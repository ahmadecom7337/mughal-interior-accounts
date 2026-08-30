-- Mughal Interior Accounts — bank-backed job expenses, partner drawings,
-- editable operational entries, opening material rates and cash supplier names.
begin;

alter table public.materials
  add column if not exists opening_rate numeric(14,2) not null default 0;
alter table public.materials drop constraint if exists materials_opening_rate_check;
alter table public.materials add constraint materials_opening_rate_check check (opening_rate >= 0);
comment on column public.materials.opening_rate is 'Cost per unit used to value opening trackable stock.';

alter table public.purchase_bills
  add column if not exists cash_supplier_name text;
alter table public.purchase_bills drop constraint if exists purchase_bills_cash_supplier_name_check;
alter table public.purchase_bills add constraint purchase_bills_cash_supplier_name_check
  check (cash_supplier_name is null or char_length(trim(cash_supplier_name)) between 1 and 160);

alter table public.payments drop constraint if exists payments_payment_type_check;
alter table public.payments add constraint payments_payment_type_check
  check (payment_type in ('customer_receipt','supplier_payment','income','expense','transfer','labour_payment','labour_advance','partner_drawing'));
alter table public.payments drop constraint if exists payments_check;
alter table public.payments add constraint payments_check check (
  (payment_type in ('customer_receipt','income') and from_account_id is null and to_account_id is not null)
  or (payment_type in ('supplier_payment','expense','labour_payment','labour_advance','partner_drawing') and from_account_id is not null and to_account_id is null)
  or (payment_type='transfer' and from_account_id is not null and to_account_id is not null and from_account_id<>to_account_id)
);
alter table public.payments drop constraint if exists payments_check1;
alter table public.payments add constraint payments_check1 check (
  (payment_type='customer_receipt' and supplier_id is null and purchase_bill_id is null and labourer_id is null)
  or (payment_type='supplier_payment' and supplier_id is not null and party_id is null and project_id is null and walk_in_order_id is null and invoice_id is null and labourer_id is null)
  or (payment_type='expense' and party_id is null and supplier_id is null and purchase_bill_id is null and invoice_id is null and labourer_id is null and num_nonnulls(project_id,walk_in_order_id)<=1)
  or (payment_type in ('income','transfer','partner_drawing') and party_id is null and supplier_id is null and project_id is null and walk_in_order_id is null and purchase_bill_id is null and invoice_id is null and labourer_id is null)
  or (payment_type in ('labour_payment','labour_advance') and labourer_id is not null and party_id is null and supplier_id is null and project_id is null and walk_in_order_id is null and purchase_bill_id is null and invoice_id is null)
);

drop policy if exists "Members update material movements" on public.material_movements;
create policy "Members update material movements" on public.material_movements for update to authenticated
using ((select private.is_business_member(material_movements.business_id,array['owner','manager','staff'])))
with check ((select private.is_business_member(material_movements.business_id,array['owner','manager','staff'])));
grant update on public.material_movements to authenticated;

drop policy if exists "Members update labour assignments" on public.labour_assignments;
create policy "Members update labour assignments" on public.labour_assignments for update to authenticated
using ((select private.is_business_member(labour_assignments.business_id,array['owner','manager','staff'])))
with check ((select private.is_business_member(labour_assignments.business_id,array['owner','manager','staff'])));
grant update on public.labour_assignments to authenticated;

