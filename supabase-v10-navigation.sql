-- V10: order invoices, labour payments/advances, expense and service masters.

alter table public.invoices alter column project_id drop not null;
alter table public.invoices add column if not exists walk_in_order_id uuid references public.walk_in_orders(id) on delete restrict;
create unique index if not exists invoices_walk_in_order_id_key on public.invoices(walk_in_order_id) where walk_in_order_id is not null;
alter table public.invoices drop constraint if exists invoices_target_check;
alter table public.invoices add constraint invoices_target_check check (num_nonnulls(project_id, walk_in_order_id) = 1);

alter table public.payments add column if not exists labourer_id uuid references public.labourers(id) on delete restrict;
create index if not exists payments_labourer_idx on public.payments(labourer_id) where labourer_id is not null;
create index if not exists labour_assignments_labourer_idx on public.labour_assignments(labourer_id);
alter table public.payments drop constraint if exists payments_payment_type_check;
alter table public.payments add constraint payments_payment_type_check check (payment_type = any (array['customer_receipt','supplier_payment','income','expense','transfer','labour_payment','labour_advance']::text[]));
alter table public.payments drop constraint if exists payments_check;
alter table public.payments add constraint payments_check check (
  (payment_type = any (array['customer_receipt','income']::text[]) and from_account_id is null and to_account_id is not null)
  or (payment_type = any (array['supplier_payment','expense','labour_payment','labour_advance']::text[]) and from_account_id is not null and to_account_id is null)
  or (payment_type = 'transfer' and from_account_id is not null and to_account_id is not null and from_account_id <> to_account_id)
);
alter table public.payments drop constraint if exists payments_check1;
alter table public.payments add constraint payments_check1 check (
  (payment_type = 'customer_receipt' and supplier_id is null and purchase_bill_id is null and labourer_id is null)
  or (payment_type = 'supplier_payment' and supplier_id is not null and purchase_bill_id is not null and party_id is null and project_id is null and walk_in_order_id is null and invoice_id is null and labourer_id is null)
  or (payment_type = any (array['income','expense','transfer']::text[]) and party_id is null and supplier_id is null and project_id is null and walk_in_order_id is null and purchase_bill_id is null and invoice_id is null and labourer_id is null)
  or (payment_type = any (array['labour_payment','labour_advance']::text[]) and labourer_id is not null and party_id is null and supplier_id is null and project_id is null and walk_in_order_id is null and purchase_bill_id is null and invoice_id is null)
);

drop policy if exists "Members add payments" on public.payments;
create policy "Members add payments" on public.payments for insert to authenticated
with check ((select private.is_business_member(payments.business_id, array['owner','manager','staff']::text[])) and created_by = (select auth.uid()));

create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, name)
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  description text,
  default_rate numeric not null default 0 check (default_rate >= 0),
  unit text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, name)
);

alter table public.expense_categories enable row level security;
alter table public.services enable row level security;
grant select, insert, update on public.expense_categories, public.services to authenticated;

drop policy if exists "Members view expense categories" on public.expense_categories;
create policy "Members view expense categories" on public.expense_categories for select to authenticated using ((select private.is_business_member(expense_categories.business_id)));
drop policy if exists "Members add expense categories" on public.expense_categories;
create policy "Members add expense categories" on public.expense_categories for insert to authenticated with check ((select private.is_business_member(expense_categories.business_id, array['owner','manager','staff']::text[])));
drop policy if exists "Members update expense categories" on public.expense_categories;
create policy "Members update expense categories" on public.expense_categories for update to authenticated using ((select private.is_business_member(expense_categories.business_id, array['owner','manager','staff']::text[]))) with check ((select private.is_business_member(expense_categories.business_id, array['owner','manager','staff']::text[])));

drop policy if exists "Members view services" on public.services;
create policy "Members view services" on public.services for select to authenticated using ((select private.is_business_member(services.business_id)));
drop policy if exists "Members add services" on public.services;
create policy "Members add services" on public.services for insert to authenticated with check ((select private.is_business_member(services.business_id, array['owner','manager','staff']::text[])));
drop policy if exists "Members update services" on public.services;
create policy "Members update services" on public.services for update to authenticated using ((select private.is_business_member(services.business_id, array['owner','manager','staff']::text[]))) with check ((select private.is_business_member(services.business_id, array['owner','manager','staff']::text[])));
