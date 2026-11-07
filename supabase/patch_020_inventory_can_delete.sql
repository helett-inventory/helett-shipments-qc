-- Run once in the Supabase SQL editor. Safe to run again.
-- Inventory (and admin): delete a shipment together with its SKU lines, QC cases, scans, dispatches, signatures and log.

create or replace function delete_shipment(p_ship uuid) returns text[]
language plpgsql security definer set search_path = public as $$
declare paths text[]; ids uuid[];
begin
  perform _require_role(array['inventory']); -- admin passes every role check

  -- signature files to remove from storage (the app deletes them after this returns)
  select coalesce(array_agg(p), '{}') into paths from (
    select i.qc_sign_path as p from inspections i join shipment_lines l on l.id = i.line_id where l.shipment_id = p_ship
    union all select dispatch_sign_path from dispatches where shipment_id = p_ship
    union all select wm_sign_path from dispatches where shipment_id = p_ship
  ) x where p is not null;

  select array_agg(id) into ids from (
    select id from shipments where id = p_ship
    union all select id from shipment_lines where shipment_id = p_ship
    union all select i.id from inspections i join shipment_lines l on l.id = i.line_id where l.shipment_id = p_ship
    union all select id from dispatches where shipment_id = p_ship
  ) y;

  delete from scan_log where check_id in (
    select f.id from fnsku_checks f
      join inspections i on i.id = f.inspection_id
      join shipment_lines l on l.id = i.line_id where l.shipment_id = p_ship
    union
    select id from box_label_checks where shipment_id = p_ship);
  delete from audit_log where entity_id = any (coalesce(ids, '{}'));
  -- lines, QC cases, scans, dispatches follow by cascade
  delete from shipments where id = p_ship;
  return paths;
end $$;

drop policy if exists sig_delete on storage.objects;
create policy sig_delete on storage.objects for delete to authenticated
  using (bucket_id = 'signatures' and exists (select 1 from public.profiles where id = auth.uid() and (is_admin or role = 'inventory')));

revoke all on function delete_shipment(uuid) from public;
grant execute on function delete_shipment(uuid) to authenticated;

notify pgrst, 'reload schema';
