begin;

alter table public.materials
  add column if not exists tracking_type text not null default 'stock';
alter table public.materials drop constraint if exists materials_tracking_type_check;
alter table public.materials add constraint materials_tracking_type_check
  check (tracking_type in ('stock','consumable'));

alter table public.purchase_bill_items
  add column if not exists details text;

create or replace function private.validate_purchase_material_line()
returns trigger language plpgsql set search_path='' as $$
declare v_tracking text;
begin
  select m.tracking_type into v_tracking from public.materials m
  where m.id=new.material_id and m.business_id=new.business_id and m.active;
  if v_tracking is null then raise exception 'The selected material is unavailable.'; end if;
  if v_tracking='consumable' and new.quantity<>1 then
    raise exception 'Consumable purchases use one amount-based pool entry.';
  end if;
  new.details:=nullif(trim(coalesce(new.details,'')),'');
  return new;
end;
$$;
drop trigger if exists validate_purchase_material_line on public.purchase_bill_items;
create trigger validate_purchase_material_line before insert or update on public.purchase_bill_items
for each row execute function private.validate_purchase_material_line();

create or replace function private.post_purchase_bill_stock()
returns trigger language plpgsql set search_path='' as $$
declare v_supplier_name text; v_bill_number text; v_bill_date date; v_supplier_id uuid;
begin
  select s.name,pb.bill_number,pb.bill_date,pb.supplier_id
  into v_supplier_name,v_bill_number,v_bill_date,v_supplier_id
  from public.purchase_bills pb join public.suppliers s on s.id=pb.supplier_id and s.business_id=pb.business_id
  where pb.id=new.purchase_bill_id and pb.business_id=new.business_id;
  if v_bill_number is null then raise exception 'Purchase bill does not belong to this business.'; end if;
  insert into public.material_movements(
    business_id,material_id,movement_type,movement_date,quantity,unit_cost,supplier_id,
    supplier_name,reference,notes,purchase_bill_id,purchase_bill_item_id
  ) values(
    new.business_id,new.material_id,'purchase',v_bill_date,new.quantity,new.unit_cost,v_supplier_id,
    v_supplier_name,v_bill_number,new.details,new.purchase_bill_id,new.id
  );
  return new;
end;
$$;

