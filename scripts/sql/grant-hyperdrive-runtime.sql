-- Run ONLY in project lyeyjfvxmqruszgfrjze, using Supabase SQL Editor.
-- Promotes the successful connection probe to a server-only runtime role.
-- Keeps its existing password; no data, ownership, or browser grants change.
BEGIN;
SET LOCAL search_path = pg_catalog, public;
DO $permissions$
DECLARE
  t text;
  app_tables text[] := ARRAY[
    'users','sessions','login_attempts','warehouses',
    'sales_channels','shops','shipping_carriers','work_shifts',
    'shift_members','orders','order_items','shipments',
    'scan_events','import_batches','import_errors','import_templates',
    'handover_batches','handover_items','carrier_matching_rules','exception_cases',
    'audit_logs','system_settings','source_manifests','source_manifest_items',
    'source_manifest_archives','return_imports','return_cases','return_items',
    'return_parcels','return_snapshots','return_events','return_claims',
    'return_evidence','maintenance_jobs','retired_requests','return_import_purges',
    'retired_return_cases','carrier_aliases','return_import_results','return_import_changes',
    'return_reason_rules','product_components','sales_imports','successful_sales',
    'return_upload_attempts','setup_leases','data_jobs','worker_heartbeats'
  ];
BEGIN
  IF current_database() <> 'postgres'
     OR to_regclass('public.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'Select the ComsFlow Supabase database first';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.schema_migrations
    WHERE name = '017_job_storage_cleanup.sql'
  ) THEN
    RAISE EXCEPTION 'ComsFlow v2 migration marker is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'comsflow_connection_check'
    AND rolcanlogin AND NOT rolsuper AND NOT rolcreaterole
    AND NOT rolcreatedb AND NOT rolbypassrls
  ) THEN
    RAISE EXCEPTION 'Expected limited connection role was not found';
  END IF;
  GRANT USAGE ON SCHEMA public TO comsflow_connection_check;
  -- Health can read migration markers but the application cannot modify them.
  GRANT SELECT ON public.schema_migrations TO comsflow_connection_check;
  DROP POLICY IF EXISTS comsflow_server_access ON public.schema_migrations;
  CREATE POLICY comsflow_server_access ON public.schema_migrations
    FOR SELECT TO comsflow_connection_check USING (true);
  FOREACH t IN ARRAY app_tables LOOP
    -- Explicit app allowlist: no auth/storage access or future table grants.
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE EXCEPTION 'Missing ComsFlow table: %', t;
    END IF;
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO comsflow_connection_check', t
    );
    EXECUTE format('DROP POLICY IF EXISTS comsflow_server_access ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY comsflow_server_access ON public.%I TO comsflow_connection_check USING (true) WITH CHECK (true)', t
    );
  END LOOP;
  -- Migration 018 objects are optional on older installations. The reconciliation
  -- log only needs append/read access, never UPDATE/DELETE or browser grants.
  IF to_regclass('public.scan_reconciliations') IS NOT NULL
     AND to_regclass('public.effective_scan_events') IS NOT NULL THEN
    GRANT SELECT ON public.effective_scan_events TO comsflow_connection_check;
    GRANT SELECT,INSERT ON public.scan_reconciliations TO comsflow_connection_check;
    DROP POLICY IF EXISTS comsflow_server_access ON public.scan_reconciliations;
    CREATE POLICY comsflow_server_access ON public.scan_reconciliations
      TO comsflow_connection_check USING (true) WITH CHECK (true);
  END IF;
END
$permissions$;
COMMIT;
SELECT 'ComsFlow Hyperdrive application permissions ready' AS status;
