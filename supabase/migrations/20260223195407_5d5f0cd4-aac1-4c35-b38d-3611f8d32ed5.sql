
ALTER TABLE public.nina_settings ADD COLUMN IF NOT EXISTS webhook_api_key text DEFAULT NULL;
