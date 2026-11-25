-- Patch 033: one overall remark for Amazon receiving, per shipment.
-- Inventory and admin only. Safe to run more than once, and also cleans up an earlier per-SKU draft of this patch.
alter table shipments add column if not exists receiving_remark text;
alter table shipments add column if not exists receiving_remark_by text;
alter table shipments add column if not exists receiving_remark_at timestamptz;

-- Remove the earlier per-SKU version if it was ever applied.
drop function if exists set_received(uuid, int, text);
alter table shipment_lines drop column if exists received_remark;

-- set_received is back to its original two-argument form (patch_019).
create or replace function set_received(p_line uuid, p_qty int) returns void
language plpgsql security definer set search_path = public as $$
declare ln shipment_lines;
begin
  perform _require_role(array['inventory']);
  select * into ln from shipment_lines where id = p_line for update;
  if not found then raise exception 'Line not found'; end if;
  if ln.status = 'Cancelled' then raise exception 'This line is cancelled'; end if;
  if p_qty is not null and p_qty < 0 then raise exception 'Received units cannot be negative'; end if;
  update shipment_lines set
    received_qty = p_qty,
    received_at  = case when p_qty is null then null else now() end,
    received_by  = case when p_qty is null then null else app_name() end
  where id = p_line;
  perform _audit('shipment_line', p_line, 'received',
                 jsonb_build_object('received_qty', ln.received_qty),
                 jsonb_build_object('received_qty', p_qty));
end $$;
revoke all on function set_received(uuid, int) from public, anon;
grant execute on function set_received(uuid, int) to authenticated;

create or replace function set_receiving_remark(p_ship uuid, p_remark text) returns void
language plpgsql security definer set search_path = public as $$
declare old text; v text := nullif(trim(coalesce(p_remark, '')), '');
begin
  perform _require_role(array['inventory']); -- admin passes every role check
  select receiving_remark into old from shipments where id = p_ship for update;
  if not found then raise exception 'Shipment not found'; end if;
  if old is distinct from v then
    update shipments set
      receiving_remark    = v,
      receiving_remark_by = case when v is null then null else app_name() end,
      receiving_remark_at = case when v is null then null else now() end
    where id = p_ship;
    perform _audit('shipment', p_ship, 'receiving_remark', jsonb_build_object('remark', old), jsonb_build_object('remark', v));
  end if;
end $$;
revoke all on function set_receiving_remark(uuid, text) from public, anon;
grant execute on function set_receiving_remark(uuid, text) to authenticated;
notify pgrst, 'reload schema';
