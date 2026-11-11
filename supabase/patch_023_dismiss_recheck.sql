-- Patch 023: let Inventory (and admin) clear the "Quantity changed after QC, recheck" flag
-- without reopening the QC case, for example when only part of the ordered quantity is meant to ship.
create or replace function dismiss_recheck(p_inspection uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_role(array['inventory']); -- admin passes every role check
  update inspections set needs_recheck = false where id = p_inspection and needs_recheck;
  perform _audit('inspection', p_inspection, 'recheck_dismissed', null, jsonb_build_object('needs_recheck', false));
end $$;

revoke all on function dismiss_recheck(uuid) from public;
grant execute on function dismiss_recheck(uuid) to authenticated;
