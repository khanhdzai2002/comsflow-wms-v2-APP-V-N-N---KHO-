-- ComsFlow: select project lyeyjfvxmqruszgfrjze and take a database backup first.
-- Adds schema/runtime grants and conservative projections from existing return sources.
-- Existing scans, receipts, source IDs and audit history are preserved; review migration 020 and the rollout guide.
BEGIN;
SET LOCAL search_path=public,extensions;
SELECT pg_advisory_xact_lock(742917);
DO $upgrade_guard$
BEGIN
 IF to_regclass('public.schema_migrations') IS NULL THEN
  RAISE EXCEPTION 'Missing ComsFlow migration ledger. Stop and verify the target.';
 END IF;
 IF (SELECT count(*) FROM public.schema_migrations WHERE name IN ('001_initial.sql','002_security.sql','003_handover_cancellation.sql','004_source_manifests.sql','005_source_security.sql','006_source_archives.sql','007_best_carrier.sql','008_source_continuation_pages.sql','009_shopee_spx_source.sql','010_return_management.sql','011_data_retention.sql','012_retired_return_cases.sql','013_return_v2.sql','014_tiktok_return_reasons.sql','015_supabase_platform.sql','016_background_jobs.sql','017_job_storage_cleanup.sql','018_prescan_reconciliation.sql','019_prescan_runtime_permissions.sql'))<>19 THEN
  RAISE EXCEPTION 'Expected all previous ComsFlow migrations. Stop and verify the target.';
 END IF;
END $upgrade_guard$;
DO $apply_upgrade$
DECLARE old_checksum text;
BEGIN
 SELECT checksum INTO old_checksum FROM public.schema_migrations WHERE name='020_return_operations.sql';
 IF old_checksum IS NOT NULL AND old_checksum<>'4207d1e0b88def8a3130fa53ef6aedf86ba2bc1f5f66e12e9889d75fb7f5ad7f' THEN
  RAISE EXCEPTION 'Migration checksum mismatch: 020_return_operations.sql';
 END IF;
 IF old_checksum IS NULL OR false THEN
  EXECUTE $upgrade_4207d1e0b88def8a$
-- Additive upgrade; all existing case/item/parcel UUIDs and operational history
-- remain intact. See docs/returns-v2/ARCHITECTURE-AND-MIGRATION.md before applying.
ALTER TABLE return_cases
 ADD COLUMN workflow text NOT NULL DEFAULT 'customer_return' CHECK(workflow IN ('customer_return','delivery_failed')),
 ADD COLUMN obligation text NOT NULL DEFAULT 'verify' CHECK(obligation IN ('required','not_required','verify')),
 ADD COLUMN obligation_verified boolean NOT NULL DEFAULT false, ADD COLUMN obligation_conflict boolean NOT NULL DEFAULT false,
 ADD COLUMN shipping_state text NOT NULL DEFAULT 'unknown',
 ADD COLUMN ordered_at timestamptz, ADD COLUMN cancelled_at timestamptz,
 ADD COLUMN platform_updated_at timestamptz, ADD COLUMN approved_at timestamptz,
 ADD COLUMN source_order_amount numeric(18,0), ADD COLUMN source_refund_amount numeric(18,0),
 ADD COLUMN source_goods_value numeric(18,0), ADD COLUMN source_refund_paid boolean NOT NULL DEFAULT false, ADD COLUMN source_refund_only boolean NOT NULL DEFAULT false,
 ADD COLUMN source_cancelled boolean NOT NULL DEFAULT false, ADD COLUMN financial_conflict boolean NOT NULL DEFAULT false,
 ADD COLUMN source_inactive boolean NOT NULL DEFAULT false,
 ADD COLUMN verification_status text NOT NULL DEFAULT 'pending', ADD COLUMN verification_result text NOT NULL DEFAULT '',
 ADD COLUMN inspected_at timestamptz, ADD COLUMN inspection_partial boolean NOT NULL DEFAULT false;
