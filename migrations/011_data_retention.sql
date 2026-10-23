CREATE TABLE maintenance_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_by uuid NOT NULL REFERENCES users(id),
 kind text NOT NULL CHECK(kind IN ('scans','returns')),
 before_date date NOT NULL, warehouse_id uuid REFERENCES warehouses(id),
 targets jsonb NOT NULL, fingerprint text NOT NULL, summary jsonb NOT NULL,
 state text NOT NULL DEFAULT 'preview' CHECK(state IN ('preview','running','completed')),
 executing_xid bigint, result jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '30 minutes',
 completed_at timestamptz
);
CREATE INDEX ON maintenance_jobs(completed_at DESC) WHERE state='completed';
CREATE TABLE retired_requests (
 kind text NOT NULL CHECK(kind IN ('scans','returns')), request_id uuid NOT NULL,
 job_id uuid NOT NULL REFERENCES maintenance_jobs(id),
 PRIMARY KEY(kind,request_id)
);
CREATE TABLE return_import_purges (
 import_id uuid PRIMARY KEY REFERENCES return_imports(id),
 purged_rows integer NOT NULL CHECK(purged_rows>0),
 job_id uuid NOT NULL REFERENCES maintenance_jobs(id)
);
CREATE INDEX ON return_cases(updated_at,id);
CREATE INDEX ON return_snapshots(case_id);
CREATE INDEX ON return_claims(case_id);
CREATE INDEX ON return_evidence(case_id);
CREATE INDEX ON exception_cases(scan_event_id);
CREATE INDEX ON exception_cases(shipment_id);

-- Only DELETE of exact previewed targets is permitted, inside the executing
-- job's transaction. UPDATE remains forbidden; audit/source guards are unchanged.
CREATE FUNCTION maintenance_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j maintenance_jobs%ROWTYPE; target text;
BEGIN
 IF TG_OP='DELETE' AND nullif(current_setting('comsflow.cleanup_job',true),'') IS NOT NULL THEN
  SELECT * INTO j FROM maintenance_jobs m
   WHERE m.id=current_setting('comsflow.cleanup_job')::uuid
   AND m.state='running' AND m.executing_xid=txid_current()
   AND EXISTS(SELECT 1 FROM users u WHERE u.id=m.created_by AND u.active AND u.role='admin');
  IF FOUND THEN
   IF TG_TABLE_NAME='scan_events' AND j.kind='scans' THEN target:=OLD.id::text;
   ELSIF TG_TABLE_NAME IN ('return_events','return_snapshots','return_evidence') AND j.kind='returns' THEN target:=OLD.case_id::text;
   END IF;
   IF target IS NOT NULL AND j.targets ? target THEN RETURN OLD; END IF;
  END IF;
 END IF;
 RAISE EXCEPTION 'History is append-only outside an authorized cleanup';
END $$;
DROP TRIGGER preserve_scans ON scan_events;
CREATE TRIGGER preserve_scans BEFORE UPDATE OR DELETE ON scan_events FOR EACH ROW EXECUTE FUNCTION maintenance_history_guard();
DROP TRIGGER preserve_return_events ON return_events;
DROP TRIGGER preserve_return_snapshots ON return_snapshots;
DROP TRIGGER preserve_return_evidence ON return_evidence;
CREATE TRIGGER preserve_return_events BEFORE UPDATE OR DELETE ON return_events FOR EACH ROW EXECUTE FUNCTION maintenance_history_guard();
CREATE TRIGGER preserve_return_snapshots BEFORE UPDATE OR DELETE ON return_snapshots FOR EACH ROW EXECUTE FUNCTION maintenance_history_guard();
CREATE TRIGGER preserve_return_evidence BEFORE UPDATE OR DELETE ON return_evidence FOR EACH ROW EXECUTE FUNCTION maintenance_history_guard();
DO $$ DECLARE t text; r text; BEGIN
 FOREACH t IN ARRAY ARRAY['maintenance_jobs','retired_requests','return_import_purges'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',t,r); END IF;
  END LOOP;
 END LOOP;
END $$;
