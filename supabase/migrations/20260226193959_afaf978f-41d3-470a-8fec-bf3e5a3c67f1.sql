
-- Add handoff_summary column to conversations
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS handoff_summary text;
