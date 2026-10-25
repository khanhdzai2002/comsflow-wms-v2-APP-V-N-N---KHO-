-- ComsFlow: select project lyeyjfvxmqruszgfrjze and take a database backup first.
-- Adds reconciliation records/indexes only; no existing scans or shipments are changed.
BEGIN;
SET LOCAL search_path=public,extensions;
SELECT pg_advisory_xact_lock(742917);
DO $upgrade$
DECLARE old_checksum text;
BEGIN
 IF to_regclass('public.schema_migrations') IS NULL THEN
  RAISE EXCEPTION 'Missing ComsFlow migration ledger. Stop and verify the target.';
 END IF;
 IF (SELECT count(*) FROM public.schema_migrations WHERE name IN ('001_initial.sql','002_security.sql','003_handover_cancellation.sql','004_source_manifests.sql','005_source_security.sql','006_source_archives.sql','007_best_carrier.sql','008_source_continuation_pages.sql','009_shopee_spx_source.sql','010_return_management.sql','011_data_retention.sql','012_retired_return_cases.sql','013_return_v2.sql','014_tiktok_return_reasons.sql','015_supabase_platform.sql','016_background_jobs.sql','017_job_storage_cleanup.sql'))<>17 THEN
  RAISE EXCEPTION 'Expected all previous ComsFlow migrations. Stop and verify the target.';
 END IF;
 SELECT checksum INTO old_checksum FROM public.schema_migrations WHERE name='018_prescan_reconciliation.sql';
 IF old_checksum IS NOT NULL THEN
  IF old_checksum<>'57bd8dd1a0bf8203c6c32d877e569a11ac257d8165e35644b243b9733499f34d' THEN RAISE EXCEPTION 'Migration 018 checksum mismatch'; END IF;
 ELSE
  EXECUTE $migration018$-- Preserve the original scan and append its source-file reconciliation separately.
CREATE TABLE scan_reconciliations (
 scan_event_id uuid PRIMARY KEY REFERENCES scan_events(id),
 shipment_id uuid NOT NULL REFERENCES shipments(id),
 outcome text NOT NULL CHECK(outcome IN ('success','duplicate')),
 reconciled_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX one_reconciled_success_per_shipment ON scan_reconciliations(shipment_id) WHERE outcome='success';
CREATE INDEX scan_reconciliations_shipment ON scan_reconciliations(shipment_id);
CREATE INDEX pending_scan_code ON scan_events ((upper(btrim(coalesce(response->>'code',raw_code)))),warehouse_id,created_at,id) WHERE outcome='unknown' AND shipment_id IS NULL;
ALTER TABLE scan_reconciliations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON scan_reconciliations FROM PUBLIC;
CREATE TRIGGER preserve_scan_reconciliations BEFORE UPDATE OR DELETE ON scan_reconciliations FOR EACH ROW EXECUTE FUNCTION deny_history_mutation();
CREATE VIEW effective_scan_events WITH (security_invoker=true) AS
 SELECT e.id,e.request_id,coalesce(r.shipment_id,e.shipment_id) shipment_id,
 e.raw_code,coalesce(r.outcome,e.outcome) outcome,e.user_id,e.shift_id,e.warehouse_id,
 e.method,e.created_at,e.response,e.request_payload,e.outcome original_outcome,
 r.created_at reconciled_at
 FROM scan_events e LEFT JOIN scan_reconciliations r ON r.scan_event_id=e.id;
REVOKE ALL ON effective_scan_events FROM PUBLIC;
DO $$
DECLARE role_name text;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON scan_reconciliations,effective_scan_events FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
$migration018$;
  INSERT INTO public.schema_migrations(name,checksum) VALUES('018_prescan_reconciliation.sql','57bd8dd1a0bf8203c6c32d877e569a11ac257d8165e35644b243b9733499f34d');
 END IF;
END $upgrade$;
COMMIT;
SELECT to_regclass('public.effective_scan_events') IS NOT NULL AS prescan_ready;
