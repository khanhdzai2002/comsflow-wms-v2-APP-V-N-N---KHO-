-- Run only in project lyeyjfvxmqruszgfrjze, using Supabase SQL Editor.
-- First create/confirm the chosen user in Authentication > Users.
-- Replace the placeholder below with that user's email. No password goes here.
BEGIN;
DO $admin$
DECLARE
  owner_email text := 'THAY_EMAIL_VUA_TAO';
  selected_user public.users%ROWTYPE;
BEGIN
  owner_email := lower(btrim(owner_email));
  IF position('@' IN owner_email) < 2 THEN
    RAISE EXCEPTION 'Replace THAY_EMAIL_VUA_TAO with the email created in Supabase Authentication';
  END IF;
  IF current_database() <> 'postgres' OR NOT EXISTS (
    SELECT 1 FROM public.schema_migrations WHERE name='017_job_storage_cleanup.sql'
  ) THEN
    RAISE EXCEPTION 'Select the ComsFlow Supabase project first';
  END IF;
  PERFORM pg_advisory_xact_lock(742925);
  SELECT u.* INTO STRICT selected_user
  FROM public.users u JOIN auth.users a ON a.id=u.auth_user_id
  WHERE lower(a.email)=owner_email AND lower(u.email)=owner_email
    AND a.email_confirmed_at IS NOT NULL
  FOR UPDATE OF u;
  IF EXISTS (
    SELECT 1 FROM public.users WHERE role='admin' AND active AND id<>selected_user.id
  ) THEN
    RAISE EXCEPTION 'Another active administrator already exists; recover that account instead';
  END IF;
  IF selected_user.role='admin' AND selected_user.active THEN RETURN; END IF;
  UPDATE public.users SET role='admin',active=true WHERE id=selected_user.id;
  INSERT INTO public.audit_logs(user_id,action,entity_id,before_value,after_value,reason)
  VALUES(selected_user.id,'setup_admin',selected_user.id::text,
    jsonb_build_object('role',selected_user.role,'active',selected_user.active),
    jsonb_build_object('role','admin','active',true),
    'Project owner provisioned first administrator via Supabase SQL Editor');
EXCEPTION
  WHEN no_data_found THEN
    RAISE EXCEPTION 'No confirmed linked user found. Check the email and Auto Confirm User in Supabase Authentication';
  WHEN too_many_rows THEN
    RAISE EXCEPTION 'Ambiguous account match; review the selected email before granting access';
END
$admin$;
COMMIT;
SELECT 'Admin ready: sign in with the email and password set in Supabase Authentication' AS status;
