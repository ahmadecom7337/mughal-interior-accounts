-- Mughal Interior Accounts — Module 2
-- Quotation duration plus project execution and project financial tracking.

alter table public.quotations
  add column if not exists days_to_complete integer
  check (days_to_complete is null or days_to_complete >= 0);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  party_id uuid not null references public.parties(id) on delete restrict,
  source_quotation_id uuid unique references public.quotations(id) on delete set null,
  project_number text not null,
  name text not null check (char_length(trim(name)) between 1 and 200),
  description text,
  contract_type text not null check (contract_type in ('with_material','without_material')),
  original_contract_amount numeric(14,2) not null default 0 check (original_contract_amount >= 0),
  start_date date,
  expected_end_date date,
  days_to_complete integer check (days_to_complete is null or days_to_complete >= 0),
  status text not null default 'Planning' check (status in ('Planning','Active','On Hold','Completed','Cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, project_number),
  check (expected_end_date is null or start_date is null or expected_end_date >= start_date)
);

create table if not exists public.project_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  entry_type text not null check (entry_type in ('scope_increase','scope_decrease','receipt','labour','material','expense')),
  entry_date date not null default current_date,
  description text not null check (char_length(trim(description)) between 1 and 240),
  amount numeric(14,2) not null check (amount > 0),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists projects_business_status_idx on public.projects(business_id, status);
create index if not exists projects_party_idx on public.projects(party_id);
create index if not exists project_entries_project_date_idx on public.project_entries(project_id, entry_date desc);
create index if not exists project_entries_business_idx on public.project_entries(business_id);

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at before update on public.projects
for each row execute function private.set_updated_at();

alter table public.projects enable row level security;
alter table public.project_entries enable row level security;

create policy "Members view projects" on public.projects for select to authenticated
using (private.is_business_member(business_id));
create policy "Members add projects" on public.projects for insert to authenticated
with check (private.is_business_member(business_id, array['owner','manager','staff']));
create policy "Members update projects" on public.projects for update to authenticated
using (private.is_business_member(business_id, array['owner','manager','staff']))
with check (private.is_business_member(business_id, array['owner','manager','staff']));

create policy "Members view project entries" on public.project_entries for select to authenticated
using (private.is_business_member(business_id));
create policy "Members add project entries" on public.project_entries for insert to authenticated
with check (
  private.is_business_member(business_id, array['owner','manager','staff'])
  and exists (
    select 1 from public.projects p
    where p.id = project_id and p.business_id = business_id
  )
);

grant select, insert, update on public.projects to authenticated;
grant select, insert on public.project_entries to authenticated;
revoke all on public.projects, public.project_entries from anon;

notify pgrst, 'reload schema';
