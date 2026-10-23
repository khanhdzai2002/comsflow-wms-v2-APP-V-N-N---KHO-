ALTER TABLE source_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_manifest_items ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text; r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['source_manifests','source_manifest_items'] LOOP
    FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
        EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',t,r);
      END IF;
    END LOOP;
  END LOOP;
END $$;
