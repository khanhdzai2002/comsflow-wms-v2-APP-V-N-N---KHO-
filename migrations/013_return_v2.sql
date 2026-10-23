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
