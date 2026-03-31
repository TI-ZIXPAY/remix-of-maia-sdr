
-- Create business_hours_schedule table
CREATE TABLE public.business_hours_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_of_week INTEGER NOT NULL,
  start_time TIME NOT NULL DEFAULT '09:00',
  end_time TIME NOT NULL DEFAULT '18:00',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(day_of_week)
);

-- Validation trigger instead of CHECK constraint
CREATE OR REPLACE FUNCTION public.validate_day_of_week()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.day_of_week < 0 OR NEW.day_of_week > 6 THEN
    RAISE EXCEPTION 'day_of_week must be between 0 and 6';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER check_day_of_week
BEFORE INSERT OR UPDATE ON public.business_hours_schedule
FOR EACH ROW EXECUTE FUNCTION public.validate_day_of_week();

-- Enable RLS
ALTER TABLE public.business_hours_schedule ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Admins can manage business_hours_schedule"
ON public.business_hours_schedule
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated can read business_hours_schedule"
ON public.business_hours_schedule
FOR SELECT
USING (true);

-- Seed with default data (Mon-Fri 09-18, Sat-Sun off)
INSERT INTO public.business_hours_schedule (day_of_week, start_time, end_time, is_active) VALUES
  (0, '09:00', '18:00', false),
  (1, '09:00', '18:00', true),
  (2, '09:00', '18:00', true),
  (3, '09:00', '18:00', true),
  (4, '09:00', '18:00', true),
  (5, '09:00', '18:00', true),
  (6, '09:00', '13:00', false);
