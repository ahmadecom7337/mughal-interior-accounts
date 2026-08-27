-- Mughal Interior and Decor — print defaults and accounting corrections.

alter table public.businesses
  add column if not exists document_disclaimer text not null default
    'Prices are subject to change until approval and advance payment. After approval, prices remain fixed unless scope of work or material/site costs change.';

grant update (document_disclaimer) on public.businesses to authenticated;

insert into public.payment_accounts (business_id, name, account_type, opening_balance)
select b.id, 'Cash', 'Cash', 0
from public.businesses b
where not exists (
  select 1 from public.payment_accounts a
  where a.business_id = b.id and a.account_type = 'Cash' and a.active
);

-- One assignment can now be settled in several partial wage payments.
alter table public.labour_wage_settlement_items
  drop constraint if exists labour_wage_settlement_items_labour_assignment_id_key;

create index if not exists labour_wage_settlement_items_assignment_idx
  on public.labour_wage_settlement_items(labour_assignment_id);

-- Keep every existing target restriction, allowing only supplier payments to
-- omit a specific purchase bill for automatic allocation.
alter table public.payments drop constraint payments_check1;
alter table public.payments add constraint payments_check1 check (
  (payment_type='customer_receipt' and supplier_id is null and purchase_bill_id is null and labourer_id is null)
  or (payment_type='supplier_payment' and supplier_id is not null and party_id is null and project_id is null and walk_in_order_id is null and invoice_id is null and labourer_id is null)
  or (payment_type='expense' and party_id is null and supplier_id is null and purchase_bill_id is null and invoice_id is null and labourer_id is null and num_nonnulls(project_id,walk_in_order_id)<=1)
  or (payment_type in ('income','transfer') and party_id is null and supplier_id is null and project_id is null and walk_in_order_id is null and purchase_bill_id is null and invoice_id is null and labourer_id is null)
  or (payment_type in ('labour_payment','labour_advance') and labourer_id is not null and party_id is null and supplier_id is null and project_id is null and walk_in_order_id is null and purchase_bill_id is null and invoice_id is null)
);

