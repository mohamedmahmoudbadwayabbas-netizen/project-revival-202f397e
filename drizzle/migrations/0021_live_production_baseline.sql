-- Forward-only baseline of live public tables captured 2026-11-17.
-- Existing migration files are unchanged. No objects or data are dropped.
-- store_settings_public is expanded compatibly from its source definition.
-- If the live view already has the current 34-column contract, this is a no-op.

CREATE TABLE IF NOT EXISTS public.branches (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  name_en text,
  city text,
  governorate text,
  address text,
  phone text,
  status text DEFAULT 'open'::text NOT NULL,
  is_main boolean DEFAULT false NOT NULL,
  delivery_zones text[] DEFAULT '{}'::text[] NOT NULL,
  estimated_minutes integer,
  fee numeric DEFAULT 0,
  min_order_amount numeric,
  lat double precision,
  lng double precision,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT branches_pkey PRIMARY KEY (id)
);
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'branches' AND policyname = 'branches_admin') THEN EXECUTE $policy$CREATE POLICY "branches_admin" ON public."branches" FOR ALL TO "authenticated" USING (is_admin()) WITH CHECK (is_admin())$policy$; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'branches' AND policyname = 'branches_read') THEN EXECUTE $policy$CREATE POLICY "branches_read" ON public."branches" FOR SELECT TO "anon", "authenticated" USING ((is_active OR is_admin()))$policy$; END IF; END; $migration$;
GRANT ALL PRIVILEGES ON TABLE public.branches TO anon;
GRANT ALL PRIVILEGES ON TABLE public.branches TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.branches TO postgres;
GRANT ALL PRIVILEGES ON TABLE public.branches TO service_role;

CREATE TABLE IF NOT EXISTS public.payments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  order_id uuid NOT NULL,
  method text NOT NULL,
  amount numeric NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  gateway_reference text,
  reconciled_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT payments_method_check CHECK (method = ANY (ARRAY['cod'::text, 'instapay'::text, 'bank_transfer'::text, 'online'::text])),
  CONSTRAINT payments_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT payments_pkey PRIMARY KEY (id),
  CONSTRAINT payments_status_check CHECK (status = ANY (ARRAY['pending'::text, 'authorized'::text, 'collected'::text, 'failed'::text, 'refunded'::text]))
);
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'payments' AND policyname = 'payments_admin_policy') THEN EXECUTE $policy$CREATE POLICY "payments_admin_policy" ON public."payments" FOR ALL TO public USING (is_admin()) WITH CHECK (is_admin())$policy$; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'payments' AND policyname = 'payments_select_policy') THEN EXECUTE $policy$CREATE POLICY "payments_select_policy" ON public."payments" FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = payments.order_id) AND ((o.user_id = auth.uid()) OR is_admin())))))$policy$; END IF; END; $migration$;
GRANT ALL PRIVILEGES ON TABLE public.payments TO anon;
GRANT ALL PRIVILEGES ON TABLE public.payments TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.payments TO postgres;
GRANT ALL PRIVILEGES ON TABLE public.payments TO service_role;

CREATE TABLE IF NOT EXISTS public.return_requests (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  order_item_id uuid NOT NULL,
  reason_category text NOT NULL,
  customer_note text,
  status text DEFAULT 'open'::text NOT NULL,
  resolution_type text,
  admin_note text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  resolved_at timestamp with time zone,
  CONSTRAINT return_requests_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
  CONSTRAINT return_requests_pkey PRIMARY KEY (id),
  CONSTRAINT return_requests_reason_category_check CHECK (reason_category = ANY (ARRAY['damaged'::text, 'wrong_item'::text, 'missing'::text, 'quality_issue'::text, 'never_arrived'::text])),
  CONSTRAINT return_requests_resolution_type_check CHECK (resolution_type = ANY (ARRAY['store_credit'::text, 'refund'::text, 'replacement'::text])),
  CONSTRAINT return_requests_status_check CHECK (status = ANY (ARRAY['open'::text, 'under_review'::text, 'approved'::text, 'rejected'::text, 'resolved'::text]))
);
ALTER TABLE public.return_requests ENABLE ROW LEVEL SECURITY;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'return_requests' AND policyname = 'return_requests_admin_policy') THEN EXECUTE $policy$CREATE POLICY "return_requests_admin_policy" ON public."return_requests" FOR ALL TO public USING (is_admin()) WITH CHECK (is_admin())$policy$; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'return_requests' AND policyname = 'return_requests_insert_policy') THEN EXECUTE $policy$CREATE POLICY "return_requests_insert_policy" ON public."return_requests" FOR INSERT TO public WITH CHECK ((EXISTS ( SELECT 1
   FROM (order_items oi
     JOIN orders o ON ((o.id = oi.order_id)))
  WHERE ((oi.id = return_requests.order_item_id) AND (o.user_id = auth.uid())))))$policy$; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'return_requests' AND policyname = 'return_requests_select_policy') THEN EXECUTE $policy$CREATE POLICY "return_requests_select_policy" ON public."return_requests" FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM (order_items oi
     JOIN orders o ON ((o.id = oi.order_id)))
  WHERE ((oi.id = return_requests.order_item_id) AND ((o.user_id = auth.uid()) OR is_admin())))))$policy$; END IF; END; $migration$;
