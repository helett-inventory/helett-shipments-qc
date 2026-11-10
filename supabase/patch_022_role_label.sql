-- Patch 022: a display title for a person, e.g. "Supply chain".
-- Permissions still come from `role` (a Supply chain person is role 'inventory'),
-- so nothing else in the app or the database changes. Run once in the Supabase SQL Editor.
alter table profiles add column if not exists role_label text;

-- Example: make an existing inventory login show "Supply chain" in the app.
-- update profiles set role_label = 'Supply chain'
-- where id = (select id from auth.users where email = 'their-email@example.com');
