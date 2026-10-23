ALTER TABLE scan_events ADD COLUMN request_payload jsonb;
-- Browser roles cannot read operational data. Backend connects as table owner.
DO $$
DECLARE t text; r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','sessions','login_attempts','warehouses','sales_channels','shops','shipping_carriers','work_shifts','shift_members','orders','order_items','shipments','scan_events','import_batches','import_errors','import_templates','handover_batches','handover_items','carrier_matching_rules','exception_cases','audit_logs','system_settings']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
        EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',t,r);
      END IF;
    END LOOP;
  END LOOP;
END $$;
