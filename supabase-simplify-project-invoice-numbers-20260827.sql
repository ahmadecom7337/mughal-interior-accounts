-- Assign simple sequential numbers to new project invoices only.
-- Existing invoice numbers and order invoice numbering remain unchanged.

create or replace function private.assign_project_invoice_number()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_next integer;
begin
  if new.project_id is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(new.business_id::text || ':project-invoice-number', 20260827)
  );

  select coalesce(max((substring(i.invoice_number from '^INV-([0-9]+)$'))::integer), 0) + 1
  into v_next
  from public.invoices i
  where i.business_id = new.business_id
    and i.project_id is not null
    and i.invoice_number ~ '^INV-[0-9]+$';

  new.invoice_number := 'INV-' || lpad(v_next::text, 4, '0');
  return new;
end;
$$;

drop trigger if exists invoices_assign_project_number on public.invoices;
create trigger invoices_assign_project_number
before insert on public.invoices
for each row execute function private.assign_project_invoice_number();

notify pgrst, 'reload schema';
