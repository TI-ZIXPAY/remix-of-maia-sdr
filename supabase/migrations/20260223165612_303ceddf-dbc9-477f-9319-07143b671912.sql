
-- Table to track roulette assignments
CREATE TABLE public.roulette_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_member_id UUID NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES public.deals(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.roulette_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage roulette_assignments"
  ON public.roulette_assignments FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated can read roulette_assignments"
  ON public.roulette_assignments FOR SELECT
  USING (true);

-- Service role policy for edge functions
CREATE POLICY "Service can manage roulette_assignments"
  ON public.roulette_assignments FOR ALL
  USING (true)
  WITH CHECK (true);

-- Function to pick next member based on weighted roulette
CREATE OR REPLACE FUNCTION public.pick_next_roulette_member()
RETURNS TABLE(member_id UUID, member_name TEXT, member_email TEXT, user_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH active_members AS (
    SELECT tm.id, tm.name, tm.email, tm.user_id, COALESCE(tm.weight, 1) AS weight
    FROM team_members tm
    WHERE tm.status = 'active' AND COALESCE(tm.weight, 1) > 0
  ),
  recent_counts AS (
    SELECT ra.team_member_id, COUNT(*) AS cnt
    FROM roulette_assignments ra
    WHERE ra.assigned_at > now() - interval '7 days'
    GROUP BY ra.team_member_id
  ),
  scored AS (
    SELECT am.id, am.name, am.email, am.user_id,
           am.weight,
           COALESCE(rc.cnt, 0) AS recent,
           (am.weight::float / GREATEST(COALESCE(rc.cnt, 0) + 1, 1)) AS score
    FROM active_members am
    LEFT JOIN recent_counts rc ON rc.team_member_id = am.id
    ORDER BY score DESC, random()
    LIMIT 1
  )
  SELECT scored.id, scored.name, scored.email, scored.user_id
  FROM scored;
END;
$$;

-- Index for performance
CREATE INDEX idx_roulette_assignments_assigned_at ON public.roulette_assignments(assigned_at DESC);
CREATE INDEX idx_roulette_assignments_team_member ON public.roulette_assignments(team_member_id);
