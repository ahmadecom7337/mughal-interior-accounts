-- Mughal Interior Accounts — Walk-in Orders

create table if not exists public.walk_in_orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  party_id uuid references public.parties(id) on delete restrict,
  order_number text not null,
  customer_name text not null check (char_length(trim(customer_name)) between 1 and 160),
  customer_phone text,
  title text not null check (char_length(trim(title)) between 1 and 200),
  description text not null check (char_length(trim(description)) between 1 and 4000),
  order_date date not null default current_date,
  promised_date date,
  amount numeric(14,2) not null check (amount > 0),
  status text not null default 'Pending' check (status in ('Pending','In Progress','Ready','Delivered','Cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, order_number),
  check (promised_date is null or promised_date >= order_date)
);

create table if not exists public.walk_in_order_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  walk_in_order_id uuid not null references public.walk_in_orders(id) on delete cascade,
  entry_type text not null check (entry_type in ('receipt','labour','material','expense')),
  entry_date date not null default current_date,
  description text not null check (char_length(trim(description)) between 1 and 240),
  amount numeric(14,2) not null check (amount > 0),
  notes text,
  created_at timestamptz not null default now()
);

alter table public.material_movements add column if not exists walk_in_order_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'material_movements_walk_in_order_id_fkey'
      and conrelid = 'public.material_movements'::regclass
  ) then
    alter table public.material_movements
      add constraint material_movements_walk_in_order_id_fkey
      foreign key (walk_in_order_id) references public.walk_in_orders(id) on delete restrict;
  end if;
end $$;

alter table public.material_movements drop constraint if exists material_movements_movement_type_check;
alter table public.material_movements drop constraint if exists material_movements_check;
alter table public.material_movements drop constraint if exists material_movements_check1;
alter table public.material_movements drop constraint if exists material_movements_target_check;
alter table public.material_movements drop constraint if exists material_movements_positive_cost_check;

alter table public.material_movements
  add constraint material_movements_movement_type_check
  check (movement_type in ('purchase','project_issue','walk_in_issue','adjustment_in','adjustment_out'));

alter table public.material_movements
  add constraint material_movements_target_check
  check (
    (movement_type = 'project_issue' and project_id is not null and walk_in_order_id is null)
    or (movement_type = 'walk_in_issue' and walk_in_order_id is not null and project_id is null)
    or (movement_type not in ('project_issue','walk_in_issue') and project_id is null and walk_in_order_id is null)
  );

alter table public.material_movements
  add constraint material_movements_positive_cost_check
  check (movement_type not in ('purchase','project_issue','walk_in_issue') or unit_cost > 0);

create index if not exists walk_in_orders_business_date_idx on public.walk_in_orders(business_id, order_date desc, created_at desc);
create index if not exists walk_in_orders_party_idx on public.walk_in_orders(party_id) where party_id is not null;
create index if not exists walk_in_orders_business_status_idx on public.walk_in_orders(business_id, status);
create index if not exists walk_in_order_entries_business_idx on public.walk_in_order_entries(business_id);
create index if not exists walk_in_order_entries_order_date_idx on public.walk_in_order_entries(walk_in_order_id, entry_date desc, created_at desc);
create index if not exists material_movements_walk_in_order_idx on public.material_movements(walk_in_order_id) where walk_in_order_id is not null;

drop trigger if exists walk_in_orders_set_updated_at on public.walk_in_orders;
create trigger walk_in_orders_set_updated_at before update on public.walk_in_orders
for each row execute function private.set_updated_at();

create or replace function private.check_material_stock()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  available_quantity numeric(14,3);
begin
  if new.movement_type in ('project_issue','walk_in_issue','adjustment_out') then
    perform 1
    from public.materials m
    where m.id = new.material_id and m.business_id = new.business_id
    for update;

    select coalesce(sum(
      case when mm.movement_type in ('purchase','adjustment_in') then mm.quantity else -mm.quantity end
    ), 0)
    into available_quantity
    from public.material_movements mm
    where mm.material_id = new.material_id
      and mm.business_id = new.business_id;

    if new.quantity > available_quantity then
      raise exception 'Insufficient stock. Available quantity is %.', available_quantity;
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.post_walk_in_material_cost()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  material_name text;
  material_unit text;
begin
  if new.movement_type = 'walk_in_issue' then
    select m.name, m.unit into material_name, material_unit
    from public.materials m
    where m.id = new.material_id and m.business_id = new.business_id;

    insert into public.walk_in_order_entries (
      business_id, walk_in_order_id, entry_type, entry_date, description, amount, notes
    ) values (
      new.business_id,
      new.walk_in_order_id,
      'material',
      new.movement_date,
      'Material: ' || material_name || ' (' || new.quantity || ' ' || material_unit || ')',
      new.quantity * new.unit_cost,
      concat_ws(' · ', nullif(new.reference, ''), nullif(new.notes, ''))
    );
  end if;
  return new;
end;
$$;

drop trigger if exists material_movements_post_walk_in_cost on public.material_movements;
create trigger material_movements_post_walk_in_cost after insert on public.material_movements
for each row execute function private.post_walk_in_material_cost();

