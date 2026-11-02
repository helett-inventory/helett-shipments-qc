-- Run once in the Supabase SQL editor.
-- Any box label is accepted when the FBA ID before the U-number matches (U000001, U000003, ...), whatever its number.
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

-- Undo the short-lived 'box number outside the shipment' rejection, if it was ever applied.
update box_label_checks set ok = true, reason = null where reason = 'box_out_of_range';

notify pgrst, 'reload schema';