ALTER TABLE return_parcels ADD COLUMN excluded_manually boolean NOT NULL DEFAULT false;
UPDATE return_parcels SET excluded_manually=true WHERE NOT active;
ALTER TABLE return_items ADD COLUMN color text NOT NULL DEFAULT '', ADD COLUMN size text NOT NULL DEFAULT '', ADD COLUMN quality_condition text CHECK(quality_condition IN ('full','short','damaged','wrong','empty','swapped','missing_tag','used','dirty','torn','missing_accessory','other'));
ALTER TABLE return_claims ADD COLUMN parcel_id uuid REFERENCES return_parcels(id), ADD COLUMN claim_type text NOT NULL DEFAULT 'other',
 ADD COLUMN responsible_party text NOT NULL DEFAULT '', ADD COLUMN carrier_id uuid REFERENCES shipping_carriers(id),
 ADD COLUMN assigned_to uuid REFERENCES users(id), ADD COLUMN opened_at timestamptz, ADD COLUMN closed_at timestamptz;
UPDATE return_claims c SET opened_at=(SELECT min(e.created_at) FROM return_events e WHERE e.case_id=c.case_id AND e.action='claim' AND e.data->'after'->>'id'=c.id::text);
ALTER TABLE return_claims ALTER COLUMN opened_at SET DEFAULT now();
CREATE TABLE return_handover_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), warehouse_id uuid NOT NULL REFERENCES warehouses(id), carrier_id uuid REFERENCES shipping_carriers(id),
 courier_name text NOT NULL DEFAULT '', note text NOT NULL DEFAULT '', created_by uuid NOT NULL REFERENCES users(id),
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(), closed_at timestamptz, closed_by uuid REFERENCES users(id)
);
CREATE TABLE return_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), warehouse_id uuid NOT NULL REFERENCES warehouses(id),shop_id uuid REFERENCES shops(id),
 tracking_code text NOT NULL DEFAULT '', order_code text NOT NULL DEFAULT '', carrier_id uuid REFERENCES shipping_carriers(id),carrier_origin text NOT NULL DEFAULT 'unknown',
 case_id uuid REFERENCES return_cases(id),parcel_id uuid REFERENCES return_parcels(id),
 received_at timestamptz NOT NULL, recorded_by uuid NOT NULL REFERENCES users(id), employee_source text NOT NULL DEFAULT '',
 courier_name text NOT NULL DEFAULT '', note text NOT NULL DEFAULT '',source text NOT NULL CHECK(source IN ('scan','warehouse_file','legacy')),
 session_id uuid REFERENCES return_handover_sessions(id),shift_id uuid REFERENCES work_shifts(id),
 source_active boolean NOT NULL DEFAULT true,sku_evidence jsonb NOT NULL DEFAULT '[]',sku_evidence_import_id uuid REFERENCES data_jobs(id),match_state text NOT NULL DEFAULT 'unmatched' CHECK(match_state IN ('unmatched','matched','ambiguous','conflict')),
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(parcel_id),CHECK(tracking_code<>'' OR order_code<>'')
);
CREATE INDEX return_sessions_actor_time ON return_handover_sessions(created_by,started_at DESC,id);
CREATE INDEX return_receipts_session ON return_receipts(session_id,source_active,received_at,id);
CREATE INDEX return_receipts_actor_time ON return_receipts(recorded_by,received_at DESC,id);
CREATE INDEX return_receipts_warehouse_time ON return_receipts(warehouse_id,received_at DESC,id);
CREATE INDEX return_receipts_tracking ON return_receipts(warehouse_id,tracking_code);
CREATE INDEX return_receipts_case ON return_receipts(case_id,match_state,received_at);
CREATE INDEX return_receipts_order ON return_receipts(warehouse_id,order_code);
CREATE INDEX return_receipts_match ON return_receipts(match_state,received_at,id);
CREATE TABLE return_receipt_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),receipt_id uuid REFERENCES return_receipts(id),case_id uuid REFERENCES return_cases(id),
 actor_id uuid NOT NULL REFERENCES users(id),action text NOT NULL,reason text NOT NULL DEFAULT '',data jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX return_receipt_events_import ON return_receipt_events((data->>'importId'),receipt_id);
