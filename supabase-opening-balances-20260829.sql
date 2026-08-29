-- Mughal Interior Accounts — opening balances for materials, suppliers and projects.
begin;

alter table public.materials
  add column if not exists opening_quantity numeric(14,3) not null default 0,
  add column if not exists opening_amount numeric(14,2) not null default 0;

alter table public.materials drop constraint if exists materials_opening_quantity_check;
alter table public.materials add constraint materials_opening_quantity_check
  check (opening_quantity >= 0);
alter table public.materials drop constraint if exists materials_opening_amount_check;
alter table public.materials add constraint materials_opening_amount_check
  check (opening_amount >= 0);
alter table public.materials drop constraint if exists materials_opening_tracking_check;
alter table public.materials add constraint materials_opening_tracking_check
  check (
    (tracking_type = 'stock' and opening_amount = 0)
    or (tracking_type = 'consumable' and opening_quantity = 0)
  );

alter table public.suppliers
  add column if not exists opening_amount numeric(14,2) not null default 0,
  add column if not exists opening_amount_paid numeric(14,2) not null default 0;

alter table public.suppliers drop constraint if exists suppliers_opening_amount_check;
alter table public.suppliers add constraint suppliers_opening_amount_check
  check (opening_amount >= 0);
alter table public.suppliers drop constraint if exists suppliers_opening_amount_paid_check;
alter table public.suppliers add constraint suppliers_opening_amount_paid_check
  check (opening_amount_paid >= 0 and opening_amount_paid <= opening_amount);

alter table public.projects
  add column if not exists opening_invoice_amount numeric(14,2) not null default 0,
  add column if not exists opening_received_amount numeric(14,2) not null default 0,
  add column if not exists opening_expenses_amount numeric(14,2) not null default 0,
  add column if not exists opening_material_amount numeric(14,2) not null default 0,
  add column if not exists opening_labour_amount numeric(14,2) not null default 0;

alter table public.projects drop constraint if exists projects_opening_amounts_check;
alter table public.projects add constraint projects_opening_amounts_check check (
  opening_invoice_amount >= 0
  and opening_received_amount >= 0
  and opening_expenses_amount >= 0
  and opening_material_amount >= 0
  and opening_labour_amount >= 0
);

alter table public.projects
  add column if not exists opening_balance_receivable numeric(14,2)
    generated always as (opening_invoice_amount - opening_received_amount) stored,
  add column if not exists opening_current_profit numeric(14,2)
    generated always as (
      opening_invoice_amount - opening_expenses_amount - opening_material_amount - opening_labour_amount
    ) stored;

comment on column public.materials.opening_quantity is 'Trackable quantity held before the first app transaction.';
comment on column public.materials.opening_amount is 'Consumable pool value held before the first app transaction.';
comment on column public.suppliers.opening_amount is 'Amount payable before the first supplier bill entered in the app.';
comment on column public.projects.opening_balance_receivable is 'Calculated project receivable brought into the app.';
comment on column public.projects.opening_current_profit is 'Calculated project profit brought into the app before later costs.';

-- Opening material is part of available stock without creating a fake purchase movement.
create or replace function private.check_material_stock()
returns trigger language plpgsql set search_path='' as $$
declare available numeric(16,2); returnable numeric(16,2); v_consumable boolean; requested numeric(16,2); v_opening numeric(16,2);
begin
  if new.project_id is not null and exists(
    select 1 from public.projects p where p.id=new.project_id and p.business_id=new.business_id and p.closed
  ) then raise exception 'This project is closed and cannot receive material transactions.'; end if;

  select m.tracking_type='consumable',case when m.tracking_type='consumable' then m.opening_amount else m.opening_quantity end
  into v_consumable,v_opening from public.materials m
  where m.id=new.material_id and m.business_id=new.business_id for update;
  if not found then raise exception 'The selected material is unavailable.'; end if;
  requested:=case when v_consumable then new.quantity*new.unit_cost else new.quantity end;

  if new.movement_type in ('project_issue','walk_in_issue','adjustment_out') then
    select v_opening+coalesce(sum(case
      when mm.movement_type in ('purchase','adjustment_in','walk_in_return','project_return')
        then case when v_consumable then mm.quantity*mm.unit_cost else mm.quantity end
      else -(case when v_consumable then mm.quantity*mm.unit_cost else mm.quantity end) end),0)
    into available from public.material_movements mm
    where mm.material_id=new.material_id and mm.business_id=new.business_id;
    if requested>available then
      raise exception 'Insufficient material balance. Available % is %.',case when v_consumable then 'amount' else 'quantity' end,available;
    end if;
  elsif new.movement_type='walk_in_return' then
    select coalesce(sum(case when mm.movement_type='walk_in_issue' then case when v_consumable then mm.quantity*mm.unit_cost else mm.quantity end
      when mm.movement_type='walk_in_return' then -(case when v_consumable then mm.quantity*mm.unit_cost else mm.quantity end) else 0 end),0)
    into returnable from public.material_movements mm
    where mm.material_id=new.material_id and mm.business_id=new.business_id and mm.walk_in_order_id=new.walk_in_order_id;
    if requested>returnable then raise exception 'Return exceeds the amount or quantity assigned to this order. Returnable balance is %.',returnable; end if;
  elsif new.movement_type='project_return' then
    select coalesce(sum(case when mm.movement_type='project_issue' then case when v_consumable then mm.quantity*mm.unit_cost else mm.quantity end
      when mm.movement_type='project_return' then -(case when v_consumable then mm.quantity*mm.unit_cost else mm.quantity end) else 0 end),0)
    into returnable from public.material_movements mm
    where mm.material_id=new.material_id and mm.business_id=new.business_id and mm.project_id=new.project_id;
    if requested>returnable then raise exception 'Return exceeds the amount or quantity assigned to this project. Returnable balance is %.',returnable; end if;
  end if;
  return new;
