-- Chỉ chạy trong project Supabase mới lyeyjfvxmqruszgfrjze.
-- Không chuyển/xóa dữ liệu Railway, không tạo tài khoản Admin.
BEGIN;
SET LOCAL search_path=public,extensions;
SELECT pg_advisory_xact_lock(742917);
DO $comsflow$
DECLARE
 expected jsonb := '{"001_initial.sql":"107e14bde7cb4672d3f4a444906f3f2ba4a8f9344b956b17a9cf9af92feb1b8a","002_security.sql":"b7dfae0a8266d99a3d806ef8409fda8846f817a2b6d9752f3bea6e89cb4f0503","003_handover_cancellation.sql":"b0029d9f4e19a09a32d81eea6d8a97d753a93e5323d2877c868124349d173314","004_source_manifests.sql":"96bb7ceb41d2532f07210a725afa67959264fddc5fb986a3070892403948cbae","005_source_security.sql":"223b497de0888adb1c5c3fac3f9ffddf4067d80f94e7befc0ebcde616b398b1d","006_source_archives.sql":"bca242083ad92061d1fb347e7e93759b7fe1e55a0f456d15a4116cee009c0c7f","007_best_carrier.sql":"84270634d46b073fdfaeb36c05ed0eda27c0694611f63148655e9eddb2f664af","008_source_continuation_pages.sql":"1256895db86bd9f0d712ddeea5d4635b1d1ff7a4939b6341083b761ecddfbd4c","009_shopee_spx_source.sql":"f9bbedf2686ec45a6e50916d9cf37aa244358095c846323b836fed9efcf8d561","010_return_management.sql":"6376a4a727c0eeb89e99bf5dc87321d8cfb2088d9a8ebcf38c5b192685fb6f96","011_data_retention.sql":"c76e60b37fc7a1186eae342eda1ce34af62e4f61057fabbee01ddc7e99475fee","012_retired_return_cases.sql":"7c4300ff68241d6707ea02f52f50e345178ec01810a51fd441e0cb0d21ecda11","013_return_v2.sql":"0af187a9803d465a39bb4ccfe94e63c1edbe4615393317ea179a2bb002297d3c","014_tiktok_return_reasons.sql":"624f31c96eb3188db2c6201646776a444ec3f4e99d65dfc9bb7fffd3538a8750","015_supabase_platform.sql":"24d031c96441486a42e7ce174e588706ac24e42dad3d30e01e36adad0adeccce","016_background_jobs.sql":"5a8bbb578e69a2f50994650b7dae22ee30c212de74d7c2a996925e2fcaf8fbf3","017_job_storage_cleanup.sql":"ede913b0fe7ad4de74ba28054ecae9ae343bdb10558a66940483474b6ffe8fb7"}';
BEGIN
 IF to_regclass('public.schema_migrations') IS NOT NULL THEN
  IF EXISTS (
   SELECT 1 FROM jsonb_each_text(expected) e
   LEFT JOIN public.schema_migrations m ON m.name=e.key
   WHERE m.checksum IS DISTINCT FROM e.value
  ) THEN
   RAISE EXCEPTION 'Schema đã có hoặc không đúng phiên bản. Dừng để kiểm tra; không xóa bảng.';
  END IF;
  RETURN;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public') THEN
  RAISE EXCEPTION 'Project có bảng sẵn. Hãy chọn project ComsFlow mới, không xóa dữ liệu.';
 END IF;
 EXECUTE $app_schema$
CREATE TABLE public.schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now());
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

ALTER TABLE handover_batches DROP CONSTRAINT handover_batches_status_check;
ALTER TABLE handover_batches ADD CONSTRAINT handover_batches_status_check CHECK(status IN ('draft','confirmed','cancelled'));
ALTER TABLE handover_items ADD COLUMN released_at timestamptz;
ALTER TABLE handover_items DROP CONSTRAINT handover_items_shipment_id_key;
CREATE UNIQUE INDEX one_active_handover_per_shipment ON handover_items(shipment_id) WHERE released_at IS NULL;

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

