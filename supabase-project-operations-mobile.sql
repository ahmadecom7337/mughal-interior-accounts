-- Project workspace mobile modules: receipts, labour, materials, and expenses.

alter table public.labourers
  add column if not exists record_date date not null default current_date,
  add column if not exists joining_date date,
  add column if not exists speciality text;

alter table public.project_entries
  add column if not exists expense_category_id uuid
  references public.expense_categories(id) on delete restrict;

create index if not exists project_entries_expense_category_idx
  on public.project_entries(expense_category_id)
  where expense_category_id is not null;

-- Members can correct records; permanent deletion remains owner-only.
drop policy if exists "Members update payments" on public.payments;
create policy "Members update payments"
  on public.payments for update to authenticated
  using ((select private.is_business_member(payments.business_id, array['owner','manager','staff'])))
  with check ((select private.is_business_member(payments.business_id, array['owner','manager','staff'])));

drop policy if exists "Owners delete payments" on public.payments;
create policy "Owners delete payments"
  on public.payments for delete to authenticated
  using ((select private.is_business_member(payments.business_id, array['owner'])));

drop policy if exists "Members update project entries" on public.project_entries;
create policy "Members update project entries"
  on public.project_entries for update to authenticated
  using ((select private.is_business_member(project_entries.business_id, array['owner','manager','staff'])))
  with check (
    (select private.is_business_member(project_entries.business_id, array['owner','manager','staff']))
    and exists (
      select 1 from public.projects p
      where p.id = project_entries.project_id
        and p.business_id = project_entries.business_id
        and p.status = 'Approved'
    )
  );

drop policy if exists "Owners delete project entries" on public.project_entries;
create policy "Owners delete project entries"
  on public.project_entries for delete to authenticated
  using ((select private.is_business_member(project_entries.business_id, array['owner'])));

drop policy if exists "Owners delete labourers" on public.labourers;
create policy "Owners delete labourers"
  on public.labourers for delete to authenticated
  using ((select private.is_business_member(labourers.business_id, array['owner'])));

drop policy if exists "Owners delete expense categories" on public.expense_categories;
create policy "Owners delete expense categories"
  on public.expense_categories for delete to authenticated
  using ((select private.is_business_member(expense_categories.business_id, array['owner'])));

create or replace function public.update_project_receipt(
  p_payment_id uuid,
  p_payment_date date,
  p_to_account_id uuid,
  p_amount numeric,
  p_description text,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_business_id uuid;
begin
  if p_payment_date is null or p_to_account_id is null or p_amount is null or p_amount <= 0
     or nullif(trim(p_description), '') is null then
    raise exception 'Complete the date, bank account, amount and details.';
  end if;

  select p.business_id into v_business_id
  from public.payments p
  where p.id = p_payment_id and p.payment_type = 'customer_receipt';

  if v_business_id is null
     or not (select private.is_business_member(v_business_id, array['owner','manager','staff'])) then
    raise exception 'Receipt not found or access denied.';
  end if;

  if not exists (
    select 1 from public.payment_accounts a
    where a.id = p_to_account_id and a.business_id = v_business_id and a.active
  ) then
    raise exception 'Select an active bank or cash account.';
  end if;

  update public.payments
  set payment_date = p_payment_date,
      to_account_id = p_to_account_id,
      amount = p_amount,
      description = trim(p_description),
      notes = nullif(trim(coalesce(p_notes, '')), '')
  where id = p_payment_id;

  update public.project_entries
  set entry_date = p_payment_date,
      description = trim(p_description),
      amount = p_amount,
      notes = nullif(trim(coalesce(p_notes, '')), '')
  where payment_id = p_payment_id;

  return p_payment_id;
end;
$$;

create or replace function public.delete_project_receipt(p_payment_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_business_id uuid;
begin
  select p.business_id into v_business_id
  from public.payments p
  where p.id = p_payment_id and p.payment_type = 'customer_receipt';

  if v_business_id is null
     or not (select private.is_business_member(v_business_id, array['owner'])) then
    raise exception 'Only the business owner can delete this receipt.';
  end if;

  delete from public.project_entries where payment_id = p_payment_id;
  delete from public.payments where id = p_payment_id;
  return p_payment_id;
end;
$$;

revoke all on function public.update_project_receipt(uuid,date,uuid,numeric,text,text) from public, anon;
grant execute on function public.update_project_receipt(uuid,date,uuid,numeric,text,text) to authenticated;
revoke all on function public.delete_project_receipt(uuid) from public, anon;
grant execute on function public.delete_project_receipt(uuid) to authenticated;

notify pgrst, 'reload schema';
