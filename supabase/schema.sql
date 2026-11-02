    -- Helett Enterprises QC + Shipments  |  Supabase schema
    -- Run once in the Supabase SQL editor (Project > SQL Editor > New query).
    -- All writes from the app go through the security-definer functions at the
    -- bottom; tables themselves are read-only to signed-in users (RLS).
    
    create extension if not exists pgcrypto;
    
    -- ---------------------------------------------------------------- profiles
    create table if not exists profiles (
      id    uuid primary key references auth.users(id) on delete cascade,
      name  text not null,
      role  text not null check (role in ('inventory', 'qc', 'wm')),
      is_admin boolean not null default false
    );
    
    create or replace function app_role() returns text
    language sql stable security definer set search_path = public as
    $$ select role from profiles where id = auth.uid() $$;
    
    create or replace function app_name() returns text
    language sql stable security definer set search_path = public as
    $$ select name from profiles where id = auth.uid() $$;
    
    -- ---------------------------------------------------------------- sku map
    -- SKU - ASIN - FNSKU. Only Inventory can read it, so the expected FNSKU
    -- never reaches a QC device.
    create table if not exists sku_map (
      asin         text primary key,
      product_name text not null,
      sku          text,
      fnsku        text,
      active       boolean not null default true
    );
    
    -- ---------------------------------------------------------------- shipments
    create sequence if not exists shipment_seq;
    create sequence if not exists record_seq;
    
    create table if not exists shipments (
      id              uuid primary key default gen_random_uuid(),
      ref             text unique not null default ('SH-' || lpad(nextval('shipment_seq')::text, 5, '0')),
      fba_id          text not null unique,
      created_at      timestamptz not null default now(),
      dispatch_date   date,
      warehouse       text not null,
      appointment_at  timestamptz,
      transport       text,
      remarks         text,
      box_qty_total   int not null check (box_qty_total > 0),
      dispatch_mode   text check (dispatch_mode in ('ATS', 'Drop In', 'Bluedart')),
      status          text not null default 'Created'
                      check (status in ('Created','QC In Progress','QC Done','Partially Dispatched','Dispatched','Closed','Cancelled')),
      on_hold         boolean not null default false,
      hold_reason     text,
      created_by      uuid default auth.uid()
    );
    
    create table if not exists shipment_lines (
      id            uuid primary key default gen_random_uuid(),
      shipment_id   uuid not null references shipments(id) on delete cascade,
      asin          text not null references sku_map(asin),
      product_name  text not null,
      unit_qty      int not null check (unit_qty > 0),
      box_qty       int,
      status        text not null default 'QC Open'
                    check (status in ('QC Open','QC Submitted','Partially Dispatched','Dispatched','Closed','Not Dispatched','Cancelled')),
      created_at    timestamptz not null default now()
    );
    
    create table if not exists inspections (
      id                 uuid primary key default gen_random_uuid(),
      line_id            uuid not null unique references shipment_lines(id) on delete cascade,
      record_no          text unique not null default ('QC-' || to_char(now(), 'YY') || '-' || lpad(nextval('record_seq')::text, 5, '0')),
      status             text not null default 'Open' check (status in ('Open','Submitted','Closed')),
      inspection_date    date,
      model_dispatched   text,
      checks             jsonb not null default '{}'::jsonb,
      inspected_qty      int not null default 0,
      accepted_qty       int not null default 0,
      rejected_qty       int not null default 0,
      product_condition  text,
      packaging_quality  text,
      overall_result     text,
      qc_remarks         text,
      inspector_name     text,
      qc_sign_path       text,
      submitted_at       timestamptz,
      needs_recheck      boolean not null default false
    );
    
    create table if not exists fnsku_checks (
      id             uuid primary key default gen_random_uuid(),
      inspection_id  uuid not null references inspections(id) on delete cascade,
      sample_no      int not null,
      unit_no        int,
      scanned        text,
      ok             boolean,
      scanned_at     timestamptz,
      scanned_by     uuid
    );
    
    create table if not exists box_label_checks (
      id           uuid primary key default gen_random_uuid(),
      shipment_id  uuid not null references shipments(id) on delete cascade,
      sample_no    int not null,
      box_no       int,
      scanned      text,
      ok           boolean,
      reason       text,
      scanned_at   timestamptz,
      scanned_by   uuid
    );
    
    create table if not exists scan_log (
      id        bigserial primary key,
      at        timestamptz not null default now(),
      kind      text not null,
      check_id  uuid not null,
      code      text,
      ok        boolean,
      by_user   uuid default auth.uid()
    );
    
    create table if not exists dispatches (
      id                 uuid primary key default gen_random_uuid(),
      shipment_id        uuid not null references shipments(id) on delete cascade,
      dispatched_at      timestamptz not null default now(),
      dispatched_by      uuid default auth.uid(),
      dispatched_by_name text,
      transport          text,
      boxes_sent         int not null check (boxes_sent >= 0),
      remarks            text,
      dispatch_sign_path text,
      wm_approved_at     timestamptz,
      wm_name            text,
      wm_sign_path       text
    );
    
    create table if not exists dispatch_lines (
      id           uuid primary key default gen_random_uuid(),
      dispatch_id  uuid not null references dispatches(id) on delete cascade,
      line_id      uuid not null references shipment_lines(id) on delete cascade,
      units        int not null check (units > 0)
    );
    
    create table if not exists audit_log (
      id         bigserial primary key,
      at         timestamptz not null default now(),
      user_id    uuid default auth.uid(),
      user_name  text,
      entity     text not null,
      entity_id  uuid,
      action     text not null,
      old_data   jsonb,
      new_data   jsonb
    );
    
    create index if not exists idx_lines_ship   on shipment_lines(shipment_id);
    create index if not exists idx_fn_insp      on fnsku_checks(inspection_id);
    create index if not exists idx_box_ship     on box_label_checks(shipment_id);
    create index if not exists idx_disp_ship    on dispatches(shipment_id);
    create index if not exists idx_dl_line      on dispatch_lines(line_id);
    create index if not exists idx_audit_entity on audit_log(entity, entity_id);
    
    -- ---------------------------------------------------------------- RLS
    alter table profiles          enable row level security;
    alter table sku_map           enable row level security;
    alter table shipments         enable row level security;
    alter table shipment_lines    enable row level security;
    alter table inspections       enable row level security;
    alter table fnsku_checks      enable row level security;
    alter table box_label_checks  enable row level security;
    alter table scan_log          enable row level security;
    alter table dispatches        enable row level security;
    alter table dispatch_lines    enable row level security;
    alter table audit_log         enable row level security;
    
    do $$
    declare t text;
    begin
      foreach t in array array['profiles','shipments','shipment_lines','inspections','fnsku_checks',
                               'box_label_checks','scan_log','dispatches','dispatch_lines','audit_log']
      loop
        execute format('drop policy if exists read_all on %I', t);
        execute format('create policy read_all on %I for select to authenticated using (true)', t);
      end loop;
    end $$;
    
    drop policy if exists sku_map_inventory on sku_map;
    create policy sku_map_inventory on sku_map for all to authenticated
      using (app_role() = 'inventory') with check (app_role() = 'inventory');
    
    -- fnsku_checks.scanned shows what the inspector scanned; the expected value
    -- lives only in sku_map. QC never gets read access to sku_map.
    
    -- ---------------------------------------------------------------- storage
    insert into storage.buckets (id, name, public) values ('signatures', 'signatures', false)
    on conflict (id) do nothing;
    
    drop policy if exists sig_read   on storage.objects;
    drop policy if exists sig_insert on storage.objects;
    create policy sig_read   on storage.objects for select to authenticated using (bucket_id = 'signatures');
    create policy sig_insert on storage.objects for insert to authenticated with check (bucket_id = 'signatures');
    
    -- ---------------------------------------------------------------- realtime
    do $$
    declare t text;
    begin
      foreach t in array array['shipments','shipment_lines','inspections','fnsku_checks',
                               'box_label_checks','dispatches','dispatch_lines']
      loop
        begin
          execute format('alter publication supabase_realtime add table %I', t);
        exception when duplicate_object then null;
        end;
      end loop;
    end $$;
    
    -- ---------------------------------------------------------------- helpers
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
    
    create or replace function _audit(p_entity text, p_id uuid, p_action text, p_old jsonb, p_new jsonb)
    returns void language sql security definer set search_path = public as $$
      insert into audit_log(user_name, entity, entity_id, action, old_data, new_data)
      values (app_name(), p_entity, p_id, p_action, p_old, p_new)
    $$;
  
  -- Line status from QC result + dispatch quantities + WM approvals.
  create or replace function refresh_line(p_line uuid) returns void
  language plpgsql security definer set search_path = public as $$
  declare ln shipment_lines; ins inspections; disp int; unapproved int;
    begin
      select * into ln from shipment_lines where id = p_line;
      if ln.status in ('Cancelled', 'Not Dispatched', 'QC Open') then return; end if;
      select * into ins from inspections where line_id = p_line;
      select coalesce(sum(units), 0) into disp from dispatch_lines where line_id = p_line;
      select count(*) into unapproved
        from dispatch_lines dl join dispatches d on d.id = dl.dispatch_id
        where dl.line_id = p_line and d.wm_approved_at is null;
    
      if disp = 0 then
        update shipment_lines set status = 'QC Submitted' where id = p_line;
        update inspections set status = 'Submitted' where line_id = p_line and status = 'Closed';
      elsif disp < least(ins.accepted_qty, ln.unit_qty) then
        update shipment_lines set status = 'Partially Dispatched' where id = p_line;
      elsif unapproved = 0 then
        update shipment_lines set status = 'Closed' where id = p_line;
        update inspections set status = 'Closed' where line_id = p_line;
      else
        update shipment_lines set status = 'Dispatched' where id = p_line;
      end if;
    end $$;
    
    -- Shipment status derived from its lines.
    create or replace function refresh_shipment(p_ship uuid) returns void
    language plpgsql security definer set search_path = public as $$
    declare total int; cancelled int; parked int; live int; closed int; sent int; partial int; submitted int; v_status text;
    begin
      select count(*),
             count(*) filter (where status = 'Cancelled'),
             count(*) filter (where status = 'Not Dispatched'),
             count(*) filter (where status not in ('Cancelled', 'Not Dispatched')),
             count(*) filter (where status = 'Closed'),
             count(*) filter (where status in ('Dispatched', 'Closed')),
             count(*) filter (where status = 'Partially Dispatched'),
             count(*) filter (where status = 'QC Submitted')
        into total, cancelled, parked, live, closed, sent, partial, submitted
        from shipment_lines where shipment_id = p_ship;
    
      if total = 0 or cancelled = total then v_status := 'Cancelled';
      elsif live = 0 then v_status := 'QC Done';
      elsif closed = live and parked = 0 then v_status := 'Closed';
      elsif sent = live then v_status := 'Dispatched';
      elsif sent + partial > 0 then v_status := 'Partially Dispatched';
      elsif submitted = live then v_status := 'QC Done';
      elsif submitted > 0 then v_status := 'QC In Progress';
      else v_status := 'Created';
      end if;
      update shipments set status = v_status where id = p_ship;
    end $$;
    
    create or replace function _random_samples(n int) returns table(sample_no int, v int)
    language sql as $$
      -- Three scan slots (fewer for tiny shipments). No unit or box is pre-assigned.
      select g::int, null::int from generate_series(1, least(3, greatest(n, 0))) g
    $$;
    
    -- ---------------------------------------------------------------- shipments
    create or replace function create_shipment(p jsonb) returns uuid
    language plpgsql security definer set search_path = public as $$
    declare sid uuid; l jsonb; lid uuid; iid uuid; pm sku_map; boxes int;
    begin
      perform _require_role(array['inventory']);
      if coalesce(jsonb_array_length(p->'lines'), 0) = 0 then raise exception 'Add at least one SKU line'; end if;
      boxes := (p->>'box_qty_total')::int;
    
      insert into shipments(fba_id, warehouse, appointment_at, transport, dispatch_date, remarks, box_qty_total, dispatch_mode)
      values (upper(trim(p->>'fba_id')), trim(p->>'warehouse'), nullif(p->>'appointment_at', '')::timestamptz,
              nullif(p->>'transport', ''), nullif(p->>'dispatch_date', '')::date, nullif(p->>'remarks', ''), boxes,
              nullif(p->>'dispatch_mode', ''))
      returning id into sid;
    
      insert into box_label_checks(shipment_id, sample_no, box_no)
      select sid, sample_no, v from _random_samples(boxes);
    
      for l in select * from jsonb_array_elements(p->'lines') loop
        select * into pm from sku_map where asin = l->>'asin';
        if not found then raise exception 'Unknown ASIN %', l->>'asin'; end if;
        insert into shipment_lines(shipment_id, asin, product_name, unit_qty, box_qty)
        values (sid, pm.asin, pm.product_name, (l->>'unit_qty')::int, nullif(l->>'box_qty', '')::int)
        returning id into lid;
        insert into inspections(line_id, inspected_qty, inspection_date)
        values (lid, (l->>'unit_qty')::int, current_date) returning id into iid;
        insert into fnsku_checks(inspection_id, sample_no, unit_no)
        select iid, sample_no, v from _random_samples((l->>'unit_qty')::int);
      end loop;
    
      perform _audit('shipment', sid, 'create', null, p);
      perform refresh_shipment(sid);
      return sid;
    end $$;
    
    create or replace function add_line(p_ship uuid, p_asin text, p_units int, p_boxes int)
    returns uuid language plpgsql security definer set search_path = public as $$
    declare pm sku_map; lid uuid; iid uuid;
    begin
      perform _require_role(array['inventory']);
      select * into pm from sku_map where asin = p_asin;
      if not found then raise exception 'Unknown ASIN %', p_asin; end if;
      insert into shipment_lines(shipment_id, asin, product_name, unit_qty, box_qty)
      values (p_ship, pm.asin, pm.product_name, p_units, p_boxes) returning id into lid;
      insert into inspections(line_id, inspected_qty, inspection_date) values (lid, p_units, current_date) returning id into iid;
      insert into fnsku_checks(inspection_id, sample_no, unit_no)
      select iid, sample_no, v from _random_samples(p_units);
      perform _audit('shipment_line', lid, 'add', null, jsonb_build_object('asin', p_asin, 'units', p_units, 'boxes', p_boxes));
      perform refresh_shipment(p_ship);
      return lid;
    end $$;
    
    create or replace function update_shipment(p_id uuid, p_changes jsonb) returns void
    language plpgsql security definer set search_path = public as $$
    declare old_row shipments; new_fba text; new_boxes int; regen boolean := false;
    begin
      perform _require_role(array['inventory']);
      select * into old_row from shipments where id = p_id for update;
      new_fba   := upper(trim(coalesce(p_changes->>'fba_id', old_row.fba_id)));
      new_boxes := coalesce((p_changes->>'box_qty_total')::int, old_row.box_qty_total);
      regen := (new_fba <> old_row.fba_id) or (new_boxes <> old_row.box_qty_total);
    
      update shipments set
        fba_id         = new_fba,
        box_qty_total  = new_boxes,
        warehouse      = coalesce(nullif(trim(p_changes->>'warehouse'), ''), warehouse),
        dispatch_mode  = case when p_changes ? 'dispatch_mode' then nullif(p_changes->>'dispatch_mode', '') else dispatch_mode end,
        appointment_at = case when p_changes ? 'appointment_at' then nullif(p_changes->>'appointment_at', '')::timestamptz else appointment_at end,
        dispatch_date  = case when p_changes ? 'dispatch_date'  then nullif(p_changes->>'dispatch_date', '')::date else dispatch_date end,
        transport      = case when p_changes ? 'transport' then nullif(p_changes->>'transport', '') else transport end,
        remarks        = case when p_changes ? 'remarks'   then nullif(p_changes->>'remarks', '')   else remarks end
      where id = p_id;
    
      if regen then
        delete from box_label_checks where shipment_id = p_id;
        insert into box_label_checks(shipment_id, sample_no, box_no)
        select p_id, sample_no, v from _random_samples(new_boxes);
      end if;
    
      perform _audit('shipment', p_id, 'edit', to_jsonb(old_row), p_changes);
    end $$;
    
    create or replace function update_line(p_line uuid, p_units int, p_boxes int) returns void
    language plpgsql security definer set search_path = public as $$
    declare old_row shipment_lines; iid uuid;
    begin
      perform _require_role(array['inventory']);
      select * into old_row from shipment_lines where id = p_line for update;
      update shipment_lines set unit_qty = p_units, box_qty = p_boxes where id = p_line;
      if p_units <> old_row.unit_qty then
        select id into iid from inspections where line_id = p_line;
        delete from fnsku_checks where inspection_id = iid;
        insert into fnsku_checks(inspection_id, sample_no, unit_no)
        select iid, sample_no, v from _random_samples(p_units);
        update inspections set needs_recheck = (status <> 'Open'), inspected_qty = p_units where id = iid;
      end if;
      perform _audit('shipment_line', p_line, 'edit', to_jsonb(old_row),
                     jsonb_build_object('unit_qty', p_units, 'box_qty', p_boxes));
    end $$;
    
    create or replace function set_line_state(p_line uuid, p_state text) returns void
    language plpgsql security definer set search_path = public as $$
    declare ln shipment_lines; ins inspections;
    begin
      perform _require_role(array['inventory']);
      select * into ln from shipment_lines where id = p_line for update;
      select * into ins from inspections where line_id = p_line;
      if p_state in ('Not Dispatched', 'Cancelled') then
        update shipment_lines set status = p_state where id = p_line;
      elsif p_state = 'Restore' then
        update shipment_lines set status = case when ins.status = 'Open' then 'QC Open' else 'QC Submitted' end where id = p_line;
        perform refresh_line(p_line);
      else
        raise exception 'Unknown state %', p_state;
      end if;
      perform _audit('shipment_line', p_line, 'state:' || p_state, jsonb_build_object('status', ln.status), null);
      perform refresh_shipment(ln.shipment_id);
    end $$;
    
    create or replace function cancel_shipment(p_ship uuid) returns void
    language plpgsql security definer set search_path = public as $$
    begin
      perform _require_role(array['inventory']);
      if exists (select 1 from dispatches where shipment_id = p_ship) then
        raise exception 'Shipment already has a dispatch and cannot be cancelled';
      end if;
      update shipment_lines set status = 'Cancelled' where shipment_id = p_ship;
      update shipments set status = 'Cancelled', on_hold = false where id = p_ship;
      perform _audit('shipment', p_ship, 'cancel', null, null);
    end $$;
    
    create or replace function clear_hold(p_ship uuid) returns void
    language plpgsql security definer set search_path = public as $$
    begin
      perform _require_role(array['inventory']);
      update shipments set on_hold = false, hold_reason = null where id = p_ship;
      perform _audit('shipment', p_ship, 'clear_hold', null, null);
    end $$;
    
    -- ---------------------------------------------------------------- scans
    create or replace function scan_fnsku(p_check uuid, p_code text) returns jsonb
    language plpgsql security definer set search_path = public as $$
    declare c fnsku_checks; ins inspections; ln shipment_lines; expected text; v_ok boolean; code text;
    begin
      perform _require_role(array['qc']);
      code := upper(trim(p_code));
      select * into c from fnsku_checks where id = p_check;
      if not found then raise exception 'Scan slot not found'; end if;
      select * into ins from inspections where id = c.inspection_id;
      if ins.status <> 'Open' then raise exception 'This case is not open'; end if;
      select * into ln from shipment_lines where id = ins.line_id;
      select upper(trim(fnsku)) into expected from sku_map where asin = ln.asin;
      if expected is null or expected = '' then
        raise exception 'No FNSKU on file for %. Ask Inventory to update the SKU map.', ln.asin;
      end if;
      v_ok := (code = expected);
      update fnsku_checks set scanned = code, ok = v_ok, scanned_at = now(), scanned_by = auth.uid() where id = p_check;
      insert into scan_log(kind, check_id, code, ok) values ('fnsku', p_check, code, v_ok);
      if not v_ok then
        update shipments set on_hold = true, hold_reason = 'FNSKU mismatch: ' || ln.product_name where id = ln.shipment_id;
        perform _audit('shipment', ln.shipment_id, 'flag_fnsku', null,
                       jsonb_build_object('product', ln.product_name, 'scanned', code));
      end if;
      return jsonb_build_object('ok', v_ok);
    end $$;
    
    create or replace function scan_box_label(p_check uuid, p_code text) returns jsonb
    language plpgsql security definer set search_path = public as $$
    declare c box_label_checks; sh shipments; code text; code_fba text; code_box int; v_ok boolean := false; v_reason text;
    begin
      perform _require_role(array['inventory']);
      code := upper(trim(p_code));
      select * into c from box_label_checks where id = p_check;
      if not found then raise exception 'Scan slot not found'; end if;
      select * into sh from shipments where id = c.shipment_id;
      -- Labels are pasted at shipment time, after the QC checklist is done, so any time until the shipment is finished.
    if sh.status in ('Closed', 'Cancelled') then
      raise exception 'This shipment is finished';
    end if;
      -- Any box will do, but the same box cannot count twice.
      if exists (select 1 from box_label_checks where shipment_id = sh.id and id <> p_check and ok and scanned = code) then
        raise exception 'This box label was already scanned. Scan a different box.';
      end if;
      -- Only the FBA ID has to match; the full barcode is stored as scanned.
      code_fba := substring(code from '^(.*)U[0-9]{6}$');
      if code_fba is null then
        v_reason := 'unreadable';
      else
        code_box := substring(code from 'U([0-9]{6})$')::int;
        if code_fba <> upper(sh.fba_id) then v_reason := 'wrong_fba';
        else v_ok := true; end if;
      end if;
      update box_label_checks set scanned = code, box_no = code_box, ok = v_ok, reason = v_reason,
             scanned_at = now(), scanned_by = auth.uid() where id = p_check;
      insert into scan_log(kind, check_id, code, ok) values ('box', p_check, code, v_ok);
      if not v_ok then
        update shipments set on_hold = true, hold_reason = 'Box label mismatch (' || v_reason || ')' where id = sh.id;
        perform _audit('shipment', sh.id, 'flag_box', null, jsonb_build_object('scanned', code, 'reason', v_reason));
      end if;
      return jsonb_build_object('ok', v_ok, 'reason', v_reason);
    end $$;
    
    -- ---------------------------------------------------------------- QC
    create or replace function submit_inspection(p_id uuid, p jsonb) returns void
    language plpgsql security definer set search_path = public as $$
    declare ins inspections; ln shipment_lines;
    begin
      perform _require_role(array['qc']);
      select * into ins from inspections where id = p_id for update;
      if ins.status <> 'Open' then raise exception 'This case is already submitted'; end if;
      if exists (select 1 from fnsku_checks where inspection_id = p_id and scanned is null) then
        raise exception 'Scan all FNSKU samples before submitting';
      end if;
      if coalesce(p->>'sign_path', '') = '' then raise exception 'QC signature is required'; end if;
      if (p->>'accepted_qty')::int + (p->>'rejected_qty')::int > (p->>'inspected_qty')::int then
        raise exception 'Accepted plus rejected is more than inspected';
      end if;
    
      update inspections set
        status = 'Submitted',
        inspection_date   = coalesce(nullif(p->>'inspection_date', '')::date, current_date),
        model_dispatched  = p->>'model_dispatched',
        checks            = coalesce(p->'checks', '{}'::jsonb),
        inspected_qty     = (p->>'inspected_qty')::int,
        accepted_qty      = (p->>'accepted_qty')::int,
        rejected_qty      = (p->>'rejected_qty')::int,
        product_condition = p->>'product_condition',
        packaging_quality = p->>'packaging_quality',
        overall_result    = p->>'overall_result',
        qc_remarks        = nullif(p->>'qc_remarks', ''),
        inspector_name    = p->>'inspector_name',
        qc_sign_path      = p->>'sign_path',
        submitted_at      = now(),
        needs_recheck     = false
      where id = p_id returning * into ins;
    
      select * into ln from shipment_lines where id = ins.line_id;
      if ln.status = 'QC Open' then
        update shipment_lines set status = 'QC Submitted' where id = ln.id;
      end if;
      perform _audit('inspection', p_id, 'submit', null, null);
      perform refresh_shipment(ln.shipment_id);
    end $$;
    
    create or replace function reopen_inspection(p_id uuid) returns void
    language plpgsql security definer set search_path = public as $$
    declare ins inspections; ln shipment_lines;
    begin
      perform _require_role(array['inventory', 'wm']);
      select * into ins from inspections where id = p_id for update;
      select * into ln from shipment_lines where id = ins.line_id;
      if exists (select 1 from dispatch_lines where line_id = ln.id) then
        raise exception 'This line already has a dispatch and cannot be reopened';
      end if;
      update inspections set status = 'Open', qc_sign_path = null, submitted_at = null where id = p_id;
      update shipment_lines set status = 'QC Open' where id = ln.id;
      perform _audit('inspection', p_id, 'reopen', jsonb_build_object('status', ins.status), null);
      perform refresh_shipment(ln.shipment_id);
    end $$;
    
    -- ---------------------------------------------------------------- dispatch
    create or replace function confirm_dispatch(p_ship uuid, p jsonb) returns uuid
    language plpgsql security definer set search_path = public as $$
    declare sh shipments; d uuid; l jsonb; ln shipment_lines; ins inspections;
            already_units int; boxes_prior int; boxes_new int; box_checks int; box_ok int;
    begin
      perform _require_role(array['inventory']);
      select * into sh from shipments where id = p_ship for update;
      if sh.status = 'Cancelled' then raise exception 'Shipment is cancelled'; end if;
      if sh.on_hold then raise exception 'Shipment is on hold: %', coalesce(sh.hold_reason, 'flag open'); end if;
    
      select count(*), count(*) filter (where scanned is not null) into box_checks, box_ok from box_label_checks where shipment_id = p_ship;
      if sh.dispatch_mode is distinct from 'ATS' and (box_checks = 0 or box_ok <> box_checks) then
        raise exception 'Box label check is not complete. Scan the box labels first.';
      end if;
      if coalesce(p->>'sign_path', '') = '' then raise exception 'Dispatch signature is required'; end if;
      if coalesce(jsonb_array_length(p->'lines'), 0) = 0 then raise exception 'Choose at least one line to dispatch'; end if;
    
      boxes_new := (p->>'boxes_sent')::int;
      select coalesce(sum(boxes_sent), 0) into boxes_prior from dispatches where shipment_id = p_ship;
      if boxes_prior + boxes_new > sh.box_qty_total then
        raise exception 'Boxes sent (%) would exceed total boxes (%)', boxes_prior + boxes_new, sh.box_qty_total;
      end if;
    
      insert into dispatches(shipment_id, dispatched_by_name, transport, boxes_sent, remarks, dispatch_sign_path)
      values (p_ship, coalesce(nullif(trim(p->>'by_name'), ''), app_name()), nullif(p->>'transport', ''), boxes_new, nullif(p->>'remarks', ''), p->>'sign_path')
      returning id into d;
    
      for l in select * from jsonb_array_elements(p->'lines') loop
        select * into ln from shipment_lines where id = (l->>'line_id')::uuid and shipment_id = p_ship;
        if not found then raise exception 'Line does not belong to this shipment'; end if;
        select * into ins from inspections where line_id = ln.id;
        if ln.status not in ('QC Submitted', 'Partially Dispatched') then
          raise exception '% is not ready to dispatch (%)', ln.product_name, ln.status;
        end if;
        select coalesce(sum(units), 0) into already_units from dispatch_lines where line_id = ln.id;
        if already_units + (l->>'units')::int > least(ins.accepted_qty, ln.unit_qty) then
          raise exception 'More units than QC accepted for %', ln.product_name;
        end if;
        insert into dispatch_lines(dispatch_id, line_id, units) values (d, ln.id, (l->>'units')::int);
        perform refresh_line(ln.id);
      end loop;
    
      perform _audit('dispatch', d, 'confirm', null, p);
      perform refresh_shipment(p_ship);
      return d;
    end $$;
    
    create or replace function approve_dispatch(p_dispatch uuid, p_sign_path text, p_name text default null) returns void
    language plpgsql security definer set search_path = public as $$
    declare d dispatches; l record;
    begin
      perform _require_role(array['wm']);
      if coalesce(p_sign_path, '') = '' then raise exception 'Signature is required'; end if;
      select * into d from dispatches where id = p_dispatch for update;
      if d.wm_approved_at is not null then raise exception 'Already approved'; end if;
      update dispatches set wm_approved_at = now(), wm_name = coalesce(nullif(trim(p_name), ''), app_name()), wm_sign_path = p_sign_path where id = p_dispatch;
      for l in select line_id from dispatch_lines where dispatch_id = p_dispatch loop
        perform refresh_line(l.line_id);
      end loop;
      perform _audit('dispatch', p_dispatch, 'approve', null, null);
      perform refresh_shipment(d.shipment_id);
    end $$;
    
    -- ---------------------------------------------------------------- delete (admin)
    create or replace function delete_shipment(p_ship uuid) returns text[]
    language plpgsql security definer set search_path = public as $$
    declare paths text[]; ids uuid[];
    begin
      if not coalesce((select is_admin from profiles where id = auth.uid()), false) then
        raise exception 'Only an admin can delete a shipment';
      end if;
    
      -- signature files to remove from storage (the app deletes them after this returns)
      select coalesce(array_agg(p), '{}') into paths from (
        select i.qc_sign_path as p from inspections i join shipment_lines l on l.id = i.line_id where l.shipment_id = p_ship
        union all select dispatch_sign_path from dispatches where shipment_id = p_ship
        union all select wm_sign_path from dispatches where shipment_id = p_ship
      ) x where p is not null;
    
      select array_agg(id) into ids from (
        select id from shipments where id = p_ship
        union all select id from shipment_lines where shipment_id = p_ship
        union all select i.id from inspections i join shipment_lines l on l.id = i.line_id where l.shipment_id = p_ship
        union all select id from dispatches where shipment_id = p_ship
      ) y;
    
      delete from scan_log where check_id in (
        select f.id from fnsku_checks f
          join inspections i on i.id = f.inspection_id
          join shipment_lines l on l.id = i.line_id where l.shipment_id = p_ship
        union
        select id from box_label_checks where shipment_id = p_ship);
      delete from audit_log where entity_id = any (coalesce(ids, '{}'));
      -- lines, QC cases, scans, dispatches follow by cascade
      delete from shipments where id = p_ship;
      return paths;
    end $$;
    
    drop policy if exists sig_delete on storage.objects;
    create policy sig_delete on storage.objects for delete to authenticated
      using (bucket_id = 'signatures' and coalesce((select is_admin from public.profiles where id = auth.uid()), false));
    
    -- ---------------------------------------------------------------- grants
    revoke all on function create_shipment(jsonb), add_line(uuid, text, int, int), update_shipment(uuid, jsonb),
      update_line(uuid, int, int), set_line_state(uuid, text), cancel_shipment(uuid), clear_hold(uuid),
      scan_fnsku(uuid, text), scan_box_label(uuid, text), submit_inspection(uuid, jsonb), reopen_inspection(uuid),
      confirm_dispatch(uuid, jsonb), approve_dispatch(uuid, text, text) from public;
    
    grant execute on function create_shipment(jsonb), add_line(uuid, text, int, int), update_shipment(uuid, jsonb),
      update_line(uuid, int, int), set_line_state(uuid, text), cancel_shipment(uuid), clear_hold(uuid),
      scan_fnsku(uuid, text), scan_box_label(uuid, text), submit_inspection(uuid, jsonb), reopen_inspection(uuid),
      confirm_dispatch(uuid, jsonb), approve_dispatch(uuid, text, text) to authenticated;
    
    revoke all on function delete_shipment(uuid) from public;
    grant execute on function delete_shipment(uuid) to authenticated;
    
    -- ---------------------------------------------------------------- first users
    -- After creating users in Authentication > Users, add their profile rows, e.g.:
    --   insert into profiles(id, name, role) values ('<uuid>', 'Amal Anilkumar', 'inventory');
    --   insert into profiles(id, name, role) values ('<uuid>', 'Suhail K', 'qc');
    --   insert into profiles(id, name, role) values ('<uuid>', 'Mohammed Misbahudeen KC', 'wm');
