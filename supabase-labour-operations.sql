-- Mughal Interior Accounts: labour directory and job wage assignments.

create table if not exists public.labourers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  cnic text check (cnic is null or char_length(trim(cnic)) between 5 and 20),
  mobile text,
  home_address text,
  daily_wage_rate numeric(14,2) not null default 0 check (daily_wage_rate >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, cnic)
);

create table if not exists public.labour_assignments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  labourer_id uuid not null references public.labourers(id) on delete restrict,
  project_id uuid references public.projects(id) on delete restrict,
  walk_in_order_id uuid references public.walk_in_orders(id) on delete restrict,
  assignment_date date not null default current_date,
  days numeric(8,2) not null check (days > 0),
  daily_rate numeric(14,2) not null check (daily_rate >= 0),
  amount numeric(16,2) generated always as (days * daily_rate) stored,
  notes text,
  created_at timestamptz not null default now(),
  check (num_nonnulls(project_id, walk_in_order_id) = 1)
);

create index if not exists labourers_business_name_idx on public.labourers (business_id, name);
create index if not exists labour_assignments_business_date_idx on public.labour_assignments (business_id, assignment_date desc);
create index if not exists labour_assignments_project_idx on public.labour_assignments (project_id) where project_id is not null;
create index if not exists labour_assignments_order_idx on public.labour_assignments (walk_in_order_id) where walk_in_order_id is not null;

alter table public.labourers enable row level security;
alter table public.labour_assignments enable row level security;

drop policy if exists "Members view labourers" on public.labourers;
create policy "Members view labourers" on public.labourers for select to authenticated
using ((select private.is_business_member(labourers.business_id)));

drop policy if exists "Members add labourers" on public.labourers;
create policy "Members add labourers" on public.labourers for insert to authenticated
with check ((select private.is_business_member(labourers.business_id, array['owner','manager','staff'])));

drop policy if exists "Members update labourers" on public.labourers;
create policy "Members update labourers" on public.labourers for update to authenticated
using ((select private.is_business_member(labourers.business_id, array['owner','manager','staff'])))
with check ((select private.is_business_member(labourers.business_id, array['owner','manager','staff'])));

drop policy if exists "Members view labour assignments" on public.labour_assignments;
create policy "Members view labour assignments" on public.labour_assignments for select to authenticated
using ((select private.is_business_member(labour_assignments.business_id)));

drop policy if exists "Members add labour assignments" on public.labour_assignments;
create policy "Members add labour assignments" on public.labour_assignments for insert to authenticated
with check (
  (select private.is_business_member(labour_assignments.business_id, array['owner','manager','staff']))
  and exists (
    select 1 from public.labourers l
    where l.id = labour_assignments.labourer_id
      and l.business_id = labour_assignments.business_id
      and l.active
  )
  and (
    (labour_assignments.project_id is not null and exists (
      select 1 from public.projects p where p.id = labour_assignments.project_id
      and p.business_id = labour_assignments.business_id and p.status = 'Approved'
    ))
    or
    (labour_assignments.walk_in_order_id is not null and exists (
      select 1 from public.walk_in_orders w where w.id = labour_assignments.walk_in_order_id
      and w.business_id = labour_assignments.business_id and w.status <> 'Cancelled'
    ))
  )
);

grant select, insert, update on public.labourers to authenticated;
grant select, insert on public.labour_assignments to authenticated;

create or replace function private.post_labour_assignment_cost()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  worker_name text;
  cost_description text;
begin
  select l.name into worker_name
  from public.labourers l
  where l.id = new.labourer_id and l.business_id = new.business_id;

  cost_description := 'Labour: ' || worker_name || ' (' || trim(to_char(new.days, 'FM999999990.00')) || ' days × Rs. ' || trim(to_char(new.daily_rate, 'FM999999999990.00')) || ')';

  if new.project_id is not null then
    insert into public.project_entries (business_id, project_id, entry_type, entry_date, description, amount, notes)
    values (new.business_id, new.project_id, 'labour', new.assignment_date, cost_description, new.amount, new.notes);
  else
    insert into public.walk_in_order_entries (business_id, walk_in_order_id, entry_type, entry_date, description, amount, notes)
    values (new.business_id, new.walk_in_order_id, 'labour', new.assignment_date, cost_description, new.amount, new.notes);
  end if;

  return new;
end;
$$;

drop trigger if exists labour_assignment_cost_trigger on public.labour_assignments;
create trigger labour_assignment_cost_trigger
after insert on public.labour_assignments
for each row execute function private.post_labour_assignment_cost();

notify pgrst, 'reload schema';
