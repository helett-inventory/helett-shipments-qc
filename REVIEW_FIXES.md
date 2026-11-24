# Independent review: fix list

Status: **Fixed** = changed in this branch. **Manual** = you must do it (cannot be done from the repo).
After merging, run `supabase/patch_031_review_fixes.sql` once in the Supabase SQL Editor (safe to repeat).
Check it with `npm run test:db` (loads schema + all patches into an in-memory Postgres and checks roles).

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | Critical | The old Google Apps Script web app (`Code.gs`, URL in `OLD_API_URL`) answers `list` with no login (264 records returned). Anyone with the URL can read and edit legacy records. Drive signature files are "anyone with the link". | **Manual**: Apps Script > Deploy > Manage deployments > archive the deployment (or set access to "Only myself"); set the Drive signature folder's files to private. Do it after the migration is finished. |
| 2 | High | View-only roles (finance, marketplace) could read `audit_log`, `scan_log` and `fnsku_checks` through the API; the UI only hid them. | **Fixed** (patch 031, section 7). **Still open**: they can still read `inspections` rows (checks, remarks) because the shipment pages embed QC status from that table. Closing it fully needs a view or a column-limited read; not done to avoid breaking those pages. |
| 3 | High | Editing a shipment or line after dispatch wiped box-label and FNSKU scans and allowed totals below what was sent (e.g. 2 boxes sent of 1 total). | **Fixed** (patch 031, section 3). After a dispatch the FBA ID is locked, totals cannot go below sent, scans are kept. Finished shipments cannot be edited. |
| 4 | Medium | Internal helpers (`_audit`, `refresh_line`, `refresh_shipment`, `_random_samples`, `_require_role`, `_stamp_hold`) were callable by anon and view-only logins; `_audit` allowed forged audit rows. | **Fixed** (patch 031, section 1). |
| 5 | Medium | Blank FBA ID / warehouse accepted. | **Fixed** (patch 031, sections 2 and 4: checks in the functions, plus `NOT VALID` constraints so existing rows are untouched). |
| 6 | Medium | Migration script threw on a bad date mid-shipment, leaving half-written data (not transactional). | **Fixed**: dates are validated (`isoOrNow`). Still not transactional: if it fails for another reason, delete the partial shipment before re-running. Also confirm `box_qty_total` (sum of `qcQty`) is meant to be boxes. |
| 7 | Low-Med | Unsent QC drafts stayed in `localStorage` after sign-out, so the next user on that device saw them. | **Fixed** (`src/lib/cache.ts`). |
| 8 | Low | `submit_inspection` with an unknown id silently succeeded. | **Fixed** (patch 031, section 5). |
| 9 | Low | View-only roles could upload to the `signatures` bucket. | **Fixed** (patch 031, section 6). |
| 10 | Low | Inventory can scan an FNSKU mismatch and then clear the hold alone. | **Not changed**: by design (inventory has QC rights). Decide whether a second person should clear holds. |
| 11 | Low | No tests existed. | **Fixed**: `supabase/tests/db.test.mjs`, `npm run test:db`. |

## Still to check by hand
- Supabase Auth settings: confirm public sign-up is **disabled** (Authentication > Providers/Settings). If it is on, anyone can sign up and read the data finding 2 leaves open.
- Confirm all patches 001-030 are applied on the live project (the repo cannot tell).
- Concurrency (two people scanning or dispatching the same shipment) was not tested.
- `manual_qc` as wm and `set_line_state` transitions were not exercised.
