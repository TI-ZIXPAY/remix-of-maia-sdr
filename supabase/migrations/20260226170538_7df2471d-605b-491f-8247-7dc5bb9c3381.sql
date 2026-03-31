
-- Add webhook_endpoint_id to followup_steps (webhook per step column)
ALTER TABLE public.followup_steps
ADD COLUMN webhook_endpoint_id uuid REFERENCES public.webhook_endpoints(id) ON DELETE SET NULL;

-- Add webhook columns to followup_sequences for special columns (Concluído, Cancelado)
ALTER TABLE public.followup_sequences
ADD COLUMN webhook_on_completed_id uuid REFERENCES public.webhook_endpoints(id) ON DELETE SET NULL,
ADD COLUMN webhook_on_cancelled_id uuid REFERENCES public.webhook_endpoints(id) ON DELETE SET NULL;
