CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL,
 name text NOT NULL, password_hash text NOT NULL,
 role text NOT NULL CHECK(role IN ('admin','manager','staff')), active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL);
CREATE INDEX ON sessions(expires_at);
CREATE TABLE login_attempts (key text PRIMARY KEY, attempts integer NOT NULL DEFAULT 0, window_start timestamptz NOT NULL DEFAULT now());
CREATE TABLE warehouses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE NOT NULL);
CREATE TABLE sales_channels (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE NOT NULL);
CREATE TABLE shops (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, channel_id uuid NOT NULL REFERENCES sales_channels(id), UNIQUE(channel_id,name));
CREATE TABLE shipping_carriers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE NOT NULL);
CREATE TABLE work_shifts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, warehouse_id uuid NOT NULL REFERENCES warehouses(id),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, CHECK(ends_at>starts_at)
);
CREATE TABLE shift_members (shift_id uuid REFERENCES work_shifts(id),user_id uuid REFERENCES users(id),PRIMARY KEY(shift_id,user_id));
CREATE TABLE orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), external_id text NOT NULL, channel_id uuid NOT NULL REFERENCES sales_channels(id),
 shop_id uuid NOT NULL REFERENCES shops(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(shop_id,external_id)
);
CREATE TABLE order_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id),
 sku text NOT NULL, name text NOT NULL, color text NOT NULL DEFAULT '', size text NOT NULL DEFAULT '',
 quantity integer NOT NULL CHECK(quantity>0), UNIQUE(order_id,sku,color,size)
);
CREATE TABLE shipments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tracking_code text UNIQUE NOT NULL,
 order_id uuid NOT NULL REFERENCES orders(id), carrier_id uuid NOT NULL REFERENCES shipping_carriers(id),
 warehouse_id uuid NOT NULL REFERENCES warehouses(id), due_date date NOT NULL,
 status text NOT NULL DEFAULT 'awaiting_scan' CHECK(status IN ('pending','awaiting_scan','scanned','awaiting_handover','handed_over','cancelled','blocked','review')),
 scanned_at timestamptz, scanned_by uuid REFERENCES users(id), shift_id uuid REFERENCES work_shifts(id),
 handed_at timestamptz, handed_by uuid REFERENCES users(id), note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((scanned_at IS NULL)=(scanned_by IS NULL)),
 CHECK (status NOT IN ('scanned','awaiting_handover','handed_over') OR scanned_at IS NOT NULL),
 CHECK (status<>'handed_over' OR handed_at IS NOT NULL)
);
CREATE INDEX ON shipments(due_date,warehouse_id,carrier_id);
CREATE INDEX ON shipments(status);
CREATE INDEX ON shipments(scanned_by,scanned_at);
CREATE TABLE scan_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid UNIQUE NOT NULL,
 shipment_id uuid REFERENCES shipments(id), raw_code text NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('success','duplicate','unknown','invalid','cancelled','blocked','carrier_mismatch','warehouse_mismatch')),
 user_id uuid NOT NULL REFERENCES users(id), shift_id uuid NOT NULL REFERENCES work_shifts(id),
 warehouse_id uuid NOT NULL REFERENCES warehouses(id), method text NOT NULL CHECK(method IN ('hid','camera','manual')),
 created_at timestamptz NOT NULL DEFAULT now(), response jsonb NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX one_success_per_shipment ON scan_events(shipment_id) WHERE outcome='success';
CREATE INDEX ON scan_events(created_at,user_id);
CREATE TABLE import_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), filename text NOT NULL, user_id uuid NOT NULL REFERENCES users(id),
 total_rows integer NOT NULL, imported integer NOT NULL DEFAULT 0, errors integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE import_errors (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), batch_id uuid NOT NULL REFERENCES import_batches(id),
 row_number integer NOT NULL, message text NOT NULL, raw jsonb NOT NULL
);
CREATE TABLE import_templates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE NOT NULL, mapping jsonb NOT NULL, created_by uuid REFERENCES users(id));
CREATE TABLE handover_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), carrier_id uuid NOT NULL REFERENCES shipping_carriers(id),
 warehouse_id uuid NOT NULL REFERENCES warehouses(id), status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','confirmed')),
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 confirmed_by uuid REFERENCES users(id), confirmed_at timestamptz, note text NOT NULL DEFAULT ''
);
CREATE TABLE handover_items (
 batch_id uuid NOT NULL REFERENCES handover_batches(id), shipment_id uuid NOT NULL UNIQUE REFERENCES shipments(id),PRIMARY KEY(batch_id,shipment_id)
);
CREATE TABLE carrier_matching_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), prefix text UNIQUE NOT NULL,
 carrier_id uuid NOT NULL REFERENCES shipping_carriers(id), channel_id uuid REFERENCES sales_channels(id), active boolean NOT NULL DEFAULT true
);
CREATE TABLE exception_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), scan_event_id uuid REFERENCES scan_events(id),shipment_id uuid REFERENCES shipments(id),
 kind text NOT NULL, status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
 created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz, resolved_by uuid REFERENCES users(id), reason text
);
CREATE INDEX ON exception_cases(status,created_at);
CREATE TABLE audit_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users(id), action text NOT NULL,
 entity_id text NOT NULL, before_value jsonb, after_value jsonb, reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_logs(created_at);
CREATE TABLE system_settings (key text PRIMARY KEY,value jsonb NOT NULL);
CREATE FUNCTION deny_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'History is append-only'; END $$;
CREATE TRIGGER preserve_scans BEFORE UPDATE OR DELETE ON scan_events FOR EACH ROW EXECUTE FUNCTION deny_history_mutation();
CREATE TRIGGER preserve_audit BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION deny_history_mutation();
