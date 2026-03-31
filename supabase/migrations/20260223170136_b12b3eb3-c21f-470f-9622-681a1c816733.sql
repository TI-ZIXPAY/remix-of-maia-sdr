
DROP FUNCTION IF EXISTS public.pick_next_roulette_member();

CREATE FUNCTION public.pick_next_roulette_member()
RETURNS TABLE(member_id UUID, member_name TEXT, member_email TEXT, user_id UUID, external_id TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH active_members AS (
    SELECT tm.id, tm.name, tm.email, tm.user_id, tm.external_id, COALESCE(tm.weight, 1) AS weight
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
    SELECT am.id, am.name, am.email, am.user_id, am.external_id,
           am.weight,
           COALESCE(rc.cnt, 0) AS recent,
           (am.weight::float / GREATEST(COALESCE(rc.cnt, 0) + 1, 1)) AS score
    FROM active_members am
    LEFT JOIN recent_counts rc ON rc.team_member_id = am.id
    ORDER BY score DESC, random()
    LIMIT 1
  )
  SELECT scored.id, scored.name, scored.email, scored.user_id, scored.external_id
  FROM scored;
END;
$$;
