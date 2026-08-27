-- Fix order invoice line ordering on PostgreSQL 17.
-- Apply through the Supabase migration tool before merging this branch.

begin;

create or replace function public.create_order_invoice(
  p_business_id uuid,
  p_invoice_date date,
  p_customer_name text,
  p_customer_phone text,
  p_details text,
  p_discount numeric,
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_invoice_id uuid := gen_random_uuid();
  v_subtotal numeric(16,2);
  v_discount numeric(16,2) := coalesce(p_discount,0);
  v_total numeric(16,2);
  v_year text := extract(year from p_invoice_date)::text;
  v_next integer;
  v_invoice_number text;
begin
  if not (select private.is_business_member(p_business_id, array['owner','manager','staff'])) then
    raise exception 'This account cannot create order invoices.';
  end if;
  if p_invoice_date is null or nullif(trim(p_customer_name),'') is null then
    raise exception 'Invoice date and customer name are required.';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one invoice item.';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items)
      as x(order_item_id uuid, details text, quantity numeric, rate numeric)
    left join public.order_items i on i.id=x.order_item_id
      and i.business_id=p_business_id and i.active
    where i.id is null or x.quantity is null or x.quantity <= 0
      or x.rate is null or x.rate < 0
  ) then
    raise exception 'Every line needs a valid item, quantity and rate.';
  end if;

  select sum(x.quantity*x.rate) into v_subtotal
  from jsonb_to_recordset(p_items)
    as x(order_item_id uuid, details text, quantity numeric, rate numeric);
  if v_discount < 0 or v_discount > v_subtotal then
    raise exception 'Discount must be between zero and the subtotal.';
  end if;
  v_total := v_subtotal-v_discount;
  if v_total <= 0 then raise exception 'Grand total must be greater than zero.'; end if;

  select public.create_walk_in_order(
    p_business_id, null, trim(p_customer_name),
    nullif(trim(coalesce(p_customer_phone,'')),''),
    'Order invoice', coalesce(nullif(trim(coalesce(p_details,'')),''),'Order invoice items'),
    p_invoice_date, null, v_total, 'Pending', null
  ) into v_order_id;
  update public.walk_in_orders
  set subtotal=v_subtotal, discount=v_discount where id=v_order_id;

  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text || ':order-invoice:' || v_year, 20260826));
  select coalesce(max((substring(i.invoice_number from '([0-9]+)$'))::integer),0)+1 into v_next
  from public.invoices i
  where i.business_id=p_business_id and i.invoice_number like 'MIO-' || v_year || '-%';
  v_invoice_number := 'MIO-' || v_year || '-' || lpad(v_next::text,4,'0');

  insert into public.invoices(
    id,business_id,project_id,walk_in_order_id,invoice_number,invoice_date,
    due_date,amount,notes,status
  ) values (
    v_invoice_id,p_business_id,null,v_order_id,v_invoice_number,p_invoice_date,
    null,v_total,null,'Draft'
  );

  insert into public.order_invoice_items(
    business_id,walk_in_order_id,order_item_id,item_name,details,quantity,rate,sort_order
  )
  select p_business_id,v_order_id,(x.item->>'order_item_id')::uuid,i.name,
    nullif(trim(coalesce(x.item->>'details',i.details,'')),''),
    (x.item->>'quantity')::numeric,(x.item->>'rate')::numeric,x.sort_order::integer
  from jsonb_array_elements(p_items) with ordinality as x(item,sort_order)
  join public.order_items i on i.id=(x.item->>'order_item_id')::uuid
    and i.business_id=p_business_id;
  return v_order_id;
end;
$$;

create or replace function public.update_order_invoice(
  p_order_id uuid,
  p_invoice_date date,
  p_customer_name text,
  p_customer_phone text,
  p_details text,
  p_discount numeric,
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_subtotal numeric(16,2);
  v_discount numeric(16,2) := coalesce(p_discount,0);
  v_total numeric(16,2);
begin
  select w.business_id into v_business_id from public.walk_in_orders w
  where w.id=p_order_id and w.status <> 'Cancelled';
  if v_business_id is null
    or not (select private.is_business_member(v_business_id,array['owner','manager','staff'])) then
    raise exception 'Order invoice not found or access denied.';
  end if;
  if p_invoice_date is null or nullif(trim(p_customer_name),'') is null
    or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then
    raise exception 'Date, customer and at least one item are required.';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items)
      as x(order_item_id uuid, details text, quantity numeric, rate numeric)
    left join public.order_items i on i.id=x.order_item_id
      and i.business_id=v_business_id and i.active
    where i.id is null or x.quantity is null or x.quantity<=0
      or x.rate is null or x.rate<0
  ) then raise exception 'Every line needs a valid item, quantity and rate.'; end if;
  select sum(x.quantity*x.rate) into v_subtotal
  from jsonb_to_recordset(p_items)
    as x(order_item_id uuid, details text, quantity numeric, rate numeric);
  if v_discount<0 or v_discount>v_subtotal then
    raise exception 'Discount must be between zero and the subtotal.';
  end if;
  v_total:=v_subtotal-v_discount;
  if v_total<=0 then raise exception 'Grand total must be greater than zero.'; end if;

  update public.walk_in_orders set
    customer_name=trim(p_customer_name),
    customer_phone=nullif(trim(coalesce(p_customer_phone,'')),''),
    description=coalesce(nullif(trim(coalesce(p_details,'')),''),'Order invoice items'),
    order_date=p_invoice_date, subtotal=v_subtotal, discount=v_discount,
    amount=v_total, updated_at=now()
  where id=p_order_id;
  update public.invoices set invoice_date=p_invoice_date,amount=v_total,updated_at=now()
  where walk_in_order_id=p_order_id and business_id=v_business_id;
  delete from public.order_invoice_items where walk_in_order_id=p_order_id;
  insert into public.order_invoice_items(
    business_id,walk_in_order_id,order_item_id,item_name,details,quantity,rate,sort_order
  )
  select v_business_id,p_order_id,(x.item->>'order_item_id')::uuid,i.name,
    nullif(trim(coalesce(x.item->>'details',i.details,'')),''),
    (x.item->>'quantity')::numeric,(x.item->>'rate')::numeric,x.sort_order::integer
  from jsonb_array_elements(p_items) with ordinality as x(item,sort_order)
  join public.order_items i on i.id=(x.item->>'order_item_id')::uuid
    and i.business_id=v_business_id;
  return p_order_id;
end;
$$;

revoke all on function public.create_order_invoice(uuid,date,text,text,text,numeric,jsonb) from public,anon;
grant execute on function public.create_order_invoice(uuid,date,text,text,text,numeric,jsonb) to authenticated;
revoke all on function public.update_order_invoice(uuid,date,text,text,text,numeric,jsonb) from public,anon;
grant execute on function public.update_order_invoice(uuid,date,text,text,text,numeric,jsonb) to authenticated;

commit;
