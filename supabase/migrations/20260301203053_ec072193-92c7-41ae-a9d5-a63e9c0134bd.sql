
-- 1. Create normalize_br_phone function
CREATE OR REPLACE FUNCTION public.normalize_br_phone(phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  digits text;
  ddd text;
  local_number text;
BEGIN
  digits := regexp_replace(phone, '\D', '', 'g');
  
  IF length(digits) = 12 AND left(digits, 2) = '55' THEN
    ddd := substring(digits from 3 for 2);
    local_number := substring(digits from 5);
    RETURN '55' || ddd || '9' || local_number;
  ELSIF length(digits) = 13 AND left(digits, 2) = '55' THEN
    RETURN digits;
  END IF;
  
  RETURN digits;
END;
$function$;

-- 2. Update get_deals_needing_greeting to use normalize_br_phone
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
    AND NOT EXISTS (
      SELECT 1 FROM public.conversations c WHERE c.contact_id = d.contact_id
    )
    AND NOT EXISTS (
      SELECT 1 
      FROM public.conversations c2
      JOIN public.contacts ct2 ON ct2.id = c2.contact_id
      WHERE normalize_br_phone(ct2.phone_number) = normalize_br_phone(ct.phone_number)
    );
$function$;

-- 3. Update auto_create_deal_on_contact trigger
CREATE OR REPLACE FUNCTION public.auto_create_deal_on_contact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  first_stage_id UUID;
  existing_deal_id UUID;
BEGIN
  SELECT d.id INTO existing_deal_id
  FROM public.deals d
  WHERE d.contact_id = NEW.id
  LIMIT 1;

  IF existing_deal_id IS NOT NULL THEN RETURN NEW; END IF;

  SELECT d.id INTO existing_deal_id
  FROM public.deals d
  JOIN public.contacts c ON c.id = d.contact_id
  WHERE normalize_br_phone(c.phone_number) = normalize_br_phone(NEW.phone_number)
  LIMIT 1;

  IF existing_deal_id IS NOT NULL THEN RETURN NEW; END IF;

  SELECT id INTO first_stage_id
  FROM public.pipeline_stages
  WHERE is_active = true
  ORDER BY position ASC
  LIMIT 1;

  IF first_stage_id IS NOT NULL THEN
    INSERT INTO public.deals (title, contact_id, stage_id, user_id, priority)
    VALUES (COALESCE(NEW.name, NEW.phone_number), NEW.id, first_stage_id, NEW.user_id, 'medium')
    ON CONFLICT (contact_id) WHERE contact_id IS NOT NULL DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

-- 4. Update create_deal_for_new_contact trigger
CREATE OR REPLACE FUNCTION public.create_deal_for_new_contact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  first_stage_id UUID;
  existing_deal_id UUID;
BEGIN
  SELECT d.id INTO existing_deal_id
  FROM public.deals d
  WHERE d.contact_id = NEW.id
  LIMIT 1;

  IF existing_deal_id IS NOT NULL THEN RETURN NEW; END IF;

  SELECT d.id INTO existing_deal_id
  FROM public.deals d
  JOIN public.contacts c ON c.id = d.contact_id
  WHERE normalize_br_phone(c.phone_number) = normalize_br_phone(NEW.phone_number)
  LIMIT 1;

  IF existing_deal_id IS NOT NULL THEN RETURN NEW; END IF;

  SELECT id INTO first_stage_id 
  FROM public.pipeline_stages 
  WHERE is_active = true 
    AND (user_id = NEW.user_id OR user_id IS NULL)
  ORDER BY position 
  LIMIT 1;
  
  IF first_stage_id IS NULL THEN
    RAISE NOTICE 'No pipeline stages found, skipping deal creation for contact %', NEW.id;
    RETURN NEW;
  END IF;
  
  INSERT INTO deals (contact_id, title, company, stage, stage_id, priority, user_id)
  VALUES (NEW.id, COALESCE(NEW.name, NEW.call_name, 'Novo Lead'), NULL, 'new', first_stage_id, 'medium', NEW.user_id)
  ON CONFLICT (contact_id) WHERE contact_id IS NOT NULL DO NOTHING;
  
  RETURN NEW;
END;
$function$;

-- 5. Merge existing duplicates safely
DO $$
DECLARE
  dup RECORD;
  canonical_id UUID;
  redundant_id UUID;
  canonical_conv_id UUID;
BEGIN
  FOR dup IN
    WITH normalized AS (
      SELECT id, phone_number, name,
        CASE 
          WHEN length(regexp_replace(phone_number, '\D', '', 'g')) = 12 
               AND left(regexp_replace(phone_number, '\D', '', 'g'), 2) = '55'
          THEN '55' || substring(regexp_replace(phone_number, '\D', '', 'g') from 3 for 2) || '9' || substring(regexp_replace(phone_number, '\D', '', 'g') from 5)
          ELSE regexp_replace(phone_number, '\D', '', 'g')
        END AS canonical_phone
      FROM contacts
    )
    SELECT n1.id AS id_short, n2.id AS id_long, n1.phone_number AS phone_short, n2.phone_number AS phone_long
    FROM normalized n1
    JOIN normalized n2 ON n1.canonical_phone = n2.canonical_phone AND n1.id <> n2.id
    WHERE length(regexp_replace(n1.phone_number, '\D', '', 'g')) = 12
      AND length(regexp_replace(n2.phone_number, '\D', '', 'g')) = 13
  LOOP
    canonical_id := dup.id_long;   -- 13 digits (with 9)
    redundant_id := dup.id_short;  -- 12 digits (without 9)
    
    RAISE NOTICE 'Merging % into %', redundant_id, canonical_id;
    
    -- Deactivate conversations from redundant contact (don't move, to avoid unique constraint)
    UPDATE conversations SET is_active = false WHERE contact_id = redundant_id AND is_active = true;
    
    -- Move messages from redundant conversations to canonical conversation
    SELECT id INTO canonical_conv_id FROM conversations WHERE contact_id = canonical_id ORDER BY last_message_at DESC LIMIT 1;
    
    IF canonical_conv_id IS NOT NULL THEN
      UPDATE messages SET conversation_id = canonical_conv_id 
      WHERE conversation_id IN (SELECT id FROM conversations WHERE contact_id = redundant_id);
    END IF;
    
    -- Move inactive conversations to canonical contact
    UPDATE conversations SET contact_id = canonical_id WHERE contact_id = redundant_id;
    
    -- Move deals (delete redundant if canonical already has one)
    IF EXISTS (SELECT 1 FROM deals WHERE contact_id = canonical_id) THEN
      DELETE FROM deals WHERE contact_id = redundant_id;
    ELSE
      UPDATE deals SET contact_id = canonical_id WHERE contact_id = redundant_id;
    END IF;
    
    -- Move other references
    UPDATE roulette_assignments SET contact_id = canonical_id WHERE contact_id = redundant_id;
    UPDATE appointments SET contact_id = canonical_id WHERE contact_id = redundant_id;
    
    -- Move custom field values (skip conflicts)
    UPDATE contact_custom_field_values SET contact_id = canonical_id WHERE contact_id = redundant_id
      AND NOT EXISTS (
        SELECT 1 FROM contact_custom_field_values v2 
        WHERE v2.contact_id = canonical_id AND v2.field_id = contact_custom_field_values.field_id
      );
    DELETE FROM contact_custom_field_values WHERE contact_id = redundant_id;
    
    -- Delete redundant contact
    DELETE FROM contacts WHERE id = redundant_id;
    
    RAISE NOTICE 'Merged and deleted %', redundant_id;
  END LOOP;
END $$;
