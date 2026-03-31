
-- Add unique constraint on contact_id in deals table to prevent duplicate cards
-- Only one deal per contact is allowed
CREATE UNIQUE INDEX IF NOT EXISTS deals_contact_id_unique ON public.deals (contact_id) WHERE contact_id IS NOT NULL;
