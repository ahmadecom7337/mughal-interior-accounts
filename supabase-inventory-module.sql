-- Mughal Interior Accounts — Materials & Inventory module

create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  category text,
  sku text,
  unit text not null default 'piece' check (unit in ('piece','sheet','foot','meter','kg','box','roll','liter')),
  reorder_level numeric(14,3) not null default 0 check (reorder_level >= 0),
  default_unit_cost numeric(14,2) not null default 0 check (default_unit_cost >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, name)
);

create table if not exists public.material_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete restrict,
  project_id uuid references public.projects(id) on delete restrict,
  movement_type text not null check (movement_type in ('purchase','project_issue','adjustment_in','adjustment_out')),
  movement_date date not null default current_date,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0),
  supplier_name text,
  reference text,
  notes text,
  created_at timestamptz not null default now(),
  check ((movement_type = 'project_issue' and project_id is not null) or movement_type <> 'project_issue'),
  check (movement_type not in ('purchase','project_issue') or unit_cost > 0)
);

create index if not exists materials_business_name_idx on public.materials(business_id, name);
create index if not exists material_movements_material_date_idx on public.material_movements(material_id, movement_date desc, created_at desc);
create index if not exists material_movements_project_idx on public.material_movements(project_id) where project_id is not null;
create index if not exists material_movements_business_date_idx on public.material_movements(business_id, movement_date desc);

drop trigger if exists materials_set_updated_at on public.materials;
create trigger materials_set_updated_at before update on public.materials
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
  if new.movement_type in ('project_issue','adjustment_out') then
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

create or replace function private.post_project_material_cost()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  material_name text;
  material_unit text;
begin
  if new.movement_type = 'project_issue' then
    select m.name, m.unit into material_name, material_unit
    from public.materials m
    where m.id = new.material_id and m.business_id = new.business_id;

    insert into public.project_entries (
      business_id, project_id, entry_type, entry_date, description, amount, notes
    ) values (
      new.business_id,
      new.project_id,
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

drop trigger if exists material_movements_check_stock on public.material_movements;
create trigger material_movements_check_stock before insert on public.material_movements
for each row execute function private.check_material_stock();

drop trigger if exists material_movements_post_project_cost on public.material_movements;
create trigger material_movements_post_project_cost after insert on public.material_movements
for each row execute function private.post_project_material_cost();

alter table public.materials enable row level security;
alter table public.material_movements enable row level security;

create policy "Members view materials" on public.materials for select to authenticated
using (private.is_business_member(business_id));
create policy "Members add materials" on public.materials for insert to authenticated
with check (private.is_business_member(business_id, array['owner','manager','staff']));
create policy "Members update materials" on public.materials for update to authenticated
using (private.is_business_member(business_id, array['owner','manager','staff']))
with check (private.is_business_member(business_id, array['owner','manager','staff']));

create policy "Members view material movements" on public.material_movements for select to authenticated
using (private.is_business_member(business_id));
create policy "Members add material movements" on public.material_movements for insert to authenticated
with check (
  private.is_business_member(business_id, array['owner','manager','staff'])
  and exists (
    select 1 from public.materials m
    where m.id = material_movements.material_id
      and m.business_id = material_movements.business_id
  )
  and (
    movement_type <> 'project_issue'
    or exists (
      select 1 from public.projects p
      where p.id = material_movements.project_id
        and p.business_id = material_movements.business_id
        and p.status = 'Approved'
    )
  )
);

grant select, insert, update on public.materials to authenticated;
grant select, insert on public.material_movements to authenticated;
revoke all on public.materials, public.material_movements from anon;

notify pgrst, 'reload schema';