create or replace function private.settle_labour_wages(
  p_business_id uuid,
  p_labourer_id uuid,
  p_settlement_date date,
  p_from_account_id uuid,
  p_notes text,
  p_assignment_ids uuid[],
  p_amount numeric
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
  v_total_due numeric(14,2);
  v_advance_available numeric(14,2);
  v_advance_applied numeric(14,2);
  v_cash_paid numeric(14,2);
  v_account_available numeric(14,2);
  v_remaining numeric(14,2) := p_amount;
  v_apply numeric(14,2);
  v_requested integer;
  v_found integer;
  v_row record;
begin
  if not (select private.is_business_member(p_business_id, array['owner','manager','staff'])) then
    raise exception 'This account cannot pay labour for the selected business.';
  end if;
  if p_settlement_date is null or coalesce(cardinality(p_assignment_ids),0)=0 or coalesce(p_amount,0)<=0 then
    raise exception 'Payment date, labour assignments and an amount greater than zero are required.';
  end if;
  if char_length(coalesce(p_notes,''))>1000 then raise exception 'Details cannot exceed 1000 characters.'; end if;

  select l.name into v_worker_name from public.labourers l
  where l.id=p_labourer_id and l.business_id=p_business_id;
  if v_worker_name is null then raise exception 'The labour person is unavailable.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':labour:'||p_labourer_id::text,20260826));
  perform 1 from public.labour_assignments a
  where a.id=any(p_assignment_ids) and a.business_id=p_business_id and a.labourer_id=p_labourer_id
  for update;
  select count(distinct requested_id) into v_requested from unnest(p_assignment_ids) ids(requested_id);
  select count(*) into v_found from public.labour_assignments a
  where a.id=any(p_assignment_ids) and a.business_id=p_business_id and a.labourer_id=p_labourer_id;
  if v_found<>v_requested then raise exception 'One or more wage assignments are unavailable. Refresh and try again.'; end if;

  select coalesce(sum(greatest(0,coalesce(a.amount,a.days*a.daily_rate)-coalesce(paid.amount,0))),0)
  into v_total_due
  from public.labour_assignments a
  left join (
    select i.labour_assignment_id,sum(i.amount) amount
    from public.labour_wage_settlement_items i
    where i.business_id=p_business_id
    group by i.labour_assignment_id
  ) paid on paid.labour_assignment_id=a.id
  where a.id=any(p_assignment_ids) and a.business_id=p_business_id and a.labourer_id=p_labourer_id;

  if v_total_due<=0 then raise exception 'The selected wages have no outstanding balance.'; end if;
  if p_amount>v_total_due then raise exception 'Payment exceeds outstanding wages of Rs. %.',v_total_due; end if;

  select greatest(0,
    coalesce((select sum(p.amount) from public.payments p where p.business_id=p_business_id and p.labourer_id=p_labourer_id and p.payment_type='labour_advance'),0)
    - coalesce((select sum(s.advance_applied) from public.labour_wage_settlements s where s.business_id=p_business_id and s.labourer_id=p_labourer_id),0)
  ) into v_advance_available;
  v_advance_applied:=least(p_amount,v_advance_available);
  v_cash_paid:=p_amount-v_advance_applied;

  if v_cash_paid>0 then
    perform 1 from public.payment_accounts a
    where a.id=p_from_account_id and a.business_id=p_business_id and a.active for update;
    if not found then raise exception 'Select the bank or cash account paying these wages.'; end if;
    select a.opening_balance+coalesce(sum(case when p.to_account_id=a.id then p.amount when p.from_account_id=a.id then -p.amount else 0 end),0)
    into v_account_available
    from public.payment_accounts a
    left join public.payments p on p.business_id=a.business_id and (p.from_account_id=a.id or p.to_account_id=a.id)
    where a.id=p_from_account_id and a.business_id=p_business_id
    group by a.id,a.opening_balance;
    if v_cash_paid>v_account_available then raise exception 'Insufficient account balance. Available balance is Rs. %.',v_account_available; end if;

    v_payment_id:=gen_random_uuid();
    v_year:=extract(year from p_settlement_date)::text;
    perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':payment:'||v_year,20260815));
    select coalesce(max((substring(p.payment_number from '([0-9]+)$'))::integer),0)+1 into v_next
    from public.payments p where p.business_id=p_business_id and p.payment_number like 'MIT-'||v_year||'-%';
    v_payment_number:='MIT-'||v_year||'-'||lpad(v_next::text,4,'0');
    insert into public.payments(id,business_id,payment_number,payment_type,payment_date,from_account_id,labourer_id,description,amount,created_by)
    values(v_payment_id,p_business_id,v_payment_number,'labour_payment',p_settlement_date,p_from_account_id,p_labourer_id,
      left(coalesce(nullif(trim(coalesce(p_notes,'')),''),'Wage payment for '||v_worker_name),240),v_cash_paid,(select auth.uid()));
  end if;

  insert into public.labour_wage_settlements(id,business_id,labourer_id,settlement_date,gross_wages,advance_applied,cash_paid,payment_id,notes,created_by)
  values(v_settlement_id,p_business_id,p_labourer_id,p_settlement_date,p_amount,v_advance_applied,v_cash_paid,v_payment_id,
    nullif(trim(coalesce(p_notes,'')),''),(select auth.uid()));

  for v_row in
    select a.id,greatest(0,coalesce(a.amount,a.days*a.daily_rate)-coalesce(paid.amount,0)) due
    from public.labour_assignments a
    left join (
      select i.labour_assignment_id,sum(i.amount) amount
      from public.labour_wage_settlement_items i
      where i.business_id=p_business_id
      group by i.labour_assignment_id
    ) paid on paid.labour_assignment_id=a.id
    where a.id=any(p_assignment_ids) and a.business_id=p_business_id and a.labourer_id=p_labourer_id
    order by a.assignment_date,a.created_at,a.id
  loop
    exit when v_remaining<=0;
    v_apply:=least(v_remaining,v_row.due);
    if v_apply>0 then
      insert into public.labour_wage_settlement_items(business_id,settlement_id,labour_assignment_id,amount)
      values(p_business_id,v_settlement_id,v_row.id,v_apply);
      v_remaining:=v_remaining-v_apply;
    end if;
  end loop;
  return v_settlement_id;
end;
$$;

create or replace function public.settle_labour_wages(
  p_business_id uuid,
  p_labourer_id uuid,
  p_settlement_date date,
  p_from_account_id uuid,
  p_notes text,
  p_assignment_ids uuid[],
  p_amount numeric
)
returns uuid language sql security invoker set search_path='' as $$
  select private.settle_labour_wages(p_business_id,p_labourer_id,p_settlement_date,p_from_account_id,p_notes,p_assignment_ids,p_amount);
$$;

revoke execute on function private.settle_labour_wages(uuid,uuid,date,uuid,text,uuid[],numeric) from public,anon;
grant execute on function private.settle_labour_wages(uuid,uuid,date,uuid,text,uuid[],numeric) to authenticated;
revoke execute on function public.settle_labour_wages(uuid,uuid,date,uuid,text,uuid[],numeric) from public,anon;
grant execute on function public.settle_labour_wages(uuid,uuid,date,uuid,text,uuid[],numeric) to authenticated;

-- Compatibility for the currently deployed six-argument wage dialog.
create or replace function private.settle_labour_wages(
  p_business_id uuid,p_labourer_id uuid,p_settlement_date date,
  p_from_account_id uuid,p_notes text,p_assignment_ids uuid[]
)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_due numeric(14,2);
begin
  if not (select private.is_business_member(p_business_id,array['owner','manager','staff'])) then
    raise exception 'This account cannot pay labour for the selected business.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':labour:'||p_labourer_id::text,20260826));
  select coalesce(sum(greatest(0,coalesce(a.amount,a.days*a.daily_rate)-coalesce((
    select sum(i.amount) from public.labour_wage_settlement_items i
    where i.business_id=p_business_id and i.labour_assignment_id=a.id
  ),0))),0) into v_due
  from public.labour_assignments a
  where a.business_id=p_business_id and a.labourer_id=p_labourer_id and a.id=any(p_assignment_ids);
  return private.settle_labour_wages(p_business_id,p_labourer_id,p_settlement_date,p_from_account_id,p_notes,p_assignment_ids,v_due);
