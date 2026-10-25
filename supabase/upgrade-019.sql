-- ComsFlow: select project lyeyjfvxmqruszgfrjze and take a database backup first.
-- Adds schema/runtime grants only; no existing scans or shipments are changed.
BEGIN;
SET LOCAL search_path=public,extensions;
SELECT pg_advisory_xact_lock(742917);
DO $upgrade_guard$
BEGIN
 IF to_regclass('public.schema_migrations') IS NULL THEN
  RAISE EXCEPTION 'Missing ComsFlow migration ledger. Stop and verify the target.';
 END IF;
 IF (SELECT count(*) FROM public.schema_migrations WHERE name IN ('001_initial.sql','002_security.sql','003_handover_cancellation.sql','004_source_manifests.sql','005_source_security.sql','006_source_archives.sql','007_best_carrier.sql','008_source_continuation_pages.sql','009_shopee_spx_source.sql','010_return_management.sql','011_data_retention.sql','012_retired_return_cases.sql','013_return_v2.sql','014_tiktok_return_reasons.sql','015_supabase_platform.sql','016_background_jobs.sql','017_job_storage_cleanup.sql','018_prescan_reconciliation.sql'))<>18 THEN
  RAISE EXCEPTION 'Expected all previous ComsFlow migrations. Stop and verify the target.';
 END IF;
END $upgrade_guard$;
DO $apply_upgrade$
DECLARE old_checksum text;
BEGIN
 SELECT checksum INTO old_checksum FROM public.schema_migrations WHERE name='019_prescan_runtime_permissions.sql';
 IF old_checksum IS NOT NULL AND old_checksum<>'9fdc107242e40e0f22458a99c6a7846c9dcc276946538a258b87a31c1b65902f' THEN
  RAISE EXCEPTION 'Migration checksum mismatch: 019_prescan_runtime_permissions.sql';
 END IF;
 IF old_checksum IS NULL OR true THEN
  EXECUTE $upgrade_9fdc107242e40e0f$
-- The Hyperdrive login is intentionally limited; new objects need explicit
-- grants AND an RLS policy. Never grant these objects to browser/API roles.
DO $prescan_permissions$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='comsflow_connection_check') THEN
  RETURN;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='comsflow_connection_check'
   AND rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolbypassrls) THEN
  RAISE EXCEPTION 'Expected limited Hyperdrive runtime role';
 END IF;
 IF to_regclass('public.effective_scan_events') IS NULL OR to_regclass('public.scan_reconciliations') IS NULL THEN
  RAISE EXCEPTION 'Apply ComsFlow migration 018 before repairing its permissions';
 END IF;
 GRANT SELECT ON public.effective_scan_events TO comsflow_connection_check;
 GRANT SELECT,INSERT ON public.scan_reconciliations TO comsflow_connection_check;
 DROP POLICY IF EXISTS comsflow_server_access ON public.scan_reconciliations;
 CREATE POLICY comsflow_server_access ON public.scan_reconciliations
   TO comsflow_connection_check USING (true) WITH CHECK (true);
END
$prescan_permissions$;

$upgrade_9fdc107242e40e0f$;
  INSERT INTO public.schema_migrations(name,checksum) VALUES('019_prescan_runtime_permissions.sql','9fdc107242e40e0f22458a99c6a7846c9dcc276946538a258b87a31c1b65902f') ON CONFLICT(name) DO NOTHING;
 END IF;
END $apply_upgrade$;
COMMIT;
SELECT to_regclass('public.effective_scan_events') IS NOT NULL AS prescan_ready;
