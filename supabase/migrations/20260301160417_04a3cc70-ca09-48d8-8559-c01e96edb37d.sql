
-- Update trigger function to handle unique constraint gracefully
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
  -- Check if a deal already exists for THIS contact_id
  SELECT d.id INTO existing_deal_id
  FROM public.deals d
  WHERE d.contact_id = NEW.id
  LIMIT 1;

  IF existing_deal_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Also check by phone number across other contacts
  SELECT d.id INTO existing_deal_id
  FROM public.deals d
  JOIN public.contacts c ON c.id = d.contact_id
  WHERE regexp_replace(c.phone_number, '\D', '', 'g') = regexp_replace(NEW.phone_number, '\D', '', 'g')
  LIMIT 1;

  IF existing_deal_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO first_stage_id
  FROM public.pipeline_stages
  WHERE is_active = true
  ORDER BY position ASC
  LIMIT 1;

  IF first_stage_id IS NOT NULL THEN
    INSERT INTO public.deals (title, contact_id, stage_id, user_id, priority)
    VALUES (
      COALESCE(NEW.name, NEW.phone_number),
      NEW.id,
      first_stage_id,
      NEW.user_id,
      'medium'
    )
    ON CONFLICT (contact_id) WHERE contact_id IS NOT NULL DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

-- Update the other trigger function too
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
  -- Check if a deal already exists for THIS contact_id
  SELECT d.id INTO existing_deal_id
  FROM public.deals d
  WHERE d.contact_id = NEW.id
  LIMIT 1;

  IF existing_deal_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Also check by phone number
  SELECT d.id INTO existing_deal_id
  FROM public.deals d
  JOIN public.contacts c ON c.id = d.contact_id
  WHERE regexp_replace(c.phone_number, '\D', '', 'g') = regexp_replace(NEW.phone_number, '\D', '', 'g')
  LIMIT 1;

  IF existing_deal_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

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
  VALUES (
    NEW.id,
    COALESCE(NEW.name, NEW.call_name, 'Novo Lead'),
    NULL,
    'new',
    first_stage_id,
    'medium',
    NEW.user_id
  )
  ON CONFLICT (contact_id) WHERE contact_id IS NOT NULL DO NOTHING;
  
  RETURN NEW;
END;
$function$;