create or replace function private.check_material_stock()
returns trigger language plpgsql set search_path='' as $$
declare available numeric(16,2); returnable numeric(16,2); v_consumable boolean; requested numeric(16,2);
begin
  if new.project_id is not null and exists(
    select 1 from public.projects p where p.id=new.project_id and p.business_id=new.business_id and p.closed
  ) then raise exception 'This project is closed and cannot receive material transactions.'; end if;

  select m.tracking_type='consumable' into v_consumable from public.materials m
  where m.id=new.material_id and m.business_id=new.business_id for update;
  if not found then raise exception 'The selected material is unavailable.'; end if;
  requested:=case when v_consumable then new.quantity*new.unit_cost else new.quantity end;

  if new.movement_type in ('project_issue','walk_in_issue','adjustment_out') then
    select coalesce(sum(case
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

create or replace function private.post_project_material_cost()
returns trigger language plpgsql set search_path='' as $$
declare material_name text; material_unit text; v_consumable boolean;
begin
  if new.movement_type in ('project_issue','project_return') then
    select m.name,m.unit,m.tracking_type='consumable' into material_name,material_unit,v_consumable
    from public.materials m where m.id=new.material_id and m.business_id=new.business_id;
    insert into public.project_entries(business_id,project_id,entry_type,entry_date,description,amount,notes)
    values(new.business_id,new.project_id,case when new.movement_type='project_return' then 'material_return' else 'material' end,new.movement_date,
      case when new.movement_type='project_return' then 'Material returned: ' else 'Material: ' end||material_name||
      case when v_consumable then ' ('||(new.quantity*new.unit_cost)||' rupees)' else ' ('||new.quantity||' '||material_unit||')' end,
      new.quantity*new.unit_cost,concat_ws(' · ',nullif(new.reference,''),nullif(new.notes,'')));
  end if;
  return new;
end;
$$;

create or replace function private.post_walk_in_material_cost()
returns trigger language plpgsql set search_path='' as $$
declare material_name text; material_unit text; v_consumable boolean;
begin
  if new.movement_type in ('walk_in_issue','walk_in_return') then
    select m.name,m.unit,m.tracking_type='consumable' into material_name,material_unit,v_consumable
    from public.materials m where m.id=new.material_id and m.business_id=new.business_id;
    insert into public.walk_in_order_entries(business_id,walk_in_order_id,entry_type,entry_date,description,amount,notes)
    values(new.business_id,new.walk_in_order_id,case when new.movement_type='walk_in_return' then 'material_return' else 'material' end,new.movement_date,
      case when new.movement_type='walk_in_return' then 'Material returned: ' else 'Material: ' end||material_name||
      case when v_consumable then ' ('||(new.quantity*new.unit_cost)||' rupees)' else ' ('||new.quantity||' '||material_unit||')' end,
      new.quantity*new.unit_cost,concat_ws(' · ',nullif(new.reference,''),nullif(new.notes,'')));
  end if;
  return new;
end;
$$;

create or replace function public.create_purchase_bill_mobile(
  p_supplier_id uuid,p_bill_date date,p_notes text,p_discount numeric,p_items jsonb
) returns uuid language plpgsql security invoker set search_path='' as $$
declare v_business_id uuid; v_bill_id uuid:=gen_random_uuid(); v_bill_number text; v_year text:=extract(year from p_bill_date)::text;
  v_next integer; v_subtotal numeric(16,2); v_discount numeric(16,2):=coalesce(p_discount,0); v_total numeric(16,2);
begin
  select s.business_id into v_business_id from public.suppliers s where s.id=p_supplier_id and s.active;
  if v_business_id is null or not (select private.is_business_member(v_business_id,array['owner','manager','staff'])) then
    raise exception 'Supplier is unavailable for this business.';
  end if;
  if p_bill_date is null then raise exception 'Purchase date is required.'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Add at least one material.'; end if;
  if exists(
    select 1 from jsonb_to_recordset(p_items) x(material_id uuid,quantity numeric,unit_cost numeric,details text)
    left join public.materials m on m.id=x.material_id and m.business_id=v_business_id and m.active
    where m.id is null or x.quantity is null or x.quantity<=0 or x.unit_cost is null or x.unit_cost<=0
      or (m.tracking_type='consumable' and x.quantity<>1)
  ) then raise exception 'Every line needs a valid material and amount; consumables must use a single amount entry.'; end if;
  select sum(round(x.quantity*x.unit_cost,2)) into v_subtotal
  from jsonb_to_recordset(p_items) x(material_id uuid,quantity numeric,unit_cost numeric,details text);
  if v_discount<0 or v_discount>=v_subtotal then raise exception 'Discount must be zero or less than the subtotal.'; end if;
  v_total:=v_subtotal-v_discount;
  perform pg_advisory_xact_lock(hashtextextended(v_business_id::text||':purchase-bill:'||v_year,20260826));
  select coalesce(max((substring(pb.bill_number from '([0-9]+)$'))::integer),0)+1 into v_next
  from public.purchase_bills pb where pb.business_id=v_business_id and pb.bill_number like 'MIPB-'||v_year||'-%';
  v_bill_number:='MIPB-'||v_year||'-'||lpad(v_next::text,4,'0');
  insert into public.purchase_bills(id,business_id,supplier_id,bill_number,bill_date,subtotal,discount,total_amount,amount_paid,payment_status,status,notes)
  values(v_bill_id,v_business_id,p_supplier_id,v_bill_number,p_bill_date,v_subtotal,v_discount,v_total,0,'Unpaid','Posted',nullif(trim(coalesce(p_notes,'')),''));
  insert into public.purchase_bill_items(business_id,purchase_bill_id,material_id,quantity,unit_cost,details)
  select v_business_id,v_bill_id,x.material_id,x.quantity,x.unit_cost,nullif(trim(coalesce(x.details,'')),'')
  from jsonb_to_recordset(p_items) x(material_id uuid,quantity numeric,unit_cost numeric,details text);
  return v_bill_id;
end;
$$;

update public.suppliers s set name='Cash Purchase Supplier',updated_at=now()
where s.name='Cash Purchase' and not exists(
  select 1 from public.suppliers x where x.business_id=s.business_id and x.name='Cash Purchase Supplier'
);
insert into public.suppliers(business_id,name,supplier_number,notes,active)
select b.id,'Cash Purchase Supplier','SUP-'||lpad((coalesce((select max(nullif(regexp_replace(s.supplier_number,'\D','','g'),''))::integer from public.suppliers s where s.business_id=b.id),0)+1)::text,4,'0'),'Automatic supplier for purchases paid immediately.',true
from public.businesses b where not exists(select 1 from public.suppliers s where s.business_id=b.id and s.name='Cash Purchase Supplier');

create or replace function private.seed_cash_purchase_supplier()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.suppliers(business_id,name,supplier_number,notes,active)
  values(new.id,'Cash Purchase Supplier','SUP-0001','Automatic supplier for purchases paid immediately.',true);
  return new;
end;
$$;
drop trigger if exists seed_cash_purchase_supplier on public.businesses;
create trigger seed_cash_purchase_supplier after insert on public.businesses
for each row execute function private.seed_cash_purchase_supplier();

create or replace function public.create_cash_purchase_mobile(
  p_bill_date date,p_notes text,p_discount numeric,p_items jsonb,p_from_account_id uuid
) returns uuid language plpgsql security invoker set search_path='' as $$
declare v_business_id uuid; v_supplier_id uuid; v_bill_id uuid; v_total numeric(16,2);
begin
  select a.business_id into v_business_id from public.payment_accounts a
  where a.id=p_from_account_id and a.active for update;
  if v_business_id is null or not (select private.is_business_member(v_business_id,array['owner','manager','staff'])) then
    raise exception 'The payment account is unavailable.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_business_id::text||':cash-purchase-supplier',20260829));
  select s.id into v_supplier_id from public.suppliers s
  where s.business_id=v_business_id and s.name='Cash Purchase Supplier' and s.active limit 1;
  if v_supplier_id is null then
    insert into public.suppliers(business_id,name,supplier_number,notes,active)
    values(v_business_id,'Cash Purchase Supplier','SUP-'||lpad((coalesce((select max(nullif(regexp_replace(s.supplier_number,'\D','','g'),''))::integer from public.suppliers s where s.business_id=v_business_id),0)+1)::text,4,'0'),'Automatic supplier for purchases paid immediately.',true)
    returning id into v_supplier_id;
  end if;
  v_bill_id:=public.create_purchase_bill_mobile(v_supplier_id,p_bill_date,p_notes,p_discount,p_items);
  select pb.total_amount into v_total from public.purchase_bills pb where pb.id=v_bill_id and pb.business_id=v_business_id;
  perform public.record_payment(v_business_id,'supplier_payment',p_bill_date,p_from_account_id,null,null,v_supplier_id,null,null,v_bill_id,null,'Cash purchase - '||(select pb.bill_number from public.purchase_bills pb where pb.id=v_bill_id),v_total,null,p_notes);
  return v_bill_id;
end;
$$;

revoke execute on function public.create_cash_purchase_mobile(date,text,numeric,jsonb,uuid) from public,anon;
grant execute on function public.create_cash_purchase_mobile(date,text,numeric,jsonb,uuid) to authenticated;
revoke execute on function public.create_purchase_bill_mobile(uuid,date,text,numeric,jsonb) from public,anon;
grant execute on function public.create_purchase_bill_mobile(uuid,date,text,numeric,jsonb) to authenticated;
notify pgrst,'reload schema';

commit;
