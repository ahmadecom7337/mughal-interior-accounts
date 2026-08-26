-- Mobile Labour tab: weekly wage settlements and advance payments.

create table if not exists public.labour_wage_settlements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  labourer_id uuid not null references public.labourers(id) on delete restrict,
  settlement_date date not null default current_date,
  gross_wages numeric(14,2) not null check (gross_wages > 0),
  advance_applied numeric(14,2) not null default 0 check (advance_applied >= 0),
  cash_paid numeric(14,2) not null default 0 check (cash_paid >= 0),
  payment_id uuid unique references public.payments(id) on delete restrict,
  notes text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (gross_wages = advance_applied + cash_paid),
  check ((cash_paid = 0 and payment_id is null) or (cash_paid > 0 and payment_id is not null))
);

create table if not exists public.labour_wage_settlement_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  settlement_id uuid not null references public.labour_wage_settlements(id) on delete cascade,
  labour_assignment_id uuid not null unique references public.labour_assignments(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (settlement_id, labour_assignment_id)
);

create index if not exists labour_wage_settlements_business_date_idx
  on public.labour_wage_settlements(business_id, settlement_date desc, created_at desc);
create index if not exists labour_wage_settlements_labourer_idx
  on public.labour_wage_settlements(labourer_id, settlement_date desc);
create index if not exists labour_wage_settlement_items_settlement_idx
  on public.labour_wage_settlement_items(settlement_id);

alter table public.labour_wage_settlements enable row level security;
alter table public.labour_wage_settlement_items enable row level security;

drop policy if exists "Members view labour wage settlements" on public.labour_wage_settlements;
create policy "Members view labour wage settlements"
on public.labour_wage_settlements for select to authenticated
using ((select private.is_business_member(labour_wage_settlements.business_id)));

drop policy if exists "Members view labour wage settlement items" on public.labour_wage_settlement_items;
create policy "Members view labour wage settlement items"
on public.labour_wage_settlement_items for select to authenticated
using ((select private.is_business_member(labour_wage_settlement_items.business_id)));

grant select on public.labour_wage_settlements, public.labour_wage_settlement_items to authenticated;
revoke all on public.labour_wage_settlements, public.labour_wage_settlement_items from anon;

create or replace function private.record_labour_advance(
  p_business_id uuid,
  p_labourer_id uuid,
  p_payment_date date,
  p_from_account_id uuid,
  p_amount numeric,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment_id uuid := gen_random_uuid();
  v_payment_number text;
  v_year text;
  v_next integer;
  v_available numeric(14,2);
begin
  if not (select private.is_business_member(p_business_id, array['owner','manager','staff'])) then
    raise exception 'This account cannot pay labour for the selected business.';
  end if;
  if p_payment_date is null or p_amount is null or p_amount <= 0 then
    raise exception 'Payment date and an amount greater than zero are required.';
  end if;
  if char_length(trim(coalesce(p_description,''))) not between 1 and 240 then
    raise exception 'Details must contain between 1 and 240 characters.';
  end if;
  perform 1 from public.labourers l
  where l.id = p_labourer_id and l.business_id = p_business_id and l.active;
  if not found then raise exception 'The labour person is unavailable.'; end if;

  perform 1 from public.payment_accounts a
  where a.id = p_from_account_id and a.business_id = p_business_id and a.active
  for update;
  if not found then raise exception 'The payment account is unavailable.'; end if;

  select a.opening_balance + coalesce(sum(
    case when p.to_account_id = a.id then p.amount when p.from_account_id = a.id then -p.amount else 0 end
  ),0)
  into v_available
  from public.payment_accounts a
  left join public.payments p on p.business_id = a.business_id
    and (p.from_account_id = a.id or p.to_account_id = a.id)
  where a.id = p_from_account_id and a.business_id = p_business_id
  group by a.id, a.opening_balance;
  if p_amount > v_available then
    raise exception 'Insufficient account balance. Available balance is Rs. %.', v_available;
  end if;

  v_year := extract(year from p_payment_date)::text;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text || ':payment:' || v_year, 20260815));
  select coalesce(max((substring(p.payment_number from '([0-9]+)$'))::integer),0)+1
  into v_next from public.payments p
  where p.business_id = p_business_id and p.payment_number like 'MIT-' || v_year || '-%';
  v_payment_number := 'MIT-' || v_year || '-' || lpad(v_next::text,4,'0');

  insert into public.payments (
    id, business_id, payment_number, payment_type, payment_date,
    from_account_id, to_account_id, party_id, supplier_id, project_id,
    walk_in_order_id, purchase_bill_id, invoice_id, labourer_id,
    description, amount, reference, notes, created_by
  ) values (
    v_payment_id, p_business_id, v_payment_number, 'labour_advance', p_payment_date,
    p_from_account_id, null, null, null, null,
    null, null, null, p_labourer_id,
    trim(p_description), p_amount, null, null, (select auth.uid())
  );
  return v_payment_id;
