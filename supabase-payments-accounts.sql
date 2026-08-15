-- Mughal Interior Accounts — Payments, Cash & Bank Accounts

create table if not exists public.payment_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  account_type text not null check (account_type in ('Cash','Bank','Mobile Wallet')),
  bank_name text,
  account_number text,
  opening_balance numeric(14,2) not null default 0 check (opening_balance >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, name)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  payment_number text not null,
  payment_type text not null check (payment_type in ('customer_receipt','supplier_payment','income','expense','transfer')),
  payment_date date not null default current_date,
  from_account_id uuid references public.payment_accounts(id) on delete restrict,
  to_account_id uuid references public.payment_accounts(id) on delete restrict,
  party_id uuid references public.parties(id) on delete restrict,
  supplier_id uuid references public.suppliers(id) on delete restrict,
  project_id uuid references public.projects(id) on delete restrict,
  walk_in_order_id uuid references public.walk_in_orders(id) on delete restrict,
  purchase_bill_id uuid references public.purchase_bills(id) on delete restrict,
  invoice_id uuid references public.invoices(id) on delete restrict,
  description text not null check (char_length(trim(description)) between 1 and 240),
  amount numeric(14,2) not null check (amount > 0),
  reference text,
  notes text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (business_id, payment_number),
  check (
    (payment_type in ('customer_receipt','income') and from_account_id is null and to_account_id is not null)
    or (payment_type in ('supplier_payment','expense') and from_account_id is not null and to_account_id is null)
    or (payment_type = 'transfer' and from_account_id is not null and to_account_id is not null and from_account_id <> to_account_id)
  ),
  check (
    (payment_type = 'customer_receipt' and supplier_id is null and purchase_bill_id is null)
    or (payment_type = 'supplier_payment' and supplier_id is not null and purchase_bill_id is not null and party_id is null and project_id is null and walk_in_order_id is null and invoice_id is null)
    or (payment_type in ('income','expense','transfer') and party_id is null and supplier_id is null and project_id is null and walk_in_order_id is null and purchase_bill_id is null and invoice_id is null)
  )
);

alter table public.project_entries add column if not exists payment_id uuid;
alter table public.walk_in_order_entries add column if not exists payment_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'project_entries_payment_id_fkey'
      and conrelid = 'public.project_entries'::regclass
  ) then
    alter table public.project_entries
      add constraint project_entries_payment_id_fkey
      foreign key (payment_id) references public.payments(id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'walk_in_order_entries_payment_id_fkey'
      and conrelid = 'public.walk_in_order_entries'::regclass
  ) then
    alter table public.walk_in_order_entries
      add constraint walk_in_order_entries_payment_id_fkey
      foreign key (payment_id) references public.payments(id) on delete restrict;
  end if;
end $$;

create index if not exists payment_accounts_business_active_idx on public.payment_accounts(business_id, active, name);
create index if not exists payments_business_date_idx on public.payments(business_id, payment_date desc, created_at desc);
create index if not exists payments_business_type_idx on public.payments(business_id, payment_type);
create index if not exists payments_from_account_idx on public.payments(from_account_id, payment_date desc) where from_account_id is not null;
create index if not exists payments_to_account_idx on public.payments(to_account_id, payment_date desc) where to_account_id is not null;
create index if not exists payments_party_idx on public.payments(party_id) where party_id is not null;
create index if not exists payments_supplier_idx on public.payments(supplier_id) where supplier_id is not null;
create index if not exists payments_project_idx on public.payments(project_id) where project_id is not null;
create index if not exists payments_walk_in_order_idx on public.payments(walk_in_order_id) where walk_in_order_id is not null;
create index if not exists payments_purchase_bill_idx on public.payments(purchase_bill_id) where purchase_bill_id is not null;
create index if not exists payments_invoice_idx on public.payments(invoice_id) where invoice_id is not null;
create index if not exists payments_created_by_idx on public.payments(created_by);
create unique index if not exists project_entries_payment_unique_idx on public.project_entries(payment_id) where payment_id is not null;
create unique index if not exists walk_in_order_entries_payment_unique_idx on public.walk_in_order_entries(payment_id) where payment_id is not null;

drop trigger if exists payment_accounts_set_updated_at on public.payment_accounts;
create trigger payment_accounts_set_updated_at before update on public.payment_accounts
for each row execute function private.set_updated_at();