alter table public.walk_in_orders enable row level security;
alter table public.walk_in_order_entries enable row level security;

create policy "Members view walk in orders" on public.walk_in_orders for select to authenticated
using ((select private.is_business_member(business_id)));
create policy "Members add walk in orders" on public.walk_in_orders for insert to authenticated
with check (
  (select private.is_business_member(walk_in_orders.business_id, array['owner','manager','staff']))
  and (
    walk_in_orders.party_id is null
    or exists (
      select 1 from public.parties p
      where p.id = walk_in_orders.party_id and p.business_id = walk_in_orders.business_id
    )
  )
);
create policy "Members update walk in orders" on public.walk_in_orders for update to authenticated
using ((select private.is_business_member(business_id, array['owner','manager','staff'])))
with check (
  (select private.is_business_member(walk_in_orders.business_id, array['owner','manager','staff']))
  and (
    walk_in_orders.party_id is null
    or exists (
      select 1 from public.parties p
      where p.id = walk_in_orders.party_id and p.business_id = walk_in_orders.business_id
    )
  )
);

create policy "Members view walk in order entries" on public.walk_in_order_entries for select to authenticated
using ((select private.is_business_member(business_id)));
create policy "Members add walk in order entries" on public.walk_in_order_entries for insert to authenticated
with check (
  (select private.is_business_member(walk_in_order_entries.business_id, array['owner','manager','staff']))
  and exists (
    select 1 from public.walk_in_orders w
    where w.id = walk_in_order_entries.walk_in_order_id
      and w.business_id = walk_in_order_entries.business_id
      and w.status <> 'Cancelled'
  )
);

drop policy if exists "Members add material movements" on public.material_movements;
create policy "Members add material movements" on public.material_movements for insert to authenticated
with check (
  (select private.is_business_member(material_movements.business_id, array['owner','manager','staff']))
  and exists (
    select 1 from public.materials m
    where m.id = material_movements.material_id
      and m.business_id = material_movements.business_id
  )
  and (
    material_movements.movement_type <> 'project_issue'
    or exists (
      select 1 from public.projects p
      where p.id = material_movements.project_id
        and p.business_id = material_movements.business_id
        and p.status = 'Approved'
    )
  )
  and (
    material_movements.movement_type <> 'walk_in_issue'
    or exists (
      select 1 from public.walk_in_orders w
      where w.id = material_movements.walk_in_order_id
        and w.business_id = material_movements.business_id
        and w.status in ('Pending','In Progress','Ready')
    )
  )
);

create or replace function public.create_walk_in_order(
  p_business_id uuid,
  p_party_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_title text,
  p_description text,
  p_order_date date,
  p_promised_date date,
  p_amount numeric,
  p_status text,
  p_notes text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order_id uuid := gen_random_uuid();
  v_year text := extract(year from p_order_date)::text;
  v_next integer;
  v_order_number text;
begin
  if not (select private.is_business_member(p_business_id, array['owner','manager','staff'])) then
    raise exception 'This account cannot create orders for the selected business.';
  end if;
  if p_party_id is not null and not exists (
    select 1 from public.parties p where p.id = p_party_id and p.business_id = p_business_id
  ) then
    raise exception 'The selected party is unavailable.';
  end if;
  if char_length(trim(p_customer_name)) < 1 or char_length(trim(p_title)) < 1 or char_length(trim(p_description)) < 1 then
    raise exception 'Customer, order title and work details are required.';
  end if;
  if p_amount <= 0 then
    raise exception 'Order amount must be greater than zero.';
  end if;
  if p_status not in ('Pending','In Progress','Ready','Delivered','Cancelled') then
    raise exception 'Order status is invalid.';
  end if;
  if p_promised_date is not null and p_promised_date < p_order_date then
    raise exception 'Promised date cannot be before order date.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text || ':walk-in-order:' || v_year, 20260815));
  select coalesce(max((substring(w.order_number from '([0-9]+)$'))::integer), 0) + 1 into v_next
  from public.walk_in_orders w
  where w.business_id = p_business_id and w.order_number like 'MIW-' || v_year || '-%';
  v_order_number := 'MIW-' || v_year || '-' || lpad(v_next::text, 4, '0');

  insert into public.walk_in_orders (
    id, business_id, party_id, order_number, customer_name, customer_phone,
    title, description, order_date, promised_date, amount, status, notes
  ) values (
    v_order_id, p_business_id, p_party_id, v_order_number, trim(p_customer_name),
    nullif(trim(p_customer_phone), ''), trim(p_title), trim(p_description),
    p_order_date, p_promised_date, p_amount, p_status, nullif(trim(p_notes), '')
  );
  return v_order_id;
end;
$$;

grant select, insert, update on public.walk_in_orders to authenticated;
grant select, insert on public.walk_in_order_entries to authenticated;
revoke all on public.walk_in_orders, public.walk_in_order_entries from anon;
revoke execute on function public.create_walk_in_order(uuid,uuid,text,text,text,text,date,date,numeric,text,text) from public, anon;
grant execute on function public.create_walk_in_order(uuid,uuid,text,text,text,text,date,date,numeric,text,text) to authenticated;

notify pgrst, 'reload schema';
