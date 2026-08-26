-- Mobile redesign support: project master records now store their work location.
alter table public.projects
  add column if not exists location text;

comment on column public.projects.location is
  'Project work location shown on project records and documents.';

-- Destructive actions are intentionally limited to business owners.
drop policy if exists "Owners delete parties" on public.parties;
create policy "Owners delete parties"
  on public.parties for delete to authenticated
  using (private.is_business_member(business_id, array['owner']));

drop policy if exists "Owners delete projects" on public.projects;
create policy "Owners delete projects"
  on public.projects for delete to authenticated
  using (private.is_business_member(business_id, array['owner']));

drop policy if exists "Owners delete invoices" on public.invoices;
create policy "Owners delete invoices"
  on public.invoices for delete to authenticated
  using (private.is_business_member(business_id, array['owner']));
