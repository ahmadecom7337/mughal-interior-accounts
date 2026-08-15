-- Explicitly correlate material movement policies to the inserted row.

drop policy if exists "Members add material movements" on public.material_movements;

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

notify pgrst, 'reload schema';