create or replace function private.protect_account_opening_balance()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.business_id <> old.business_id then
    raise exception 'An account cannot be moved to another business.';
  end if;
  if new.opening_balance <> old.opening_balance and exists (
    select 1 from public.payments p
    where p.business_id = old.business_id
      and (p.from_account_id = old.id or p.to_account_id = old.id)
  ) then
    raise exception 'Opening balance cannot be changed after transactions have been recorded.';
  end if;
  return new;
end;
$$;

drop trigger if exists payment_accounts_protect_balance on public.payment_accounts;
create trigger payment_accounts_protect_balance before update on public.payment_accounts
for each row execute function private.protect_account_opening_balance();

create or replace function private.record_payment(
  p_business_id uuid,
  p_payment_type text,
  p_payment_date date,
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_party_id uuid,
  p_supplier_id uuid,
  p_project_id uuid,
  p_walk_in_order_id uuid,
  p_purchase_bill_id uuid,
  p_invoice_id uuid,
  p_description text,
  p_amount numeric,
  p_reference text,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment_id uuid := gen_random_uuid();
  v_payment_number text;
  v_next integer;
  v_year text := extract(year from p_payment_date)::text;
  v_available numeric(14,2);
  v_due numeric(14,2);
  v_party_id uuid := p_party_id;
  v_supplier_id uuid := p_supplier_id;
  v_invoice_id uuid := p_invoice_id;
begin
  if not (select private.is_business_member(p_business_id, array['owner','manager','staff'])) then
    raise exception 'This account cannot record payments for the selected business.';
  end if;
  if p_payment_type not in ('customer_receipt','supplier_payment','income','expense','transfer') then
    raise exception 'Payment type is invalid.';
  end if;
  if p_payment_date is null or p_amount is null or p_amount <= 0 then
    raise exception 'Payment date and an amount greater than zero are required.';
  end if;
  if char_length(trim(coalesce(p_description,''))) < 1 then
    raise exception 'Payment description is required.';
  end if;

  if p_from_account_id is not null then
    perform 1 from public.payment_accounts a
    where a.id = p_from_account_id and a.business_id = p_business_id and a.active
    for update;
    if not found then raise exception 'The payment account is unavailable.'; end if;
  end if;
  if p_to_account_id is not null then
    perform 1 from public.payment_accounts a
    where a.id = p_to_account_id and a.business_id = p_business_id and a.active
    for update;
    if not found then raise exception 'The receiving account is unavailable.'; end if;
  end if;

  if p_payment_type in ('customer_receipt','income') and (p_from_account_id is not null or p_to_account_id is null) then
    raise exception 'Select the account receiving this money.';
  elsif p_payment_type in ('supplier_payment','expense') and (p_from_account_id is null or p_to_account_id is not null) then
    raise exception 'Select the account paying this money.';
  elsif p_payment_type = 'transfer' and (p_from_account_id is null or p_to_account_id is null or p_from_account_id = p_to_account_id) then
    raise exception 'Choose two different accounts for a transfer.';
  end if;

  if p_from_account_id is not null then
    select a.opening_balance + coalesce(sum(
      case when p.to_account_id = a.id then p.amount when p.from_account_id = a.id then -p.amount else 0 end
    ),0)
    into v_available
    from public.payment_accounts a
    left join public.payments p on p.business_id = a.business_id and (p.from_account_id = a.id or p.to_account_id = a.id)
    where a.id = p_from_account_id and a.business_id = p_business_id
    group by a.id, a.opening_balance;
    if p_amount > v_available then
      raise exception 'Insufficient account balance. Available balance is Rs. %.', v_available;
    end if;
  end if;

  if p_payment_type = 'customer_receipt' then
    if (p_project_id is not null)::integer + (p_walk_in_order_id is not null)::integer + (p_party_id is not null)::integer <> 1 then
      raise exception 'Choose one project, walk-in order, or party for this receipt.';
    end if;
    if p_project_id is not null then
      select pr.party_id,
        pr.original_contract_amount
        + coalesce(sum(pe.amount) filter (where pe.entry_type = 'scope_increase'),0)
        - coalesce(sum(pe.amount) filter (where pe.entry_type = 'scope_decrease'),0)
        - coalesce(sum(pe.amount) filter (where pe.entry_type = 'receipt'),0)
      into v_party_id, v_due
      from public.projects pr
      left join public.project_entries pe on pe.project_id = pr.id and pe.business_id = pr.business_id
      where pr.id = p_project_id and pr.business_id = p_business_id and pr.status = 'Approved'
      group by pr.id, pr.party_id, pr.original_contract_amount;
      if v_party_id is null then raise exception 'The approved project is unavailable.'; end if;
      if p_amount > greatest(v_due,0) then raise exception 'Receipt exceeds the project balance of Rs. %.', greatest(v_due,0); end if;
      if v_invoice_id is null then
        select i.id into v_invoice_id from public.invoices i
        where i.project_id = p_project_id and i.business_id = p_business_id limit 1;
      elsif not exists (
        select 1 from public.invoices i where i.id = v_invoice_id and i.project_id = p_project_id and i.business_id = p_business_id
      ) then
        raise exception 'The selected invoice does not belong to this project.';
      end if;
    elsif p_walk_in_order_id is not null then
      if p_invoice_id is not null then raise exception 'A walk-in receipt cannot be linked to a project invoice.'; end if;
      select w.party_id, w.amount - coalesce(sum(e.amount) filter (where e.entry_type = 'receipt'),0)
      into v_party_id, v_due
      from public.walk_in_orders w
      left join public.walk_in_order_entries e on e.walk_in_order_id = w.id and e.business_id = w.business_id
      where w.id = p_walk_in_order_id and w.business_id = p_business_id and w.status <> 'Cancelled'
      group by w.id, w.party_id, w.amount;
      if v_due is null then raise exception 'The walk-in order is unavailable.'; end if;
      if p_amount > greatest(v_due,0) then raise exception 'Receipt exceeds the order balance of Rs. %.', greatest(v_due,0); end if;
    else
      if p_invoice_id is not null then raise exception 'A general party receipt cannot be linked to a project invoice.'; end if;
      if not exists (
        select 1 from public.parties pt where pt.id = p_party_id and pt.business_id = p_business_id
      ) then
        raise exception 'The selected party is unavailable.';
      end if;
    end if;
  elsif p_payment_type = 'supplier_payment' then
    select pb.supplier_id, pb.total_amount - pb.amount_paid
    into v_supplier_id, v_due
    from public.purchase_bills pb
    where pb.id = p_purchase_bill_id and pb.business_id = p_business_id and pb.status = 'Posted'
    for update;
    if v_supplier_id is null then raise exception 'The supplier bill is unavailable.'; end if;
    if p_supplier_id is not null and p_supplier_id <> v_supplier_id then raise exception 'The supplier does not match this bill.'; end if;
    if p_amount > greatest(v_due,0) then raise exception 'Payment exceeds the bill balance of Rs. %.', greatest(v_due,0); end if;
  elsif p_payment_type in ('income','expense','transfer') and (
    p_party_id is not null or p_supplier_id is not null or p_project_id is not null
    or p_walk_in_order_id is not null or p_purchase_bill_id is not null or p_invoice_id is not null
  ) then
    raise exception 'This transaction type cannot be linked to a customer or supplier document.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text || ':payment:' || v_year, 20260815));
  select coalesce(max((substring(p.payment_number from '([0-9]+)$'))::integer),0)+1 into v_next
  from public.payments p
  where p.business_id = p_business_id and p.payment_number like 'MIT-' || v_year || '-%';
  v_payment_number := 'MIT-' || v_year || '-' || lpad(v_next::text,4,'0');

  insert into public.payments (
    id, business_id, payment_number, payment_type, payment_date,
    from_account_id, to_account_id, party_id, supplier_id, project_id,
    walk_in_order_id, purchase_bill_id, invoice_id, description, amount,
    reference, notes, created_by
  ) values (
    v_payment_id, p_business_id, v_payment_number, p_payment_type, p_payment_date,
    p_from_account_id, p_to_account_id, v_party_id, v_supplier_id, p_project_id,
    p_walk_in_order_id, p_purchase_bill_id, v_invoice_id, trim(p_description), p_amount,
    nullif(trim(coalesce(p_reference,'')),''), nullif(trim(coalesce(p_notes,'')),''), (select auth.uid())
  );

  if p_payment_type = 'customer_receipt' and p_project_id is not null then
    insert into public.project_entries (
      business_id, project_id, entry_type, entry_date, description, amount, notes, payment_id
    ) values (
      p_business_id, p_project_id, 'receipt', p_payment_date, trim(p_description), p_amount,
      concat_ws(' · ', nullif(trim(coalesce(p_reference,'')),''), nullif(trim(coalesce(p_notes,'')),'')), v_payment_id
    );
    update public.invoices i set status = 'Paid'
    where i.project_id = p_project_id and i.business_id = p_business_id
      and i.amount <= (
        select coalesce(sum(pe.amount),0) from public.project_entries pe
        where pe.project_id = p_project_id and pe.business_id = p_business_id and pe.entry_type = 'receipt'
      );
  elsif p_payment_type = 'customer_receipt' and p_walk_in_order_id is not null then
    insert into public.walk_in_order_entries (
      business_id, walk_in_order_id, entry_type, entry_date, description, amount, notes, payment_id
    ) values (
      p_business_id, p_walk_in_order_id, 'receipt', p_payment_date, trim(p_description), p_amount,
      concat_ws(' · ', nullif(trim(coalesce(p_reference,'')),''), nullif(trim(coalesce(p_notes,'')),'')), v_payment_id
    );
  elsif p_payment_type = 'supplier_payment' then
    update public.purchase_bills pb
    set amount_paid = pb.amount_paid + p_amount,
        payment_status = case when pb.amount_paid + p_amount >= pb.total_amount then 'Paid' else 'Partly Paid' end
    where pb.id = p_purchase_bill_id and pb.business_id = p_business_id;
  end if;

  return v_payment_id;
end;
$$;

create or replace function public.record_payment(
  p_business_id uuid,
  p_payment_type text,
  p_payment_date date,
  p_from_account_id uuid default null,
  p_to_account_id uuid default null,
  p_party_id uuid default null,
  p_supplier_id uuid default null,
  p_project_id uuid default null,
  p_walk_in_order_id uuid default null,
  p_purchase_bill_id uuid default null,
  p_invoice_id uuid default null,
  p_description text default null,
  p_amount numeric default null,
  p_reference text default null,
  p_notes text default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.record_payment(
    p_business_id, p_payment_type, p_payment_date, p_from_account_id, p_to_account_id,
    p_party_id, p_supplier_id, p_project_id, p_walk_in_order_id, p_purchase_bill_id,
    p_invoice_id, p_description, p_amount, p_reference, p_notes
  );
$$;

create or replace function private.create_business_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare new_business_id uuid;
begin
  insert into public.businesses(name, owner_id)
  values ('Mughal Interior', new.id)
  returning id into new_business_id;
  insert into public.business_members(business_id, user_id, role)
  values (new_business_id, new.id, 'owner');
  insert into public.payment_accounts(business_id, name, account_type, opening_balance)
  values (new_business_id, 'Cash', 'Cash', 0);
  return new;
end;
$$;

insert into public.payment_accounts (business_id, name, account_type, opening_balance)
select b.id, 'Cash', 'Cash', 0
from public.businesses b
where not exists (
  select 1 from public.payment_accounts a where a.business_id = b.id
);

alter table public.payment_accounts enable row level security;
alter table public.payments enable row level security;

create policy "Members view payment accounts" on public.payment_accounts for select to authenticated
using ((select private.is_business_member(business_id)));
create policy "Members add payment accounts" on public.payment_accounts for insert to authenticated
with check ((select private.is_business_member(business_id, array['owner','manager','staff'])));
create policy "Members update payment accounts" on public.payment_accounts for update to authenticated
using ((select private.is_business_member(business_id, array['owner','manager','staff'])))
with check ((select private.is_business_member(business_id, array['owner','manager','staff'])));
create policy "Members view payments" on public.payments for select to authenticated
using ((select private.is_business_member(business_id)));

grant select, insert, update on public.payment_accounts to authenticated;
grant select on public.payments to authenticated;
revoke all on public.payment_accounts, public.payments from anon;
revoke execute on function private.record_payment(uuid,text,date,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,numeric,text,text) from public, anon;
grant execute on function private.record_payment(uuid,text,date,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,numeric,text,text) to authenticated;
revoke execute on function public.record_payment(uuid,text,date,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,numeric,text,text) from public, anon;
grant execute on function public.record_payment(uuid,text,date,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,numeric,text,text) to authenticated;

notify pgrst, 'reload schema';
