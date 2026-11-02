# Helett Enterprises: Shipments and QC

React + Vite PWA on Supabase (Postgres, Auth, Realtime, Storage). Online only.

## Set up
1. Create a Supabase project.
2. SQL editor: run `supabase/schema.sql`, then `supabase/seed_sku_map.sql`.
3. Fill `fnsku` (and `sku`) in the `sku_map` table from the SKU-ASIN-FNSKU sheet (Table Editor > Import CSV).
4. Authentication > Users: add one user per person. Then add their profile row (see end of `schema.sql`) with role `inventory`, `qc` or `wm`.
5. Copy `.env.example` to `.env`, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
6. `npm install`, `npm run dev` (or `npm run build` and host `dist/` on HTTPS; camera scanning needs HTTPS).

## Migrate old data
```
OLD_API_URL=... SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/migrate-from-sheet.mjs          # dry run
OLD_API_URL=... SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/migrate-from-sheet.mjs --commit
```
Rotate the service key afterwards.