INSERT INTO shipping_carriers(name) VALUES ('BEST Express') ON CONFLICT(name) DO NOTHING;

-- Preserve the distinction between repeated labels and product continuation pages.
-- Historical sources retain their original counts; this applies to new imports.
ALTER TABLE source_manifests
  ADD COLUMN continuation_pages integer NOT NULL DEFAULT 0
  CHECK (continuation_pages >= 0);

INSERT INTO sales_channels(name) VALUES ('Shopee') ON CONFLICT(name) DO NOTHING;
INSERT INTO shipping_carriers(name) VALUES ('SPX Express') ON CONFLICT(name) DO NOTHING;
-- A hint for unknown scans only. A prefix never substitutes for imported data.
-- Keep any rule already configured by the administrator.
INSERT INTO carrier_matching_rules(prefix,carrier_id,channel_id)
SELECT 'SPXVN',c.id,s.id FROM shipping_carriers c,sales_channels s
WHERE c.name='SPX Express' AND s.name='Shopee'
ON CONFLICT(prefix) DO NOTHING;

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

-- Compact identities prevent later exports from recreating purged cases.
CREATE TABLE retired_return_cases (
 shop_id uuid NOT NULL REFERENCES shops(id), external_id text NOT NULL,
 job_id uuid NOT NULL REFERENCES maintenance_jobs(id),
 PRIMARY KEY(shop_id,external_id)
);
ALTER TABLE retired_return_cases ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE retired_return_cases FROM %I',r); END IF;
 END LOOP;
END $$;

