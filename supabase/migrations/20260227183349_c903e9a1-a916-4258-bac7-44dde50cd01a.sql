
ALTER TABLE public.nina_settings ADD COLUMN IF NOT EXISTS business_hours_24h boolean NOT NULL DEFAULT false;
