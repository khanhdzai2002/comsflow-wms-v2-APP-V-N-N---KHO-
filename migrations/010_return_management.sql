CREATE TABLE return_imports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), file_hash text NOT NULL, filename text NOT NULL,
 shop_id uuid NOT NULL REFERENCES shops(id), warehouse_id uuid NOT NULL REFERENCES warehouses(id),
 rows_count integer NOT NULL, summary jsonb NOT NULL, created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(shop_id,file_hash)
);
CREATE TABLE return_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL REFERENCES shops(id),
 warehouse_id uuid NOT NULL REFERENCES warehouses(id), external_id text NOT NULL, order_code text NOT NULL,
 requested_at timestamptz NOT NULL, platform_status text NOT NULL, platform_substatus text NOT NULL DEFAULT '',
 return_type text NOT NULL, source_data jsonb NOT NULL, source_hash text NOT NULL,
 last_import_id uuid NOT NULL REFERENCES return_imports(id),
 processing_status text NOT NULL DEFAULT 'pending' CHECK(processing_status IN ('pending','checking','claim_open','claim_submitted','claim_won','claim_lost','suspected_lost','lost','compensated','completed','closed_unsuccessful')),
 inspection_status text NOT NULL DEFAULT 'pending' CHECK(inspection_status IN ('pending','full','short','damaged','wrong','empty')),
 inspection_stale boolean NOT NULL DEFAULT false, no_physical_return boolean NOT NULL DEFAULT false,
 assigned_to uuid REFERENCES users(id), expected_at date, location text NOT NULL DEFAULT '',
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(shop_id,external_id)
);
CREATE TABLE return_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES return_cases(id),
 item_key text NOT NULL, sku_id text NOT NULL, seller_sku text NOT NULL DEFAULT '', name text NOT NULL,
 variant text NOT NULL DEFAULT '', expected_qty integer NOT NULL CHECK(expected_qty>0),
 received_qty integer CHECK(received_qty>=0), unit_amount numeric(18,0), active boolean NOT NULL DEFAULT true,
 UNIQUE(case_id,item_key)
);
CREATE TABLE return_parcels (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES return_cases(id),
 tracking_code text NOT NULL, carrier_id uuid REFERENCES shipping_carriers(id), active boolean NOT NULL DEFAULT true,
 received_at timestamptz, received_by uuid REFERENCES users(id), UNIQUE(case_id,tracking_code),
 CHECK((received_at IS NULL)=(received_by IS NULL))
);
CREATE INDEX ON return_parcels(tracking_code);
CREATE INDEX ON return_cases(requested_at,warehouse_id,processing_status);
CREATE TABLE return_snapshots (
 import_id uuid NOT NULL REFERENCES return_imports(id), row_number integer NOT NULL,
 case_id uuid REFERENCES return_cases(id), raw jsonb NOT NULL, error text,
 PRIMARY KEY(import_id,row_number)
);
CREATE TABLE return_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid REFERENCES return_cases(id),
 parcel_id uuid REFERENCES return_parcels(id), request_id uuid UNIQUE,
 actor_id uuid NOT NULL REFERENCES users(id), shift_id uuid REFERENCES work_shifts(id),
 action text NOT NULL, code text NOT NULL DEFAULT '', reason text NOT NULL DEFAULT '',
 data jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ON return_events(case_id,created_at);
CREATE TABLE return_claims (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES return_cases(id),
 reason text NOT NULL, deadline date, requested_amount numeric(18,0), approved_amount numeric(18,0),
 received_amount numeric(18,0), received_on date,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','submitted','won','lost','paid','closed')),
 created_by uuid NOT NULL REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(requested_amount IS NULL OR requested_amount>=0), CHECK(approved_amount IS NULL OR approved_amount>=0),
 CHECK(received_amount IS NULL OR received_amount>=0), CHECK(status<>'paid' OR (received_amount IS NOT NULL AND received_on IS NOT NULL))
);
CREATE TABLE return_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES return_cases(id),
 filename text NOT NULL, mime text NOT NULL CHECK(mime IN ('image/jpeg','image/png','application/pdf')),
 bytes bytea NOT NULL CHECK(octet_length(bytes)<=5242880), created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO system_settings(key,value) VALUES('return_overdue_days','5') ON CONFLICT DO NOTHING;
DO $$ DECLARE t text; r text; BEGIN
 FOREACH t IN ARRAY ARRAY['return_imports','return_snapshots','return_events','return_evidence'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION deny_history_mutation()','preserve_'||t,t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['return_imports','return_cases','return_items','return_parcels','return_snapshots','return_events','return_claims','return_evidence'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',t,r); END IF;
  END LOOP;
 END LOOP;
END $$;
