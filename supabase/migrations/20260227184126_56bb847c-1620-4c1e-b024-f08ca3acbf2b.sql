-- Add configurable delay for auto greeting
ALTER TABLE public.nina_settings 
ADD COLUMN IF NOT EXISTS auto_greeting_delay_minutes integer NOT NULL DEFAULT 10;

-- Update the function to use configurable delay
CREATE OR REPLACE FUNCTION public.get_deals_needing_greeting()
 RETURNS TABLE(id uuid, contact_id uuid, user_id uuid)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT d.id, d.contact_id, d.user_id
  FROM public.deals d
  WHERE d.contact_id IS NOT NULL
    AND d.created_at <= now() - (
      SELECT COALESCE(
        (SELECT (ns.auto_greeting_delay_minutes || ' minutes')::interval FROM public.nina_settings ns LIMIT 1),
        interval '10 minutes'
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.conversations c WHERE c.contact_id = d.contact_id
    );
$function$;