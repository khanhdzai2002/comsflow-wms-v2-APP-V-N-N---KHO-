ALTER TABLE handover_batches DROP CONSTRAINT handover_batches_status_check;
ALTER TABLE handover_batches ADD CONSTRAINT handover_batches_status_check CHECK(status IN ('draft','confirmed','cancelled'));
ALTER TABLE handover_items ADD COLUMN released_at timestamptz;
ALTER TABLE handover_items DROP CONSTRAINT handover_items_shipment_id_key;
CREATE UNIQUE INDEX one_active_handover_per_shipment ON handover_items(shipment_id) WHERE released_at IS NULL;
