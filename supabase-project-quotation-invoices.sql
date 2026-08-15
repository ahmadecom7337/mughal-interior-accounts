-- Mughal Interior Accounts — project-first quotation and invoices

alter table public.projects
  add column if not exists quote_date date not null default current_date,
  add column if not exists valid_until date,
  add column if not exists pricing_mode text not null default 'with_material',
  add column if not exists price_with_material numeric(14,2),
  add column if not exists price_without_material numeric(14,2),
  add column if not exists payment_terms text,
  add column if not exists notes text;

alter table public.projects drop constraint if exists projects_status_check;

update public.projects
set pricing_mode = contract_type,
    price_with_material = case when contract_type = 'with_material' then original_contract_amount else price_with_material end,
    price_without_material = case when contract_type = 'without_material' then original_contract_amount else price_without_material end,
    status = case when status = 'Cancelled' then 'Cancelled' when status = 'Planning' then 'Pending' else 'Approved' end;

alter table public.projects drop constraint if exists projects_pricing_mode_check;
alter table public.projects drop constraint if exists projects_price_with_material_check;
alter table public.projects drop constraint if exists projects_price_without_material_check;

alter table public.projects
  add constraint projects_status_check check (status in ('Pending','Approved','Cancelled')),
  add constraint projects_pricing_mode_check check (pricing_mode in ('with_material','without_material','both')),
  add constraint projects_price_with_material_check check (price_with_material is null or price_with_material >= 0),
  add constraint projects_price_without_material_check check (price_without_material is null or price_without_material >= 0);

alter table public.projects alter column status set default 'Pending';

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  project_id uuid not null unique references public.projects(id) on delete restrict,
  invoice_number text not null,
  invoice_date date not null default current_date,
  due_date date,
  amount numeric(14,2) not null check (amount >= 0),
  notes text,
  status text not null default 'Draft' check (status in ('Draft','Sent','Paid')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, invoice_number),
  check (due_date is null or due_date >= invoice_date)
);

create index if not exists invoices_business_status_idx on public.invoices(business_id, status);
create index if not exists invoices_project_idx on public.invoices(project_id);

drop trigger if exists invoices_set_updated_at on public.invoices;
create trigger invoices_set_updated_at before update on public.invoices
for each row execute function private.set_updated_at();

alter table public.invoices enable row level security;

create policy "Members view invoices" on public.invoices for select to authenticated
using (private.is_business_member(business_id));

create policy "Members add approved project invoices" on public.invoices for insert to authenticated
with check (
  private.is_business_member(business_id, array['owner','manager','staff'])
  and exists (
    select 1 from public.projects p
    where p.id = project_id
      and p.business_id = business_id
      and p.status = 'Approved'
  )
);

create policy "Members update invoices" on public.invoices for update to authenticated
using (private.is_business_member(business_id, array['owner','manager','staff']))
with check (
  private.is_business_member(business_id, array['owner','manager','staff'])
  and exists (
    select 1 from public.projects p
    where p.id = project_id
      and p.business_id = business_id
      and p.status = 'Approved'
  )
);

grant select, insert, update on public.invoices to authenticated;
revoke all on public.invoices from anon;

notify pgrst, 'reload schema';
