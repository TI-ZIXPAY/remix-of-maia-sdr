
-- Tabela de variáveis de pontuação para a IA
CREATE TABLE public.scoring_variables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  score INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  position INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.scoring_variables ENABLE ROW LEVEL SECURITY;

-- Admins can CRUD
CREATE POLICY "Admins can manage scoring_variables"
ON public.scoring_variables
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Authenticated can read
CREATE POLICY "Authenticated can read scoring_variables"
ON public.scoring_variables
FOR SELECT
USING (true);
