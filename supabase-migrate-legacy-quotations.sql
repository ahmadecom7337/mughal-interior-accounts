-- Preserve quotations created before the project-first workflow.

insert into public.projects (
  business_id, party_id, source_quotation_id, project_number, name, description,
  quote_date, valid_until, start_date, expected_end_date, days_to_complete,
  pricing_mode, price_with_material, price_without_material, contract_type,
  original_contract_amount, payment_terms, notes, status, created_at, updated_at
)
select
  q.business_id,
  q.party_id,
  q.id,
  q.quote_number,
  q.project_title,
  q.project_details,
  q.quote_date,
  q.valid_until,
  q.start_date,
  q.end_date,
  q.days_to_complete,
  q.pricing_mode,
  q.price_with_material,
  q.price_without_material,
  case when q.pricing_mode = 'without_material' then 'without_material' else 'with_material' end,
  case when q.pricing_mode = 'without_material' then coalesce(q.price_without_material, 0) else coalesce(q.price_with_material, 0) end,
  q.payment_terms,
  q.notes,
  case when q.status = 'Approved' then 'Approved' when q.status = 'Rejected' then 'Cancelled' else 'Pending' end,
  q.created_at,
  q.updated_at
from public.quotations q
where not exists (
  select 1 from public.projects p where p.source_quotation_id = q.id
);

notify pgrst, 'reload schema';
