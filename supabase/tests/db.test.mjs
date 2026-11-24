// Database tests: loads schema.sql + every patch into an in-memory Postgres (PGlite) and checks roles.
// Run: npm run test:db
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const db = new PGlite({ extensions: { pgcrypto } })

await db.exec(`
create role anon nologin; create role authenticated nologin;
create schema auth; create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create publication supabase_realtime;
grant usage on schema public,auth,storage to anon,authenticated;
alter default privileges in schema public grant all on tables to anon,authenticated;
alter default privileges in schema public grant all on sequences to anon,authenticated;
alter default privileges in schema public grant execute on functions to anon,authenticated,public;
grant all on storage.objects, storage.buckets to anon,authenticated;
grant execute on function auth.uid() to public;
insert into auth.users values ('d45ac37b-5c48-43b3-acba-fe93d7578549');
`)
const files = ['schema.sql', ...fs.readdirSync(dir).filter((f) => /^patch_\d+/.test(f)).sort()]
for (const f of files) {
  try {
    await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'))
  } catch (e) {
    console.log('APPLY FAIL', f, String(e.message).slice(0, 200))
    process.exit(2)
  }
}

const U = { inv: '1', qc: '2', wm: '3', fin: '4', mkt: '5' }
const roles = { inv: 'inventory', qc: 'qc', wm: 'wm', fin: 'finance', mkt: 'marketplace' }
for (const k in U) {
  const id = U[k].repeat(8) + '-1111-1111-1111-' + U[k].repeat(12)
  U[k] = id
  await db.exec(`insert into auth.users values ('${id}'); insert into profiles(id,name,role) values ('${id}','${k}','${roles[k]}')`)
}
await db.exec(`insert into sku_map(asin,product_name,sku,fnsku) values ('B0TEST','Widget','SKU1','X00FN1')`)

async function as(who, sql, params) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${U[who] || ''}',false); set role ${who === 'anon' ? 'anon' : 'authenticated'}`)
  try {
    return { ok: true, rows: (await db.query(sql, params)).rows }
  } catch (e) {
    return { ok: false, err: e.message }
  } finally {
    await db.exec('reset role')
  }
}

let failed = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`)
  if (!cond) failed++
}
const shipment = (fba, warehouse = 'W') => JSON.stringify({ fba_id: fba, warehouse, box_qty_total: 2, lines: [{ asin: 'B0TEST', unit_qty: 10 }] })

// helpers cannot be called by the API
for (const who of ['anon', 'mkt', 'fin']) {
  const r = await as(who, `select _audit('shipment', null, 'forged', null, null)`)
  check(`_audit refused for ${who}`, !r.ok, JSON.stringify(r))
}
check('refresh_shipment refused for anon', !(await as('anon', `select refresh_shipment(gen_random_uuid())`)).ok)
check('no forged audit rows', (await db.query(`select count(*)::int c from audit_log where action='forged'`)).rows[0].c === 0)

// role matrix on create
for (const who of ['anon', 'fin', 'mkt', 'wm', 'qc']) check(`create_shipment refused for ${who}`, !(await as(who, `select create_shipment($1::jsonb)`, [shipment('R' + who)])).ok)

// validation
check('blank FBA refused', !(await as('inv', `select create_shipment($1::jsonb)`, [shipment('  ')])).ok)
check('blank warehouse refused', !(await as('inv', `select create_shipment($1::jsonb)`, [shipment('BW', ' ')])).ok)
const made = await as('inv', `select create_shipment($1::jsonb) id`, [shipment('FBA1')])
check('inventory can create', made.ok, JSON.stringify(made))
const sid = made.rows[0].id
const q = async (sql) => (await db.query(sql)).rows
const iid = (await q(`select id from inspections limit 1`))[0].id
const lid = (await q(`select id from shipment_lines limit 1`))[0].id

check('update_shipment blank FBA refused', !(await as('inv', `select update_shipment('${sid}', '{"fba_id":"  "}')`)).ok)
check('submit_inspection unknown id refused', !(await as('qc', `select submit_inspection('99999999-9999-9999-9999-999999999999','{"accepted_qty":1,"rejected_qty":0,"inspected_qty":1}')`)).ok)

// view-only roles cannot read audit / scans through the API, but can still read shipments
for (const who of ['fin', 'mkt']) {
  for (const t of ['audit_log', 'scan_log', 'fnsku_checks']) {
    const r = await as(who, `select count(*)::int c from ${t}`)
    check(`${who} reads 0 rows of ${t}`, r.ok && r.rows[0].c === 0, JSON.stringify(r))
  }
  const s = await as(who, `select count(*)::int c from shipments`)
  check(`${who} still reads shipments`, s.ok && s.rows[0].c >= 1)
}
check('inventory still reads audit_log', (await as('inv', `select count(*)::int c from audit_log`)).rows[0].c > 0)

// storage upload
check('marketplace cannot upload signatures', !(await as('mkt', `insert into storage.objects(bucket_id,name) values ('signatures','x.png')`)).ok)
check('qc can upload signatures', (await as('qc', `insert into storage.objects(bucket_id,name) values ('signatures','x.png')`)).ok)

// full flow, then edit after dispatch
const checks = await q(`select id from fnsku_checks where inspection_id='${iid}'`)
for (const c of checks) await as('qc', `select scan_fnsku('${c.id}','x00fn1')`)
check('qc submits', (await as('qc', `select submit_inspection('${iid}','{"accepted_qty":8,"rejected_qty":2,"inspected_qty":10}')`)).ok)
const boxes = await q(`select id from box_label_checks where shipment_id='${sid}'`)
for (const [i, c] of boxes.entries()) await as('inv', `select scan_box_label('${c.id}','FBA1U00000${i + 1}')`)
const disp = await as('inv', `select confirm_dispatch('${sid}',$1::jsonb)`, [JSON.stringify({ boxes_sent: 2, lines: [{ line_id: lid, units: 8 }] })])
check('dispatch succeeds', disp.ok, JSON.stringify(disp))
check('change FBA ID after dispatch refused', !(await as('inv', `select update_shipment('${sid}','{"fba_id":"CHANGED"}')`)).ok)
check('boxes below sent refused', !(await as('inv', `select update_shipment('${sid}','{"box_qty_total":1}')`)).ok)
check('units below dispatched refused', !(await as('inv', `select update_line('${lid}',3,1)`)).ok)
check('box scans kept', (await q(`select count(*)::int c from box_label_checks where shipment_id='${sid}' and scanned is not null`))[0].c === 2)
check('fnsku scans kept', (await q(`select count(*)::int c from fnsku_checks where inspection_id='${iid}' and scanned is not null`))[0].c === checks.length)
check('harmless edit after dispatch allowed', (await as('inv', `select update_shipment('${sid}','{"remarks":"note"}')`)).ok)

console.log(failed ? `\n${failed} FAILED` : '\nAll passed')
process.exit(failed ? 1 : 0)