-- Validate the replacement movement against stock excluding its previous value.
create or replace function private.check_material_stock()
returns trigger language plpgsql set search_path='' as $$
declare available numeric(16,2); returnable numeric(16,2); v_consumable boolean; requested numeric(16,2); v_opening numeric(16,2);
begin
  if new.project_id is not null and exists(select 1 from public.projects p where p.id=new.project_id and p.business_id=new.business_id and p.closed)
    then raise exception 'This project is closed and cannot receive material transactions.'; end if;
  select m.tracking_type='consumable',case when m.tracking_type='consumable' then m.opening_amount else m.opening_quantity end
    into v_consumable,v_opening from public.materials m where m.id=new.material_id and m.business_id=new.business_id for update;
  if not found then raise exception 'The selected material is unavailable.'; end if;
  requested:=case when v_consumable then new.quantity*new.unit_cost else new.quantity end;
  if new.movement_type in ('project_issue','walk_in_issue','adjustment_out') then
    select v_opening+coalesce(sum(case when mm.movement_type in ('purchase','adjustment_in','walk_in_return','project_return')
      then case when v_consumable then mm.quantity*mm.unit_cost else mm.quantity end
      else -(case when v_consumable then mm.quantity*mm.unit_cost else mm.quantity end) end),0)
    into available from public.material_movements mm
    where mm.material_id=new.material_id and mm.business_id=new.business_id and (tg_op='INSERT' or mm.id<>old.id);
    if requested>available then raise exception 'Insufficient material balance. Available % is %.',case when v_consumable then 'amount' else 'quantity' end,available; end if;
  elsif new.movement_type in ('walk_in_return','project_return') then
    select coalesce(sum(case
      when mm.movement_type=case when new.movement_type='walk_in_return' then 'walk_in_issue' else 'project_issue' end then case when v_consumable then mm.quantity*mm.unit_cost else mm.quantity end
      when mm.movement_type=new.movement_type then -(case when v_consumable then mm.quantity*mm.unit_cost else mm.quantity end) else 0 end),0)
    into returnable from public.material_movements mm
    where mm.material_id=new.material_id and mm.business_id=new.business_id
      and mm.project_id is not distinct from new.project_id and mm.walk_in_order_id is not distinct from new.walk_in_order_id
      and (tg_op='INSERT' or mm.id<>old.id);
    if requested>returnable then raise exception 'Return exceeds the amount or quantity assigned to this job. Returnable balance is %.',returnable; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists material_movements_check_stock on public.material_movements;
create trigger material_movements_check_stock before insert or update on public.material_movements
for each row execute function private.check_material_stock();

create or replace function private.next_payment_number(p_business_id uuid,p_day date)
returns text language plpgsql security invoker set search_path='' as $$
declare v_year text:=extract(year from p_day)::text; v_next integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':payment:'||v_year,20260815));
  select coalesce(max((substring(p.payment_number from '([0-9]+)$'))::integer),0)+1 into v_next
  from public.payments p where p.business_id=p_business_id and p.payment_number like 'MIT-'||v_year||'-%';
  return 'MIT-'||v_year||'-'||lpad(v_next::text,4,'0');
end;
$$;

create or replace function private.account_available(p_business_id uuid,p_account_id uuid,p_exclude_payment uuid default null)
returns numeric language sql security invoker set search_path='' stable as $$
  select a.opening_balance+coalesce(sum(case when p.to_account_id=a.id then p.amount when p.from_account_id=a.id then -p.amount else 0 end),0)
  from public.payment_accounts a left join public.payments p
    on p.business_id=a.business_id and (p.from_account_id=a.id or p.to_account_id=a.id) and p.id is distinct from p_exclude_payment
  where a.id=p_account_id and a.business_id=p_business_id and a.active group by a.id,a.opening_balance
$$;

