-- Run once in the Supabase SQL editor.
-- Adds an admin flag: an admin account can scan, fill, sign, approve, edit and reopen anything.
alter table profiles add column if not exists is_admin boolean not null default false;

create or replace function _require_role(roles text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- Admin accounts may do anything.
  if coalesce((select is_admin from profiles where id = auth.uid()), false) then return; end if;
  -- Inventory may also do anything QC can (scan, fill, submit).
  if app_role() = 'inventory' and 'qc' = any (roles) then return; end if;
  if app_role() is null or not (app_role() = any (roles)) then
    raise exception 'Your role is not allowed to do this';
  end if;
end $$;

-- inventory@helett.com becomes an admin (keeps role inventory, so it also sees the Inventory screens).
insert into profiles (id, name, role, is_admin)
values ('d45ac37b-5c48-43b3-acba-fe93d7578549', 'Admin', 'inventory', true)
on conflict (id) do update set role = 'inventory', is_admin = true;
