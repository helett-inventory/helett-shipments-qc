-- Run once in the Supabase SQL editor.
-- Mode of dispatch can now also be Bluedart.
alter table shipments drop constraint if exists shipments_dispatch_mode_check;
alter table shipments add constraint shipments_dispatch_mode_check
  check (dispatch_mode in ('ATS', 'Drop In', 'Bluedart'));
