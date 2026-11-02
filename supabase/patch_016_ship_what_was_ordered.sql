-- Run once in the Supabase SQL editor.
-- QC may check more units than the shipment needs (failures are thrown out of the pool, good ones fill the shipment).
-- A line never dispatches more than it ordered, even if more units passed QC.

create or replace function refresh_line(p_line uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ln shipment_lines; ins inspections; disp int; unapproved int;
  begin
    select * into ln from shipment_lines where id = p_line;
    if ln.status in ('Cancelled', 'Not Dispatched', 'QC Open') then return; end if;
    select * into ins from inspections where line_id = p_line;
    select coalesce(sum(units), 0) into disp from dispatch_lines where line_id = p_line;
    select count(*) into unapproved
      from dispatch_lines dl join dispatches d on d.id = dl.dispatch_id
      where dl.line_id = p_line and d.wm_approved_at is null;
  
    if disp = 0 then
      update shipment_lines set status = 'QC Submitted' where id = p_line;
      update inspections set status = 'Submitted' where line_id = p_line and status = 'Closed';
    elsif disp < least(ins.accepted_qty, ln.unit_qty) then
      update shipment_lines set status = 'Partially Dispatched' where id = p_line;
    elsif unapproved = 0 then
      update shipment_lines set status = 'Closed' where id = p_line;
      update inspections set status = 'Closed' where line_id = p_line;
    else
      update shipment_lines set status = 'Dispatched' where id = p_line;
    end if;
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
      raise exception 'Box label check is not complete. Scan the box labels first.';
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

notify pgrst, 'reload schema';
