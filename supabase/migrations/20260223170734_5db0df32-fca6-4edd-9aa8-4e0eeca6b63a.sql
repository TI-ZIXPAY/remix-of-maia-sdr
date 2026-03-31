ALTER TABLE public.nina_settings
  ADD COLUMN IF NOT EXISTS auto_greeting_messages JSONB DEFAULT '[]'::jsonb;