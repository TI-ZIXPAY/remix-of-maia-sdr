
-- Drop restrictive RLS policy on conversation_states that blocks deletes when user_id is null
DROP POLICY IF EXISTS "Users can access states of their conversations" ON public.conversation_states;

-- Create permissive policy for authenticated users
CREATE POLICY "Authenticated users can access conversation_states"
ON public.conversation_states
FOR ALL
USING (auth.role() = 'authenticated'::text)
WITH CHECK (auth.role() = 'authenticated'::text);
