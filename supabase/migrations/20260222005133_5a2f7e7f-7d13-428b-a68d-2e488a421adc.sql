
-- =============================================
-- FOLLOW-UP SEQUENCES (templates de fluxo)
-- =============================================
CREATE TABLE public.followup_sequences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  trigger_event TEXT NOT NULL DEFAULT 'appointment_scheduled',
  is_active BOOLEAN NOT NULL DEFAULT true,
  user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.followup_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage followup_sequences"
  ON public.followup_sequences FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated can read followup_sequences"
  ON public.followup_sequences FOR SELECT
  USING (true);

CREATE TRIGGER update_followup_sequences_updated_at
  BEFORE UPDATE ON public.followup_sequences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- FOLLOW-UP STEPS (passos com timing e mensagem)
-- =============================================
CREATE TABLE public.followup_steps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sequence_id UUID NOT NULL REFERENCES public.followup_sequences(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL DEFAULT 1,
  delay_minutes INTEGER NOT NULL DEFAULT -1440,
  message_template TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.followup_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage followup_steps"
  ON public.followup_steps FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated can read followup_steps"
  ON public.followup_steps FOR SELECT
  USING (true);

CREATE TRIGGER update_followup_steps_updated_at
  BEFORE UPDATE ON public.followup_steps
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- FOLLOW-UP EXECUTIONS (controle de execução)
-- =============================================
CREATE TABLE public.followup_executions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  step_id UUID NOT NULL REFERENCES public.followup_steps(id) ON DELETE CASCADE,
  appointment_id UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  scheduled_for TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.followup_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage followup_executions"
  ON public.followup_executions FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated can read followup_executions"
  ON public.followup_executions FOR SELECT
  USING (true);

CREATE POLICY "Service can manage followup_executions"
  ON public.followup_executions FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER update_followup_executions_updated_at
  BEFORE UPDATE ON public.followup_executions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Index for cron performance
CREATE INDEX idx_followup_executions_scheduled 
  ON public.followup_executions (scheduled_for, status) 
  WHERE status = 'scheduled';

CREATE INDEX idx_followup_executions_appointment 
  ON public.followup_executions (appointment_id);