end;
$$;

create or replace function public.record_labour_advance(
  p_business_id uuid,
  p_labourer_id uuid,
  p_payment_date date,
  p_from_account_id uuid,
  p_amount numeric,
  p_description text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.record_labour_advance(
    p_business_id, p_labourer_id, p_payment_date,
    p_from_account_id, p_amount, p_description
  );
$$;

create or replace function private.settle_labour_wages(
  p_business_id uuid,
  p_labourer_id uuid,
  p_settlement_date date,
  p_from_account_id uuid,
  p_notes text,
  p_assignment_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settlement_id uuid := gen_random_uuid();
  v_payment_id uuid;
  v_payment_number text;
  v_worker_name text;
  v_year text;
  v_next integer;
  v_requested integer;
  v_found integer;
  v_gross numeric(14,2);
  v_advance_available numeric(14,2);
  v_advance_applied numeric(14,2);
  v_cash_paid numeric(14,2);
  v_account_available numeric(14,2);
begin
  if not (select private.is_business_member(p_business_id, array['owner','manager','staff'])) then
    raise exception 'This account cannot pay labour for the selected business.';
  end if;
  if p_settlement_date is null or coalesce(cardinality(p_assignment_ids),0) = 0 then
    raise exception 'Payment date and at least one unpaid assignment are required.';
  end if;
  if char_length(coalesce(p_notes,'')) > 1000 then
    raise exception 'Details cannot exceed 1000 characters.';
  end if;

  select l.name into v_worker_name from public.labourers l
  where l.id = p_labourer_id and l.business_id = p_business_id;
  if v_worker_name is null then raise exception 'The labour person is unavailable.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text || ':labour:' || p_labourer_id::text, 20260826));
  select count(distinct requested_id) into v_requested
  from unnest(p_assignment_ids) as ids(requested_id);

  perform 1 from public.labour_assignments a
  where a.id = any(p_assignment_ids)
    and a.business_id = p_business_id
    and a.labourer_id = p_labourer_id
  for update;

  select count(*), sum(coalesce(a.amount, a.days * a.daily_rate))
  into v_found, v_gross
  from public.labour_assignments a
  where a.id = any(p_assignment_ids)
    and a.business_id = p_business_id
    and a.labourer_id = p_labourer_id
    and not exists (
      select 1 from public.labour_wage_settlement_items si
      where si.labour_assignment_id = a.id
    );

  if v_found <> v_requested then
    raise exception 'One or more wage assignments are unavailable or already paid. Refresh and try again.';
  end if;
  if coalesce(v_gross,0) <= 0 then raise exception 'The selected wages have no payable amount.'; end if;

  select greatest(0,
    coalesce((select sum(p.amount) from public.payments p
      where p.business_id = p_business_id and p.labourer_id = p_labourer_id
        and p.payment_type = 'labour_advance'),0)
    - coalesce((select sum(s.advance_applied) from public.labour_wage_settlements s
      where s.business_id = p_business_id and s.labourer_id = p_labourer_id),0)
  ) into v_advance_available;
  v_advance_applied := least(v_gross, v_advance_available);
  v_cash_paid := v_gross - v_advance_applied;

  if v_cash_paid > 0 then
    perform 1 from public.payment_accounts a
    where a.id = p_from_account_id and a.business_id = p_business_id and a.active
    for update;
    if not found then raise exception 'Select the bank or cash account paying these wages.'; end if;

    select a.opening_balance + coalesce(sum(
      case when p.to_account_id = a.id then p.amount when p.from_account_id = a.id then -p.amount else 0 end
    ),0)
    into v_account_available
    from public.payment_accounts a
    left join public.payments p on p.business_id = a.business_id
      and (p.from_account_id = a.id or p.to_account_id = a.id)
    where a.id = p_from_account_id and a.business_id = p_business_id
    group by a.id, a.opening_balance;
    if v_cash_paid > v_account_available then
      raise exception 'Insufficient account balance. Available balance is Rs. %.', v_account_available;
    end if;

    v_payment_id := gen_random_uuid();
    v_year := extract(year from p_settlement_date)::text;
    perform pg_advisory_xact_lock(hashtextextended(p_business_id::text || ':payment:' || v_year, 20260815));
    select coalesce(max((substring(p.payment_number from '([0-9]+)$'))::integer),0)+1
    into v_next from public.payments p
    where p.business_id = p_business_id and p.payment_number like 'MIT-' || v_year || '-%';
    v_payment_number := 'MIT-' || v_year || '-' || lpad(v_next::text,4,'0');

    insert into public.payments (
      id, business_id, payment_number, payment_type, payment_date,
      from_account_id, to_account_id, party_id, supplier_id, project_id,
      walk_in_order_id, purchase_bill_id, invoice_id, labourer_id,
      description, amount, reference, notes, created_by
    ) values (
      v_payment_id, p_business_id, v_payment_number, 'labour_payment', p_settlement_date,
      p_from_account_id, null, null, null, null,
      null, null, null, p_labourer_id,
      left(coalesce(nullif(trim(coalesce(p_notes,'')),''), 'Wage payment for ' || v_worker_name),240),
      v_cash_paid, null, null, (select auth.uid())
    );
  end if;

  insert into public.labour_wage_settlements (
    id, business_id, labourer_id, settlement_date, gross_wages,
    advance_applied, cash_paid, payment_id, notes, created_by
  ) values (
    v_settlement_id, p_business_id, p_labourer_id, p_settlement_date, v_gross,
    v_advance_applied, v_cash_paid, v_payment_id,
    nullif(trim(coalesce(p_notes,'')),''), (select auth.uid())
  );

  insert into public.labour_wage_settlement_items (
    business_id, settlement_id, labour_assignment_id, amount
  )
  select p_business_id, v_settlement_id, a.id, coalesce(a.amount, a.days * a.daily_rate)
  from public.labour_assignments a
  where a.id = any(p_assignment_ids)
    and a.business_id = p_business_id
    and a.labourer_id = p_labourer_id;

  return v_settlement_id;
end;
$$;

create or replace function public.settle_labour_wages(
  p_business_id uuid,
  p_labourer_id uuid,
  p_settlement_date date,
  p_from_account_id uuid,
  p_notes text,
  p_assignment_ids uuid[]
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.settle_labour_wages(
    p_business_id, p_labourer_id, p_settlement_date,
    p_from_account_id, p_notes, p_assignment_ids
  );
$$;

revoke execute on function private.record_labour_advance(uuid,uuid,date,uuid,numeric,text) from public, anon;
grant execute on function private.record_labour_advance(uuid,uuid,date,uuid,numeric,text) to authenticated;
revoke execute on function public.record_labour_advance(uuid,uuid,date,uuid,numeric,text) from public, anon;
grant execute on function public.record_labour_advance(uuid,uuid,date,uuid,numeric,text) to authenticated;

revoke execute on function private.settle_labour_wages(uuid,uuid,date,uuid,text,uuid[]) from public, anon;
grant execute on function private.settle_labour_wages(uuid,uuid,date,uuid,text,uuid[]) to authenticated;
revoke execute on function public.settle_labour_wages(uuid,uuid,date,uuid,text,uuid[]) from public, anon;
grant execute on function public.settle_labour_wages(uuid,uuid,date,uuid,text,uuid[]) to authenticated;

notify pgrst, 'reload schema';
