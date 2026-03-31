
ALTER TABLE public.messages 
ADD COLUMN IF NOT EXISTS transcription_text text,
ADD COLUMN IF NOT EXISTS transcription_status text NOT NULL DEFAULT 'idle',
ADD COLUMN IF NOT EXISTS transcription_error text;
