-- Patch 031: fixes from the independent review (see REVIEW_FIXES.md). Safe to run more than once.

-- 1) Internal helpers must not be callable through the API. They were granted to PUBLIC by default, so
--    anon or a view-only login could forge audit_log rows or force status recalculation.
--    The app's own functions are security definer (owned by the table owner) and keep working.
revoke all on function _audit(text, uuid, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function refresh_line(uuid) from public, anon, authenticated;
revoke all on function refresh_shipment(uuid) from public, anon, authenticated;
revoke all on function _random_samples(int) from public, anon, authenticated;
revoke all on function _require_role(text[]) from public, anon, authenticated;
revoke all on function _stamp_hold() from public, anon, authenticated;

-- 2) Blank FBA ID / warehouse are refused (existing rows are not re-checked).
alter table shipments drop constraint if exists shipments_fba_id_not_blank;
alter table shipments add constraint shipments_fba_id_not_blank check (length(trim(fba_id)) > 0) not valid;
alter table shipments drop constraint if exists shipments_warehouse_not_blank;
alter table shipments add constraint shipments_warehouse_not_blank check (length(trim(warehouse)) > 0) not valid;

-- 3) Editing after dispatch can no longer wipe scan evidence or push totals below what was sent.
create or replace function update_shipment(p_id uuid, p_changes jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare old_row shipments; new_fba text; new_boxes int; regen boolean := false; sent int; has_dispatch boolean;
begin
  perform _require_role(array['inventory']);
  select * into old_row from shipments where id = p_id for update;
  if not found then raise exception 'Shipment not found'; end if;
  if old_row.status in ('Closed', 'Cancelled') then raise exception 'This shipment is finished and cannot be edited'; end if;
  new_fba   := upper(trim(coalesce(p_changes->>'fba_id', old_row.fba_id)));
  new_boxes := coalesce((p_changes->>'box_qty_total')::int, old_row.box_qty_total);
  if new_fba = '' then raise exception 'FBA shipment ID is required'; end if;
  if p_changes ? 'warehouse' and nullif(trim(p_changes->>'warehouse'), '') is null then raise exception 'Warehouse is required'; end if;
  select coalesce(sum(boxes_sent), 0), count(*) > 0 into sent, has_dispatch from dispatches where shipment_id = p_id;
  if has_dispatch and new_fba <> old_row.fba_id then raise exception 'The FBA ID cannot change after a dispatch'; end if;
  if new_boxes < sent then raise exception 'Total boxes (%) cannot be less than boxes already sent (%)', new_boxes, sent; end if;
  regen := not has_dispatch and ((new_fba <> old_row.fba_id) or (new_boxes <> old_row.box_qty_total));

  update shipments set
    fba_id         = new_fba,
    box_qty_total  = new_boxes,
    warehouse      = coalesce(nullif(trim(p_changes->>'warehouse'), ''), warehouse),
    dispatch_mode  = case when p_changes ? 'dispatch_mode' then nullif(p_changes->>'dispatch_mode', '') else dispatch_mode end,
    appointment_at = case when p_changes ? 'appointment_at' then nullif(p_changes->>'appointment_at', '')::timestamptz else appointment_at end,
    dispatch_date  = case when p_changes ? 'dispatch_date'  then nullif(p_changes->>'dispatch_date', '')::date else dispatch_date end,
    transport      = case when p_changes ? 'transport' then nullif(p_changes->>'transport', '') else transport end,
    remarks        = case when p_changes ? 'remarks'   then nullif(p_changes->>'remarks', '')   else remarks end
  where id = p_id;

  if regen then
    delete from box_label_checks where shipment_id = p_id;
    insert into box_label_checks(shipment_id, sample_no, box_no)
    select p_id, sample_no, v from _random_samples(new_boxes);
  end if;

  perform _audit('shipment', p_id, 'edit', to_jsonb(old_row), p_changes);
end $$;

create or replace function update_line(p_line uuid, p_units int, p_boxes int) returns void
language plpgsql security definer set search_path = public as $$
declare old_row shipment_lines; iid uuid; dispatched int;
begin
  perform _require_role(array['inventory']);
  select * into old_row from shipment_lines where id = p_line for update;
  if not found then raise exception 'Line not found'; end if;
  select coalesce(sum(units), 0) into dispatched from dispatch_lines where line_id = p_line;
  if p_units < dispatched then raise exception 'Units (%) cannot be less than units already dispatched (%)', p_units, dispatched; end if;
  update shipment_lines set unit_qty = p_units, box_qty = p_boxes where id = p_line;
  -- With a dispatch on file the scans are evidence of what shipped, so they are kept.
  if p_units <> old_row.unit_qty and dispatched = 0 then
    select id into iid from inspections where line_id = p_line;
    delete from fnsku_checks where inspection_id = iid;
    insert into fnsku_checks(inspection_id, sample_no, unit_no)
    select iid, sample_no, v from _random_samples(p_units);
    update inspections set needs_recheck = (status <> 'Open'), inspected_qty = p_units where id = iid;
  end if;
  perform _audit('shipment_line', p_line, 'edit', to_jsonb(old_row),
                 jsonb_build_object('unit_qty', p_units, 'box_qty', p_boxes));
end $$;

-- 4) create_shipment: same blank checks (otherwise as patch_009).
create or replace function create_shipment(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid; l jsonb; lid uuid; iid uuid; pm sku_map; boxes int;
begin
  perform _require_role(array['inventory']);
  if coalesce(jsonb_array_length(p->'lines'), 0) = 0 then raise exception 'Add at least one SKU line'; end if;
  if nullif(trim(coalesce(p->>'fba_id', '')), '') is null then raise exception 'FBA shipment ID is required'; end if;
  if nullif(trim(coalesce(p->>'warehouse', '')), '') is null then raise exception 'Warehouse is required'; end if;
  boxes := (p->>'box_qty_total')::int;

  insert into shipments(fba_id, warehouse, appointment_at, transport, dispatch_date, remarks, box_qty_total, dispatch_mode)
  values (upper(trim(p->>'fba_id')), trim(p->>'warehouse'), nullif(p->>'appointment_at', '')::timestamptz,
          nullif(p->>'transport', ''), nullif(p->>'dispatch_date', '')::date, nullif(p->>'remarks', ''), boxes,
          nullif(p->>'dispatch_mode', ''))
  returning id into sid;

  insert into box_label_checks(shipment_id, sample_no, box_no)
  select sid, sample_no, v from _random_samples(boxes);

  for l in select * from jsonb_array_elements(p->'lines') loop
    select * into pm from sku_map where asin = l->>'asin';
    if not found then raise exception 'Unknown ASIN %', l->>'asin'; end if;
    insert into shipment_lines(shipment_id, asin, product_name, unit_qty, box_qty)
    values (sid, pm.asin, pm.product_name, (l->>'unit_qty')::int, nullif(l->>'box_qty', '')::int)
    returning id into lid;
    insert into inspections(line_id, inspected_qty, inspection_date)
    values (lid, (l->>'unit_qty')::int, current_date) returning id into iid;
    insert into fnsku_checks(inspection_id, sample_no, unit_no)
    select iid, sample_no, v from _random_samples((l->>'unit_qty')::int);
  end loop;

  perform _audit('shipment', sid, 'create', null, p);
  perform refresh_shipment(sid);
  return sid;
end $$;

-- 5) submit_inspection: an unknown case id is an error, not a silent success (otherwise as patch_021).
create or replace function submit_inspection(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare ins inspections; ln shipment_lines;
begin
  perform _require_role(array['qc']);
  select * into ins from inspections where id = p_id for update;
  if not found then raise exception 'QC case not found'; end if;
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
    inspector_name    = app_name(),
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

-- 6) Signature uploads: only people who work shipments (and admins), not the view-only roles.
drop policy if exists sig_insert on storage.objects;
create policy sig_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'signatures' and exists (
    select 1 from public.profiles where id = auth.uid() and (is_admin or role in ('inventory', 'qc', 'wm'))));

-- 7) View-only roles (finance, marketplace) no longer read the audit log, scan log or sample scans through the API.
--    The app already hides these from them. Everything else they read is unchanged, because the shipment
--    pages embed QC status and quantities from `inspections`.
create or replace function _is_view_only() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('finance', 'marketplace') and not is_admin from profiles where id = auth.uid()), false)
$$;
revoke all on function _is_view_only() from public, anon;
grant execute on function _is_view_only() to authenticated;

drop policy if exists read_all on audit_log;
create policy read_all on audit_log for select to authenticated using (not _is_view_only());
drop policy if exists read_all on scan_log;
create policy read_all on scan_log for select to authenticated using (not _is_view_only());
drop policy if exists read_all on fnsku_checks;
create policy read_all on fnsku_checks for select to authenticated using (not _is_view_only());

notify pgrst, 'reload schema';
