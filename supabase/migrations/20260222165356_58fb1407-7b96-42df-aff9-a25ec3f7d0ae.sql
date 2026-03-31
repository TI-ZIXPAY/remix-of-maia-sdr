
-- Drop the trigger and function together
DROP TRIGGER IF EXISTS auto_greeting_on_deal_insert ON public.deals;
DROP FUNCTION IF EXISTS public.trigger_auto_greeting_on_deal() CASCADE;
