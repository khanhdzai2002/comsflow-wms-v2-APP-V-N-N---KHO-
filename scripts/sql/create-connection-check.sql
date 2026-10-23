-- Run only in the ComsFlow Supabase project's SQL Editor.
-- Output contains a newly generated secret: copy it privately to Hyperdrive.
-- This creates a LOGIN/CONNECT probe only, not an application administrator.
CREATE OR REPLACE FUNCTION pg_temp.comsflow_connection_check()
RETURNS TABLE (db_user text, db_password text)
LANGUAGE plpgsql
AS $probe$
DECLARE
  generated_password text := replace(pg_catalog.gen_random_uuid()::text, '-', '');
BEGIN
  IF current_database() <> 'postgres'
     OR to_regclass('public.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'Open SQL Editor in the ComsFlow Supabase project first';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.schema_migrations
    WHERE name = '017_job_storage_cleanup.sql'
  ) THEN
    RAISE EXCEPTION 'ComsFlow v2 migration marker was not found; no role created';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'comsflow_connection_check') THEN
    RAISE EXCEPTION 'Probe role already exists; no password was changed. Do not repeatedly rerun this script';
  END IF;
  EXECUTE format(
    'CREATE ROLE comsflow_connection_check LOGIN NOINHERIT PASSWORD %L',
    generated_password
  );
  GRANT CONNECT ON DATABASE postgres TO comsflow_connection_check;
  RETURN QUERY SELECT 'comsflow_connection_check'::text, generated_password;
END
$probe$;
SELECT * FROM pg_temp.comsflow_connection_check();
