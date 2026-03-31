-- Adiciona campos para suportar Uazapi como alternativa ao WhatsApp Cloud API
ALTER TABLE public.nina_settings
ADD COLUMN IF NOT EXISTS whatsapp_provider text NOT NULL DEFAULT 'cloud' CHECK (whatsapp_provider IN ('cloud', 'uazapi')),
ADD COLUMN IF NOT EXISTS uazapi_endpoint text,
ADD COLUMN IF NOT EXISTS uazapi_session text,
ADD COLUMN IF NOT EXISTS uazapi_sessionkey text;

-- Comentários para documentação
COMMENT ON COLUMN public.nina_settings.whatsapp_provider IS 'Provedor de WhatsApp: cloud (Meta Cloud API) ou uazapi';
COMMENT ON COLUMN public.nina_settings.uazapi_endpoint IS 'URL base do endpoint Uazapi (ex: https://seuservidor.uazapi.com)';
COMMENT ON COLUMN public.nina_settings.uazapi_session IS 'Nome da sessão no Uazapi';
COMMENT ON COLUMN public.nina_settings.uazapi_sessionkey IS 'Session key para autenticação no Uazapi';