-- Add handoff configuration fields
ALTER TABLE public.nina_settings 
ADD COLUMN IF NOT EXISTS handoff_timeout_minutes integer NOT NULL DEFAULT 15,
ADD COLUMN IF NOT EXISTS handoff_webhook_endpoint_id uuid REFERENCES public.webhook_endpoints(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS handoff_team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL;