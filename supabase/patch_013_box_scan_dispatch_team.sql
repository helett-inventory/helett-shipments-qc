-- Run once in the Supabase SQL editor.
-- Box labels are scanned by the dispatch team (Inventory / admin) from the shipment page, not by QC.

create or replace function scan_box_label(p_check uuid, p_code text) returns jsonb
  language plpgsql security definer set search_path = public as $$
  declare c box_label_checks; sh shipments; code text; code_fba text; code_box int; v_ok boolean := false; v_reason text;
  begin
    perform _require_role(array['inventory']);
    code := upper(trim(p_code));
    select * into c from box_label_checks where id = p_check;
    if not found then raise exception 'Scan slot not found'; end if;
    select * into sh from shipments where id = c.shipment_id;
    -- Labels are pasted at shipment time, after the QC checklist is done, so any time until the shipment is finished.
  if sh.status in ('Closed', 'Cancelled') then
    raise exception 'This shipment is finished';
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

notify pgrst, 'reload schema';
