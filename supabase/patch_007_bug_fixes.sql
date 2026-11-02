-- Run once in the Supabase SQL editor.
-- 1) A shipment with a Not Dispatched line no longer shows Closed.
-- 2) The last open QC case cannot be submitted before the 3 box labels are scanned (no one else could scan them).
-- 3) Dispatch needs all 3 box labels scanned and no hold; a mismatch the Inventory team cleared no longer blocks forever.

create or replace function refresh_shipment(p_ship uuid) returns void
language plpgsql security definer set search_path = public as $$
declare total int; cancelled int; parked int; live int; closed int; sent int; partial int; submitted int; v_status text;
begin
  select count(*),
         count(*) filter (where status = 'Cancelled'),
         count(*) filter (where status = 'Not Dispatched'),
         count(*) filter (where status not in ('Cancelled', 'Not Dispatched')),
         count(*) filter (where status = 'Closed'),
         count(*) filter (where status in ('Dispatched', 'Closed')),
         count(*) filter (where status = 'Partially Dispatched'),
         count(*) filter (where status = 'QC Submitted')
    into total, cancelled, parked, live, closed, sent, partial, submitted
    from shipment_lines where shipment_id = p_ship;

  if total = 0 or cancelled = total then v_status := 'Cancelled';
  elsif live = 0 then v_status := 'QC Done';
  elsif closed = live and parked = 0 then v_status := 'Closed';
  elsif sent = live then v_status := 'Dispatched';
  elsif sent + partial > 0 then v_status := 'Partially Dispatched';
  elsif submitted = live then v_status := 'QC Done';
  elsif submitted > 0 then v_status := 'QC In Progress';
  else v_status := 'Created';
  end if;
  update shipments set status = v_status where id = p_ship;
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
  perform _audit('inspection', p_id, 'submit', null, null, null);
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
  values (p_ship, app_name(), nullif(p->>'transport', ''), boxes_new, nullif(p->>'remarks', ''), p->>'sign_path')
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

  perform _audit('dispatch', d, 'confirm', null, p, null);
  perform refresh_shipment(p_ship);
  return d;
end $$;
