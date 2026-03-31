ALTER TABLE public.nina_settings ADD COLUMN IF NOT EXISTS calendly_enabled boolean DEFAULT false;
ALTER TABLE public.nina_settings ADD COLUMN IF NOT EXISTS calendly_event_type_uri text;
ALTER TABLE public.nina_settings ADD COLUMN IF NOT EXISTS calendly_scheduling_url text;