-- Patch 033: optional remark per SKU line when recording units received by Amazon.
-- Inventory and admin only (same rule as set_received). Safe to run more than once.
alter table shipment_lines add column if not exists received_remark text;

drop function if exists set_received(uuid, int);

create or replace function set_received(p_line uuid, p_qty int, p_remark text default null) returns void
language plpgsql security definer set search_path = public as $$
declare ln shipment_lines; v_remark text := nullif(trim(coalesce(p_remark, '')), '');
begin
  perform _require_role(array['inventory']); -- admin passes every role check
  select * into ln from shipment_lines where id = p_line for update;
  if not found then raise exception 'Line not found'; end if;
  if ln.status = 'Cancelled' then raise exception 'This line is cancelled'; end if;
  if p_qty is not null and p_qty < 0 then raise exception 'Received units cannot be negative'; end if;
  update shipment_lines set
    received_qty    = p_qty,
    received_remark = v_remark,
    received_at     = case when p_qty is null and v_remark is null then null else now() end,
    received_by     = case when p_qty is null and v_remark is null then null else app_name() end
  where id = p_line;
  perform _audit('shipment_line', p_line, 'received',
                 jsonb_build_object('received_qty', ln.received_qty, 'remark', ln.received_remark),
                 jsonb_build_object('received_qty', p_qty, 'remark', v_remark));
end $$;

revoke all on function set_received(uuid, int, text) from public, anon;
grant execute on function set_received(uuid, int, text) to authenticated;
notify pgrst, 'reload schema';