CREATE INDEX return_receipt_events_receipt ON return_receipt_events(receipt_id,created_at);
CREATE TABLE return_source_versions (
 case_id uuid NOT NULL REFERENCES return_cases(id),import_id uuid NOT NULL REFERENCES return_imports(id),
 rows_data jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(case_id,import_id)
);
CREATE TABLE return_import_archives (
 import_id uuid PRIMARY KEY REFERENCES return_imports(id), archived_by uuid NOT NULL REFERENCES users(id),
 archived_at timestamptz NOT NULL DEFAULT now(),reason text NOT NULL
);
CREATE TABLE return_intake_batches (
 id uuid PRIMARY KEY REFERENCES data_jobs(id),kind text NOT NULL CHECK(kind IN ('customer_return','delivery_failed','warehouse_receipt')),
 warehouse_id uuid NOT NULL REFERENCES warehouses(id),shop text NOT NULL,channel text NOT NULL,
 identity_hash text NOT NULL,headers jsonb NOT NULL,mapping jsonb NOT NULL DEFAULT '{}',
 total_rows integer NOT NULL CHECK(total_rows BETWEEN 1 AND 50000),staged_rows integer NOT NULL DEFAULT 0,
 imported_rows integer NOT NULL DEFAULT 0,state text NOT NULL DEFAULT 'staging',summary jsonb NOT NULL DEFAULT '{}',
 reused_batch_id uuid REFERENCES return_intake_batches(id),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX return_intake_identity ON return_intake_batches(identity_hash,state);
CREATE TABLE return_intake_rows (
 batch_id uuid NOT NULL REFERENCES return_intake_batches(id),row_number integer NOT NULL,raw jsonb NOT NULL,
 normalized jsonb,request_key text NOT NULL DEFAULT '',item_key text NOT NULL DEFAULT '',tracking_code text NOT NULL DEFAULT '',order_code text NOT NULL DEFAULT '',
 preview_source_hash text,error text NOT NULL DEFAULT '',duplicate boolean NOT NULL DEFAULT false,warnings jsonb NOT NULL DEFAULT '[]',imported boolean NOT NULL DEFAULT false,import_id uuid REFERENCES return_imports(id),
 PRIMARY KEY(batch_id,row_number)
);
CREATE INDEX return_intake_identity_rows ON return_intake_rows(batch_id,request_key,item_key);
CREATE INDEX return_intake_requests ON return_intake_rows(batch_id,imported,request_key,row_number);
CREATE TABLE return_media (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid REFERENCES return_cases(id),session_id uuid REFERENCES return_handover_sessions(id),
 storage_path text UNIQUE NOT NULL,filename text NOT NULL,mime text NOT NULL,file_size integer NOT NULL CHECK(file_size BETWEEN 1 AND 52428800),
 sha256 text NOT NULL,created_by uuid NOT NULL REFERENCES users(id),state text NOT NULL DEFAULT 'pending',created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(case_id IS NOT NULL OR session_id IS NOT NULL)
);
CREATE TABLE return_report_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),created_by uuid NOT NULL REFERENCES users(id),filters jsonb NOT NULL,total_rows integer NOT NULL DEFAULT 0,total_cases integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL DEFAULT now()+interval '1 day');
CREATE INDEX return_report_expiry ON return_report_sessions(expires_at);
CREATE TABLE return_report_rows(report_id uuid NOT NULL REFERENCES return_report_sessions(id) ON DELETE CASCADE,ordinal integer NOT NULL,carrier text NOT NULL,row_data jsonb NOT NULL,PRIMARY KEY(report_id,ordinal));
-- Capture the existing source and receipts once. Original columns/events are not
-- modified. Cases without receipts remain without physical receipt evidence.
INSERT INTO return_source_versions(case_id,import_id,rows_data,created_at)
 SELECT id,last_import_id,source_data,created_at FROM return_cases;
INSERT INTO return_receipts(warehouse_id,shop_id,tracking_code,order_code,carrier_id,case_id,parcel_id,received_at,recorded_by,source,match_state)
 SELECT r.warehouse_id,r.shop_id,p.tracking_code,r.order_code,p.carrier_id,r.id,p.id,p.received_at,p.received_by,'legacy','matched'
 FROM return_parcels p JOIN return_cases r ON r.id=p.case_id WHERE p.received_at IS NOT NULL;
