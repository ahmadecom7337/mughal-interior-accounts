-- Mughal Interior Accounts — Suppliers & Material Purchase Bills

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  contact_name text,
  phone text,
  address text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, name)
);

create table if not exists public.purchase_bills (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  bill_number text not null,
  supplier_invoice_no text,
  bill_date date not null default current_date,
  due_date date,
  total_amount numeric(14,2) not null check (total_amount > 0),
  amount_paid numeric(14,2) not null default 0 check (amount_paid >= 0 and amount_paid <= total_amount),
  payment_status text not null default 'Unpaid' check (payment_status in ('Unpaid','Partly Paid','Paid')),
  status text not null default 'Posted' check (status in ('Posted','Cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, bill_number)
);

create table if not exists public.purchase_bill_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  purchase_bill_id uuid not null references public.purchase_bills(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost numeric(14,2) not null check (unit_cost > 0),
  line_total numeric(14,2) generated always as (round(quantity * unit_cost, 2)) stored,
  created_at timestamptz not null default now()
);

alter table public.material_movements add column if not exists supplier_id uuid;
alter table public.material_movements add column if not exists purchase_bill_id uuid;
alter table public.material_movements add column if not exists purchase_bill_item_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'material_movements_supplier_id_fkey' and conrelid = 'public.material_movements'::regclass) then
    alter table public.material_movements add constraint material_movements_supplier_id_fkey foreign key (supplier_id) references public.suppliers(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'material_movements_purchase_bill_id_fkey' and conrelid = 'public.material_movements'::regclass) then
    alter table public.material_movements add constraint material_movements_purchase_bill_id_fkey foreign key (purchase_bill_id) references public.purchase_bills(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'material_movements_purchase_bill_item_id_fkey' and conrelid = 'public.material_movements'::regclass) then
    alter table public.material_movements add constraint material_movements_purchase_bill_item_id_fkey foreign key (purchase_bill_item_id) references public.purchase_bill_items(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'material_movements_purchase_bill_item_id_key' and conrelid = 'public.material_movements'::regclass) then
    alter table public.material_movements add constraint material_movements_purchase_bill_item_id_key unique (purchase_bill_item_id);
  end if;
end $$;

create index if not exists suppliers_business_name_idx on public.suppliers(business_id, name);
create index if not exists purchase_bills_business_date_idx on public.purchase_bills(business_id, bill_date desc, created_at desc);
create index if not exists purchase_bills_supplier_idx on public.purchase_bills(supplier_id);
create index if not exists purchase_bill_items_business_idx on public.purchase_bill_items(business_id);
create index if not exists purchase_bill_items_bill_idx on public.purchase_bill_items(purchase_bill_id);
create index if not exists purchase_bill_items_material_idx on public.purchase_bill_items(material_id);
create index if not exists material_movements_supplier_idx on public.material_movements(supplier_id) where supplier_id is not null;
create index if not exists material_movements_purchase_bill_idx on public.material_movements(purchase_bill_id) where purchase_bill_id is not null;

drop trigger if exists suppliers_set_updated_at on public.suppliers;
create trigger suppliers_set_updated_at before update on public.suppliers
for each row execute function private.set_updated_at();

drop trigger if exists purchase_bills_set_updated_at on public.purchase_bills;
create trigger purchase_bills_set_updated_at before update on public.purchase_bills
for each row execute function private.set_updated_at();

create or replace function private.post_purchase_bill_stock()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_supplier_name text;
  v_bill_number text;
  v_bill_date date;
begin
  select s.name, pb.bill_number, pb.bill_date
    into v_supplier_name, v_bill_number, v_bill_date
  from public.purchase_bills pb
  join public.suppliers s on s.id = pb.supplier_id and s.business_id = pb.business_id
  where pb.id = new.purchase_bill_id and pb.business_id = new.business_id;

  if v_bill_number is null then
    raise exception 'Purchase bill does not belong to this business.';
  end if;

  insert into public.material_movements (
    business_id, material_id, movement_type, movement_date, quantity, unit_cost,
    supplier_id, supplier_name, reference, purchase_bill_id, purchase_bill_item_id
  ) values (
    new.business_id, new.material_id, 'purchase', v_bill_date, new.quantity, new.unit_cost,
    (select supplier_id from public.purchase_bills where id = new.purchase_bill_id),
    v_supplier_name, v_bill_number, new.purchase_bill_id, new.id
  );
  return new;
end;
$$;

drop trigger if exists purchase_bill_items_post_stock on public.purchase_bill_items;
create trigger purchase_bill_items_post_stock after insert on public.purchase_bill_items
for each row execute function private.post_purchase_bill_stock();

alter table public.suppliers enable row level security;
alter table public.purchase_bills enable row level security;
alter table public.purchase_bill_items enable row level security;

create policy "Members view suppliers" on public.suppliers for select to authenticated
using ((select private.is_business_member(business_id)));
create policy "Members add suppliers" on public.suppliers for insert to authenticated
with check ((select private.is_business_member(business_id, array['owner','manager','staff'])));
create policy "Members update suppliers" on public.suppliers for update to authenticated
using ((select private.is_business_member(business_id, array['owner','manager','staff'])))
with check ((select private.is_business_member(business_id, array['owner','manager','staff'])));

create policy "Members view purchase bills" on public.purchase_bills for select to authenticated
using ((select private.is_business_member(business_id)));
create policy "Members add purchase bills" on public.purchase_bills for insert to authenticated
with check (
  (select private.is_business_member(purchase_bills.business_id, array['owner','manager','staff']))
  and exists (
    select 1 from public.suppliers s
    where s.id = purchase_bills.supplier_id
      and s.business_id = purchase_bills.business_id
      and s.active
  )
);

create policy "Members view purchase bill items" on public.purchase_bill_items for select to authenticated
using ((select private.is_business_member(business_id)));
create policy "Members add purchase bill items" on public.purchase_bill_items for insert to authenticated
with check (
  (select private.is_business_member(purchase_bill_items.business_id, array['owner','manager','staff']))
  and exists (
    select 1 from public.purchase_bills pb
    where pb.id = purchase_bill_items.purchase_bill_id
      and pb.business_id = purchase_bill_items.business_id
      and pb.status = 'Posted'
  )
  and exists (
    select 1 from public.materials m
    where m.id = purchase_bill_items.material_id
      and m.business_id = purchase_bill_items.business_id
      and m.active
  )
);

create or replace function public.create_purchase_bill(
  p_supplier_id uuid,
  p_bill_date date,
  p_due_date date,
  p_supplier_invoice_no text,
  p_notes text,
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_bill_id uuid := gen_random_uuid();
  v_bill_number text;
  v_year text := extract(year from p_bill_date)::text;
  v_next integer;
  v_total numeric(14,2);
begin
  select s.business_id into v_business_id
  from public.suppliers s
  where s.id = p_supplier_id and s.active;

  if v_business_id is null or not (select private.is_business_member(v_business_id, array['owner','manager','staff'])) then
    raise exception 'Supplier is unavailable for this business.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one material item.';
  end if;
  if p_due_date is not null and p_due_date < p_bill_date then
    raise exception 'Due date cannot be before bill date.';
  end if;

  select round(sum(x.quantity * x.unit_cost), 2) into v_total
  from jsonb_to_recordset(p_items) as x(material_id uuid, quantity numeric, unit_cost numeric);

  if v_total is null or v_total <= 0 then
    raise exception 'Purchase bill total must be greater than zero.';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as x(material_id uuid, quantity numeric, unit_cost numeric)
    left join public.materials m on m.id = x.material_id and m.business_id = v_business_id and m.active
    where m.id is null or x.quantity <= 0 or x.unit_cost <= 0
  ) then
    raise exception 'One or more bill items are invalid.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_business_id::text || ':purchase-bill:' || v_year, 20260815));
  select coalesce(max((substring(pb.bill_number from '([0-9]+)$'))::integer), 0) + 1 into v_next
  from public.purchase_bills pb
  where pb.business_id = v_business_id and pb.bill_number like 'MIPB-' || v_year || '-%';
  v_bill_number := 'MIPB-' || v_year || '-' || lpad(v_next::text, 4, '0');

  insert into public.purchase_bills (
    id, business_id, supplier_id, bill_number, supplier_invoice_no, bill_date, due_date, total_amount, notes
  ) values (
    v_bill_id, v_business_id, p_supplier_id, v_bill_number, nullif(trim(p_supplier_invoice_no), ''), p_bill_date, p_due_date, v_total, nullif(trim(p_notes), '')
  );

  insert into public.purchase_bill_items (business_id, purchase_bill_id, material_id, quantity, unit_cost)
  select v_business_id, v_bill_id, x.material_id, x.quantity, x.unit_cost
  from jsonb_to_recordset(p_items) as x(material_id uuid, quantity numeric, unit_cost numeric);

  return v_bill_id;
end;
$$;

grant select, insert, update on public.suppliers to authenticated;
grant select, insert on public.purchase_bills, public.purchase_bill_items to authenticated;
revoke all on public.suppliers, public.purchase_bills, public.purchase_bill_items from anon;
revoke execute on function public.create_purchase_bill(uuid,date,date,text,text,jsonb) from public, anon;
grant execute on function public.create_purchase_bill(uuid,date,date,text,text,jsonb) to authenticated;

notify pgrst, 'reload schema';
