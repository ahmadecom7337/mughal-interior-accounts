-- Troubleshooting migration for mobile project, order, purchasing and labour flows.
-- Prepared for review. Apply through the Supabase migration tool before merging the app branch.

begin;

alter table public.projects add column if not exists closed boolean not null default false;
alter table public.parties add column if not exists party_number text;
alter table public.suppliers add column if not exists supplier_number text;
alter table public.labourers add column if not exists labour_number text;

-- Replace UUID-like display identifiers with short business-local serials.
update public.projects set project_number = 'TMP-' || id::text;
with ranked as (
  select id, row_number() over (partition by business_id order by created_at, id) as serial
  from public.projects
)
update public.projects p set project_number = 'PRJ-' || lpad(r.serial::text, 4, '0')
from ranked r where r.id = p.id;

update public.materials set sku = 'TMP-' || id::text;
with ranked as (
  select id, row_number() over (partition by business_id order by created_at, id) as serial
  from public.materials
)
update public.materials m set sku = 'MAT-' || lpad(r.serial::text, 4, '0')
from ranked r where r.id = m.id;

with ranked as (
  select id, row_number() over (partition by business_id order by created_at, id) as serial
  from public.parties
)
update public.parties p set party_number = 'PTY-' || lpad(r.serial::text, 4, '0')
from ranked r where r.id = p.id;

with ranked as (
  select id, row_number() over (partition by business_id order by created_at, id) as serial
  from public.suppliers
)
update public.suppliers s set supplier_number = 'SUP-' || lpad(r.serial::text, 4, '0')
from ranked r where r.id = s.id;

with ranked as (
  select id, row_number() over (partition by business_id order by created_at, id) as serial
  from public.labourers
)
update public.labourers l set labour_number = 'LAB-' || lpad(r.serial::text, 4, '0')
from ranked r where r.id = l.id;

alter table public.parties alter column party_number set not null;
alter table public.suppliers alter column supplier_number set not null;
alter table public.labourers alter column labour_number set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname='parties_business_party_number_key' and conrelid='public.parties'::regclass) then
    alter table public.parties add constraint parties_business_party_number_key unique (business_id, party_number);
  end if;
  if not exists (select 1 from pg_constraint where conname='suppliers_business_supplier_number_key' and conrelid='public.suppliers'::regclass) then
    alter table public.suppliers add constraint suppliers_business_supplier_number_key unique (business_id, supplier_number);
  end if;
  if not exists (select 1 from pg_constraint where conname='labourers_business_labour_number_key' and conrelid='public.labourers'::regclass) then
    alter table public.labourers add constraint labourers_business_labour_number_key unique (business_id, labour_number);
  end if;
end;
$$;

create or replace function private.assign_party_number()
returns trigger language plpgsql set search_path = '' as $$
declare v_next integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.business_id::text || ':PTY', 20260826));
  select coalesce(max((substring(party_number from '([0-9]+)$'))::integer), 0) + 1
  into v_next from public.parties where business_id = new.business_id;
  new.party_number := 'PTY-' || lpad(v_next::text, 4, '0');
  return new;
end;
$$;

create or replace function private.assign_project_number()
returns trigger language plpgsql set search_path = '' as $$
declare v_next integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.business_id::text || ':PRJ', 20260826));
  select coalesce(max((substring(project_number from '([0-9]+)$'))::integer), 0) + 1
  into v_next from public.projects where business_id = new.business_id;
  new.project_number := 'PRJ-' || lpad(v_next::text, 4, '0');
  return new;
end;
$$;

create or replace function private.assign_material_number()
returns trigger language plpgsql set search_path = '' as $$
declare v_next integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.business_id::text || ':MAT', 20260826));
  select coalesce(max((substring(sku from '([0-9]+)$'))::integer), 0) + 1
  into v_next from public.materials where business_id = new.business_id;
  new.sku := 'MAT-' || lpad(v_next::text, 4, '0');
  return new;
end;
$$;

