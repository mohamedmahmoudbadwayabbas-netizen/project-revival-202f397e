DROP POLICY IF EXISTS configs_read ON public.ai_agent_configs;
CREATE POLICY configs_read ON public.ai_agent_configs FOR SELECT TO anon, authenticated USING (agent_name = 'nawat');
DROP POLICY IF EXISTS tools_read ON public.ai_tool_registry;
CREATE POLICY tools_read ON public.ai_tool_registry FOR SELECT TO anon, authenticated USING (agent_name = 'nawat' AND is_enabled = true);
DROP POLICY IF EXISTS slots_read ON public.delivery_slots;
CREATE POLICY slots_read ON public.delivery_slots FOR SELECT TO anon, authenticated USING (is_active IS NOT FALSE);