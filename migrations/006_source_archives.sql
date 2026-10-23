-- Keep the original manifest and membership immutable; lifecycle is stored separately.
CREATE TABLE source_manifest_archives (
 manifest_id uuid PRIMARY KEY REFERENCES source_manifests(id),
 archived_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 archived_by uuid NOT NULL REFERENCES users(id),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 8 AND 1000)
);
ALTER TABLE source_manifest_archives ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON TABLE source_manifest_archives FROM %I',r);
  END IF;
 END LOOP;
END $$;
