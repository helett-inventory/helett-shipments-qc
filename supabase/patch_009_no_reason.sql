-- Run once in the Supabase SQL editor.
-- Removes the 'reason / note' from every edit, hold, cancel and reopen, in the app and in the database.

drop function if exists update_shipment(uuid, jsonb, text);
drop function if exists update_line(uuid, int, int, text);
drop function if exists add_line(uuid, text, int, int, text);
drop function if exists set_line_state(uuid, text, text);
drop function if exists cancel_shipment(uuid, text);
drop function if exists clear_hold(uuid, text);
drop function if exists reopen_inspection(uuid, text);

create or replace function _audit(p_entity text, p_id uuid, p_action text, p_old jsonb, p_new jsonb)
returns void language sql security definer set search_path = public as $$
  insert into audit_log(user_name, entity, entity_id, action, old_data, new_data)
  values (app_name(), p_entity, p_id, p_action, p_old, p_new)
$$;

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

  perform _audit('shipment', sid, 'create', null, p);
  perform refresh_shipment(sid);
  return sid;
end $$;

create or replace function add_line(p_ship uuid, p_asin text, p_units int, p_boxes int)
returns uuid language plpgsql security definer set search_path = public as $$
declare pm sku_map; lid uuid; iid uuid;
begin
  perform _require_role(array['inventory']);
  select * into pm from sku_map where asin = p_asin;
  if not found then raise exception 'Unknown ASIN %', p_asin; end if;
  insert into shipment_lines(shipment_id, asin, product_name, unit_qty, box_qty)
  values (p_ship, pm.asin, pm.product_name, p_units, p_boxes) returning id into lid;
  insert into inspections(line_id, inspected_qty, inspection_date) values (lid, p_units, current_date) returning id into iid;
  insert into fnsku_checks(inspection_id, sample_no, unit_no)
  select iid, sample_no, v from _random_samples(p_units);
  perform _audit('shipment_line', lid, 'add', null, jsonb_build_object('asin', p_asin, 'units', p_units, 'boxes', p_boxes));
  perform refresh_shipment(p_ship);
  return lid;
end $$;

create or replace function update_shipment(p_id uuid, p_changes jsonb) returns void
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

  perform _audit('shipment', p_id, 'edit', to_jsonb(old_row), p_changes);
end $$;

create or replace function update_line(p_line uuid, p_units int, p_boxes int) returns void
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
                 jsonb_build_object('unit_qty', p_units, 'box_qty', p_boxes));
end $$;

create or replace function set_line_state(p_line uuid, p_state text) returns void
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
  perform _audit('shipment_line', p_line, 'state:' || p_state, jsonb_build_object('status', ln.status), null);
  perform refresh_shipment(ln.shipment_id);
end $$;

