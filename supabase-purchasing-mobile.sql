-- Mobile Purchasing workspace: supplier companies, material details and discounted purchases.

alter table public.suppliers add column if not exists company_name text;
update public.suppliers set company_name=contact_name
where company_name is null and nullif(trim(coalesce(contact_name,'')),'') is not null;

alter table public.materials add column if not exists details text;

alter table public.purchase_bills
  add column if not exists subtotal numeric(16,2),
  add column if not exists discount numeric(16,2) not null default 0;

update public.purchase_bills
set subtotal=total_amount+coalesce(discount,0)
where subtotal is null;

alter table public.purchase_bills alter column subtotal set not null;
alter table public.purchase_bills drop constraint if exists purchase_bills_subtotal_check;
alter table public.purchase_bills drop constraint if exists purchase_bills_discount_check;
alter table public.purchase_bills add constraint purchase_bills_subtotal_check check (subtotal>0);
alter table public.purchase_bills add constraint purchase_bills_discount_check
  check (discount>=0 and discount<subtotal and total_amount=subtotal-discount);

drop policy if exists "Owners delete suppliers" on public.suppliers;
create policy "Owners delete suppliers" on public.suppliers for delete to authenticated
using ((select private.is_business_member(suppliers.business_id,array['owner'])));

drop policy if exists "Owners delete materials" on public.materials;
create policy "Owners delete materials" on public.materials for delete to authenticated
using ((select private.is_business_member(materials.business_id,array['owner'])));

grant select,insert,update,delete on public.suppliers,public.materials to authenticated;
revoke all on public.suppliers,public.materials from anon;

create or replace function public.create_purchase_bill_mobile(
  p_supplier_id uuid,
  p_bill_date date,
  p_notes text,
  p_discount numeric,
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_business_id uuid;
  v_bill_id uuid:=gen_random_uuid();
  v_bill_number text;
  v_year text:=extract(year from p_bill_date)::text;
  v_next integer;
  v_subtotal numeric(16,2);
  v_discount numeric(16,2):=coalesce(p_discount,0);
  v_total numeric(16,2);
begin
  select s.business_id into v_business_id
  from public.suppliers s where s.id=p_supplier_id and s.active;

  if v_business_id is null
    or not (select private.is_business_member(v_business_id,array['owner','manager','staff'])) then
    raise exception 'Supplier is unavailable for this business.';
  end if;
  if p_bill_date is null then raise exception 'Purchase date is required.'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then
    raise exception 'Add at least one material.';
  end if;
  if exists(
    select 1
    from jsonb_to_recordset(p_items) as x(material_id uuid,quantity numeric,unit_cost numeric)
    left join public.materials m on m.id=x.material_id
      and m.business_id=v_business_id and m.active
    where m.id is null or x.quantity is null or x.quantity<=0
      or x.unit_cost is null or x.unit_cost<=0
  ) then raise exception 'Every line needs a valid material, quantity and rate.'; end if;

  select sum(round(x.quantity*x.unit_cost,2)) into v_subtotal
  from jsonb_to_recordset(p_items) as x(material_id uuid,quantity numeric,unit_cost numeric);
  if v_discount<0 or v_discount>=v_subtotal then
    raise exception 'Discount must be zero or less than the subtotal.';
  end if;
  v_total:=v_subtotal-v_discount;

  perform pg_advisory_xact_lock(hashtextextended(v_business_id::text||':purchase-bill:'||v_year,20260826));
  select coalesce(max((substring(pb.bill_number from '([0-9]+)$'))::integer),0)+1 into v_next
  from public.purchase_bills pb
  where pb.business_id=v_business_id and pb.bill_number like 'MIPB-'||v_year||'-%';
  v_bill_number:='MIPB-'||v_year||'-'||lpad(v_next::text,4,'0');

  insert into public.purchase_bills(
    id,business_id,supplier_id,bill_number,bill_date,subtotal,discount,
    total_amount,amount_paid,payment_status,status,notes
  ) values(
    v_bill_id,v_business_id,p_supplier_id,v_bill_number,p_bill_date,v_subtotal,v_discount,
    v_total,0,'Unpaid','Posted',nullif(trim(coalesce(p_notes,'')),'')
  );

  insert into public.purchase_bill_items(
    business_id,purchase_bill_id,material_id,quantity,unit_cost
  )
  select v_business_id,v_bill_id,x.material_id,x.quantity,x.unit_cost
  from jsonb_to_recordset(p_items) as x(material_id uuid,quantity numeric,unit_cost numeric);

  return v_bill_id;
end;
$$;

revoke all on function public.create_purchase_bill_mobile(uuid,date,text,numeric,jsonb) from public,anon;
grant execute on function public.create_purchase_bill_mobile(uuid,date,text,numeric,jsonb) to authenticated;

notify pgrst,'reload schema';
