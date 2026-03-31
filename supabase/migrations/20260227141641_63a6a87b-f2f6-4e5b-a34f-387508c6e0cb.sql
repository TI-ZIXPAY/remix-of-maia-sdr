
ALTER TABLE public.contacts
ADD COLUMN follow_up_status text NOT NULL DEFAULT 'nao_agendado';

COMMENT ON COLUMN public.contacts.follow_up_status IS 'Status de follow-up mapeado aos eventos do Calendly: nao_agendado, agendado, cancelado, no_show';
