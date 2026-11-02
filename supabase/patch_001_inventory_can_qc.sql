-- Safe to run any time, in any order. This is the FINAL version of the role check:
--   admin accounts: everything. inventory: everything inventory + everything QC can do.
alter table profiles add column if not exists is_admin boolean not null default false;

create or replace function _require_role(roles text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce((select is_admin from profiles where id = auth.uid()), false) then return; end if;
  if app_role() = 'inventory' and 'qc' = any (roles) then return; end if;
  if app_role() is null or not (app_role() = any (roles)) then
    raise exception 'Your role is not allowed to do this';
  end if;
end $$;
