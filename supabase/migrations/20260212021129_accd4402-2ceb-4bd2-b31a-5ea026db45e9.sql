
ALTER TABLE public.nina_settings
  ADD COLUMN google_calendar_client_id text,
  ADD COLUMN google_calendar_client_secret text,
  ADD COLUMN google_calendar_refresh_token text,
  ADD COLUMN google_calendar_id text DEFAULT 'primary',
  ADD COLUMN google_calendar_enabled boolean DEFAULT false;
