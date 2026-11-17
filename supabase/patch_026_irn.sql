-- Patch 026: IRN / invoice reference number on a shipment.
-- Finance (Accounts) and admin may set or change it; everyone can read it. Run once in the Supabase SQL Editor.
alter table shipments add column if not exists irn text;

create or replace function set_irn(p_ship uuid, p_irn text) returns void
language plpgsql security definer set search_path = public as $$
declare old text; v text := nullif(trim(coalesce(p_irn, '')), '');
begin
  perform _require_role(array['finance']); -- admin passes every role check
  select irn into old from shipments where id = p_ship;
  if not found then raise exception 'Shipment not found'; end if;
  if old is distinct from v then
    update shipments set irn = v where id = p_ship;
    perform _audit('shipment', p_ship, 'irn_changed', jsonb_build_object('irn', old), jsonb_build_object('irn', v));
  end if;
end $$;

revoke all on function set_irn(uuid, text) from public;
grant execute on function set_irn(uuid, text) to authenticated;