create or replace function private.assign_supplier_number()
returns trigger language plpgsql set search_path = '' as $$
declare v_next integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.business_id::text || ':SUP', 20260826));
  select coalesce(max((substring(supplier_number from '([0-9]+)$'))::integer), 0) + 1
  into v_next from public.suppliers where business_id = new.business_id;
  new.supplier_number := 'SUP-' || lpad(v_next::text, 4, '0');
  return new;
end;
$$;

create or replace function private.assign_labour_number()
returns trigger language plpgsql set search_path = '' as $$
declare v_next integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.business_id::text || ':LAB', 20260826));
  select coalesce(max((substring(labour_number from '([0-9]+)$'))::integer), 0) + 1
  into v_next from public.labourers where business_id = new.business_id;
  new.labour_number := 'LAB-' || lpad(v_next::text, 4, '0');
  return new;
end;
$$;

drop trigger if exists assign_party_number on public.parties;
create trigger assign_party_number before insert on public.parties for each row execute function private.assign_party_number();
drop trigger if exists assign_project_number on public.projects;
create trigger assign_project_number before insert on public.projects for each row execute function private.assign_project_number();
drop trigger if exists assign_material_number on public.materials;
create trigger assign_material_number before insert on public.materials for each row execute function private.assign_material_number();
drop trigger if exists assign_supplier_number on public.suppliers;
create trigger assign_supplier_number before insert on public.suppliers for each row execute function private.assign_supplier_number();
drop trigger if exists assign_labour_number on public.labourers;
create trigger assign_labour_number before insert on public.labourers for each row execute function private.assign_labour_number();

-- Closed projects remain visible historically but cannot receive new activity.
create or replace function private.require_active_project()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.project_id is not null and exists (
    select 1 from public.projects p
    where p.id = new.project_id and p.business_id = new.business_id and p.closed
  ) then
    raise exception 'This project is closed and cannot receive new transactions.';
  end if;
  return new;
end;
$$;

drop trigger if exists require_active_project_entry on public.project_entries;
create trigger require_active_project_entry before insert on public.project_entries
for each row execute function private.require_active_project();
drop trigger if exists require_active_project_labour on public.labour_assignments;
create trigger require_active_project_labour before insert on public.labour_assignments
for each row execute function private.require_active_project();

-- Project material returns.
alter table public.material_movements drop constraint if exists material_movements_movement_type_check;
alter table public.material_movements add constraint material_movements_movement_type_check check (
  movement_type in ('purchase','project_issue','project_return','walk_in_issue','walk_in_return','adjustment_in','adjustment_out')
);
alter table public.material_movements drop constraint if exists material_movements_target_check;
alter table public.material_movements add constraint material_movements_target_check check (
  (movement_type in ('project_issue','project_return') and project_id is not null and walk_in_order_id is null)
  or (movement_type in ('walk_in_issue','walk_in_return') and walk_in_order_id is not null and project_id is null)
  or (movement_type not in ('project_issue','project_return','walk_in_issue','walk_in_return') and project_id is null and walk_in_order_id is null)
);
alter table public.material_movements drop constraint if exists material_movements_positive_cost_check;
alter table public.material_movements add constraint material_movements_positive_cost_check check (
  movement_type not in ('purchase','project_issue','project_return','walk_in_issue','walk_in_return') or unit_cost > 0
);

