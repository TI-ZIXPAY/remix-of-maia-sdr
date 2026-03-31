
-- Add is_question and webhook_on_negative_id to followup_steps
ALTER TABLE public.followup_steps
  ADD COLUMN is_question boolean NOT NULL DEFAULT false,
  ADD COLUMN webhook_on_negative_id uuid REFERENCES public.webhook_endpoints(id) ON DELETE SET NULL;

-- Add reply_status to followup_executions
ALTER TABLE public.followup_executions
  ADD COLUMN reply_status text;
