-- Mughal Interior Accounts — Complete V1
-- Business settings, secure staff management and policy hardening.

alter table public.businesses
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists address text,
  add column if not exists default_payment_terms text,
  add column if not exists default_quote_valid_days integer not null default 15
    check (default_quote_valid_days between 0 and 365),
  add column if not exists default_invoice_due_days integer not null default 7
    check (default_invoice_due_days between 0 and 365),
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists businesses_set_updated_at on public.businesses;
create trigger businesses_set_updated_at before update on public.businesses
for each row execute function private.set_updated_at();

drop policy if exists "Owners and managers update business" on public.businesses;
create policy "Owners and managers update business"
on public.businesses for update to authenticated
using ((select private.is_business_member(id, array['owner','manager'])))
with check ((select private.is_business_member(id, array['owner','manager'])));

grant update (name, phone, email, address, default_payment_terms,
  default_quote_valid_days, default_invoice_due_days)
on public.businesses to authenticated;

-- Correct legacy policy predicates so the related record must belong to the
-- same business as the invoice or entry being written.
drop policy if exists "Members add approved project invoices" on public.invoices;
create policy "Members add approved project invoices"
on public.invoices for insert to authenticated
with check (
  (select private.is_business_member(business_id, array['owner','manager','staff']))
  and exists (
    select 1 from public.projects p
    where p.id = invoices.project_id
      and p.business_id = invoices.business_id
      and p.status = 'Approved'
  )
);

drop policy if exists "Members update invoices" on public.invoices;
create policy "Members update invoices"
on public.invoices for update to authenticated
using ((select private.is_business_member(business_id, array['owner','manager','staff'])))
with check (
  (select private.is_business_member(business_id, array['owner','manager','staff']))
  and exists (
    select 1 from public.projects p
    where p.id = invoices.project_id
      and p.business_id = invoices.business_id
      and p.status = 'Approved'
  )
);

drop policy if exists "Members add project entries" on public.project_entries;
create policy "Members add project entries"
on public.project_entries for insert to authenticated
with check (
  (select private.is_business_member(business_id, array['owner','manager','staff']))
  and exists (
    select 1 from public.projects p
    where p.id = project_entries.project_id
      and p.business_id = project_entries.business_id
      and p.status = 'Approved'
  )
);

create or replace function public.list_business_members(p_business_id uuid)
returns table (
  user_id uuid,
  email text,
  role text,
  created_at timestamptz,
  is_current boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.is_business_member(p_business_id)) then
    raise exception 'You cannot view members of this business.';
  end if;
  return query
  select m.user_id, u.email::text, m.role, m.created_at,
    m.user_id = (select auth.uid())
  from public.business_members m
  join auth.users u on u.id = m.user_id
  where m.business_id = p_business_id
  order by case m.role when 'owner' then 0 when 'manager' then 1 when 'staff' then 2 else 3 end,
    lower(u.email);
end;
$$;

create or replace function public.add_business_member_by_email(
  p_business_id uuid,
  p_email text,
  p_role text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid;
begin
  if not (select private.is_business_member(p_business_id, array['owner'])) then
    raise exception 'Only the business owner can add team members.';
  end if;
  if p_role not in ('manager','staff','viewer') then
    raise exception 'Choose manager, staff or viewer.';
  end if;
  select u.id into v_user_id from auth.users u
  where lower(u.email) = lower(trim(p_email)) limit 1;
  if v_user_id is null then
    raise exception 'No registered user was found for this email. Create and confirm the user in Supabase Authentication first.';
  end if;
  if exists (
    select 1 from public.business_members m
    where m.business_id = p_business_id and m.user_id = v_user_id and m.role = 'owner'
  ) then
    raise exception 'The business owner role cannot be changed.';
  end if;
  insert into public.business_members (business_id, user_id, role)
  values (p_business_id, v_user_id, p_role)
  on conflict (business_id, user_id) do update set role = excluded.role;
  return v_user_id;
end;
$$;

create or replace function public.update_business_member_role(
  p_business_id uuid,
  p_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_business_member(p_business_id, array['owner'])) then
    raise exception 'Only the business owner can change team roles.';
  end if;
  if p_role not in ('manager','staff','viewer') then
    raise exception 'Choose manager, staff or viewer.';
  end if;
  update public.business_members m set role = p_role
  where m.business_id = p_business_id and m.user_id = p_user_id and m.role <> 'owner';
  if not found then raise exception 'This member cannot be updated.'; end if;
end;
$$;

create or replace function public.remove_business_member(
  p_business_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_business_member(p_business_id, array['owner'])) then
    raise exception 'Only the business owner can remove team members.';
  end if;
  if p_user_id = (select auth.uid()) then
    raise exception 'You cannot remove your own account.';
  end if;
  delete from public.business_members m
  where m.business_id = p_business_id and m.user_id = p_user_id and m.role <> 'owner';
  if not found then raise exception 'This member cannot be removed.'; end if;
end;
$$;

revoke all on function public.list_business_members(uuid) from public, anon;
revoke all on function public.add_business_member_by_email(uuid, text, text) from public, anon;
revoke all on function public.update_business_member_role(uuid, uuid, text) from public, anon;
revoke all on function public.remove_business_member(uuid, uuid) from public, anon;
grant execute on function public.list_business_members(uuid) to authenticated;
grant execute on function public.add_business_member_by_email(uuid, text, text) to authenticated;
grant execute on function public.update_business_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.remove_business_member(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
