-- Run once in the Supabase SQL editor.
-- ATS shipments need no box label scan: the dispatch gate skips that check for them.

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