-- Legacy files already contain normalized ISO dates / numeric monetary values.
-- Extract those exact values only; no guessed dates, identifiers or money.
WITH source AS (
 SELECT r.id,lower(regexp_replace(normalize(replace(r.platform_status||' '||r.platform_substatus||' '||r.return_type,'đ','d'),NFD),'[̀-ͯ]','','g')) text,
  bool_or(coalesce(x->'meta'->>'refundTime','')<>'') refund_paid,
  bool_or(coalesce(x->'meta'->>'shippedAt','')<>'' OR coalesce(x->'meta'->>'handedAt','')<>'' OR x->'meta'->>'handedOver'='true') handed,
  min(x->'meta'->>'orderedAt') FILTER(WHERE x->'meta'->>'orderedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$') ordered,
  max(x->'meta'->>'cancelledAt') FILTER(WHERE x->'meta'->>'cancelledAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$') cancelled,
  max(x->'meta'->>'platformUpdated') FILTER(WHERE x->'meta'->>'platformUpdated' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$') updated,
  min(x->'meta'->>'approvedAt') FILTER(WHERE x->'meta'->>'approvedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$') approved,
  array_agg(DISTINCT x->>'orderAmount') FILTER(WHERE x->>'orderAmount' ~ '^[0-9]{1,18}$') amounts,
  array_agg(DISTINCT x->'meta'->>'refundAmount') FILTER(WHERE x->'meta'->>'refundAmount' ~ '^[0-9]{1,18}$') refunds
 FROM return_cases r LEFT JOIN LATERAL jsonb_array_elements(r.source_data) x ON true GROUP BY r.id
), classified AS (
 SELECT s.*,text ~ '(refund[[:space:]]*only|chi hoan tien)' refund_only,
  text ~ '(return(ed|ing)[[:space:]]*(to[[:space:]]*(sender|seller)|in[[:space:]]*transit)|dang (hoan|trung chuyen|quay dau))' in_return_transit,
  text ~ '(lost|that lac)' reported_lost,
  text ~ '(awaiting[[:space:]]*(buyer|customer|shipment)|khach chua gui|cho khach gui)' awaiting
 FROM source s
)
UPDATE return_cases r SET ordered_at=c.ordered::timestamptz,cancelled_at=c.cancelled::timestamptz,platform_updated_at=c.updated::timestamptz,approved_at=c.approved::timestamptz,
 source_refund_paid=coalesce(c.refund_paid,false),source_refund_only=c.refund_only,source_cancelled=c.text ~ '(cancel|đa huy|da huy)',
 source_order_amount=CASE WHEN cardinality(c.amounts)=1 THEN c.amounts[1]::numeric END,
 source_refund_amount=CASE WHEN cardinality(c.refunds)=1 THEN c.refunds[1]::numeric END,
 financial_conflict=coalesce(cardinality(c.amounts)>1 OR cardinality(c.refunds)>1,false),
 obligation=CASE WHEN r.no_physical_return OR c.refund_only THEN 'not_required'
  WHEN c.text ~ '(reject|declin|refus|tu choi yeu cau|yeu cau bi huy)' OR (c.text ~ '(cancel|da huy)' AND NOT c.in_return_transit) THEN 'not_required'
  WHEN c.text ~ '(return|tra hang|hoan hang)' THEN 'required' ELSE 'verify' END,
 shipping_state=CASE WHEN c.reported_lost THEN 'reported_lost' WHEN c.in_return_transit THEN 'returning' WHEN c.awaiting THEN 'awaiting_customer' ELSE 'unknown' END
 FROM classified c WHERE c.id=r.id;
UPDATE return_cases r SET inspected_at=(SELECT max(created_at) FROM return_events e WHERE e.case_id=r.id AND e.action='inspect') WHERE inspection_status<>'pending';
-- Recover pre-source scans which the old app stored as "unknown" events. Keep
-- the first exact code/warehouse observation; do not replace existing receipts.
WITH first_unknown AS (
 SELECT DISTINCT ON (w.id,e.code) e.*,w.id warehouse_id
 FROM return_events e JOIN warehouses w ON w.id::text=e.data->'payload'->>'warehouseId'
 WHERE e.action='unknown' AND e.code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{3,79}$'
 AND NOT EXISTS(SELECT 1 FROM return_receipts r WHERE r.warehouse_id=w.id AND r.tracking_code=e.code)
 ORDER BY w.id,e.code,e.created_at,e.id
)
INSERT INTO return_receipts(warehouse_id,tracking_code,received_at,recorded_by,source,shift_id,note)
 SELECT warehouse_id,code,created_at,actor_id,'legacy',shift_id,'Khôi phục từ lượt nhận trước nguồn; cần đối chiếu chính xác' FROM first_unknown;
INSERT INTO return_receipt_events(receipt_id,case_id,actor_id,action,data,created_at)
 SELECT r.id,r.case_id,r.recorded_by,'legacy_evidence',jsonb_build_object('preservedTime',r.received_at,'source','legacy'),r.received_at FROM return_receipts r;
CREATE INDEX return_cases_workflow_scope ON return_cases(workflow,warehouse_id,requested_at,id);
CREATE INDEX return_cases_obligation_shipping ON return_cases(obligation,shipping_state,requested_at,id) WHERE NOT source_inactive;
CREATE INDEX return_cases_order_lookup ON return_cases(shop_id,order_code);
CREATE INDEX return_inspections_latest ON return_events(case_id,parcel_id,created_at DESC,id) WHERE action='inspect';
CREATE INDEX return_events_actor_time ON return_events(actor_id,created_at,id);
CREATE INDEX return_parcels_case_active ON return_parcels(case_id,active,received_at);
CREATE INDEX return_claims_case_status ON return_claims(case_id,status);
CREATE TRIGGER preserve_return_receipt_events BEFORE UPDATE OR DELETE ON return_receipt_events FOR EACH ROW EXECUTE FUNCTION deny_history_mutation();
CREATE TRIGGER preserve_return_source_versions BEFORE UPDATE OR DELETE ON return_source_versions FOR EACH ROW EXECUTE FUNCTION deny_history_mutation();
DO $secure_returns$
DECLARE t text; role_name text;
BEGIN
 FOREACH t IN ARRAY ARRAY['return_handover_sessions','return_receipts','return_receipt_events','return_source_versions','return_import_archives','return_intake_batches','return_intake_rows','return_media','return_report_sessions','return_report_rows'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',t);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',t,role_name); END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='comsflow_connection_check' AND NOT rolsuper AND NOT rolbypassrls) THEN
   IF t IN ('return_receipt_events','return_source_versions') THEN
    EXECUTE format('GRANT SELECT,INSERT ON TABLE public.%I TO comsflow_connection_check',t);
   ELSE
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.%I TO comsflow_connection_check',t);
   END IF;
   EXECUTE format('CREATE POLICY comsflow_server_access ON public.%I TO comsflow_connection_check USING (true) WITH CHECK (true)',t);
  END IF;
 END LOOP;