create or replace function private.record_job_expense(
  p_business_id uuid,p_project_id uuid,p_walk_in_order_id uuid,p_entry_date date,
  p_expense_category_id uuid,p_from_account_id uuid,p_amount numeric,p_notes text
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_payment uuid:=gen_random_uuid(); v_entry uuid; v_name text; v_number text;
begin
  if not (select private.is_business_member(p_business_id,array['owner','manager','staff'])) then raise exception 'This account cannot record expenses.'; end if;
  if num_nonnulls(p_project_id,p_walk_in_order_id)<>1 or p_entry_date is null or coalesce(p_amount,0)<=0 then raise exception 'Complete the job, date and amount.'; end if;
  select c.name into v_name from public.expense_categories c where c.id=p_expense_category_id and c.business_id=p_business_id and c.active;
  if v_name is null then raise exception 'The expense type is unavailable.'; end if;
  if coalesce(private.account_available(p_business_id,p_from_account_id),-1)<p_amount then raise exception 'The selected account has insufficient balance.'; end if;
  if p_project_id is not null and not exists(select 1 from public.projects p where p.id=p_project_id and p.business_id=p_business_id and not p.closed) then raise exception 'The project is unavailable.'; end if;
  if p_walk_in_order_id is not null and not exists(select 1 from public.walk_in_orders w where w.id=p_walk_in_order_id and w.business_id=p_business_id and w.status<>'Cancelled') then raise exception 'The order is unavailable.'; end if;
  v_number:=private.next_payment_number(p_business_id,p_entry_date);
  insert into public.payments(id,business_id,payment_number,payment_type,payment_date,from_account_id,project_id,walk_in_order_id,description,amount,reference,notes,expense_category_id,created_by)
  values(v_payment,p_business_id,v_number,'expense',p_entry_date,p_from_account_id,p_project_id,p_walk_in_order_id,v_name,p_amount,p_expense_category_id::text,nullif(trim(coalesce(p_notes,'')),''),p_expense_category_id,(select auth.uid()));
  if p_project_id is not null then
    insert into public.project_entries(business_id,project_id,entry_type,entry_date,description,amount,notes,payment_id,expense_category_id)
    values(p_business_id,p_project_id,'expense',p_entry_date,v_name,p_amount,nullif(trim(coalesce(p_notes,'')),''),v_payment,p_expense_category_id) returning id into v_entry;
  else
    insert into public.walk_in_order_entries(business_id,walk_in_order_id,entry_type,entry_date,description,amount,notes,payment_id,expense_category_id)
    values(p_business_id,p_walk_in_order_id,'expense',p_entry_date,v_name,p_amount,nullif(trim(coalesce(p_notes,'')),''),v_payment,p_expense_category_id) returning id into v_entry;
  end if;
  return v_entry;
end;
$$;

create or replace function private.update_job_expense(
  p_entry_id uuid,p_entry_date date,p_expense_category_id uuid,p_from_account_id uuid,p_amount numeric,p_notes text
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_business uuid; v_payment uuid; v_name text; v_project uuid; v_order uuid; v_number text;
begin
  select x.business_id,x.payment_id,x.project_id,x.walk_in_order_id into v_business,v_payment,v_project,v_order
  from (
    select e.business_id,e.payment_id,e.project_id,null::uuid walk_in_order_id from public.project_entries e where e.id=p_entry_id and e.entry_type='expense'
    union all
    select e.business_id,e.payment_id,null::uuid project_id,e.walk_in_order_id from public.walk_in_order_entries e where e.id=p_entry_id and e.entry_type='expense'
  ) x limit 1;
  if v_business is null then raise exception 'The expense entry is unavailable.'; end if;
  if not (select private.is_business_member(v_business,array['owner','manager','staff'])) then raise exception 'This account cannot edit expenses.'; end if;
  select c.name into v_name from public.expense_categories c where c.id=p_expense_category_id and c.business_id=v_business and c.active;
  if v_name is null or p_entry_date is null or coalesce(p_amount,0)<=0 then raise exception 'Complete the expense, date and amount.'; end if;
  if coalesce(private.account_available(v_business,p_from_account_id,v_payment),-1)<p_amount then raise exception 'The selected account has insufficient balance.'; end if;
  if v_payment is null then
    v_payment:=gen_random_uuid();v_number:=private.next_payment_number(v_business,p_entry_date);
    insert into public.payments(id,business_id,payment_number,payment_type,payment_date,from_account_id,project_id,walk_in_order_id,description,amount,reference,notes,expense_category_id,created_by)
    values(v_payment,v_business,v_number,'expense',p_entry_date,p_from_account_id,v_project,v_order,v_name,p_amount,p_expense_category_id::text,nullif(trim(coalesce(p_notes,'')),''),p_expense_category_id,(select auth.uid()));
  else
    update public.payments set payment_date=p_entry_date,from_account_id=p_from_account_id,description=v_name,amount=p_amount,reference=p_expense_category_id::text,expense_category_id=p_expense_category_id,notes=nullif(trim(coalesce(p_notes,'')),'') where id=v_payment and business_id=v_business;
  end if;
  if v_project is not null then update public.project_entries set entry_date=p_entry_date,description=v_name,amount=p_amount,notes=nullif(trim(coalesce(p_notes,'')),''),expense_category_id=p_expense_category_id,payment_id=v_payment where id=p_entry_id;
  else update public.walk_in_order_entries set entry_date=p_entry_date,description=v_name,amount=p_amount,notes=nullif(trim(coalesce(p_notes,'')),''),expense_category_id=p_expense_category_id,payment_id=v_payment where id=p_entry_id; end if;
  return p_entry_id;
end;
$$;

create or replace function private.update_overhead_expense(p_payment_id uuid,p_payment_date date,p_expense_category_id uuid,p_from_account_id uuid,p_amount numeric,p_notes text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_business uuid; v_name text;
begin
  select business_id into v_business from public.payments where id=p_payment_id and payment_type='expense' and project_id is null and walk_in_order_id is null for update;
  if v_business is null or not (select private.is_business_member(v_business,array['owner','manager','staff'])) then raise exception 'The overhead expense is unavailable.'; end if;
  select name into v_name from public.expense_categories where id=p_expense_category_id and business_id=v_business and active;
  if v_name is null or p_payment_date is null or coalesce(p_amount,0)<=0 then raise exception 'Complete the expense, date and amount.'; end if;
  if coalesce(private.account_available(v_business,p_from_account_id,p_payment_id),-1)<p_amount then raise exception 'The selected account has insufficient balance.'; end if;
  update public.payments set payment_date=p_payment_date,from_account_id=p_from_account_id,description=v_name,amount=p_amount,reference=p_expense_category_id::text,expense_category_id=p_expense_category_id,notes=nullif(trim(coalesce(p_notes,'')),'') where id=p_payment_id;
  return p_payment_id;
end;
$$;

create or replace function private.save_partner_drawing(p_payment_id uuid,p_business_id uuid,p_payment_date date,p_from_account_id uuid,p_amount numeric,p_notes text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid:=coalesce(p_payment_id,gen_random_uuid()); v_number text; v_business uuid:=p_business_id;
begin
  if p_payment_id is not null then select business_id into v_business from public.payments where id=p_payment_id and payment_type='partner_drawing' for update; end if;
  if v_business is null or not (select private.is_business_member(v_business,array['owner','manager','staff'])) then raise exception 'This account cannot record partner drawings.'; end if;
  if p_payment_date is null or coalesce(p_amount,0)<=0 then raise exception 'Complete the date and amount.'; end if;
  if coalesce(private.account_available(v_business,p_from_account_id,p_payment_id),-1)<p_amount then raise exception 'The selected account has insufficient balance.'; end if;
  if p_payment_id is null then
    v_number:=private.next_payment_number(v_business,p_payment_date);
    insert into public.payments(id,business_id,payment_number,payment_type,payment_date,from_account_id,description,amount,reference,notes,created_by)
    values(v_id,v_business,v_number,'partner_drawing',p_payment_date,p_from_account_id,'Partner drawing - Banam Ali',p_amount,'Banam Ali',nullif(trim(coalesce(p_notes,'')),''),(select auth.uid()));
  else
    update public.payments set payment_date=p_payment_date,from_account_id=p_from_account_id,amount=p_amount,notes=nullif(trim(coalesce(p_notes,'')),'') where id=p_payment_id and business_id=v_business;
  end if;
  return v_id;
end;
$$;

create or replace function private.update_labour_wage_settlement(p_settlement_id uuid,p_settlement_date date,p_from_account_id uuid,p_notes text,p_amount numeric)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_business uuid; v_labourer uuid; v_old_payment uuid; v_payment uuid; v_worker text; v_due numeric; v_advance numeric; v_advance_apply numeric; v_cash numeric; v_remaining numeric:=p_amount; v_apply numeric; v_row record; v_number text;
begin
  select s.business_id,s.labourer_id,s.payment_id,l.name into v_business,v_labourer,v_old_payment,v_worker
  from public.labour_wage_settlements s join public.labourers l on l.id=s.labourer_id where s.id=p_settlement_id for update;
  if v_business is null or not (select private.is_business_member(v_business,array['owner','manager','staff'])) then raise exception 'The wage settlement is unavailable.'; end if;
  select coalesce(sum(a.amount),0)-coalesce((select sum(i.amount) from public.labour_wage_settlement_items i join public.labour_wage_settlements s on s.id=i.settlement_id where i.business_id=v_business and s.labourer_id=v_labourer and s.id<>p_settlement_id),0)
    into v_due from public.labour_assignments a where a.business_id=v_business and a.labourer_id=v_labourer;
  if p_settlement_date is null or coalesce(p_amount,0)<=0 or p_amount>v_due then raise exception 'Enter an amount up to the available wages of Rs. %.',v_due; end if;
  select greatest(0,coalesce((select sum(amount) from public.payments where business_id=v_business and labourer_id=v_labourer and payment_type='labour_advance'),0)-coalesce((select sum(advance_applied) from public.labour_wage_settlements where business_id=v_business and labourer_id=v_labourer and id<>p_settlement_id),0)) into v_advance;
  v_advance_apply:=least(p_amount,v_advance); v_cash:=p_amount-v_advance_apply;
  if v_cash>0 and coalesce(private.account_available(v_business,p_from_account_id,v_old_payment),-1)<v_cash then raise exception 'The selected account has insufficient balance.'; end if;
  if v_cash>0 and v_old_payment is null then
    v_payment:=gen_random_uuid();v_number:=private.next_payment_number(v_business,p_settlement_date);
    insert into public.payments(id,business_id,payment_number,payment_type,payment_date,from_account_id,labourer_id,description,amount,created_by)
    values(v_payment,v_business,v_number,'labour_payment',p_settlement_date,p_from_account_id,v_labourer,left(coalesce(nullif(trim(coalesce(p_notes,'')),''),'Wage payment for '||v_worker),240),v_cash,(select auth.uid()));
  elsif v_cash>0 then
    v_payment:=v_old_payment; update public.payments set payment_date=p_settlement_date,from_account_id=p_from_account_id,amount=v_cash,description=left(coalesce(nullif(trim(coalesce(p_notes,'')),''),'Wage payment for '||v_worker),240) where id=v_old_payment;
  else v_payment:=null; end if;
  update public.labour_wage_settlements set settlement_date=p_settlement_date,gross_wages=p_amount,advance_applied=v_advance_apply,cash_paid=v_cash,payment_id=v_payment,notes=nullif(trim(coalesce(p_notes,'')),'') where id=p_settlement_id;
  if v_cash=0 and v_old_payment is not null then delete from public.payments where id=v_old_payment; end if;
  delete from public.labour_wage_settlement_items where settlement_id=p_settlement_id;
  for v_row in select a.id,a.amount-coalesce((select sum(i.amount) from public.labour_wage_settlement_items i where i.labour_assignment_id=a.id),0) due from public.labour_assignments a where a.business_id=v_business and a.labourer_id=v_labourer order by a.assignment_date,a.created_at,a.id loop
    exit when v_remaining<=0; v_apply:=least(v_remaining,greatest(0,v_row.due));
    if v_apply>0 then insert into public.labour_wage_settlement_items(business_id,settlement_id,labour_assignment_id,amount) values(v_business,p_settlement_id,v_row.id,v_apply);v_remaining:=v_remaining-v_apply;end if;
  end loop;
  return p_settlement_id;
end;
$$;

-- Preserve the optional supplier name on cash purchases.
drop function if exists public.create_cash_purchase_mobile(date,text,numeric,jsonb,uuid,text);
create or replace function private.create_cash_purchase_mobile(p_bill_date date,p_notes text,p_discount numeric,p_items jsonb,p_from_account_id uuid,p_cash_supplier_name text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_business_id uuid; v_supplier_id uuid; v_bill_id uuid; v_total numeric;
begin
  select a.business_id into v_business_id from public.payment_accounts a where a.id=p_from_account_id and a.active for update;
  if v_business_id is null or not (select private.is_business_member(v_business_id,array['owner','manager','staff'])) then raise exception 'The payment account is unavailable.'; end if;
  select s.id into v_supplier_id from public.suppliers s where s.business_id=v_business_id and s.name='Cash Purchase Supplier' and s.active limit 1;
  if v_supplier_id is null then raise exception 'The cash purchase supplier is unavailable.'; end if;
  v_bill_id:=public.create_purchase_bill_mobile(v_supplier_id,p_bill_date,p_notes,p_discount,p_items);
  update public.purchase_bills set cash_supplier_name=nullif(trim(coalesce(p_cash_supplier_name,'')),'') where id=v_bill_id;
  select total_amount into v_total from public.purchase_bills where id=v_bill_id;
  perform public.record_payment(v_business_id,'supplier_payment',p_bill_date,p_from_account_id,null,null,v_supplier_id,null,null,v_bill_id,null,'Cash purchase - '||(select bill_number from public.purchase_bills where id=v_bill_id),v_total,null,p_notes);
  return v_bill_id;
end;
$$;

create function public.create_cash_purchase_mobile(p_bill_date date,p_notes text,p_discount numeric,p_items jsonb,p_from_account_id uuid,p_cash_supplier_name text default null)
returns uuid language sql security invoker set search_path='' as $$
  select private.create_cash_purchase_mobile(p_bill_date,p_notes,p_discount,p_items,p_from_account_id,p_cash_supplier_name)
$$;
create or replace function public.record_job_expense(p_business_id uuid,p_project_id uuid,p_walk_in_order_id uuid,p_entry_date date,p_expense_category_id uuid,p_from_account_id uuid,p_amount numeric,p_notes text)
returns uuid language sql security invoker set search_path='' as $$
  select private.record_job_expense(p_business_id,p_project_id,p_walk_in_order_id,p_entry_date,p_expense_category_id,p_from_account_id,p_amount,p_notes)
$$;
create or replace function public.update_job_expense(p_entry_id uuid,p_entry_date date,p_expense_category_id uuid,p_from_account_id uuid,p_amount numeric,p_notes text)
returns uuid language sql security invoker set search_path='' as $$
  select private.update_job_expense(p_entry_id,p_entry_date,p_expense_category_id,p_from_account_id,p_amount,p_notes)
$$;
create or replace function public.update_overhead_expense(p_payment_id uuid,p_payment_date date,p_expense_category_id uuid,p_from_account_id uuid,p_amount numeric,p_notes text)
returns uuid language sql security invoker set search_path='' as $$
  select private.update_overhead_expense(p_payment_id,p_payment_date,p_expense_category_id,p_from_account_id,p_amount,p_notes)
$$;
create or replace function public.save_partner_drawing(p_payment_id uuid,p_business_id uuid,p_payment_date date,p_from_account_id uuid,p_amount numeric,p_notes text)
returns uuid language sql security invoker set search_path='' as $$
  select private.save_partner_drawing(p_payment_id,p_business_id,p_payment_date,p_from_account_id,p_amount,p_notes)
$$;
create or replace function public.update_labour_wage_settlement(p_settlement_id uuid,p_settlement_date date,p_from_account_id uuid,p_notes text,p_amount numeric)
returns uuid language sql security invoker set search_path='' as $$
  select private.update_labour_wage_settlement(p_settlement_id,p_settlement_date,p_from_account_id,p_notes,p_amount)
$$;

revoke execute on function private.next_payment_number(uuid,date) from public,anon;
revoke execute on function private.account_available(uuid,uuid,uuid) from public,anon;
revoke execute on function private.record_job_expense(uuid,uuid,uuid,date,uuid,uuid,numeric,text) from public,anon;
revoke execute on function private.update_job_expense(uuid,date,uuid,uuid,numeric,text) from public,anon;
revoke execute on function private.update_overhead_expense(uuid,date,uuid,uuid,numeric,text) from public,anon;
revoke execute on function private.save_partner_drawing(uuid,uuid,date,uuid,numeric,text) from public,anon;
revoke execute on function private.update_labour_wage_settlement(uuid,date,uuid,text,numeric) from public,anon;
revoke execute on function private.create_cash_purchase_mobile(date,text,numeric,jsonb,uuid,text) from public,anon;
revoke execute on function public.record_job_expense(uuid,uuid,uuid,date,uuid,uuid,numeric,text) from public,anon;
revoke execute on function public.update_job_expense(uuid,date,uuid,uuid,numeric,text) from public,anon;
revoke execute on function public.update_overhead_expense(uuid,date,uuid,uuid,numeric,text) from public,anon;
revoke execute on function public.save_partner_drawing(uuid,uuid,date,uuid,numeric,text) from public,anon;
revoke execute on function public.update_labour_wage_settlement(uuid,date,uuid,text,numeric) from public,anon;
revoke execute on function public.create_cash_purchase_mobile(date,text,numeric,jsonb,uuid,text) from public,anon;
grant execute on function public.record_job_expense(uuid,uuid,uuid,date,uuid,uuid,numeric,text) to authenticated;
grant execute on function public.update_job_expense(uuid,date,uuid,uuid,numeric,text) to authenticated;
grant execute on function public.update_overhead_expense(uuid,date,uuid,uuid,numeric,text) to authenticated;
grant execute on function public.save_partner_drawing(uuid,uuid,date,uuid,numeric,text) to authenticated;
grant execute on function public.update_labour_wage_settlement(uuid,date,uuid,text,numeric) to authenticated;
grant execute on function public.create_cash_purchase_mobile(date,text,numeric,jsonb,uuid,text) to authenticated;
grant execute on function private.record_job_expense(uuid,uuid,uuid,date,uuid,uuid,numeric,text) to authenticated;
grant execute on function private.update_job_expense(uuid,date,uuid,uuid,numeric,text) to authenticated;
grant execute on function private.update_overhead_expense(uuid,date,uuid,uuid,numeric,text) to authenticated;
grant execute on function private.save_partner_drawing(uuid,uuid,date,uuid,numeric,text) to authenticated;
grant execute on function private.update_labour_wage_settlement(uuid,date,uuid,text,numeric) to authenticated;
grant execute on function private.create_cash_purchase_mobile(date,text,numeric,jsonb,uuid,text) to authenticated;

notify pgrst,'reload schema';
commit;
