
ALTER TABLE public.team_members ADD COLUMN external_id text NULL;
COMMENT ON COLUMN public.team_members.external_id IS 'ID do membro no CRM externo';
