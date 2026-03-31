
-- Add field mapping columns to scoring_variables for rule-based scoring
ALTER TABLE public.scoring_variables 
  ADD COLUMN field_key TEXT DEFAULT NULL,
  ADD COLUMN match_condition TEXT DEFAULT 'not_empty',
  ADD COLUMN match_value TEXT DEFAULT NULL;

-- match_condition options:
-- 'not_empty' = any non-empty value triggers the score
-- 'equals' = value must equal match_value exactly
-- 'contains' = value must contain match_value
-- 'not_equals' = value must NOT equal match_value
