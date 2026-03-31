-- 2. Recriar triggers de automação

-- Trigger: auto_create_deal_on_contact (cria deal automaticamente quando contato é criado)
CREATE OR REPLACE FUNCTION public.auto_create_deal_on_contact()
RETURNS TRIGGER AS $$
DECLARE
  first_stage_id uuid;
BEGIN
  -- Buscar o primeiro estágio ativo do pipeline
  SELECT id INTO first_stage_id
  FROM public.pipeline_stages
  WHERE is_active = true
  ORDER BY position ASC
  LIMIT 1;

  -- Se encontrou um estágio, criar o deal
  IF first_stage_id IS NOT NULL THEN
    INSERT INTO public.deals (contact_id, title, stage_id, user_id)
    VALUES (NEW.id, COALESCE(NEW.name, NEW.phone_number), first_stage_id, NEW.user_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS auto_create_deal_on_contact ON public.contacts;
CREATE TRIGGER auto_create_deal_on_contact
  AFTER INSERT ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_create_deal_on_contact();

-- Trigger: update_conversation_last_message (atualiza timestamps de conversas e contatos)
CREATE OR REPLACE FUNCTION public.update_conversation_last_message()
RETURNS TRIGGER AS $$
BEGIN
  -- Atualizar last_message_at na conversa
  UPDATE public.conversations
  SET last_message_at = NEW.sent_at,
      updated_at = now()
  WHERE id = NEW.conversation_id;

  -- Atualizar last_activity no contato
  UPDATE public.contacts
  SET last_activity = NEW.sent_at,
      updated_at = now()
  WHERE id = (
    SELECT contact_id FROM public.conversations WHERE id = NEW.conversation_id
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS update_conversation_last_message_trigger ON public.messages;
CREATE TRIGGER update_conversation_last_message_trigger
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_conversation_last_message();

-- Triggers updated_at para tabelas relevantes
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- contacts
DROP TRIGGER IF EXISTS update_contacts_updated_at ON public.contacts;
CREATE TRIGGER update_contacts_updated_at
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- conversations
DROP TRIGGER IF EXISTS update_conversations_updated_at ON public.conversations;
CREATE TRIGGER update_conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- conversation_states
DROP TRIGGER IF EXISTS update_conversation_states_updated_at ON public.conversation_states;
CREATE TRIGGER update_conversation_states_updated_at
  BEFORE UPDATE ON public.conversation_states
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- nina_processing_queue
DROP TRIGGER IF EXISTS update_nina_processing_queue_updated_at ON public.nina_processing_queue;
CREATE TRIGGER update_nina_processing_queue_updated_at
  BEFORE UPDATE ON public.nina_processing_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- message_processing_queue
DROP TRIGGER IF EXISTS update_message_processing_queue_updated_at ON public.message_processing_queue;
CREATE TRIGGER update_message_processing_queue_updated_at
  BEFORE UPDATE ON public.message_processing_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- send_queue
DROP TRIGGER IF EXISTS update_send_queue_updated_at ON public.send_queue;
CREATE TRIGGER update_send_queue_updated_at
  BEFORE UPDATE ON public.send_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- nina_settings
DROP TRIGGER IF EXISTS update_nina_settings_updated_at ON public.nina_settings;
CREATE TRIGGER update_nina_settings_updated_at
  BEFORE UPDATE ON public.nina_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- tag_definitions
DROP TRIGGER IF EXISTS update_tag_definitions_updated_at ON public.tag_definitions;
CREATE TRIGGER update_tag_definitions_updated_at
  BEFORE UPDATE ON public.tag_definitions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();