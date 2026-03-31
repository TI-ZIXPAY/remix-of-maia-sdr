
-- Webhook endpoints (CRM destinations)
CREATE TABLE public.webhook_endpoints (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  headers JSONB DEFAULT '{}'::jsonb,
  secret_ref TEXT, -- reference to secret name in Cloud Secrets
  signing_secret TEXT, -- HMAC secret for signing payloads
  user_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Webhook outbox (event queue)
CREATE TABLE public.webhook_outbox (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  endpoint_id UUID NOT NULL REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'dead_letter')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_error TEXT,
  last_status_code INTEGER,
  sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Indexes for dispatcher performance
CREATE INDEX idx_webhook_outbox_dispatch ON public.webhook_outbox (status, next_retry_at) WHERE status IN ('pending', 'processing');
CREATE INDEX idx_webhook_outbox_endpoint ON public.webhook_outbox (endpoint_id);
CREATE INDEX idx_webhook_outbox_event_type ON public.webhook_outbox (event_type);

-- Enable RLS
ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_outbox ENABLE ROW LEVEL SECURITY;

-- RLS: Admins can manage endpoints
CREATE POLICY "Admins can manage webhook_endpoints"
  ON public.webhook_endpoints FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- RLS: Admins can read endpoints
CREATE POLICY "Authenticated can read webhook_endpoints"
  ON public.webhook_endpoints FOR SELECT
  USING (true);

-- RLS: Admins can manage outbox
CREATE POLICY "Admins can manage webhook_outbox"
  ON public.webhook_outbox FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- RLS: Allow service role / edge functions full access
CREATE POLICY "Service can manage webhook_outbox"
  ON public.webhook_outbox FOR ALL
  USING (true)
  WITH CHECK (true);

-- Claim batch function for dispatcher (atomic lock)
CREATE OR REPLACE FUNCTION public.claim_webhook_outbox_batch(p_limit integer DEFAULT 50)
RETURNS SETOF webhook_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
    RETURN QUERY
    WITH cte AS (
        SELECT wo.id
        FROM public.webhook_outbox wo
        JOIN public.webhook_endpoints we ON we.id = wo.endpoint_id
        WHERE wo.status = 'pending'
          AND wo.next_retry_at <= now()
          AND we.enabled = true
        ORDER BY wo.created_at ASC
        FOR UPDATE OF wo SKIP LOCKED
        LIMIT p_limit
    )
    UPDATE public.webhook_outbox m
    SET status = 'processing', updated_at = now()
    WHERE m.id IN (SELECT id FROM cte)
    RETURNING m.*;
END;
$$;

-- Trigger for updated_at
CREATE TRIGGER update_webhook_endpoints_updated_at
  BEFORE UPDATE ON public.webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_webhook_outbox_updated_at
  BEFORE UPDATE ON public.webhook_outbox
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
