-- Run once in the Supabase SQL editor if you already ran the earlier schema.
-- Edits, holds, cancels and reopens no longer require a reason (it is still saved if you type one).

create or replace function update_shipment(p_id uuid, p_changes jsonb, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare old_row shipments; new_fba text; new_boxes int; regen boolean := false;
begin
  perform _require_role(array['inventory']);
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

create or replace function update_line(p_line uuid, p_units int, p_boxes int, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare old_row shipment_lines; iid uuid;
begin
  perform _require_role(array['inventory']);
  select * into old_row from shipment_lines where id = p_line for update;
  update shipment_lines set unit_qty = p_units, box_qty = p_boxes where id = p_line;
  if p_units <> old_row.unit_qty then
    select id into iid from inspections where line_id = p_line;
    delete from fnsku_checks where inspection_id = iid;
    insert into fnsku_checks(inspection_id, sample_no, unit_no)
    select iid, sample_no, v from _random_samples(p_units);
    update inspections set needs_recheck = (status <> 'Open'), inspected_qty = p_units where id = iid;
  end if;
  perform _audit('shipment_line', p_line, 'edit', to_jsonb(old_row),
                 jsonb_build_object('unit_qty', p_units, 'box_qty', p_boxes), p_reason);
end $$;

create or replace function set_line_state(p_line uuid, p_state text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare ln shipment_lines; ins inspections;
begin
  perform _require_role(array['inventory']);
  select * into ln from shipment_lines where id = p_line for update;
  select * into ins from inspections where line_id = p_line;
  if p_state in ('Not Dispatched', 'Cancelled') then
    update shipment_lines set status = p_state where id = p_line;
  elsif p_state = 'Restore' then
    update shipment_lines set status = case when ins.status = 'Open' then 'QC Open' else 'QC Submitted' end where id = p_line;
    perform refresh_line(p_line);
  else
    raise exception 'Unknown state %', p_state;
  end if;
  perform _audit('shipment_line', p_line, 'state:' || p_state, jsonb_build_object('status', ln.status), null, p_reason);
  perform refresh_shipment(ln.shipment_id);
end $$;

create or replace function cancel_shipment(p_ship uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_role(array['inventory']);
  if exists (select 1 from dispatches where shipment_id = p_ship) then
    raise exception 'Shipment already has a dispatch and cannot be cancelled';
  end if;
  update shipment_lines set status = 'Cancelled' where shipment_id = p_ship;
  update shipments set status = 'Cancelled', on_hold = false where id = p_ship;
  perform _audit('shipment', p_ship, 'cancel', null, null, p_reason);
end $$;

create or replace function clear_hold(p_ship uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_role(array['inventory']);
  update shipments set on_hold = false, hold_reason = null where id = p_ship;
  perform _audit('shipment', p_ship, 'clear_hold', null, null, p_reason);
end $$;

create or replace function reopen_inspection(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare ins inspections; ln shipment_lines;
begin
  perform _require_role(array['inventory', 'wm']);
  select * into ins from inspections where id = p_id for update;
  select * into ln from shipment_lines where id = ins.line_id;
  if exists (select 1 from dispatch_lines where line_id = ln.id) then
    raise exception 'This line already has a dispatch and cannot be reopened';
  end if;
  update inspections set status = 'Open', qc_sign_path = null, submitted_at = null where id = p_id;
  update shipment_lines set status = 'QC Open' where id = ln.id;
  perform _audit('inspection', p_id, 'reopen', jsonb_build_object('status', ins.status), null, p_reason);
  perform refresh_shipment(ln.shipment_id);
end $$;
