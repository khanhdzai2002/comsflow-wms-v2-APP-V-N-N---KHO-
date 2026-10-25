-- Preserve the original scan and append its source-file reconciliation separately.
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
