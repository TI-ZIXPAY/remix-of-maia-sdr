
-- Tabela de definições de campos personalizados
CREATE TABLE public.contact_custom_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_key TEXT NOT NULL UNIQUE,
  field_label TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text',
  options JSONB DEFAULT '[]'::jsonb,
  is_required BOOLEAN DEFAULT false,
  position INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  user_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.contact_custom_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage contact_custom_fields"
ON public.contact_custom_fields FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated can read contact_custom_fields"
ON public.contact_custom_fields FOR SELECT
USING (true);

-- Tabela de valores dos campos por contato
CREATE TABLE public.contact_custom_field_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  field_id UUID NOT NULL REFERENCES public.contact_custom_fields(id) ON DELETE CASCADE,
  value TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(contact_id, field_id)
);

ALTER TABLE public.contact_custom_field_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can manage contact_custom_field_values"
ON public.contact_custom_field_values FOR ALL
USING (auth.role() = 'authenticated'::text)
WITH CHECK (auth.role() = 'authenticated'::text);

-- Trigger de updated_at
CREATE TRIGGER update_contact_custom_fields_updated_at
BEFORE UPDATE ON public.contact_custom_fields
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_contact_custom_field_values_updated_at
BEFORE UPDATE ON public.contact_custom_field_values
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