end;
$$;
revoke execute on function private.settle_labour_wages(uuid,uuid,date,uuid,text,uuid[]) from public,anon;
grant execute on function private.settle_labour_wages(uuid,uuid,date,uuid,text,uuid[]) to authenticated;

-- Supplier payments use the supplier's total balance and are allocated oldest-first.
create or replace function private.record_supplier_payment(
  p_business_id uuid,
  p_supplier_id uuid,
  p_payment_date date,
  p_from_account_id uuid,
  p_amount numeric,
  p_description text
)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_payment_id uuid:=gen_random_uuid(); v_payment_number text; v_year text; v_next integer;
  v_available numeric(14,2); v_remaining numeric(14,2):=p_amount; v_apply numeric(14,2); v_bill record; v_last_bill uuid;
begin
  if not (select private.is_business_member(p_business_id,array['owner','manager','staff'])) then raise exception 'This account cannot pay suppliers for the selected business.'; end if;
  if p_payment_date is null or coalesce(p_amount,0)<=0 then raise exception 'Payment date and an amount greater than zero are required.'; end if;
  if not exists(select 1 from public.suppliers s where s.id=p_supplier_id and s.business_id=p_business_id and s.active) then raise exception 'The supplier is unavailable.'; end if;
  if not exists(select 1 from public.purchase_bills b where b.supplier_id=p_supplier_id and b.business_id=p_business_id and b.status='Posted') then raise exception 'This supplier has no posted purchases.'; end if;
  perform 1 from public.payment_accounts a where a.id=p_from_account_id and a.business_id=p_business_id and a.active for update;
  if not found then raise exception 'The payment account is unavailable.'; end if;
  select a.opening_balance+coalesce(sum(case when p.to_account_id=a.id then p.amount when p.from_account_id=a.id then -p.amount else 0 end),0)
  into v_available from public.payment_accounts a left join public.payments p on p.business_id=a.business_id and (p.from_account_id=a.id or p.to_account_id=a.id)
  where a.id=p_from_account_id and a.business_id=p_business_id group by a.id,a.opening_balance;
  if p_amount>v_available then raise exception 'Insufficient account balance. Available balance is Rs. %.',v_available; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':supplier:'||p_supplier_id::text,20260827));
  for v_bill in select b.id,greatest(0,b.total_amount-b.amount_paid) due from public.purchase_bills b
    where b.supplier_id=p_supplier_id and b.business_id=p_business_id and b.status='Posted'
    order by b.bill_date,b.created_at,b.id for update
  loop
    v_last_bill:=v_bill.id; exit when v_remaining<=0; v_apply:=least(v_remaining,v_bill.due);
    if v_apply>0 then update public.purchase_bills set amount_paid=amount_paid+v_apply,payment_status=case when amount_paid+v_apply>=total_amount then 'Paid' else 'Partly Paid' end where id=v_bill.id; v_remaining:=v_remaining-v_apply; end if;
  end loop;
  if v_remaining>0 and v_last_bill is not null then update public.purchase_bills set amount_paid=amount_paid+v_remaining,payment_status='Paid' where id=v_last_bill; end if;

  v_year:=extract(year from p_payment_date)::text;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':payment:'||v_year,20260815));
  select coalesce(max((substring(payment_number from '([0-9]+)$'))::integer),0)+1 into v_next from public.payments where business_id=p_business_id and payment_number like 'MIT-'||v_year||'-%';
  v_payment_number:='MIT-'||v_year||'-'||lpad(v_next::text,4,'0');
  insert into public.payments(id,business_id,payment_number,payment_type,payment_date,from_account_id,supplier_id,description,amount,created_by)
  values(v_payment_id,p_business_id,v_payment_number,'supplier_payment',p_payment_date,p_from_account_id,p_supplier_id,
    left(coalesce(nullif(trim(coalesce(p_description,'')),''),'Supplier payment'),240),p_amount,(select auth.uid()));
  return v_payment_id;
end;
$$;

create or replace function public.record_supplier_payment(p_business_id uuid,p_supplier_id uuid,p_payment_date date,p_from_account_id uuid,p_amount numeric,p_description text)
returns uuid language sql security invoker set search_path='' as $$
  select private.record_supplier_payment(p_business_id,p_supplier_id,p_payment_date,p_from_account_id,p_amount,p_description);
$$;

revoke execute on function private.record_supplier_payment(uuid,uuid,date,uuid,numeric,text) from public,anon;
grant execute on function private.record_supplier_payment(uuid,uuid,date,uuid,numeric,text) to authenticated;
revoke execute on function public.record_supplier_payment(uuid,uuid,date,uuid,numeric,text) from public,anon;
grant execute on function public.record_supplier_payment(uuid,uuid,date,uuid,numeric,text) to authenticated;

notify pgrst,'reload schema';
