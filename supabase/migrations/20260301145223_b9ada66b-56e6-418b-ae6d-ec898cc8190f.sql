
-- 1) Update get_deals_needing_greeting to compare normalized phone (digits only)
CREATE OR REPLACE FUNCTION public.get_deals_needing_greeting()
 RETURNS TABLE(id uuid, contact_id uuid, user_id uuid)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT d.id, d.contact_id, d.user_id
  FROM public.deals d
  JOIN public.contacts ct ON ct.id = d.contact_id
  WHERE d.contact_id IS NOT NULL
    AND d.created_at <= now() - (
      SELECT COALESCE(
        (SELECT (ns.auto_greeting_delay_minutes || ' minutes')::interval FROM public.nina_settings ns LIMIT 1),
        interval '10 minutes'
      )
    )
    -- Check by contact_id
    AND NOT EXISTS (
      SELECT 1 FROM public.conversations c WHERE c.contact_id = d.contact_id
    )
    -- Check by normalized phone number (digits only) across ALL contacts
    AND NOT EXISTS (
      SELECT 1 
      FROM public.conversations c2
      JOIN public.contacts ct2 ON ct2.id = c2.contact_id
      WHERE regexp_replace(ct2.phone_number, '\D', '', 'g') = regexp_replace(ct.phone_number, '\D', '', 'g')
    );
$function$;

-- 2) Partial unique index: only one active conversation per contact
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_one_active_per_contact
  ON public.conversations (contact_id)
  WHERE (is_active = true);
