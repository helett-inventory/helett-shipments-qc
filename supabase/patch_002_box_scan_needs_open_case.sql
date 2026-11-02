-- Run once in the Supabase SQL editor if you already ran the original schema.sql.
-- Box label scans are only allowed while the shipment has an open QC case.
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
  code_fba := substring(code from '^(.*)U[0-9]{6}$');
  if code_fba is null then
    v_reason := 'unreadable';
  else
    code_box := substring(code from 'U([0-9]{6})$')::int;
    if code_fba <> upper(sh.fba_id) then v_reason := 'wrong_fba';
    elsif code_box < 1 or code_box > sh.box_qty_total then v_reason := 'box_out_of_range';
    elsif code_box <> c.box_no then v_reason := 'wrong_box';
    else v_ok := true; end if;
  end if;
  update box_label_checks set scanned = code, ok = v_ok, reason = v_reason, scanned_at = now(), scanned_by = auth.uid() where id = p_check;
  insert into scan_log(kind, check_id, code, ok) values ('box', p_check, code, v_ok);
  if not v_ok then
    update shipments set on_hold = true, hold_reason = 'Box label mismatch (' || v_reason || ')' where id = sh.id;
    perform _audit('shipment', sh.id, 'flag_box', null, jsonb_build_object('scanned', code, 'reason', v_reason), 'Box label mismatch at scan');
  end if;
  return jsonb_build_object('ok', v_ok, 'reason', v_reason);
end $$;
