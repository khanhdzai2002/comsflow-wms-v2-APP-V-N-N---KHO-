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
