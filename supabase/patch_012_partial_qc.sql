-- Run once in the Supabase SQL editor.
-- QC can be submitted before the box labels exist. The case stays partially closed until the 3 box labels
-- are scanned (any time before the shipment is finished). Dispatch still needs all 3 scanned.

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

create or replace function scan_box_label(p_check uuid, p_code text) returns jsonb
  language plpgsql security definer set search_path = public as $$
  declare c box_label_checks; sh shipments; code text; code_fba text; code_box int; v_ok boolean := false; v_reason text;
  begin
    perform _require_role(array['qc']);
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

notify pgrst, 'reload schema';