END $secure_returns$;
-- Shared carrier inference for SQL aggregates; configured/manual identities win.
CREATE FUNCTION return_operation_carrier(code text,source_name text,stored uuid,origin text) RETURNS uuid LANGUAGE sql STABLE AS $carrier$
 SELECT coalesce(
  CASE WHEN origin IN ('manual','verified') THEN stored END,
  (SELECT a.carrier_id FROM carrier_aliases a WHERE a.alias=lower(regexp_replace(normalize(coalesce(source_name,''),NFD),'[^a-zA-Z0-9]','','g')) LIMIT 1),
  (SELECT id FROM shipping_carriers WHERE lower(regexp_replace(normalize(name,NFD),'[^a-zA-Z0-9]','','g'))=lower(regexp_replace(normalize(coalesce(source_name,''),NFD),'[^a-zA-Z0-9]','','g')) LIMIT 1),
  (SELECT carrier_id FROM carrier_matching_rules WHERE active AND left(code,length(prefix))=prefix ORDER BY length(prefix) DESC LIMIT 1),
  CASE WHEN origin NOT IN ('prefix','format') THEN stored END,
  CASE WHEN NOT EXISTS(SELECT 1 FROM carrier_matching_rules WHERE NOT active AND left(code,length(prefix))=prefix) THEN
   (SELECT id FROM shipping_carriers WHERE name=CASE
    WHEN code ~ '^8[56][0-9]{10}$' THEN 'J&T Express'
    WHEN code ~ '^TTVN[0-9]{8,16}$' THEN 'BEST Express'
    WHEN code ~ '^SPXVN[0-9]{11}[A-Z]$' THEN 'SPX Express'
    WHEN code ~ '^(VNGH[0-9]{11}|G[A-Z0-9]{7})$' THEN 'GHN'
    WHEN code ~ '^VTPVN[0-9]{10}$' THEN 'Viettel Post' END LIMIT 1)
  END
 )
