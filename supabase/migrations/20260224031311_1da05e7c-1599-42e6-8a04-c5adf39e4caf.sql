
-- Tabela de closers do Calendly para agendamento multi-closer
CREATE TABLE public.calendly_closers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  calendly_user_uri text,
  calendly_event_type_uri text NOT NULL,
  priority integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  user_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.calendly_closers ENABLE ROW LEVEL SECURITY;

-- Admins can manage
CREATE POLICY "Admins can manage calendly_closers"
ON public.calendly_closers
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Authenticated can read
CREATE POLICY "Authenticated can read calendly_closers"
ON public.calendly_closers
FOR SELECT
USING (true);

-- Trigger for updated_at
CREATE TRIGGER update_calendly_closers_updated_at
BEFORE UPDATE ON public.calendly_closers
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
