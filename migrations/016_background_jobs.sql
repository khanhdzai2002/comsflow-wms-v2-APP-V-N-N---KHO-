CREATE TABLE data_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_by uuid NOT NULL REFERENCES users(id),
 route text NOT NULL,
 method text NOT NULL CHECK(method IN ('GET','POST')),
 filename text NOT NULL DEFAULT '',
 storage_path text,
 file_size bigint NOT NULL DEFAULT 0 CHECK(file_size BETWEEN 0 AND 52428800),
 sha256 text,
 payload jsonb NOT NULL DEFAULT '{}',
 status text NOT NULL DEFAULT 'waiting_upload' CHECK(status IN ('waiting_upload','queued','running','succeeded','failed','cancelled')),
 result jsonb,
 error text,
 attempts integer NOT NULL DEFAULT 0,
 max_attempts integer NOT NULL DEFAULT 3,
 lease_token uuid,
 lease_expires_at timestamptz,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
 idempotency_key text NOT NULL,
 UNIQUE(created_by,idempotency_key)
);
CREATE INDEX data_jobs_queue ON data_jobs(next_attempt_at,created_at) WHERE status IN ('queued','running');
CREATE INDEX data_jobs_owner ON data_jobs(created_by,created_at DESC);
CREATE TABLE worker_heartbeats(id text PRIMARY KEY,seen_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE data_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_heartbeats ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON data_jobs,worker_heartbeats,setup_leases FROM anon;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  REVOKE ALL ON data_jobs,worker_heartbeats,setup_leases FROM authenticated;
 END IF;
END $$;
