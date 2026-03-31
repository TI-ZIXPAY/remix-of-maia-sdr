
-- Add is_approved column to user_roles (default false = pending)
ALTER TABLE public.user_roles 
ADD COLUMN is_approved boolean NOT NULL DEFAULT false;

-- Update existing users to be approved (they were already in the system)
UPDATE public.user_roles SET is_approved = true;

-- Update the handle_new_user trigger to set is_approved = false for new users
-- (first user remains auto-approved as admin)
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, full_name)
  VALUES (NEW.id, NEW.raw_user_meta_data ->> 'full_name');
  
  -- Give first user admin role (auto-approved), others get user role (pending)
  IF (SELECT COUNT(*) FROM public.user_roles) = 0 THEN
    INSERT INTO public.user_roles (user_id, role, is_approved) VALUES (NEW.id, 'admin', true);
  ELSE
    INSERT INTO public.user_roles (user_id, role, is_approved) VALUES (NEW.id, 'user', false);
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Create a function to check if user is approved (for use in RLS or app code)
CREATE OR REPLACE FUNCTION public.is_user_approved(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND is_approved = true
  )
$$;