-- Additive V2 data; existing return cases, events and receipts are untouched.
INSERT INTO shipping_carriers(name) VALUES ('GHN'),('GHTK'),('Viettel Post'),('Ninja Van') ON CONFLICT DO NOTHING;
CREATE TABLE carrier_aliases(alias text PRIMARY KEY,carrier_id uuid NOT NULL REFERENCES shipping_carriers(id));
INSERT INTO carrier_aliases(alias,carrier_id)
SELECT alias,c.id FROM (VALUES ('J&T Express','jt'),('J&T Express','jtexpress'),('J&T Express','jnt'),('SPX Express','spx'),('SPX Express','spxexpress'),('SPX Express','shopeeexpress'),('BEST Express','best'),('BEST Express','bestexpress'),('GHN','giaohangnhanh'),('GHTK','giaohangtietkiem'),('Viettel Post','viettelpost'),('Ninja Van','ninjavan')) AS a(name,alias)
JOIN shipping_carriers c ON c.name=a.name ON CONFLICT DO NOTHING;
ALTER TABLE return_parcels ADD COLUMN source_carrier text NOT NULL DEFAULT '',ADD COLUMN carrier_conflict boolean NOT NULL DEFAULT false,ADD COLUMN carrier_origin text NOT NULL DEFAULT 'unknown';
UPDATE return_parcels SET carrier_origin='manual' WHERE carrier_id IS NOT NULL;
CREATE TABLE return_import_results(import_id uuid PRIMARY KEY REFERENCES return_imports(id),new_count integer NOT NULL,updated_count integer NOT NULL,unchanged_count integer NOT NULL,error_count integer NOT NULL DEFAULT 0,status_count integer NOT NULL,finance_count integer NOT NULL);
CREATE TABLE return_import_changes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),import_id uuid NOT NULL REFERENCES return_imports(id),case_id uuid NOT NULL REFERENCES return_cases(id) ON DELETE CASCADE,external_id text NOT NULL,changes jsonb NOT NULL);
CREATE INDEX ON return_import_changes(import_id);
-- Compact reason code is separate from the verbatim reason retained in source_data.
ALTER TABLE return_cases ADD COLUMN reason_original text NOT NULL DEFAULT '',ADD COLUMN reason_group text NOT NULL DEFAULT 'other';
CREATE TABLE return_reason_rules(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),phrase text UNIQUE NOT NULL,group_key text NOT NULL,active boolean NOT NULL DEFAULT true);
INSERT INTO return_reason_rules(phrase,group_key) VALUES ('does not fit','size'),('không vừa','size'),('wrong size','size'),('not as described','description'),('không đúng mô tả','description'),('wrong color','color'),('sai màu','color'),('wrong item','wrong'),('giao nhầm','wrong'),('defective','quality'),('quality issue','quality'),('hàng lỗi','quality'),('damaged','damaged'),('hư hỏng','damaged'),('change of mind','mind'),('đổi ý','mind'),('delivery failed','delivery'),('giao hàng thất bại','delivery');
CREATE TABLE product_components(source_sku text PRIMARY KEY,components jsonb NOT NULL,updated_by uuid REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE sales_imports(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),file_hash text NOT NULL,filename text NOT NULL,shop_id uuid NOT NULL REFERENCES shops(id),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),summary jsonb NOT NULL,UNIQUE(shop_id,file_hash));
CREATE TABLE successful_sales(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),shop_id uuid NOT NULL REFERENCES shops(id),order_code text NOT NULL,line_code text NOT NULL,sku text NOT NULL,product_code text NOT NULL DEFAULT '',color text NOT NULL DEFAULT '',size text NOT NULL DEFAULT '',sold_on date NOT NULL,quantity integer NOT NULL CHECK(quantity>0),successful boolean NOT NULL,source_data jsonb NOT NULL,last_import_id uuid NOT NULL REFERENCES sales_imports(id),UNIQUE(shop_id,order_code,line_code));
CREATE INDEX ON successful_sales(shop_id,sold_on);
INSERT INTO system_settings(key,value) VALUES('return_rate_thresholds','{"low":5,"high":10}'::jsonb) ON CONFLICT DO NOTHING;
DO $$ DECLARE t text; r text; BEGIN
 FOREACH t IN ARRAY ARRAY['carrier_aliases','return_import_results','return_import_changes','return_reason_rules','product_components','sales_imports','successful_sales'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',t,r); END IF;
  END LOOP;
 END LOOP;
END $$;
-- Summary headers stay; per-case field diffs are removed with an authorized case purge.
CREATE TRIGGER preserve_return_import_results BEFORE UPDATE OR DELETE ON return_import_results FOR EACH ROW EXECUTE FUNCTION deny_history_mutation();
CREATE TRIGGER preserve_sales_imports BEFORE UPDATE OR DELETE ON sales_imports FOR EACH ROW EXECUTE FUNCTION deny_history_mutation();
CREATE TABLE return_upload_attempts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),filename text NOT NULL,channel text NOT NULL,shop text NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),summary jsonb NOT NULL,errors jsonb NOT NULL);
ALTER TABLE return_upload_attempts ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE return_upload_attempts FROM %I',r); END IF; END LOOP; END $$;
CREATE TRIGGER preserve_return_upload_attempts BEFORE UPDATE OR DELETE ON return_upload_attempts FOR EACH ROW EXECUTE FUNCTION deny_history_mutation();

CREATE OR REPLACE FUNCTION maintenance_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j maintenance_jobs%ROWTYPE; target text;
BEGIN
 IF TG_OP='DELETE' AND nullif(current_setting('comsflow.cleanup_job',true),'') IS NOT NULL THEN
  SELECT * INTO j FROM maintenance_jobs m
   WHERE m.id=current_setting('comsflow.cleanup_job')::uuid
   AND m.state='running' AND m.executing_xid=txid_current()
   AND EXISTS(SELECT 1 FROM users u WHERE u.id=m.created_by AND u.active AND u.role='admin');
  IF FOUND THEN
   IF TG_TABLE_NAME='scan_events' AND j.kind='scans' THEN target:=OLD.id::text;
   ELSIF TG_TABLE_NAME IN ('return_events','return_snapshots','return_evidence','return_import_changes') AND j.kind='returns' THEN target:=OLD.case_id::text;
   END IF;
   IF target IS NOT NULL AND j.targets ? target THEN RETURN OLD; END IF;
  END IF;
 END IF;
 RAISE EXCEPTION 'History is append-only outside an authorized cleanup';
