
-- Drop existing restrictive policies on uazapi_instances
DROP POLICY IF EXISTS "Admins can manage uazapi_instances" ON public.uazapi_instances;
DROP POLICY IF EXISTS "Authenticated can read uazapi_instances" ON public.uazapi_instances;
DROP POLICY IF EXISTS "Service can manage uazapi_instances" ON public.uazapi_instances;

-- Re-create as PERMISSIVE policies
CREATE POLICY "Admins can manage uazapi_instances"
ON public.uazapi_instances
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated can read uazapi_instances"
ON public.uazapi_instances
FOR SELECT
TO authenticated
USING (true);
