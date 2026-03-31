-- Add lead scoring fields to contacts table
ALTER TABLE public.contacts 
ADD COLUMN IF NOT EXISTS lead_score integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS lead_classification text DEFAULT 'new',
ADD COLUMN IF NOT EXISTS lead_score_breakdown jsonb DEFAULT '{
  "origin": {"points": 0, "reason": null},
  "contact_completeness": {"points": 0, "reason": null},
  "fit": {"points": 0, "reason": null},
  "maturity": {"points": 0, "reason": null},
  "value_potential": {"points": 0, "reason": null},
  "intent_signals": {"points": 0, "reason": null}
}'::jsonb,
ADD COLUMN IF NOT EXISTS lead_score_updated_at timestamp with time zone;

-- Add constraint for valid classifications
ALTER TABLE public.contacts 
ADD CONSTRAINT valid_lead_classification 
CHECK (lead_classification IN ('new', 'dq', 'nutricao', 'pre_mql', 'mql', 'sql'));

-- Create index for quick filtering by classification
CREATE INDEX IF NOT EXISTS idx_contacts_lead_classification ON public.contacts(lead_classification);
CREATE INDEX IF NOT EXISTS idx_contacts_lead_score ON public.contacts(lead_score DESC);

-- Add comment for documentation
COMMENT ON COLUMN public.contacts.lead_score IS 'Total lead score (0-100+)';
COMMENT ON COLUMN public.contacts.lead_classification IS 'Lead classification: new, dq, nutricao, pre_mql, mql, sql';
COMMENT ON COLUMN public.contacts.lead_score_breakdown IS 'Detailed breakdown of points per criteria';