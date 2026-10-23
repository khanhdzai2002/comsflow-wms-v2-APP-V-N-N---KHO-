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
