-- Mughal Interior Accounts — atomic bulk material assignment

create or replace function public.assign_materials_bulk(
  p_business_id uuid,
  p_project_id uuid,
  p_walk_in_order_id uuid,
  p_movement_date date,
  p_items jsonb
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item jsonb;
  v_material_id uuid;
  v_quantity numeric(14,3);
  v_unit_cost numeric(14,2);
  v_count integer := 0;
  v_movement_type text;
begin
  if not (select private.is_business_member(p_business_id,array['owner','manager','staff'])) then
    raise exception 'This account cannot assign materials.';
  end if;

  if num_nonnulls(p_project_id,p_walk_in_order_id) <> 1 then
    raise exception 'Select one project or one order.';
  end if;
  if p_movement_date is null then raise exception 'Select an assignment date.'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one material.';
  end if;
  if jsonb_array_length(p_items) > 100 then raise exception 'A maximum of 100 materials can be assigned at once.'; end if;

  if p_project_id is not null then
    if not exists(
      select 1 from public.projects p
      where p.id=p_project_id and p.business_id=p_business_id and p.status='Approved' and not p.closed
    ) then raise exception 'The selected project is not active and approved.'; end if;
    v_movement_type := 'project_issue';
  else
    if not exists(
      select 1 from public.walk_in_orders w
      where w.id=p_walk_in_order_id and w.business_id=p_business_id and w.status in ('Pending','In Progress','Ready')
    ) then raise exception 'The selected order is not active.'; end if;
    v_movement_type := 'walk_in_issue';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_material_id := (v_item->>'material_id')::uuid;
      v_quantity := (v_item->>'quantity')::numeric;
      v_unit_cost := (v_item->>'unit_cost')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'A material line contains an invalid quantity or cost.';
    end;

    if not exists(
      select 1 from public.materials m
      where m.id=v_material_id and m.business_id=p_business_id and m.active
    ) then raise exception 'A selected material is unavailable.'; end if;
    if coalesce(v_quantity,0) <= 0 or coalesce(v_unit_cost,0) <= 0 then
      raise exception 'Every material needs a quantity and cost greater than zero.';
    end if;

    insert into public.material_movements(
      business_id,material_id,project_id,walk_in_order_id,movement_type,movement_date,
      quantity,unit_cost,reference,notes
    ) values (
      p_business_id,v_material_id,p_project_id,p_walk_in_order_id,v_movement_type,p_movement_date,
      v_quantity,v_unit_cost,nullif(trim(v_item->>'reference'),''),nullif(trim(v_item->>'notes'),'')
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.assign_materials_bulk(uuid,uuid,uuid,date,jsonb) from public, anon, authenticated;
grant execute on function public.assign_materials_bulk(uuid,uuid,uuid,date,jsonb) to authenticated;
