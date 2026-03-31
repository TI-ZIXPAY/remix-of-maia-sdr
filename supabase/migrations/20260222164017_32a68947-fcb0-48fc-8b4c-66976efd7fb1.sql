-- Fix the trigger function to use net.http_post (pg_net's correct API)
CREATE OR REPLACE FUNCTION public.trigger_auto_greeting_on_deal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  supabase_url text;
  service_key text;
BEGIN
  -- Only trigger for new deals that have a contact_id
  IF NEW.contact_id IS NOT NULL THEN
    -- Get Supabase URL and service key from vault/settings
    SELECT decrypted_secret INTO supabase_url FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1;
    SELECT decrypted_secret INTO service_key FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1;
    
    IF supabase_url IS NOT NULL AND service_key IS NOT NULL THEN
      PERFORM net.http_post(
        url := supabase_url || '/functions/v1/auto-greeting',
        body := jsonb_build_object(
          'deal_id', NEW.id,
          'contact_id', NEW.contact_id,
          'user_id', NEW.user_id
        ),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || service_key
        )
      );
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Don't block deal creation if greeting fails
  RAISE WARNING 'Auto greeting trigger failed: %', SQLERRM;
  RETURN NEW;
END;
$$;
