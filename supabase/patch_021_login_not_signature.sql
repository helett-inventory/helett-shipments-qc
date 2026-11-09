-- Everyone has their own login, so the case is recorded under the logged-in user's name and no signature is drawn.
-- The name always comes from the server (app_name()), never from the app, so it cannot be changed by the person using it.
-- Old signatures on existing records are kept. Safe to run more than once.

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
    inspector_name    = app_name(), -- always the logged-in user
    qc_sign_path      = null,
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
  if sh.dispatch_mode is distinct from 'ATS' and (box_checks = 0 or box_ok <> box_checks) then
    raise exception 'Box label check is not complete. Scan the box labels first.';
  end if;
  if coalesce(jsonb_array_length(p->'lines'), 0) = 0 then raise exception 'Choose at least one line to dispatch'; end if;

  boxes_new := (p->>'boxes_sent')::int;
  select coalesce(sum(boxes_sent), 0) into boxes_prior from dispatches where shipment_id = p_ship;
  if boxes_prior + boxes_new > sh.box_qty_total then
    raise exception 'Boxes sent (%) would exceed total boxes (%)', boxes_prior + boxes_new, sh.box_qty_total;
  end if;

  insert into dispatches(shipment_id, dispatched_by_name, transport, boxes_sent, remarks, dispatch_sign_path)
  values (p_ship, app_name(), nullif(p->>'transport', ''), boxes_new, nullif(p->>'remarks', ''), null)
  returning id into d;

  for l in select * from jsonb_array_elements(p->'lines') loop
    select * into ln from shipment_lines where id = (l->>'line_id')::uuid and shipment_id = p_ship;
    if not found then raise exception 'Line does not belong to this shipment'; end if;
    select * into ins from inspections where line_id = ln.id;
    if ln.status not in ('QC Submitted', 'Partially Dispatched') then
      raise exception '% is not ready to dispatch (%)', ln.product_name, ln.status;
    end if;
    select coalesce(sum(units), 0) into already_units from dispatch_lines where line_id = ln.id;
    if already_units + (l->>'units')::int > least(ins.accepted_qty, ln.unit_qty) then
      raise exception 'More units than QC accepted for %', ln.product_name;
    end if;
    insert into dispatch_lines(dispatch_id, line_id, units) values (d, ln.id, (l->>'units')::int);
    perform refresh_line(ln.id);
  end loop;

  perform _audit('dispatch', d, 'confirm', null, p);
  perform refresh_shipment(p_ship);
  return d;
end $$;

create or replace function approve_dispatch(p_dispatch uuid, p_sign_path text default null, p_name text default null) returns void
language plpgsql security definer set search_path = public as $$
declare d dispatches; l record;
begin
  perform _require_role(array['wm']);
  select * into d from dispatches where id = p_dispatch for update;
  if d.wm_approved_at is not null then raise exception 'Already approved'; end if;
  update dispatches set wm_approved_at = now(), wm_name = app_name(), wm_sign_path = null where id = p_dispatch;
  for l in select line_id from dispatch_lines where dispatch_id = p_dispatch loop
    perform refresh_line(l.line_id);
  end loop;
  perform _audit('dispatch', p_dispatch, 'approve', null, null);
  perform refresh_shipment(d.shipment_id);
end $$;

create or replace function manual_qc(p_line uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare ln shipment_lines; ins inspections; v_checked int; v_failed int;
begin
  perform _require_role(array['inventory', 'wm']);
  select * into ln from shipment_lines where id = p_line for update;
  if not found then raise exception 'Line not found'; end if;
  if ln.status <> 'QC Open' then raise exception 'QC is already done for this line'; end if;
  select * into ins from inspections where line_id = p_line for update;
  if ins.status <> 'Open' then raise exception 'This case is already submitted'; end if;

  v_checked := (p->>'checked')::int;
  v_failed  := (p->>'failed')::int;
  if v_checked is null or v_checked < 1 then raise exception 'Enter how many units were checked'; end if;
  if v_failed is null or v_failed < 0 then raise exception 'Enter how many units failed (0 if none)'; end if;
  if v_failed > v_checked then raise exception 'Failed is more than checked'; end if;

  update inspections set
status          = 'Submitted',
manual          = true,
manual_by       = app_name(),
inspection_date = current_date,
inspected_qty   = v_checked,
rejected_qty    = v_failed,
accepted_qty    = v_checked - v_failed,
inspector_name  = app_name(),
qc_remarks      = 'Manual QC: paper form filled offline.',
submitted_at    = now(),
needs_recheck   = false
  where id = ins.id;

  update shipment_lines set status = 'QC Submitted' where id = ln.id;
  perform _audit('inspection', ins.id, 'manual_qc', null,
             jsonb_build_object('checked', v_checked, 'failed', v_failed));
  perform refresh_shipment(ln.shipment_id);
end $$;

notify pgrst, 'reload schema';