create or replace function private.check_material_stock()
returns trigger language plpgsql set search_path = '' as $$
declare available_quantity numeric(14,3); returned_quantity numeric(14,3);
begin
  if new.project_id is not null and exists (
    select 1 from public.projects p where p.id = new.project_id and p.business_id = new.business_id and p.closed
  ) then
    raise exception 'This project is closed and cannot receive material transactions.';
  end if;
  if new.movement_type in ('project_issue','walk_in_issue','adjustment_out') then
    perform 1 from public.materials m where m.id=new.material_id and m.business_id=new.business_id for update;
    select coalesce(sum(case
      when mm.movement_type in ('purchase','adjustment_in','walk_in_return','project_return') then mm.quantity
      else -mm.quantity end),0)
    into available_quantity from public.material_movements mm
    where mm.material_id=new.material_id and mm.business_id=new.business_id;
    if new.quantity>available_quantity then
      raise exception 'Insufficient stock. Available quantity is %.',available_quantity;
    end if;
  elsif new.movement_type='walk_in_return' then
    select coalesce(sum(case when mm.movement_type='walk_in_issue' then mm.quantity
      when mm.movement_type='walk_in_return' then -mm.quantity else 0 end),0)
    into returned_quantity from public.material_movements mm
    where mm.material_id=new.material_id and mm.business_id=new.business_id
      and mm.walk_in_order_id=new.walk_in_order_id;
    if new.quantity>returned_quantity then
      raise exception 'Return exceeds the quantity assigned to this order. Returnable quantity is %.',returned_quantity;
    end if;
  elsif new.movement_type='project_return' then
    select coalesce(sum(case when mm.movement_type='project_issue' then mm.quantity
      when mm.movement_type='project_return' then -mm.quantity else 0 end),0)
    into returned_quantity from public.material_movements mm
    where mm.material_id=new.material_id and mm.business_id=new.business_id
      and mm.project_id=new.project_id;
    if new.quantity>returned_quantity then
      raise exception 'Return exceeds the quantity assigned to this project. Returnable quantity is %.',returned_quantity;
    end if;
  end if;
  return new;
end;
$$;

alter table public.project_entries drop constraint if exists project_entries_entry_type_check;
alter table public.project_entries add constraint project_entries_entry_type_check check (
  entry_type in ('scope_increase','scope_decrease','receipt','labour','material','material_return','expense')
);

create or replace function private.post_project_material_cost()
returns trigger language plpgsql set search_path = '' as $$
declare material_name text; material_unit text;
begin
  if new.movement_type in ('project_issue','project_return') then
    select m.name,m.unit into material_name,material_unit from public.materials m
    where m.id=new.material_id and m.business_id=new.business_id;
    insert into public.project_entries(business_id,project_id,entry_type,entry_date,description,amount,notes)
    values(
      new.business_id,new.project_id,
      case when new.movement_type='project_return' then 'material_return' else 'material' end,
      new.movement_date,
      case when new.movement_type='project_return' then 'Material returned: ' else 'Material: ' end
        || material_name || ' (' || new.quantity || ' ' || material_unit || ')',
      new.quantity*new.unit_cost,
      concat_ws(' · ',nullif(new.reference,''),nullif(new.notes,''))
    );
  end if;
  return new;
end;
$$;

drop policy if exists "Members add material movements" on public.material_movements;
create policy "Members add material movements" on public.material_movements for insert to authenticated
with check (
  (select private.is_business_member(material_movements.business_id,array['owner','manager','staff']))
  and exists(select 1 from public.materials m where m.id=material_movements.material_id and m.business_id=material_movements.business_id)
  and (
    material_movements.movement_type not in ('project_issue','project_return')
    or exists(select 1 from public.projects p where p.id=material_movements.project_id and p.business_id=material_movements.business_id and p.status='Approved' and not p.closed)
  )
  and (
    material_movements.movement_type not in ('walk_in_issue','walk_in_return')
    or exists(select 1 from public.walk_in_orders w where w.id=material_movements.walk_in_order_id and w.business_id=material_movements.business_id and w.status in ('Pending','In Progress','Ready'))
  )
);

-- Supplier credit is represented by amount_paid exceeding the bill total.
alter table public.purchase_bills drop constraint if exists purchase_bills_check;
alter table public.purchase_bills add constraint purchase_bills_check check (amount_paid >= 0);

