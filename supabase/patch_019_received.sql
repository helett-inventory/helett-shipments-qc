-- Amazon receiving: how many units Amazon checked in, per SKU line. Entered by hand by Inventory.
-- Empty = pending. Safe to run more than once.
alter table shipment_lines add column if not exists received_qty int check (received_qty >= 0);
alter table shipment_lines add column if not exists received_at timestamptz;
alter table shipment_lines add column if not exists received_by text;

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
