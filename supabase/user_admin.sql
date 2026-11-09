-- Helett: user admin cheat sheet. Paste into the Supabase SQL Editor.
--
-- HOW TO USE
--   * Run ONE block at a time: highlight just that block, then press Run.
--     (Running the whole file would run every block, including the risky ones.)
--   * Replace the email and the names with real ones. The email must match exactly.
--   * Roles are exactly: 'inventory', 'qc', 'wm'.
--   * An UPDATE with a wrong email changes 0 rows and shows no error. Check the result afterwards.
--
-- The block markers below are comments, so nothing runs by accident.


-- =====================================================================
-- 1. SEE EVERYONE
-- =====================================================================
select u.email, p.name, p.role, p.is_admin, u.last_sign_in_at
from auth.users u left join profiles p on p.id = u.id
order by p.role, p.name;


-- =====================================================================
-- 2. ADD A NEW PERSON
--    First create the login: Authentication > Users > Add user (tick "Auto Confirm User").
--    Then run this, with their email, name and role.
-- =====================================================================
insert into profiles (id, name, role)
select id, 'Full Name', 'qc' from auth.users where email = 'their-email@example.com';


-- =====================================================================
-- 3. FIND LOGINS THAT HAVE NO PROFILE (you forgot step 2)
-- =====================================================================
select u.id, u.email from auth.users u
left join profiles p on p.id = u.id where p.id is null;


-- =====================================================================
-- 4. CHANGE THE DISPLAY NAME (shown in the sidebar and on new records)
--    Old records keep the name they were saved with.
-- =====================================================================
update profiles set name = 'New Name'
where id = (select id from auth.users where email = 'their-email@example.com');


-- =====================================================================
-- 5. CHANGE THE ROLE  ('inventory', 'qc' or 'wm')
-- =====================================================================
update profiles set role = 'wm'
where id = (select id from auth.users where email = 'their-email@example.com');


-- =====================================================================
-- 6. MAKE SOMEONE ADMIN / REMOVE ADMIN
-- =====================================================================
update profiles set is_admin = true
where id = (select id from auth.users where email = 'their-email@example.com');

update profiles set is_admin = false
where id = (select id from auth.users where email = 'their-email@example.com');


-- =====================================================================
-- 7. CHANGE THE LOGIN EMAIL
-- =====================================================================
update auth.users
set email = 'new@example.com', email_confirmed_at = now(), updated_at = now()
where email = 'old@example.com';


-- =====================================================================
-- 8. SET A NEW PASSWORD
--    Nobody can read an existing password back, so set a new one and tell the person.
--    (The "Send password recovery" email does not work: the app has no set-new-password screen.)
-- =====================================================================
update auth.users
set encrypted_password = crypt('NewPassword123', gen_salt('bf')), updated_at = now()
where email = 'their-email@example.com';


-- =====================================================================
-- 9. BLOCK SOMEONE FROM LOGGING IN (keeps their history), AND ALLOW AGAIN
-- =====================================================================
update auth.users set banned_until = 'infinity' where email = 'their-email@example.com';

update auth.users set banned_until = null where email = 'their-email@example.com';


-- =====================================================================
-- 10. DELETE A PERSON COMPLETELY. PERMANENT. Their login stops working at once.
--     Old cases keep their name (it was saved as text). Use block 9 to only stop a login.
-- =====================================================================
-- delete from profiles where id = (select id from auth.users where email = 'their-email@example.com');
-- delete from auth.users where email = 'their-email@example.com';


-- =====================================================================
-- 11. FIND PROFILES WHOSE NAME IS A LONG ID (a mix-up when the profile was added)
-- =====================================================================
select u.email, p.name from profiles p join auth.users u on u.id = p.id
where p.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-';


-- =====================================================================
-- 12. HOW MUCH SPACE IS USED (free plan: 500 MB database, 1 GB storage)
-- =====================================================================
select pg_size_pretty(pg_database_size(current_database())) as db_size;

select relname, pg_size_pretty(pg_total_relation_size(relid)) as size, n_live_tup as rows
from pg_stat_user_tables order by pg_total_relation_size(relid) desc limit 10;

select count(*) as files, pg_size_pretty(sum((metadata->>'size')::bigint)) as total
from storage.objects where bucket_id = 'signatures';
