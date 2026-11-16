-- Patch 024: record who put a shipment on hold, and when.
-- A trigger stamps the logged-in person's name the moment on_hold turns true, so it works for every
-- scan that can raise a hold (FNSKU mismatch, box label mismatch) without touching those functions.
alter table shipments add column if not exists hold_by text;
alter table shipments add column if not exists hold_at timestamptz;

create or replace function _stamp_hold() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.on_hold and not coalesce(old.on_hold, false) then
    new.hold_by := app_name();
    new.hold_at := now();
  elsif not new.on_hold then
    new.hold_by := null;
    new.hold_at := null;
  end if;
  return new;
end $$;

drop trigger if exists shipments_stamp_hold on shipments;
create trigger shipments_stamp_hold before update on shipments
  for each row execute function _stamp_hold();