$carrier$;
REVOKE ALL ON FUNCTION return_operation_carrier(text,text,uuid,text) FROM PUBLIC;
CREATE VIEW return_operation_rows WITH(security_invoker=true) AS
WITH facts AS (
 SELECT r.*,sh.name shop,ch.name channel,w.name warehouse,u.name assigned_employee,
  i.expected_quantity,i.received_quantity,(i.quantity_known AND NOT r.inspection_partial AND (r.inspection_status<>'pending' OR (p.received_parcels=p.parcels AND rr.quantity_parcels=p.parcels AND rr.quantity_orders=rr.order_receipts))) quantity_known,i.goods_value item_goods_value,i.item_count,
  p.parcels,p.received_parcels,p.tracking_codes,p.carrier_keys,p.last_received_at,
  rr.receipts,rr.last_receipt_at,
  cl.open_claims,cl.resolved_claims,cl.requested_compensation,cl.approved_compensation,cl.received_compensation,
  coalesce(r.no_physical_return OR r.obligation='not_required',false) no_return_required,
  (p.received_parcels>0 OR rr.receipts>0) has_receipt,
  (r.financial_conflict OR coalesce(p.carrier_conflict,false) OR r.obligation_conflict OR r.obligation='verify' OR r.verification_status IN ('source_rebuild_pending','source_conflict') OR cardinality(p.carrier_keys)>1 OR EXISTS(SELECT 1 FROM return_parcels own JOIN return_parcels other ON other.tracking_code=own.tracking_code AND other.case_id<>own.case_id AND other.active JOIN return_cases oc ON oc.id=other.case_id AND NOT oc.source_inactive WHERE own.case_id=r.id AND own.active)) data_conflict
 FROM return_cases r JOIN shops sh ON sh.id=r.shop_id JOIN sales_channels ch ON ch.id=sh.channel_id JOIN warehouses w ON w.id=r.warehouse_id LEFT JOIN users u ON u.id=r.assigned_to
 CROSS JOIN LATERAL (SELECT count(*)::int item_count,coalesce(sum(expected_qty),0)::int expected_quantity,
  coalesce(sum(received_qty),0)::int received_quantity,count(received_qty)=count(*) AND count(*)>0 quantity_known,
  CASE WHEN count(unit_amount)=count(*) AND count(*)>0 THEN sum(unit_amount*expected_qty) ELSE NULL END goods_value
  FROM return_items WHERE case_id=r.id AND active) i
 CROSS JOIN LATERAL (SELECT count(*)::int parcels,count(*) FILTER(WHERE received_at IS NOT NULL)::int received_parcels,
  coalesce(string_agg(tracking_code,', ' ORDER BY tracking_code),'') tracking_codes,
  coalesce(array_agg(DISTINCT coalesce(coalesce(CASE WHEN carrier_origin IN ('manual','verified','file') THEN carrier_id WHEN carrier_origin IN ('prefix','format') AND NOT EXISTS(SELECT 1 FROM carrier_matching_rules) THEN carrier_id END,return_operation_carrier(upper(tracking_code),source_carrier,carrier_id,carrier_origin))::text,'unknown')),'{}'::text[]) carrier_keys,
  max(received_at) last_received_at,bool_or(carrier_conflict AND carrier_origin<>'manual') carrier_conflict FROM return_parcels WHERE case_id=r.id AND active) p
 CROSS JOIN LATERAL (SELECT count(*)::int receipts,max(received_at) last_receipt_at,count(*) FILTER(WHERE parcel_id IS NOT NULL AND jsonb_array_length(sku_evidence)>0 AND EXISTS(SELECT 1 FROM return_parcels qp WHERE qp.id=parcel_id AND qp.active))::int quantity_parcels,count(*) FILTER(WHERE parcel_id IS NULL)::int order_receipts,count(*) FILTER(WHERE parcel_id IS NULL AND jsonb_array_length(sku_evidence)>0)::int quantity_orders FROM return_receipts WHERE case_id=r.id AND match_state='matched' AND source_active) rr
 CROSS JOIN LATERAL (SELECT count(*) FILTER(WHERE status IN ('open','submitted','won'))::int open_claims,
  count(*) FILTER(WHERE status IN ('paid','lost','closed'))::int resolved_claims,
  coalesce(sum(requested_amount),0) requested_compensation,coalesce(sum(approved_amount),0) approved_compensation,
  coalesce(sum(received_amount) FILTER(WHERE received_on IS NOT NULL),0) received_compensation FROM return_claims WHERE case_id=r.id) cl
), classified AS (
 SELECT f.*,
  coalesce(source_goods_value,item_goods_value) goods_value,
  CASE WHEN cardinality(carrier_keys)=0 THEN 'no_tracking' WHEN cardinality(carrier_keys)>1 THEN 'mixed' ELSE carrier_keys[1] END carrier_key,
  (has_receipt AND quantity_known AND received_quantity=expected_quantity AND received_parcels=parcels AND NOT inspection_stale AND NOT data_conflict) received_full,
  (has_receipt AND (inspection_status IN ('short','damaged','wrong','empty','swapped','missing_tag','used','dirty','torn','missing_accessory','other') OR (quantity_known AND received_quantity<expected_quantity))) has_goods_problem,
  CASE WHEN processing_status IN ('completed','compensated','closed_unsuccessful') THEN 'closed'
   WHEN processing_status='lost' THEN 'lost'
   WHEN no_return_required AND NOT has_receipt THEN 'not_required'
   WHEN data_conflict OR (no_return_required AND has_receipt) THEN 'verify'
   WHEN has_receipt THEN 'received'
   WHEN shipping_state='returning' THEN 'in_transit'
   WHEN shipping_state='awaiting_customer' THEN 'awaiting_customer'
   WHEN shipping_state='reported_lost' OR processing_status='suspected_lost' THEN 'suspected_lost'
   WHEN obligation='required' THEN 'needs_check' ELSE 'verify' END primary_state
 FROM facts f
)
SELECT c.*,coalesce(sc.name,CASE carrier_key WHEN 'unknown' THEN 'Chưa xác định' WHEN 'no_tracking' THEN 'Chưa có mã vận đơn' WHEN 'mixed' THEN 'Nhiều hãng / cần xác minh' ELSE 'Chưa xác định' END) carrier,
 (NOT has_receipt AND NOT no_return_required AND expected_at< (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) overdue
 FROM classified c LEFT JOIN shipping_carriers sc ON sc.id::text=c.carrier_key;
REVOKE ALL ON return_operation_rows FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='comsflow_connection_check' AND NOT rolsuper AND NOT rolbypassrls) THEN
  GRANT EXECUTE ON FUNCTION return_operation_carrier(text,text,uuid,text) TO comsflow_connection_check;
  GRANT SELECT ON return_operation_rows TO comsflow_connection_check;
 END IF;
