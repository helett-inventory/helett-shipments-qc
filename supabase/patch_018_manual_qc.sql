-- Manual (paper) QC. Management fills the printed QC form offline, then Inventory or the
-- Warehouse Manager enters the checked and failed counts here. Safe to run more than once.
alter table inspections add column if not exists manual boolean not null default false;
alter table inspections add column if not exists manual_by text;

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
    manual_by       = coalesce(nullif(trim(p->>'by_name'), ''), app_name()),
    inspection_date = current_date,
    inspected_qty   = v_checked,
    rejected_qty    = v_failed,
    accepted_qty    = v_checked - v_failed,
    inspector_name  = coalesce(nullif(trim(p->>'by_name'), ''), app_name()),
    qc_remarks      = 'Manual QC: paper form filled offline.',
    submitted_at    = now(),
    needs_recheck   = false
  where id = ins.id;

  update shipment_lines set status = 'QC Submitted' where id = ln.id;
  perform _audit('inspection', ins.id, 'manual_qc', null,
                 jsonb_build_object('checked', v_checked, 'failed', v_failed));
  perform refresh_shipment(ln.shipment_id);
end $$;

-- Reopening a case also drops the manual flag, so a rechecked case is a normal one again.
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
  update inspections set status = 'Open', qc_sign_path = null, submitted_at = null, manual = false, manual_by = null where id = p_id;
  update shipment_lines set status = 'QC Open' where id = ln.id;
  perform _audit('inspection', p_id, 'reopen', jsonb_build_object('status', ins.status), null);
  perform refresh_shipment(ln.shipment_id);
end $$;
