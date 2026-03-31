ALTER TABLE nina_settings 
ADD COLUMN IF NOT EXISTS city text,
ADD COLUMN IF NOT EXISTS broker_name text,
ADD COLUMN IF NOT EXISTS broker_phone text;