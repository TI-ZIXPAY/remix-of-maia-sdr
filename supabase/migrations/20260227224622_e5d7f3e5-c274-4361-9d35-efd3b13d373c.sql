
-- Update auto_create_deal_on_contact to check for existing deals by phone/email
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
  -- Check if a deal already exists for a contact with same phone_number or email
  SELECT d.id INTO existing_deal_id
  FROM public.deals d
  JOIN public.contacts c ON c.id = d.contact_id
  WHERE c.phone_number = NEW.phone_number
     OR (NEW.email IS NOT NULL AND NEW.email != '' AND c.email = NEW.email)
  LIMIT 1;

  -- If deal already exists, skip creation
  IF existing_deal_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Get the first pipeline stage (lowest position)
  SELECT id INTO first_stage_id
  FROM public.pipeline_stages
  WHERE is_active = true
  ORDER BY position ASC
  LIMIT 1;

  -- Only create deal if we have a valid stage
  IF first_stage_id IS NOT NULL THEN
    INSERT INTO public.deals (
      title,
      contact_id,
      stage_id,
      user_id,
      priority
    ) VALUES (
      COALESCE(NEW.name, NEW.phone_number),
      NEW.id,
      first_stage_id,
      NEW.user_id,
      'medium'
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- Also update create_deal_for_new_contact with same logic
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
  -- Check if a deal already exists for a contact with same phone_number or email
  SELECT d.id INTO existing_deal_id
  FROM public.deals d
  JOIN public.contacts c ON c.id = d.contact_id
  WHERE c.phone_number = NEW.phone_number
     OR (NEW.email IS NOT NULL AND NEW.email != '' AND c.email = NEW.email)
  LIMIT 1;

  -- If deal already exists, skip creation
  IF existing_deal_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Buscar primeiro estágio do pipeline
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
  );
  
  RETURN NEW;
END;
$function$;