GRANT ALL PRIVILEGES ON TABLE public.return_requests TO anon;
GRANT ALL PRIVILEGES ON TABLE public.return_requests TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.return_requests TO postgres;
GRANT ALL PRIVILEGES ON TABLE public.return_requests TO service_role;

CREATE TABLE IF NOT EXISTS public.ai_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  proposal_id uuid,
  actor uuid,
  actor_type text NOT NULL,
  action text NOT NULL,
  table_affected text,
  record_id text,
  before jsonb,
  after jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT ai_audit_log_actor_type_check CHECK (actor_type = ANY (ARRAY['human'::text, 'ai'::text])),
  CONSTRAINT ai_audit_log_pkey PRIMARY KEY (id),
  CONSTRAINT ai_audit_log_proposal_id_fkey FOREIGN KEY (proposal_id) REFERENCES ai_proposals(id)
);
ALTER TABLE public.ai_audit_log ENABLE ROW LEVEL SECURITY;
GRANT ALL PRIVILEGES ON TABLE public.ai_audit_log TO postgres;
GRANT ALL PRIVILEGES ON TABLE public.ai_audit_log TO service_role;

CREATE TABLE IF NOT EXISTS public.project_engine_approvals (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  actor_user_id uuid NOT NULL,
  source_id text NOT NULL,
  change_set_hash text NOT NULL,
  change_set jsonb NOT NULL,
  status text DEFAULT 'approved'::text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  approved_at timestamp with time zone DEFAULT now() NOT NULL,
  applying_at timestamp with time zone,
  consumed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT project_engine_approvals_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT project_engine_approvals_pkey PRIMARY KEY (id),
  CONSTRAINT project_engine_approvals_status_check CHECK (status = ANY (ARRAY['approved'::text, 'applying'::text, 'consumed'::text, 'expired'::text, 'failed'::text]))
);
ALTER TABLE public.project_engine_approvals ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS project_engine_approvals_actor_hash_idx ON public.project_engine_approvals USING btree (actor_user_id, change_set_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS project_engine_approvals_status_expiry_idx ON public.project_engine_approvals USING btree (status, expires_at);
GRANT ALL PRIVILEGES ON TABLE public.project_engine_approvals TO postgres;
GRANT ALL PRIVILEGES ON TABLE public.project_engine_approvals TO service_role;

CREATE TABLE IF NOT EXISTS public.project_engine_audit (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  event_type text NOT NULL,
  actor_user_id uuid,
  approval_id uuid,
  source_id text,
  change_set_hash text,
  validation_result jsonb,
  provider_result jsonb,
  metadata jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT project_engine_audit_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT project_engine_audit_approval_id_fkey FOREIGN KEY (approval_id) REFERENCES project_engine_approvals(id) ON DELETE SET NULL,
  CONSTRAINT project_engine_audit_pkey PRIMARY KEY (id)
);
ALTER TABLE public.project_engine_audit ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS project_engine_audit_created_idx ON public.project_engine_audit USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS project_engine_audit_change_set_idx ON public.project_engine_audit USING btree (change_set_hash, created_at DESC);
GRANT ALL PRIVILEGES ON TABLE public.project_engine_audit TO postgres;
GRANT ALL PRIVILEGES ON TABLE public.project_engine_audit TO service_role;

CREATE OR REPLACE FUNCTION private.get_store_settings_public_v2()
RETURNS TABLE (
  id uuid,
  whatsapp_number text,
  hero_title text,
  hero_subtitle text,
  hero_image_url text,
  hero_cta_text text,
  store_address text,
  store_lat numeric,
  store_lng numeric,
  site_name text,
  logo_url text,
  favicon_url text,
  primary_color text,
  accent_color text,
  background_color text,
  foreground_color text,
  announcement_text text,
  announcement_enabled boolean,
  announcement_bg_color text,
  min_order_amount numeric,
  default_delivery_fee numeric,
  first_order_coupon_enabled boolean,
  first_order_coupon_code text,
  first_order_discount_percent numeric,
  hero_bg_image text,
  login_bg_pattern text,
  cart_empty_bg text,
  floating_element_image text,
  created_at timestamptz,
  updated_at timestamptz,
  font_family text,
  ga4_id text,
  meta_pixel_id text,
  free_shipping_threshold numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT
    s.id, s.whatsapp_number, s.hero_title, s.hero_subtitle, s.hero_image_url,
    s.hero_cta_text, s.store_address, s.store_lat, s.store_lng, s.site_name,
    s.logo_url, s.favicon_url, s.primary_color, s.accent_color, s.background_color,
    s.foreground_color, s.announcement_text, s.announcement_enabled,
    s.announcement_bg_color, s.min_order_amount, s.default_delivery_fee,
    s.first_order_coupon_enabled, s.first_order_coupon_code,
    s.first_order_discount_percent, s.hero_bg_image, s.login_bg_pattern,
    s.cart_empty_bg, s.floating_element_image, s.created_at, s.updated_at,
    s.font_family, s.ga4_id, s.meta_pixel_id, s.free_shipping_threshold
  FROM public.store_settings AS s
$function$;

REVOKE ALL ON FUNCTION private.get_store_settings_public_v2() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.get_store_settings_public_v2()
  TO anon, authenticated, service_role;

DO $migration$
DECLARE
  view_columns text[];
BEGIN
  SELECT array_agg(column_name::text ORDER BY ordinal_position)
    INTO view_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'store_settings_public';

  IF view_columns = ARRAY[
    'id','site_name','logo_url','favicon_url','primary_color','accent_color',
    'background_color','foreground_color','font_family','announcement_text',
    'announcement_enabled','announcement_bg_color','whatsapp_number','hero_title',
    'hero_subtitle','hero_image_url','hero_cta_text','hero_bg_image',
    'login_bg_pattern','cart_empty_bg','floating_element_image','store_address',
    'store_lat','store_lng','ga4_id','meta_pixel_id','min_order_amount',
    'default_delivery_fee','free_shipping_threshold','first_order_coupon_enabled',
    'first_order_coupon_code','first_order_discount_percent','created_at','updated_at'
  ]::text[] THEN
    NULL;
  ELSIF view_columns = ARRAY[
    'id','whatsapp_number','hero_title','hero_subtitle','hero_image_url',
    'hero_cta_text','store_address','store_lat','store_lng','site_name','logo_url',
    'favicon_url','primary_color','accent_color','background_color','foreground_color',
    'announcement_text','announcement_enabled','announcement_bg_color',
    'min_order_amount','default_delivery_fee','first_order_coupon_enabled',
    'first_order_coupon_code','first_order_discount_percent','hero_bg_image',
    'login_bg_pattern','cart_empty_bg','floating_element_image','created_at','updated_at'
  ]::text[] THEN
    EXECUTE $view$
      CREATE OR REPLACE VIEW public.store_settings_public
      WITH (security_invoker = true)
      AS SELECT * FROM private.get_store_settings_public_v2()
    $view$;
  ELSE
    RAISE EXCEPTION
      'Unexpected public.store_settings_public columns; refusing to replace the view';
  END IF;
END;
$migration$;

GRANT SELECT ON public.store_settings_public TO anon, authenticated, service_role;
