CREATE OR REPLACE FUNCTION public.record_agent_signal(p_interaction_id uuid, p_signal text, p_guardrail_triggered boolean DEFAULT NULL::boolean, p_thinking_summary text DEFAULT NULL::text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_actor uuid;
BEGIN
  IF p_signal IS NULL OR p_signal NOT IN ('added_to_cart','user_correction','hallucination_blocked','empty_search','neutral') THEN
    RAISE EXCEPTION 'Invalid implicit signal: %', p_signal;
  END IF;
  SELECT actor_id INTO v_actor FROM public.agent_interactions WHERE id = p_interaction_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Interaction % not found', p_interaction_id; END IF;
  IF coalesce(auth.role(),'') <> 'service_role' THEN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
    IF (v_actor IS NULL OR v_actor <> auth.uid()) AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'Permission denied to record signal for interaction %', p_interaction_id;
    END IF;
  END IF;
  UPDATE public.agent_interactions SET
    implicit_signal = p_signal,
    guardrail_triggered = COALESCE(p_guardrail_triggered, (p_signal = 'hallucination_blocked'), guardrail_triggered),
    thinking_summary = COALESCE(p_thinking_summary, thinking_summary)
  WHERE id = p_interaction_id;
END; $function$;
REVOKE EXECUTE ON FUNCTION public.record_agent_signal(uuid,text,boolean,text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.record_agent_signal(uuid,text,boolean,text) TO authenticated, service_role;

DROP POLICY IF EXISTS flash_read ON public.flash_offers;
CREATE POLICY flash_read ON public.flash_offers FOR SELECT TO anon, authenticated USING (is_active IS NOT FALSE);

DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity LOOP
    EXECUTE format('DROP POLICY IF EXISTS no_guest_sessions ON public.%I', t.relname);
    EXECUTE format('CREATE POLICY no_guest_sessions ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (coalesce((auth.jwt() ->> ''is_anonymous'')::boolean, false) IS NOT TRUE) WITH CHECK (coalesce((auth.jwt() ->> ''is_anonymous'')::boolean, false) IS NOT TRUE)', t.relname);
  END LOOP;
END $$;