end;
$$;

-- Supplier payments settle the opening payable first, then posted bills oldest-first.
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
  v_available numeric(14,2); v_remaining numeric(14,2):=p_amount; v_apply numeric(14,2); v_bill record;
  v_opening_due numeric(14,2); v_bill_due numeric(14,2); v_total_due numeric(14,2);
begin
  if not (select private.is_business_member(p_business_id,array['owner','manager','staff'])) then raise exception 'This account cannot pay suppliers for the selected business.'; end if;
  if p_payment_date is null or coalesce(p_amount,0)<=0 then raise exception 'Payment date and an amount greater than zero are required.'; end if;
  perform 1 from public.suppliers s where s.id=p_supplier_id and s.business_id=p_business_id and s.active for update;
  if not found then raise exception 'The supplier is unavailable.'; end if;
  perform 1 from public.payment_accounts a where a.id=p_from_account_id and a.business_id=p_business_id and a.active for update;
  if not found then raise exception 'The payment account is unavailable.'; end if;
  select a.opening_balance+coalesce(sum(case when p.to_account_id=a.id then p.amount when p.from_account_id=a.id then -p.amount else 0 end),0)
  into v_available from public.payment_accounts a left join public.payments p on p.business_id=a.business_id and (p.from_account_id=a.id or p.to_account_id=a.id)
  where a.id=p_from_account_id and a.business_id=p_business_id group by a.id,a.opening_balance;
  if p_amount>v_available then raise exception 'Insufficient account balance. Available balance is Rs. %.',v_available; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':supplier:'||p_supplier_id::text,20260829));
  select greatest(0,s.opening_amount-s.opening_amount_paid) into v_opening_due
  from public.suppliers s where s.id=p_supplier_id and s.business_id=p_business_id for update;
  select coalesce(sum(greatest(0,b.total_amount-b.amount_paid)),0) into v_bill_due
  from public.purchase_bills b where b.supplier_id=p_supplier_id and b.business_id=p_business_id and b.status='Posted';
  v_total_due:=v_opening_due+v_bill_due;
  if v_total_due<=0 then raise exception 'This supplier has no outstanding balance.'; end if;
  if p_amount>v_total_due then raise exception 'Payment exceeds the outstanding supplier balance of Rs. %.',v_total_due; end if;

  v_apply:=least(v_remaining,v_opening_due);
  if v_apply>0 then
    update public.suppliers set opening_amount_paid=opening_amount_paid+v_apply where id=p_supplier_id and business_id=p_business_id;
    v_remaining:=v_remaining-v_apply;
  end if;

  for v_bill in select b.id,greatest(0,b.total_amount-b.amount_paid) due from public.purchase_bills b
    where b.supplier_id=p_supplier_id and b.business_id=p_business_id and b.status='Posted'
    order by b.bill_date,b.created_at,b.id for update
  loop
    exit when v_remaining<=0; v_last_bill:=v_bill.id; v_apply:=least(v_remaining,v_bill.due);
    if v_apply>0 then
      update public.purchase_bills set amount_paid=amount_paid+v_apply,payment_status=case when amount_paid+v_apply>=total_amount then 'Paid' else 'Partly Paid' end where id=v_bill.id;
      v_remaining:=v_remaining-v_apply;
    end if;
  end loop;

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

revoke execute on function private.record_supplier_payment(uuid,uuid,date,uuid,numeric,text) from public,anon;
grant execute on function private.record_supplier_payment(uuid,uuid,date,uuid,numeric,text) to authenticated;

notify pgrst,'reload schema';
commit;
