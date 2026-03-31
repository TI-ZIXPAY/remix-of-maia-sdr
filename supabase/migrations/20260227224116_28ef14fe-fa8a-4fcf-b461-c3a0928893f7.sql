
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
    -- Also check by phone number (fallback to avoid duplicate greetings)
    AND NOT EXISTS (
      SELECT 1 
      FROM public.conversations c2
      JOIN public.contacts ct2 ON ct2.id = c2.contact_id
      WHERE ct2.phone_number = ct.phone_number
    );
$function$;
