-- Patch 027: new role "marketplace" (view-only: Calendar and Shipments, no edits).
-- Every write function checks for another role, so a marketplace login is refused if it tries to change anything.
-- Run once in the Supabase SQL Editor.
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('inventory', 'qc', 'wm', 'finance', 'marketplace'));

-- Then add the person: create the login first (Authentication > Users > Add user, tick Auto Confirm User), then:
-- insert into profiles (id, name, role)
-- select id, 'Full Name', 'marketplace' from auth.users where email = 'their-email@example.com';
