-- Mobile Orders workspace: invoice items, receipts, expenses, materials and labour.

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  details text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, name)
);

create table if not exists public.order_invoice_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  walk_in_order_id uuid not null references public.walk_in_orders(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  item_name text not null,
  details text,
  quantity numeric(14,3) not null check (quantity > 0),
  rate numeric(14,2) not null check (rate >= 0),
  amount numeric(16,2) generated always as (quantity * rate) stored,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.walk_in_orders
  add column if not exists subtotal numeric(16,2),
  add column if not exists discount numeric(16,2) not null default 0;

alter table public.walk_in_orders
  drop constraint if exists walk_in_orders_subtotal_check,
  drop constraint if exists walk_in_orders_discount_check;
alter table public.walk_in_orders
  add constraint walk_in_orders_subtotal_check check (subtotal is null or subtotal >= 0),
  add constraint walk_in_orders_discount_check check (discount >= 0 and (subtotal is null or discount <= subtotal));

alter table public.walk_in_order_entries
  add column if not exists expense_category_id uuid
  references public.expense_categories(id) on delete restrict;

alter table public.walk_in_order_entries drop constraint if exists walk_in_order_entries_entry_type_check;
alter table public.walk_in_order_entries add constraint walk_in_order_entries_entry_type_check
  check (entry_type in ('receipt','labour','material','material_return','expense'));

create index if not exists order_items_business_name_idx on public.order_items(business_id, name);
create index if not exists order_invoice_items_order_idx on public.order_invoice_items(walk_in_order_id, sort_order);
create index if not exists order_invoice_items_business_idx on public.order_invoice_items(business_id);
create index if not exists order_invoice_items_item_idx on public.order_invoice_items(order_item_id);
create index if not exists walk_in_order_entries_expense_category_idx
  on public.walk_in_order_entries(expense_category_id) where expense_category_id is not null;

drop trigger if exists order_items_set_updated_at on public.order_items;
create trigger order_items_set_updated_at before update on public.order_items
for each row execute function private.set_updated_at();

alter table public.order_items enable row level security;
alter table public.order_invoice_items enable row level security;

drop policy if exists "Members view order items" on public.order_items;
create policy "Members view order items" on public.order_items for select to authenticated
using ((select private.is_business_member(order_items.business_id)));
drop policy if exists "Members add order items" on public.order_items;
create policy "Members add order items" on public.order_items for insert to authenticated
with check ((select private.is_business_member(order_items.business_id, array['owner','manager','staff'])));
drop policy if exists "Members update order items" on public.order_items;
create policy "Members update order items" on public.order_items for update to authenticated
using ((select private.is_business_member(order_items.business_id, array['owner','manager','staff'])))
with check ((select private.is_business_member(order_items.business_id, array['owner','manager','staff'])));
drop policy if exists "Owners delete order items" on public.order_items;
create policy "Owners delete order items" on public.order_items for delete to authenticated
using ((select private.is_business_member(order_items.business_id, array['owner'])));

drop policy if exists "Members view order invoice items" on public.order_invoice_items;
create policy "Members view order invoice items" on public.order_invoice_items for select to authenticated
using ((select private.is_business_member(order_invoice_items.business_id)));
drop policy if exists "Members add order invoice items" on public.order_invoice_items;
create policy "Members add order invoice items" on public.order_invoice_items for insert to authenticated
with check (
  (select private.is_business_member(order_invoice_items.business_id, array['owner','manager','staff']))
  and exists (
    select 1 from public.walk_in_orders w
    where w.id = order_invoice_items.walk_in_order_id
      and w.business_id = order_invoice_items.business_id
  )
  and exists (
    select 1 from public.order_items i
    where i.id = order_invoice_items.order_item_id
      and i.business_id = order_invoice_items.business_id and i.active
  )
);
drop policy if exists "Members update order invoice items" on public.order_invoice_items;
create policy "Members update order invoice items" on public.order_invoice_items for update to authenticated
using ((select private.is_business_member(order_invoice_items.business_id, array['owner','manager','staff'])))
with check ((select private.is_business_member(order_invoice_items.business_id, array['owner','manager','staff'])));
drop policy if exists "Members delete order invoice items" on public.order_invoice_items;
create policy "Members delete order invoice items" on public.order_invoice_items for delete to authenticated
using ((select private.is_business_member(order_invoice_items.business_id, array['owner','manager','staff'])));

grant select, insert, update, delete on public.order_items, public.order_invoice_items to authenticated;
revoke all on public.order_items, public.order_invoice_items from anon;

-- Allow invoices for either approved projects or active walk-in orders.
drop policy if exists "Members add approved project invoices" on public.invoices;
drop policy if exists "Members add invoices" on public.invoices;
create policy "Members add invoices" on public.invoices for insert to authenticated
with check (
  (select private.is_business_member(invoices.business_id, array['owner','manager','staff']))
  and (
    (invoices.project_id is not null and exists (
      select 1 from public.projects p where p.id = invoices.project_id
      and p.business_id = invoices.business_id and p.status = 'Approved'
    ))
    or
    (invoices.walk_in_order_id is not null and exists (
      select 1 from public.walk_in_orders w where w.id = invoices.walk_in_order_id
      and w.business_id = invoices.business_id and w.status <> 'Cancelled'
    ))
  )
);

drop policy if exists "Members update invoices" on public.invoices;
create policy "Members update invoices" on public.invoices for update to authenticated
using ((select private.is_business_member(invoices.business_id, array['owner','manager','staff'])))
with check (
  (select private.is_business_member(invoices.business_id, array['owner','manager','staff']))
  and (
    (invoices.project_id is not null and exists (
      select 1 from public.projects p where p.id = invoices.project_id
      and p.business_id = invoices.business_id and p.status = 'Approved'
    ))
    or
    (invoices.walk_in_order_id is not null and exists (
      select 1 from public.walk_in_orders w where w.id = invoices.walk_in_order_id
      and w.business_id = invoices.business_id and w.status <> 'Cancelled'
    ))
  )
);

drop policy if exists "Owners delete walk in orders" on public.walk_in_orders;
create policy "Owners delete walk in orders" on public.walk_in_orders for delete to authenticated
using ((select private.is_business_member(walk_in_orders.business_id, array['owner'])));
drop policy if exists "Members update walk in order entries" on public.walk_in_order_entries;
create policy "Members update walk in order entries" on public.walk_in_order_entries for update to authenticated
using ((select private.is_business_member(walk_in_order_entries.business_id, array['owner','manager','staff'])))
with check ((select private.is_business_member(walk_in_order_entries.business_id, array['owner','manager','staff'])));
drop policy if exists "Owners delete walk in order entries" on public.walk_in_order_entries;
create policy "Owners delete walk in order entries" on public.walk_in_order_entries for delete to authenticated
using ((select private.is_business_member(walk_in_order_entries.business_id, array['owner'])));

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

create or replace function public.delete_order_invoice(p_order_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare v_business_id uuid;
begin
  select business_id into v_business_id from public.walk_in_orders where id=p_order_id;
  if v_business_id is null
    or not (select private.is_business_member(v_business_id,array['owner'])) then
    raise exception 'Only the business owner can delete this invoice.';
  end if;
  if exists(select 1 from public.payments where walk_in_order_id=p_order_id)
    or exists(select 1 from public.walk_in_order_entries where walk_in_order_id=p_order_id)
    or exists(select 1 from public.material_movements where walk_in_order_id=p_order_id)
    or exists(select 1 from public.labour_assignments where walk_in_order_id=p_order_id) then
    raise exception 'Remove the order receipts, expenses, material and labour activity before deleting this invoice.';
  end if;
  delete from public.order_invoice_items where walk_in_order_id=p_order_id;
  delete from public.invoices where walk_in_order_id=p_order_id;
  delete from public.walk_in_orders where id=p_order_id;
  return p_order_id;
end;
$$;

create or replace function public.update_order_receipt(
  p_payment_id uuid,p_payment_date date,p_to_account_id uuid,
  p_amount numeric,p_description text,p_notes text default null
)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_business_id uuid; v_order_id uuid; v_due numeric;
begin
  select business_id,walk_in_order_id into v_business_id,v_order_id
  from public.payments where id=p_payment_id and payment_type='customer_receipt'
    and walk_in_order_id is not null;
  if v_business_id is null
    or not (select private.is_business_member(v_business_id,array['owner','manager','staff'])) then
    raise exception 'Order receipt not found or access denied.';
  end if;
  if p_payment_date is null or p_to_account_id is null or p_amount is null or p_amount<=0
    or nullif(trim(p_description),'') is null then
    raise exception 'Complete the date, account, amount and details.';
  end if;
  if not exists(select 1 from public.payment_accounts a where a.id=p_to_account_id
    and a.business_id=v_business_id and a.active) then
    raise exception 'Select an active bank or cash account.';
  end if;
  select w.amount-coalesce(sum(e.amount) filter(
    where e.entry_type='receipt' and e.payment_id is distinct from p_payment_id),0)
  into v_due from public.walk_in_orders w
  left join public.walk_in_order_entries e on e.walk_in_order_id=w.id
  where w.id=v_order_id group by w.id,w.amount;
  if p_amount>greatest(v_due,0) then
    raise exception 'Receipt exceeds the order balance of Rs. %.',greatest(v_due,0);
  end if;
  update public.payments set payment_date=p_payment_date,to_account_id=p_to_account_id,
    amount=p_amount,description=trim(p_description),
    notes=nullif(trim(coalesce(p_notes,'')),'') where id=p_payment_id;
  update public.walk_in_order_entries set entry_date=p_payment_date,
    amount=p_amount,description=trim(p_description),
    notes=nullif(trim(coalesce(p_notes,'')),'') where payment_id=p_payment_id;
  return p_payment_id;
end;
$$;

create or replace function public.delete_order_receipt(p_payment_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_business_id uuid;
begin
  select business_id into v_business_id from public.payments
  where id=p_payment_id and payment_type='customer_receipt' and walk_in_order_id is not null;
  if v_business_id is null
    or not (select private.is_business_member(v_business_id,array['owner'])) then
    raise exception 'Only the business owner can delete this receipt.';
  end if;
  delete from public.walk_in_order_entries where payment_id=p_payment_id;
  delete from public.payments where id=p_payment_id;
  return p_payment_id;
end;
$$;

-- Material returns restore stock and reduce the order's material cost.
alter table public.material_movements drop constraint if exists material_movements_movement_type_check;
alter table public.material_movements add constraint material_movements_movement_type_check
  check (movement_type in ('purchase','project_issue','walk_in_issue','walk_in_return','adjustment_in','adjustment_out'));
alter table public.material_movements drop constraint if exists material_movements_target_check;
alter table public.material_movements add constraint material_movements_target_check check (
  (movement_type='project_issue' and project_id is not null and walk_in_order_id is null)
  or (movement_type in ('walk_in_issue','walk_in_return') and walk_in_order_id is not null and project_id is null)
  or (movement_type not in ('project_issue','walk_in_issue','walk_in_return') and project_id is null and walk_in_order_id is null)
);
alter table public.material_movements drop constraint if exists material_movements_positive_cost_check;
alter table public.material_movements add constraint material_movements_positive_cost_check
  check (movement_type not in ('purchase','project_issue','walk_in_issue','walk_in_return') or unit_cost>0);

create or replace function private.check_material_stock()
returns trigger language plpgsql security invoker set search_path='' as $$
declare available_quantity numeric(14,3); returned_quantity numeric(14,3);
begin
  if new.movement_type in ('project_issue','walk_in_issue','adjustment_out') then
    perform 1 from public.materials m where m.id=new.material_id
      and m.business_id=new.business_id for update;
    select coalesce(sum(case
      when mm.movement_type in ('purchase','adjustment_in','walk_in_return') then mm.quantity
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
  end if;
  return new;
end;
$$;

create or replace function private.post_walk_in_material_cost()
returns trigger language plpgsql security invoker set search_path='' as $$
declare material_name text; material_unit text;
begin
  if new.movement_type in ('walk_in_issue','walk_in_return') then
    select m.name,m.unit into material_name,material_unit from public.materials m
    where m.id=new.material_id and m.business_id=new.business_id;
    insert into public.walk_in_order_entries(
      business_id,walk_in_order_id,entry_type,entry_date,description,amount,notes
    ) values (
      new.business_id,new.walk_in_order_id,
      case when new.movement_type='walk_in_return' then 'material_return' else 'material' end,
      new.movement_date,
      case when new.movement_type='walk_in_return' then 'Material returned: ' else 'Material: ' end
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
  and exists(select 1 from public.materials m where m.id=material_movements.material_id
    and m.business_id=material_movements.business_id)
  and (material_movements.movement_type<>'project_issue' or exists(
    select 1 from public.projects p where p.id=material_movements.project_id
      and p.business_id=material_movements.business_id and p.status='Approved'))
  and (material_movements.movement_type not in ('walk_in_issue','walk_in_return') or exists(
    select 1 from public.walk_in_orders w where w.id=material_movements.walk_in_order_id
      and w.business_id=material_movements.business_id
      and w.status in ('Pending','In Progress','Ready')))
);

revoke all on function public.create_order_invoice(uuid,date,text,text,text,numeric,jsonb) from public,anon;
grant execute on function public.create_order_invoice(uuid,date,text,text,text,numeric,jsonb) to authenticated;
revoke all on function public.update_order_invoice(uuid,date,text,text,text,numeric,jsonb) from public,anon;
grant execute on function public.update_order_invoice(uuid,date,text,text,text,numeric,jsonb) to authenticated;
revoke all on function public.delete_order_invoice(uuid) from public,anon;
grant execute on function public.delete_order_invoice(uuid) to authenticated;
revoke all on function public.update_order_receipt(uuid,date,uuid,numeric,text,text) from public,anon;
grant execute on function public.update_order_receipt(uuid,date,uuid,numeric,text,text) to authenticated;
revoke all on function public.delete_order_receipt(uuid) from public,anon;
grant execute on function public.delete_order_receipt(uuid) to authenticated;

notify pgrst,'reload schema';
