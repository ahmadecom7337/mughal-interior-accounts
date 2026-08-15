-- Mughal Interior Accounts — Module 1
-- Parties and contract quotations only. Quotations do not create accounting entries.

create extension if not exists pgcrypto;
create schema if not exists private;

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Mughal Interior',
  owner_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.business_members (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','manager','staff','viewer')),
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);

create table if not exists public.parties (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  phone text,
  party_type text not null default 'Individual' check (party_type in ('Individual','Business')),
  address text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quotations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  party_id uuid not null references public.parties(id) on delete restrict,
  quote_number text not null,
  project_title text not null check (char_length(trim(project_title)) between 1 and 200),
  project_details text not null,
  quote_date date not null,
  valid_until date,
  start_date date,
  end_date date,
  pricing_mode text not null check (pricing_mode in ('with_material','without_material','both')),
  price_with_material numeric(14,2) check (price_with_material >= 0),
  price_without_material numeric(14,2) check (price_without_material >= 0),
  payment_terms text,
  notes text,
  status text not null default 'Draft' check (status in ('Draft','Sent','Approved','Rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, quote_number),
  check (end_date is null or start_date is null or end_date >= start_date),
  check (
    (pricing_mode = 'with_material' and price_with_material is not null) or
    (pricing_mode = 'without_material' and price_without_material is not null) or
    (pricing_mode = 'both' and price_with_material is not null and price_without_material is not null)
  )
);

create index if not exists business_members_user_idx on public.business_members(user_id);
create index if not exists businesses_owner_idx on public.businesses(owner_id);
create index if not exists parties_business_name_idx on public.parties(business_id, name);
create index if not exists quotations_business_date_idx on public.quotations(business_id, quote_date desc);
create index if not exists quotations_party_idx on public.quotations(party_id);
create index if not exists quotations_status_idx on public.quotations(business_id, status);

create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists parties_set_updated_at on public.parties;
create trigger parties_set_updated_at before update on public.parties for each row execute function private.set_updated_at();
drop trigger if exists quotations_set_updated_at on public.quotations;
create trigger quotations_set_updated_at before update on public.quotations for each row execute function private.set_updated_at();

create or replace function private.create_business_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare new_business_id uuid;
begin
  insert into public.businesses(name, owner_id)
  values ('Mughal Interior', new.id)
  returning id into new_business_id;
  insert into public.business_members(business_id, user_id, role)
  values (new_business_id, new.id, 'owner');
  return new;
end;
$$;

revoke all on function private.create_business_for_new_user() from public, anon, authenticated;
drop trigger if exists on_mughal_user_created on auth.users;
create trigger on_mughal_user_created after insert on auth.users for each row execute function private.create_business_for_new_user();

create or replace function private.is_business_member(target_business_id uuid, allowed_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.business_members m
    where m.business_id = target_business_id
      and m.user_id = (select auth.uid())
      and (allowed_roles is null or m.role = any(allowed_roles))
  );
$$;
revoke all on function private.is_business_member(uuid, text[]) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_business_member(uuid, text[]) to authenticated;

alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.parties enable row level security;
alter table public.quotations enable row level security;

create policy "Members view their business" on public.businesses for select to authenticated
using (private.is_business_member(id));
create policy "Members view memberships" on public.business_members for select to authenticated
using (private.is_business_member(business_id));

create policy "Members view parties" on public.parties for select to authenticated
using (private.is_business_member(business_id));
create policy "Members add parties" on public.parties for insert to authenticated
with check (private.is_business_member(business_id, array['owner','manager','staff']));
create policy "Members update parties" on public.parties for update to authenticated
using (private.is_business_member(business_id, array['owner','manager','staff']))
with check (private.is_business_member(business_id, array['owner','manager','staff']));

create policy "Members view quotations" on public.quotations for select to authenticated
using (private.is_business_member(business_id));
create policy "Members add quotations" on public.quotations for insert to authenticated
with check (private.is_business_member(business_id, array['owner','manager','staff']));
create policy "Members update quotations" on public.quotations for update to authenticated
using (private.is_business_member(business_id, array['owner','manager','staff']))
with check (private.is_business_member(business_id, array['owner','manager','staff']));

grant usage on schema public to authenticated;
grant select on public.businesses, public.business_members to authenticated;
grant select, insert, update on public.parties, public.quotations to authenticated;
revoke all on public.businesses, public.business_members, public.parties, public.quotations from anon;