END $$;

-- Preserve the existing inspection codes and add more detailed issue classes.
ALTER TABLE return_cases DROP CONSTRAINT IF EXISTS return_cases_inspection_status_check;
ALTER TABLE return_cases ADD CONSTRAINT return_cases_inspection_status_check CHECK(inspection_status IN ('pending','full','short','damaged','wrong','empty','swapped','missing_tag','used','dirty','torn','missing_accessory','other'));
DO $media_bucket$ BEGIN
 IF to_regclass('storage.buckets') IS NOT NULL THEN
  UPDATE storage.buckets SET allowed_mime_types=ARRAY(SELECT DISTINCT unnest(coalesce(allowed_mime_types,'{}'::text[])||ARRAY['image/jpeg','image/png','image/webp','application/pdf','video/mp4','video/webm'])),file_size_limit=greatest(coalesce(file_size_limit,0),52428800),public=false WHERE id='comsflow-private';
 END IF;
END $media_bucket$;

$upgrade_4207d1e0b88def8a$;
  INSERT INTO public.schema_migrations(name,checksum) VALUES('020_return_operations.sql','4207d1e0b88def8a3130fa53ef6aedf86ba2bc1f5f66e12e9889d75fb7f5ad7f') ON CONFLICT(name) DO NOTHING;
 END IF;
END $apply_upgrade$;
COMMIT;
SELECT to_regclass('public.effective_scan_events') IS NOT NULL AS prescan_ready,to_regclass('public.return_operation_rows') IS NOT NULL AS return_operations_ready;