END $$;
CREATE TRIGGER preserve_return_import_changes BEFORE UPDATE OR DELETE ON return_import_changes FOR EACH ROW EXECUTE FUNCTION maintenance_history_guard();

-- Verified reason labels in the supplied original TikTok return export.
-- Keep any administrator override/disabled rule intact.
INSERT INTO return_reason_rules(phrase,group_key) VALUES
 ('item too big or too small','size'),
 ('ordered wrong size','size'),
 ('poor quality','quality'),
 ('product doesn''t match description','description'),
 ('wrong product sent','wrong')
ON CONFLICT(phrase) DO NOTHING;

ALTER TABLE users ADD COLUMN auth_user_id uuid UNIQUE;
CREATE TABLE setup_leases(key text PRIMARY KEY, token uuid NOT NULL, expires_at timestamptz NOT NULL);
ALTER TABLE setup_leases ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON setup_leases FROM %I',r); END IF;
  END LOOP;
END $$;

CREATE FUNCTION public.comsflow_auth_profile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE trusted boolean; app_role text; legacy_id uuid;
BEGIN
  trusted := COALESCE(NEW.raw_app_meta_data->>'comsflow_provisioned','false')='true';
  app_role := NEW.raw_app_meta_data->>'app_role';
  IF app_role IS NULL OR app_role NOT IN ('admin','manager','staff') THEN app_role:='staff'; END IF;
  SELECT id INTO legacy_id FROM public.users WHERE lower(email)=lower(NEW.email) AND auth_user_id IS NULL;
  IF legacy_id IS NOT NULL AND trusted THEN
    UPDATE public.users SET auth_user_id=NEW.id WHERE id=legacy_id;
  ELSE
    INSERT INTO public.users(id,auth_user_id,email,name,password_hash,role,active)
      VALUES(NEW.id,NEW.id,lower(NEW.email),coalesce(NEW.raw_user_meta_data->>'name',split_part(NEW.email,'@',1)),'!supabase-auth',app_role,trusted);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.comsflow_auth_profile() FROM PUBLIC;
DO $$ BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    EXECUTE 'CREATE TRIGGER comsflow_auth_profile AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.comsflow_auth_profile()';
  END IF;
END $$;

CREATE INDEX scan_events_warehouse_time_id ON scan_events(warehouse_id,created_at,id);
CREATE INDEX scan_events_time_id ON scan_events(created_at,id);
CREATE INDEX scan_events_outcome_time ON scan_events(outcome,created_at);
CREATE INDEX shipments_scan_time_id ON shipments(scanned_at,id) WHERE scanned_at IS NOT NULL;
CREATE INDEX shipments_warehouse_scan_time ON shipments(warehouse_id,scanned_at) WHERE scanned_at IS NOT NULL;
CREATE INDEX return_cases_warehouse_updated ON return_cases(warehouse_id,updated_at,id);

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

ALTER TABLE data_jobs ADD COLUMN storage_cleaned_at timestamptz;
CREATE INDEX data_jobs_cleanup ON data_jobs(expires_at) WHERE storage_cleaned_at IS NULL;

$app_schema$;
 INSERT INTO public.schema_migrations(name,checksum)
 SELECT key,value FROM jsonb_each_text(expected);
 ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
 REVOKE ALL ON public.schema_migrations FROM PUBLIC;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON public.schema_migrations FROM anon;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  REVOKE ALL ON public.schema_migrations FROM authenticated;
 END IF;
END
$comsflow$;
DO $private_bucket$
BEGIN
 IF to_regclass('storage.buckets') IS NOT NULL THEN
  INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  VALUES('comsflow-private','comsflow-private',false,52428800,ARRAY['application/pdf','application/octet-stream','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
  ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
 END IF;
END
$private_bucket$;
COMMIT;
SELECT 'ComsFlow schema ready; Railway data has NOT been imported' AS status,count(*) AS migrations FROM public.schema_migrations;
