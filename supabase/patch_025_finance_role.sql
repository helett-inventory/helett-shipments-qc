-- Patch 025: new role "finance" (view-only).
-- Finance can open every page (Shipments, QC, Dashboard, records) but cannot create, edit,
-- dispatch, approve or fill QC: every write function checks for another role, so it is refused.
-- Run once in the Supabase SQL Editor.
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('inventory', 'qc', 'wm', 'finance'));

-- Then add the person: create the login first (Authentication > Users > Add user, tick Auto Confirm User), then:
-- insert into profiles (id, name, role)
-- select id, 'Full Name', 'finance' from auth.users where email = 'their-email@example.com';