create or replace function cancel_shipment(p_ship uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_role(array['inventory']);
  if exists (select 1 from dispatches where shipment_id = p_ship) then
    raise exception 'Shipment already has a dispatch and cannot be cancelled';
  end if;
  update shipment_lines set status = 'Cancelled' where shipment_id = p_ship;
  update shipments set status = 'Cancelled', on_hold = false where id = p_ship;
  perform _audit('shipment', p_ship, 'cancel', null, null);
end $$;

create or replace function clear_hold(p_ship uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_role(array['inventory']);
  update shipments set on_hold = false, hold_reason = null where id = p_ship;
  perform _audit('shipment', p_ship, 'clear_hold', null, null);
end $$;

create or replace function scan_fnsku(p_check uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c fnsku_checks; ins inspections; ln shipment_lines; expected text; v_ok boolean; code text;
begin
  perform _require_role(array['qc']);
  code := upper(trim(p_code));
  select * into c from fnsku_checks where id = p_check;
  if not found then raise exception 'Scan slot not found'; end if;
  select * into ins from inspections where id = c.inspection_id;
  if ins.status <> 'Open' then raise exception 'This case is not open'; end if;
  select * into ln from shipment_lines where id = ins.line_id;
  select upper(trim(fnsku)) into expected from sku_map where asin = ln.asin;
  if expected is null or expected = '' then
    raise exception 'No FNSKU on file for %. Ask Inventory to update the SKU map.', ln.asin;
  end if;
  v_ok := (code = expected);
  update fnsku_checks set scanned = code, ok = v_ok, scanned_at = now(), scanned_by = auth.uid() where id = p_check;
  insert into scan_log(kind, check_id, code, ok) values ('fnsku', p_check, code, v_ok);
  if not v_ok then
    update shipments set on_hold = true, hold_reason = 'FNSKU mismatch: ' || ln.product_name where id = ln.shipment_id;
    perform _audit('shipment', ln.shipment_id, 'flag_fnsku', null,
                   jsonb_build_object('product', ln.product_name, 'scanned', code));
  end if;
  return jsonb_build_object('ok', v_ok);
end $$;

create or replace function scan_box_label(p_check uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c box_label_checks; sh shipments; code text; code_fba text; code_box int; v_ok boolean := false; v_reason text;
begin
  perform _require_role(array['qc']);
  code := upper(trim(p_code));
  select * into c from box_label_checks where id = p_check;
  if not found then raise exception 'Scan slot not found'; end if;
  select * into sh from shipments where id = c.shipment_id;
  if not exists (select 1 from inspections i join shipment_lines l on l.id = i.line_id
                 where l.shipment_id = sh.id and i.status = 'Open') then
    raise exception 'No open QC case on this shipment';
  end if;
  -- Any box will do, but the same box cannot count twice.
  if exists (select 1 from box_label_checks where shipment_id = sh.id and id <> p_check and ok and scanned = code) then
    raise exception 'This box label was already scanned. Scan a different box.';
  end if;
  -- Only the FBA ID has to match; the full barcode is stored as scanned.
  code_fba := substring(code from '^(.*)U[0-9]{6}$');
  if code_fba is null then
    v_reason := 'unreadable';
  else
    code_box := substring(code from 'U([0-9]{6})$')::int;
    if code_fba <> upper(sh.fba_id) then v_reason := 'wrong_fba';
    else v_ok := true; end if;
  end if;
  update box_label_checks set scanned = code, box_no = code_box, ok = v_ok, reason = v_reason,
         scanned_at = now(), scanned_by = auth.uid() where id = p_check;
  insert into scan_log(kind, check_id, code, ok) values ('box', p_check, code, v_ok);
  if not v_ok then
    update shipments set on_hold = true, hold_reason = 'Box label mismatch (' || v_reason || ')' where id = sh.id;
    perform _audit('shipment', sh.id, 'flag_box', null, jsonb_build_object('scanned', code, 'reason', v_reason));
  end if;
  return jsonb_build_object('ok', v_ok, 'reason', v_reason);
end $$;

create or replace function submit_inspection(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare ins inspections; ln shipment_lines;
begin
  perform _require_role(array['qc']);
  select * into ins from inspections where id = p_id for update;
  if ins.status <> 'Open' then raise exception 'This case is already submitted'; end if;
  if exists (select 1 from fnsku_checks where inspection_id = p_id and scanned is null) then
    raise exception 'Scan all FNSKU samples before submitting';
  end if;
  if coalesce(p->>'sign_path', '') = '' then raise exception 'QC signature is required'; end if;
  -- Box labels can only be scanned from an open case, so the last open case must finish them.
  if not exists (select 1 from inspections i2 join shipment_lines l2 on l2.id = i2.line_id
                 where i2.id <> p_id and i2.status = 'Open'
                   and l2.status <> 'Cancelled'
                   and l2.shipment_id = (select shipment_id from shipment_lines where id = ins.line_id))
     and exists (select 1 from box_label_checks b where b.shipment_id = (select shipment_id from shipment_lines where id = ins.line_id) and b.scanned is null) then
    raise exception 'Scan all box labels before submitting the last QC case of this shipment';
  end if;
  if (p->>'accepted_qty')::int + (p->>'rejected_qty')::int > (p->>'inspected_qty')::int then
    raise exception 'Accepted plus rejected is more than inspected';
  end if;

  update inspections set
    status = 'Submitted',
    inspection_date   = coalesce(nullif(p->>'inspection_date', '')::date, current_date),
    model_dispatched  = p->>'model_dispatched',
    checks            = coalesce(p->'checks', '{}'::jsonb),
    inspected_qty     = (p->>'inspected_qty')::int,
    accepted_qty      = (p->>'accepted_qty')::int,
    rejected_qty      = (p->>'rejected_qty')::int,
    product_condition = p->>'product_condition',
    packaging_quality = p->>'packaging_quality',
    overall_result    = p->>'overall_result',
    qc_remarks        = nullif(p->>'qc_remarks', ''),
    inspector_name    = p->>'inspector_name',
    qc_sign_path      = p->>'sign_path',
    submitted_at      = now(),
    needs_recheck     = false
  where id = p_id returning * into ins;

  select * into ln from shipment_lines where id = ins.line_id;
  if ln.status = 'QC Open' then
    update shipment_lines set status = 'QC Submitted' where id = ln.id;
  end if;
  perform _audit('inspection', p_id, 'submit', null, null);
  perform refresh_shipment(ln.shipment_id);
end $$;

create or replace function reopen_inspection(p_id uuid) returns void
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
  perform _audit('inspection', p_id, 'reopen', jsonb_build_object('status', ins.status), null);
  perform refresh_shipment(ln.shipment_id);
end $$;

create or replace function confirm_dispatch(p_ship uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare sh shipments; d uuid; l jsonb; ln shipment_lines; ins inspections;
        already_units int; boxes_prior int; boxes_new int; box_checks int; box_ok int;
begin
  perform _require_role(array['inventory']);
  select * into sh from shipments where id = p_ship for update;
  if sh.status = 'Cancelled' then raise exception 'Shipment is cancelled'; end if;
  if sh.on_hold then raise exception 'Shipment is on hold: %', coalesce(sh.hold_reason, 'flag open'); end if;

  select count(*), count(*) filter (where scanned is not null) into box_checks, box_ok from box_label_checks where shipment_id = p_ship;
  if box_checks = 0 or box_ok <> box_checks then
    raise exception 'Box label check is not complete. QC must scan 3 boxes.';
  end if;
  if coalesce(p->>'sign_path', '') = '' then raise exception 'Dispatch signature is required'; end if;
  if coalesce(jsonb_array_length(p->'lines'), 0) = 0 then raise exception 'Choose at least one line to dispatch'; end if;

  boxes_new := (p->>'boxes_sent')::int;
  select coalesce(sum(boxes_sent), 0) into boxes_prior from dispatches where shipment_id = p_ship;
  if boxes_prior + boxes_new > sh.box_qty_total then
    raise exception 'Boxes sent (%) would exceed total boxes (%)', boxes_prior + boxes_new, sh.box_qty_total;
  end if;

  insert into dispatches(shipment_id, dispatched_by_name, transport, boxes_sent, remarks, dispatch_sign_path)
  values (p_ship, coalesce(nullif(trim(p->>'by_name'), ''), app_name()), nullif(p->>'transport', ''), boxes_new, nullif(p->>'remarks', ''), p->>'sign_path')
  returning id into d;

  for l in select * from jsonb_array_elements(p->'lines') loop
    select * into ln from shipment_lines where id = (l->>'line_id')::uuid and shipment_id = p_ship;
    if not found then raise exception 'Line does not belong to this shipment'; end if;
    select * into ins from inspections where line_id = ln.id;
    if ln.status not in ('QC Submitted', 'Partially Dispatched') then
      raise exception '% is not ready to dispatch (%)', ln.product_name, ln.status;
    end if;
    select coalesce(sum(units), 0) into already_units from dispatch_lines where line_id = ln.id;
    if already_units + (l->>'units')::int > ins.accepted_qty then
      raise exception 'More units than QC accepted for %', ln.product_name;
    end if;
    insert into dispatch_lines(dispatch_id, line_id, units) values (d, ln.id, (l->>'units')::int);
    perform refresh_line(ln.id);
  end loop;

  perform _audit('dispatch', d, 'confirm', null, p);
  perform refresh_shipment(p_ship);
  return d;
end $$;

create or replace function approve_dispatch(p_dispatch uuid, p_sign_path text, p_name text default null) returns void
language plpgsql security definer set search_path = public as $$
declare d dispatches; l record;
begin
  perform _require_role(array['wm']);
  if coalesce(p_sign_path, '') = '' then raise exception 'Signature is required'; end if;
  select * into d from dispatches where id = p_dispatch for update;
  if d.wm_approved_at is not null then raise exception 'Already approved'; end if;
  update dispatches set wm_approved_at = now(), wm_name = coalesce(nullif(trim(p_name), ''), app_name()), wm_sign_path = p_sign_path where id = p_dispatch;
  for l in select line_id from dispatch_lines where dispatch_id = p_dispatch loop
    perform refresh_line(l.line_id);
  end loop;
  perform _audit('dispatch', p_dispatch, 'approve', null, null);
  perform refresh_shipment(d.shipment_id);
end $$;

drop function if exists _audit(text, uuid, text, jsonb, jsonb, text);
alter table audit_log drop column if exists reason;

revoke all on function update_shipment(uuid, jsonb), update_line(uuid, int, int), add_line(uuid, text, int, int),
  set_line_state(uuid, text), cancel_shipment(uuid), clear_hold(uuid), reopen_inspection(uuid) from public;
grant execute on function update_shipment(uuid, jsonb), update_line(uuid, int, int), add_line(uuid, text, int, int),
  set_line_state(uuid, text), cancel_shipment(uuid), clear_hold(uuid), reopen_inspection(uuid) to authenticated;

-- Make the API pick up the new function signatures right away.
notify pgrst, 'reload schema';
