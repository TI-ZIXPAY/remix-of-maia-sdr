ALTER TABLE public.nina_settings DROP CONSTRAINT nina_settings_ai_model_mode_check;

ALTER TABLE public.nina_settings ADD CONSTRAINT nina_settings_ai_model_mode_check CHECK (ai_model_mode IN ('flash', 'flash3', 'pro', 'pro3', 'adaptive'));