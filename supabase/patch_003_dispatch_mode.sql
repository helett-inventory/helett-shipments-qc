-- Run once in the Supabase SQL editor if you already ran the original schema.sql.
-- Adds 'mode of dispatch' (ATS / Drop In) to shipments; it is entered when the shipment is created.
alter table shipments add column if not exists dispatch_mode text check (dispatch_mode in ('ATS', 'Drop In'));

create or replace function create_shipment(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid; l jsonb; lid uuid; iid uuid; pm sku_map; boxes int;
begin
  perform _require_role(array['inventory']);
  if coalesce(jsonb_array_length(p->'lines'), 0) = 0 then raise exception 'Add at least one SKU line'; end if;
  boxes := (p->>'box_qty_total')::int;

  insert into shipments(fba_id, warehouse, appointment_at, transport, dispatch_date, remarks, box_qty_total, dispatch_mode)
  values (upper(trim(p->>'fba_id')), trim(p->>'warehouse'), nullif(p->>'appointment_at', '')::timestamptz,
          nullif(p->>'transport', ''), nullif(p->>'dispatch_date', '')::date, nullif(p->>'remarks', ''), boxes,
          nullif(p->>'dispatch_mode', ''))
  returning id into sid;

  insert into box_label_checks(shipment_id, sample_no, box_no)
  select sid, sample_no, v from _random_samples(boxes);

  for l in select * from jsonb_array_elements(p->'lines') loop
    select * into pm from sku_map where asin = l->>'asin';
    if not found then raise exception 'Unknown ASIN %', l->>'asin'; end if;
    insert into shipment_lines(shipment_id, asin, product_name, unit_qty, box_qty)
    values (sid, pm.asin, pm.product_name, (l->>'unit_qty')::int, nullif(l->>'box_qty', '')::int)
    returning id into lid;
    insert into inspections(line_id, inspected_qty, inspection_date)
    values (lid, (l->>'unit_qty')::int, current_date) returning id into iid;
    insert into fnsku_checks(inspection_id, sample_no, unit_no)
    select iid, sample_no, v from _random_samples((l->>'unit_qty')::int);
  end loop;

  perform _audit('shipment', sid, 'create', null, p, null);
  perform refresh_shipment(sid);
  return sid;
end $$;

create or replace function update_shipment(p_id uuid, p_changes jsonb, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare old_row shipments; new_fba text; new_boxes int; regen boolean := false;
begin
  perform _require_role(array['inventory']);
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  select * into old_row from shipments where id = p_id for update;
  new_fba   := upper(trim(coalesce(p_changes->>'fba_id', old_row.fba_id)));
  new_boxes := coalesce((p_changes->>'box_qty_total')::int, old_row.box_qty_total);
  regen := (new_fba <> old_row.fba_id) or (new_boxes <> old_row.box_qty_total);

  update shipments set
    fba_id         = new_fba,
    box_qty_total  = new_boxes,
    warehouse      = coalesce(nullif(trim(p_changes->>'warehouse'), ''), warehouse),
    dispatch_mode  = case when p_changes ? 'dispatch_mode' then nullif(p_changes->>'dispatch_mode', '') else dispatch_mode end,
    appointment_at = case when p_changes ? 'appointment_at' then nullif(p_changes->>'appointment_at', '')::timestamptz else appointment_at end,
    dispatch_date  = case when p_changes ? 'dispatch_date'  then nullif(p_changes->>'dispatch_date', '')::date else dispatch_date end,
    transport      = case when p_changes ? 'transport' then nullif(p_changes->>'transport', '') else transport end,
    remarks        = case when p_changes ? 'remarks'   then nullif(p_changes->>'remarks', '')   else remarks end
  where id = p_id;

  if regen then
    delete from box_label_checks where shipment_id = p_id;
    insert into box_label_checks(shipment_id, sample_no, box_no)
    select p_id, sample_no, v from _random_samples(new_boxes);
  end if;

  perform _audit('shipment', p_id, 'edit', to_jsonb(old_row), p_changes, p_reason);
end $$;