-- Allow over-receipts and supplier overpayments while retaining account, membership and document validation.
create or replace function private.record_payment(
  p_business_id uuid, p_payment_type text, p_payment_date date,
  p_from_account_id uuid, p_to_account_id uuid, p_party_id uuid,
  p_supplier_id uuid, p_project_id uuid, p_walk_in_order_id uuid,
  p_purchase_bill_id uuid, p_invoice_id uuid, p_description text,
  p_amount numeric, p_reference text, p_notes text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_payment_id uuid := gen_random_uuid(); v_payment_number text; v_next integer;
  v_year text := extract(year from p_payment_date)::text; v_available numeric(14,2);
  v_party_id uuid := p_party_id; v_supplier_id uuid := p_supplier_id; v_invoice_id uuid := p_invoice_id;
  v_description text := nullif(trim(coalesce(p_description,'')),'');
begin
  if not (select private.is_business_member(p_business_id,array['owner','manager','staff'])) then
    raise exception 'This account cannot record payments for the selected business.';
  end if;
  if p_payment_type not in ('customer_receipt','supplier_payment','income','expense','transfer') then raise exception 'Payment type is invalid.'; end if;
  if p_payment_date is null or p_amount is null or p_amount<=0 then raise exception 'Payment date and an amount greater than zero are required.'; end if;
  v_description := coalesce(v_description,case p_payment_type when 'customer_receipt' then 'Customer receipt' when 'supplier_payment' then 'Supplier payment' when 'income' then 'Income' when 'expense' then 'Business expense' else 'Money transfer' end);

  if p_from_account_id is not null then
    perform 1 from public.payment_accounts a where a.id=p_from_account_id and a.business_id=p_business_id and a.active for update;
    if not found then raise exception 'The payment account is unavailable.'; end if;
  end if;
  if p_to_account_id is not null then
    perform 1 from public.payment_accounts a where a.id=p_to_account_id and a.business_id=p_business_id and a.active for update;
    if not found then raise exception 'The receiving account is unavailable.'; end if;
  end if;
  if p_payment_type in ('customer_receipt','income') and (p_from_account_id is not null or p_to_account_id is null) then raise exception 'Select the account receiving this money.';
  elsif p_payment_type in ('supplier_payment','expense') and (p_from_account_id is null or p_to_account_id is not null) then raise exception 'Select the account paying this money.';
  elsif p_payment_type='transfer' and (p_from_account_id is null or p_to_account_id is null or p_from_account_id=p_to_account_id) then raise exception 'Choose two different accounts for a transfer.'; end if;

  if p_from_account_id is not null then
    select a.opening_balance+coalesce(sum(case when p.to_account_id=a.id then p.amount when p.from_account_id=a.id then -p.amount else 0 end),0)
    into v_available from public.payment_accounts a left join public.payments p on p.business_id=a.business_id and (p.from_account_id=a.id or p.to_account_id=a.id)
    where a.id=p_from_account_id and a.business_id=p_business_id group by a.id,a.opening_balance;
    if p_amount>v_available then raise exception 'Insufficient account balance. Available balance is Rs. %.',v_available; end if;
  end if;

  if p_payment_type='customer_receipt' then
    if (p_project_id is not null)::integer+(p_walk_in_order_id is not null)::integer+(p_party_id is not null)::integer<>1 then raise exception 'Choose one project, walk-in order, or party for this receipt.'; end if;
    if p_project_id is not null then
      select pr.party_id into v_party_id from public.projects pr where pr.id=p_project_id and pr.business_id=p_business_id and pr.status='Approved' and not pr.closed;
      if v_party_id is null then raise exception 'The approved active project is unavailable.'; end if;
      if v_invoice_id is null then select i.id into v_invoice_id from public.invoices i where i.project_id=p_project_id and i.business_id=p_business_id limit 1;
      elsif not exists(select 1 from public.invoices i where i.id=v_invoice_id and i.project_id=p_project_id and i.business_id=p_business_id) then raise exception 'The selected invoice does not belong to this project.'; end if;
    elsif p_walk_in_order_id is not null then
      if p_invoice_id is not null then raise exception 'A walk-in receipt cannot be linked to a project invoice.'; end if;
      select w.party_id into v_party_id from public.walk_in_orders w where w.id=p_walk_in_order_id and w.business_id=p_business_id and w.status<>'Cancelled';
      if not found then raise exception 'The walk-in order is unavailable.'; end if;
    else
      if p_invoice_id is not null then raise exception 'A general party receipt cannot be linked to a project invoice.'; end if;
      if not exists(select 1 from public.parties pt where pt.id=p_party_id and pt.business_id=p_business_id) then raise exception 'The selected party is unavailable.'; end if;
    end if;
  elsif p_payment_type='supplier_payment' then
    select pb.supplier_id into v_supplier_id from public.purchase_bills pb where pb.id=p_purchase_bill_id and pb.business_id=p_business_id and pb.status='Posted' for update;
    if v_supplier_id is null then raise exception 'The supplier bill is unavailable.'; end if;
    if p_supplier_id is not null and p_supplier_id<>v_supplier_id then raise exception 'The supplier does not match this bill.'; end if;
  elsif p_payment_type in ('income','expense','transfer') and (p_party_id is not null or p_supplier_id is not null or p_project_id is not null or p_walk_in_order_id is not null or p_purchase_bill_id is not null or p_invoice_id is not null) then
    raise exception 'This transaction type cannot be linked to a customer or supplier document.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':payment:'||v_year,20260815));
  select coalesce(max((substring(payment_number from '([0-9]+)$'))::integer),0)+1 into v_next from public.payments where business_id=p_business_id and payment_number like 'MIT-'||v_year||'-%';
  v_payment_number := 'MIT-'||v_year||'-'||lpad(v_next::text,4,'0');
  insert into public.payments(id,business_id,payment_number,payment_type,payment_date,from_account_id,to_account_id,party_id,supplier_id,project_id,walk_in_order_id,purchase_bill_id,invoice_id,description,amount,reference,notes,created_by)
  values(v_payment_id,p_business_id,v_payment_number,p_payment_type,p_payment_date,p_from_account_id,p_to_account_id,v_party_id,v_supplier_id,p_project_id,p_walk_in_order_id,p_purchase_bill_id,v_invoice_id,v_description,p_amount,nullif(trim(coalesce(p_reference,'')),''),nullif(trim(coalesce(p_notes,'')),''),(select auth.uid()));
  if p_payment_type='customer_receipt' and p_project_id is not null then
    insert into public.project_entries(business_id,project_id,entry_type,entry_date,description,amount,notes,payment_id)
    values(p_business_id,p_project_id,'receipt',p_payment_date,v_description,p_amount,concat_ws(' · ',nullif(trim(coalesce(p_reference,'')),''),nullif(trim(coalesce(p_notes,'')),'')),v_payment_id);
    update public.invoices i set status='Paid' where i.project_id=p_project_id and i.business_id=p_business_id and i.amount<=(select coalesce(sum(pe.amount),0) from public.project_entries pe where pe.project_id=p_project_id and pe.business_id=p_business_id and pe.entry_type='receipt');
  elsif p_payment_type='customer_receipt' and p_walk_in_order_id is not null then
    insert into public.walk_in_order_entries(business_id,walk_in_order_id,entry_type,entry_date,description,amount,notes,payment_id)
    values(p_business_id,p_walk_in_order_id,'receipt',p_payment_date,v_description,p_amount,concat_ws(' · ',nullif(trim(coalesce(p_reference,'')),''),nullif(trim(coalesce(p_notes,'')),'')),v_payment_id);
  elsif p_payment_type='supplier_payment' then
    update public.purchase_bills set amount_paid=amount_paid+p_amount,payment_status=case when amount_paid+p_amount>=total_amount then 'Paid' else 'Partly Paid' end where id=p_purchase_bill_id and business_id=p_business_id;
  end if;
  return v_payment_id;
end;
$$;

create or replace function public.update_project_receipt(p_payment_id uuid,p_payment_date date,p_to_account_id uuid,p_amount numeric,p_description text,p_notes text default null)
returns uuid language plpgsql set search_path = '' as $$
declare v_business_id uuid; v_description text := coalesce(nullif(trim(coalesce(p_description,'')),''),'Project receipt');
begin
  if p_payment_date is null or p_to_account_id is null or p_amount is null or p_amount<=0 then raise exception 'Complete the date, bank account and amount.'; end if;
  select business_id into v_business_id from public.payments where id=p_payment_id and payment_type='customer_receipt' and project_id is not null;
  if v_business_id is null or not (select private.is_business_member(v_business_id,array['owner','manager','staff'])) then raise exception 'Receipt not found or access denied.'; end if;
  if not exists(select 1 from public.payment_accounts where id=p_to_account_id and business_id=v_business_id and active) then raise exception 'Select an active bank or cash account.'; end if;
  update public.payments set payment_date=p_payment_date,to_account_id=p_to_account_id,amount=p_amount,description=v_description,notes=nullif(trim(coalesce(p_notes,'')),'') where id=p_payment_id;
  update public.project_entries set entry_date=p_payment_date,amount=p_amount,description=v_description,notes=nullif(trim(coalesce(p_notes,'')),'') where payment_id=p_payment_id;
  return p_payment_id;
end;
$$;

create or replace function public.update_order_receipt(p_payment_id uuid,p_payment_date date,p_to_account_id uuid,p_amount numeric,p_description text,p_notes text default null)
returns uuid language plpgsql set search_path = '' as $$
declare v_business_id uuid; v_description text := coalesce(nullif(trim(coalesce(p_description,'')),''),'Order receipt');
begin
  if p_payment_date is null or p_to_account_id is null or p_amount is null or p_amount<=0 then raise exception 'Complete the date, account and amount.'; end if;
  select business_id into v_business_id from public.payments where id=p_payment_id and payment_type='customer_receipt' and walk_in_order_id is not null;
  if v_business_id is null or not (select private.is_business_member(v_business_id,array['owner','manager','staff'])) then raise exception 'Order receipt not found or access denied.'; end if;
  if not exists(select 1 from public.payment_accounts where id=p_to_account_id and business_id=v_business_id and active) then raise exception 'Select an active bank or cash account.'; end if;
  update public.payments set payment_date=p_payment_date,to_account_id=p_to_account_id,amount=p_amount,description=v_description,notes=nullif(trim(coalesce(p_notes,'')),'') where id=p_payment_id;
  update public.walk_in_order_entries set entry_date=p_payment_date,amount=p_amount,description=v_description,notes=nullif(trim(coalesce(p_notes,'')),'') where payment_id=p_payment_id;
  return p_payment_id;
end;
$$;

create or replace function public.update_labour_advance(p_payment_id uuid,p_payment_date date,p_from_account_id uuid,p_amount numeric,p_description text)
returns uuid language plpgsql set search_path = '' as $$
declare v_business_id uuid; v_current_account uuid; v_current_amount numeric; v_available numeric; v_description text := coalesce(nullif(trim(coalesce(p_description,'')),''),'Labour advance');
begin
  if p_payment_date is null or p_from_account_id is null or p_amount is null or p_amount<=0 then raise exception 'Complete the date, account and amount.'; end if;
  select business_id,from_account_id,amount into v_business_id,v_current_account,v_current_amount from public.payments where id=p_payment_id and payment_type='labour_advance' for update;
  if v_business_id is null or not (select private.is_business_member(v_business_id,array['owner','manager','staff'])) then raise exception 'Labour advance not found or access denied.'; end if;
  if not exists(select 1 from public.payment_accounts where id=p_from_account_id and business_id=v_business_id and active) then raise exception 'Select an active bank or cash account.'; end if;
  select a.opening_balance+coalesce(sum(case when p.to_account_id=a.id then p.amount when p.from_account_id=a.id then -p.amount else 0 end),0)
  into v_available from public.payment_accounts a left join public.payments p on p.business_id=a.business_id and (p.from_account_id=a.id or p.to_account_id=a.id) and p.id<>p_payment_id
  where a.id=p_from_account_id and a.business_id=v_business_id group by a.id,a.opening_balance;
  if p_amount>v_available then raise exception 'Insufficient account balance. Available balance is Rs. %.',v_available; end if;
  update public.payments set payment_date=p_payment_date,from_account_id=p_from_account_id,amount=p_amount,description=v_description where id=p_payment_id;
  return p_payment_id;
end;
$$;

revoke all on function public.update_labour_advance(uuid,date,uuid,numeric,text) from public, anon;
grant execute on function public.update_labour_advance(uuid,date,uuid,numeric,text) to authenticated;

commit;
