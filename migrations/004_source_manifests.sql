CREATE TABLE source_manifests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 filename text NOT NULL, file_hash text NOT NULL UNIQUE,
 warehouse_id uuid NOT NULL REFERENCES warehouses(id),
 carrier_id uuid NOT NULL REFERENCES shipping_carriers(id),
 shop_id uuid NOT NULL REFERENCES shops(id),
 due_date date NOT NULL, page_count integer NOT NULL CHECK(page_count>0),
 duplicate_pages integer NOT NULL DEFAULT 0,
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE source_manifest_items (
 manifest_id uuid NOT NULL REFERENCES source_manifests(id),
 shipment_id uuid NOT NULL REFERENCES shipments(id),
 tracking_code text NOT NULL, external_id text NOT NULL,
 pages integer[] NOT NULL,
 scanned_before_import boolean NOT NULL,
 handed_before_import boolean NOT NULL,
 PRIMARY KEY(manifest_id,shipment_id), UNIQUE(manifest_id,tracking_code)
);
CREATE INDEX ON source_manifest_items(shipment_id);
CREATE TRIGGER preserve_source_items BEFORE UPDATE OR DELETE ON source_manifest_items FOR EACH ROW EXECUTE FUNCTION deny_history_mutation();
CREATE TRIGGER preserve_source_manifests BEFORE UPDATE OR DELETE ON source_manifests FOR EACH ROW EXECUTE FUNCTION deny_history_mutation();
