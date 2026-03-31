
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS utm_source text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS utm_medium text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS utm_campaign text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS utm_term text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS utm_content text;
