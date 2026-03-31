-- Add auto greeting settings to nina_settings
ALTER TABLE public.nina_settings
  ADD COLUMN IF NOT EXISTS auto_greeting_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_greeting_message text DEFAULT 'Olá! 👋 Vi que você demonstrou interesse. Como posso te ajudar?';

-- Enable pg_net extension for HTTP calls from triggers
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Create function to trigger auto-greeting edge function on new deal
CREATE OR REPLACE FUNCTION public.trigger_auto_greeting_on_deal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only trigger for new deals that have a contact_id
  IF NEW.contact_id IS NOT NULL THEN
    PERFORM extensions.http_post(
      url := current_setting('app.settings.supabase_url', true) || '/functions/v1/auto-greeting',
      body := json_build_object(
        'deal_id', NEW.id,
        'contact_id', NEW.contact_id,
        'user_id', NEW.user_id
      )::text,
      headers := json_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      )::text
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Don't block deal creation if greeting fails
  RAISE WARNING 'Auto greeting trigger failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- Create trigger on deals table
DROP TRIGGER IF EXISTS auto_greeting_on_deal_insert ON public.deals;
CREATE TRIGGER auto_greeting_on_deal_insert
  AFTER INSERT ON public.deals
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_auto_greeting_on_deal();
