-- Patch 032: logic fixes from the second review pass (see REVIEW_FIXES.md). Safe to run more than once.
-- Run patch_031 first.

-- 1) Quantities cannot be negative.
alter table shipment_lines drop constraint if exists shipment_lines_box_qty_nonneg;
alter table shipment_lines add constraint shipment_lines_box_qty_nonneg check (box_qty is null or box_qty >= 0) not valid;
alter table inspections drop constraint if exists inspections_qty_nonneg;
alter table inspections add constraint inspections_qty_nonneg
  check (inspected_qty >= 0 and accepted_qty >= 0 and rejected_qty >= 0) not valid;

-- 2) submit_inspection: refuse negative quantities and cancelled lines (otherwise as patch_031).
create or replace function submit_inspection(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare ins inspections; ln shipment_lines;
begin
  perform _require_role(array['qc']);
  select * into ins from inspections where id = p_id for update;
  if not found then raise exception 'QC case not found'; end if;
  if ins.status <> 'Open' then raise exception 'This case is already submitted'; end if;
  select * into ln from shipment_lines where id = ins.line_id;
  if ln.status = 'Cancelled' then raise exception 'This line is cancelled'; end if;
  if exists (select 1 from fnsku_checks where inspection_id = p_id and scanned is null) then
    raise exception 'Scan all FNSKU samples before submitting';
  end if;
  if (p->>'inspected_qty')::int < 0 or (p->>'accepted_qty')::int < 0 or (p->>'rejected_qty')::int < 0 then
    raise exception 'Quantities cannot be negative';
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
    inspector_name    = app_name(),
    qc_sign_path      = null,
    submitted_at      = now(),
    needs_recheck     = false
  where id = p_id returning * into ins;

  if ln.status = 'QC Open' then
    update shipment_lines set status = 'QC Submitted' where id = ln.id;
  end if;
  perform _audit('inspection', p_id, 'submit', null, null);
  perform refresh_shipment(ln.shipment_id);
end $$;

-- 3) confirm_dispatch: a line flagged "quantity changed after QC, recheck" cannot ship until it is rechecked
--    (or Inventory dismisses the flag). Otherwise as patch_021.
create or replace function confirm_dispatch(p_ship uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare sh shipments; d uuid; l jsonb; ln shipment_lines; ins inspections;
        already_units int; boxes_prior int; boxes_new int; box_checks int; box_ok int;
begin
  perform _require_role(array['inventory']);
  select * into sh from shipments where id = p_ship for update;
  if not found then raise exception 'Shipment not found'; end if;
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
    if ins.needs_recheck then
      raise exception '% changed after QC and needs a recheck before it can be dispatched', ln.product_name;
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

-- 4) set_line_state: a line that already has dispatched units cannot be cancelled or parked (that left a
--    "Cancelled" shipment with goods already sent), and nothing changes on a cancelled shipment.
create or replace function set_line_state(p_line uuid, p_state text) returns void
language plpgsql security definer set search_path = public as $$
declare ln shipment_lines; ins inspections; sh_status text;
begin
  perform _require_role(array['inventory']);
  select * into ln from shipment_lines where id = p_line for update;
  if not found then raise exception 'Line not found'; end if;
  select status into sh_status from shipments where id = ln.shipment_id;
  if sh_status = 'Cancelled' then raise exception 'This shipment is cancelled'; end if;
  select * into ins from inspections where line_id = p_line;
  if p_state in ('Not Dispatched', 'Cancelled') then
    if exists (select 1 from dispatch_lines where line_id = p_line) then
      raise exception 'This line already has a dispatch and cannot be cancelled or parked';
    end if;
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

-- 5) add_line: no new lines on a cancelled or closed shipment (it brought a cancelled shipment back to life).
create or replace function add_line(p_ship uuid, p_asin text, p_units int, p_boxes int)
returns uuid language plpgsql security definer set search_path = public as $$
declare pm sku_map; lid uuid; iid uuid; sh_status text;
begin
  perform _require_role(array['inventory']);
  select status into sh_status from shipments where id = p_ship for update;
  if not found then raise exception 'Shipment not found'; end if;
  if sh_status in ('Cancelled', 'Closed') then raise exception 'This shipment is finished'; end if;
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

-- 6) Unknown ids are errors, not silent successes.
create or replace function approve_dispatch(p_dispatch uuid, p_sign_path text default null, p_name text default null) returns void
language plpgsql security definer set search_path = public as $$
declare d dispatches; l record;
begin
  perform _require_role(array['wm']);
  select * into d from dispatches where id = p_dispatch for update;
  if not found then raise exception 'Dispatch not found'; end if;
  if d.wm_approved_at is not null then raise exception 'Already approved'; end if;
  update dispatches set wm_approved_at = now(), wm_name = app_name(), wm_sign_path = null where id = p_dispatch;
  for l in select line_id from dispatch_lines where dispatch_id = p_dispatch loop
    perform refresh_line(l.line_id);
  end loop;
  perform _audit('dispatch', p_dispatch, 'approve', null, null);
  perform refresh_shipment(d.shipment_id);
end $$;

create or replace function reopen_inspection(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ins inspections; ln shipment_lines;
begin
  perform _require_role(array['inventory', 'wm']);
  select * into ins from inspections where id = p_id for update;
  if not found then raise exception 'QC case not found'; end if;
  select * into ln from shipment_lines where id = ins.line_id;
  if ln.status = 'Cancelled' then raise exception 'This line is cancelled'; end if;
  if exists (select 1 from dispatch_lines where line_id = ln.id) then
    raise exception 'This line already has a dispatch and cannot be reopened';
  end if;
  update inspections set status = 'Open', qc_sign_path = null, submitted_at = null, manual = false, manual_by = null where id = p_id;
  update shipment_lines set status = 'QC Open' where id = ln.id;
  perform _audit('inspection', p_id, 'reopen', jsonb_build_object('status', ins.status), null);
  perform refresh_shipment(ln.shipment_id);
end $$;

notify pgrst, 'reload schema';
