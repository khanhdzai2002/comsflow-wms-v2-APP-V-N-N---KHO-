-- Compact identities prevent later exports from recreating purged cases.
CREATE TABLE retired_return_cases (
 shop_id uuid NOT NULL REFERENCES shops(id), external_id text NOT NULL,
 job_id uuid NOT NULL REFERENCES maintenance_jobs(id),
 PRIMARY KEY(shop_id,external_id)
);
ALTER TABLE retired_return_cases ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE retired_return_cases FROM %I',r); END IF;
 END LOOP;
END $$;
