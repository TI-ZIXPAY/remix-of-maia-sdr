
-- 1. Create uazapi_instances table
CREATE TABLE public.uazapi_instances (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Principal',
  endpoint TEXT NOT NULL,
  session TEXT,
  sessionkey TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  phone_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.uazapi_instances ENABLE ROW LEVEL SECURITY;

-- Admins can manage
CREATE POLICY "Admins can manage uazapi_instances"
  ON public.uazapi_instances FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Authenticated can read
CREATE POLICY "Authenticated can read uazapi_instances"
  ON public.uazapi_instances FOR SELECT
  USING (true);

-- Service role can manage (for edge functions)
CREATE POLICY "Service can manage uazapi_instances"
  ON public.uazapi_instances FOR ALL
  USING (true)
  WITH CHECK (true);

-- 2. Add uazapi_instance_id to contacts
ALTER TABLE public.contacts
  ADD COLUMN uazapi_instance_id UUID REFERENCES public.uazapi_instances(id) ON DELETE SET NULL;

-- 3. Updated_at trigger for uazapi_instances
CREATE TRIGGER update_uazapi_instances_updated_at
  BEFORE UPDATE ON public.uazapi_instances
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Migrate existing data from nina_settings (if configured)
INSERT INTO public.uazapi_instances (name, endpoint, session, sessionkey)
SELECT 
  'Principal',
  ns.uazapi_endpoint,
  ns.uazapi_session,
  ns.uazapi_sessionkey
FROM public.nina_settings ns
WHERE ns.uazapi_endpoint IS NOT NULL 
  AND ns.uazapi_sessionkey IS NOT NULL
LIMIT 1;
