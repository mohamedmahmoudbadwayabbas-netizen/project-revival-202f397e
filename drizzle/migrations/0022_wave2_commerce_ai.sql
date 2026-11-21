-- Wave 2: forward-only commerce and AI baseline additions.
-- No existing objects or migration history are removed or rewritten.

-- Preserve existing stock values while enabling fractional quantities.
ALTER TABLE public.products
  ALTER COLUMN stock_quantity TYPE numeric(10,3) USING stock_quantity::numeric(10,3),
  ALTER COLUMN stock TYPE numeric(10,3) USING stock::numeric(10,3);

ALTER TABLE public.delivery_zones
  ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT 'مصر',
  ADD COLUMN IF NOT EXISTS governorate text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS area text;

CREATE INDEX IF NOT EXISTS delivery_zones_egypt_lookup_idx
  ON public.delivery_zones (country, governorate, city, area) WHERE is_active;

-- Deterministic UUIDs make this seed repeatable without imposing a new
-- uniqueness rule on pre-existing zone data.
INSERT INTO public.delivery_zones
  (id, name, country, governorate, city, area, fee, min_order_amount, estimated_minutes, is_active, sort_order)
SELECT md5('egypt-wave2:' || x.governorate || ':' || x.city || ':' || x.area)::uuid,
       x.area || '، ' || x.city, 'مصر', x.governorate, x.city, x.area,
       CASE WHEN x.governorate IN ('القاهرة','الجيزة','القليوبية') THEN 25
            WHEN x.governorate IN ('الإسكندرية','بورسعيد','الإسماعيلية','السويس') THEN 35
            ELSE 45 END,
       120, CASE WHEN x.governorate IN ('القاهرة','الجيزة','القليوبية') THEN 60 ELSE 120 END,
       true, row_number() OVER (ORDER BY x.governorate, x.city, x.area)::int
FROM (VALUES
 ('القاهرة','القاهرة','مدينة نصر'),('القاهرة','القاهرة','مصر الجديدة'),('القاهرة','القاهرة','المعادي'),('القاهرة','القاهرة','حلوان'),('القاهرة','القاهرة','التجمع الخامس'),('القاهرة','القاهرة','شبرا'),
 ('الجيزة','الجيزة','الدقي'),('الجيزة','الجيزة','المهندسين'),('الجيزة','الجيزة','الهرم'),('الجيزة','الجيزة','فيصل'),('الجيزة','الجيزة','6 أكتوبر'),('الجيزة','الجيزة','الشيخ زايد'),
 ('القليوبية','بنها','بنها'),('القليوبية','شبرا الخيمة','شبرا الخيمة'),('القليوبية','العبور','العبور'),
 ('الإسكندرية','الإسكندرية','سموحة'),('الإسكندرية','الإسكندرية','سيدي جابر'),('الإسكندرية','الإسكندرية','العجمي'),('الإسكندرية','الإسكندرية','برج العرب'),
 ('البحيرة','دمنهور','دمنهور'),('البحيرة','كفر الدوار','كفر الدوار'),('مطروح','مرسى مطروح','مرسى مطروح'),('مطروح','الساحل الشمالي','الساحل الشمالي'),
 ('الدقهلية','المنصورة','المنصورة'),('الدقهلية','ميت غمر','ميت غمر'),('الشرقية','الزقازيق','الزقازيق'),('الشرقية','العاشر من رمضان','العاشر من رمضان'),('الشرقية','فاقوس','فاقوس'),
 ('الغربية','طنطا','طنطا'),('الغربية','المحلة الكبرى','المحلة الكبرى'),('المنوفية','شبين الكوم','شبين الكوم'),('المنوفية','السادات','السادات'),
 ('كفر الشيخ','كفر الشيخ','كفر الشيخ'),('كفر الشيخ','دسوق','دسوق'),('دمياط','دمياط','دمياط'),('دمياط','رأس البر','رأس البر'),
 ('بورسعيد','بورسعيد','حي الشرق'),('بورسعيد','بورسعيد','حي العرب'),('الإسماعيلية','الإسماعيلية','الإسماعيلية'),('الإسماعيلية','فايد','فايد'),('السويس','السويس','السويس'),
 ('بني سويف','بني سويف','بني سويف'),('الفيوم','الفيوم','الفيوم'),('المنيا','المنيا','المنيا'),('المنيا','ملوي','ملوي'),
 ('أسيوط','أسيوط','أسيوط'),('سوهاج','سوهاج','سوهاج'),('قنا','قنا','قنا'),('الأقصر','الأقصر','الأقصر'),('أسوان','أسوان','أسوان'),
 ('البحر الأحمر','الغردقة','الغردقة'),('البحر الأحمر','سفاجا','سفاجا'),('الوادي الجديد','الخارجة','الخارجة'),('شمال سيناء','العريش','العريش'),('جنوب سيناء','شرم الشيخ','شرم الشيخ')
) AS x(governorate,city,area)
WHERE NOT EXISTS (
  SELECT 1 FROM public.delivery_zones z
  WHERE z.country='مصر' AND z.governorate=x.governorate AND z.city=x.city AND z.area=x.area
)
ON CONFLICT (id) DO NOTHING;

-- One-time quote records are private and unforgeable; clients cannot write/read them.
CREATE TABLE IF NOT EXISTS private.order_quote_tokens (
  token uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  items jsonb NOT NULL,
  coupon_code text,
  delivery_zone_id uuid,
  subtotal numeric(12,2) NOT NULL,
  discount numeric(12,2) NOT NULL,
  delivery_fee numeric(12,2) NOT NULL,
  total numeric(12,2) NOT NULL,
  consumed_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON private.order_quote_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON private.order_quote_tokens TO service_role;

CREATE OR REPLACE FUNCTION public.calculate_order_quote(
  p_items jsonb, p_coupon_code text DEFAULT NULL, p_delivery_zone_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private
AS $function$
DECLARE
  item jsonb; product_row public.products%ROWTYPE; zone_row public.delivery_zones%ROWTYPE;
  coupon_row public.coupons%ROWTYPE; v_subtotal numeric(12,2):=0; v_discount numeric(12,2):=0;
  v_fee numeric(12,2):=0; v_total numeric(12,2); v_items jsonb:='[]'::jsonb; v_token uuid;
  v_qty numeric(10,3); v_line numeric(12,2);
BEGIN
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'EMPTY_CART'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO product_row FROM public.products WHERE id=(item->>'id')::uuid AND coalesce(is_active,true) FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
    v_qty := (item->>'quantity')::numeric;
    IF v_qty IS NULL OR v_qty<=0 OR v_qty>10000 THEN RAISE EXCEPTION 'INVALID_QUANTITY'; END IF;
    IF coalesce(product_row.stock_quantity,product_row.stock,0)<v_qty THEN RAISE EXCEPTION 'INSUFFICIENT_STOCK'; END IF;
    v_line:=round(coalesce(product_row.price_per_unit,product_row.price)*v_qty,2);
    v_subtotal:=v_subtotal+v_line;
    v_items:=v_items||jsonb_build_array(jsonb_build_object('id',product_row.id,'quantity',v_qty,'price_per_unit',coalesce(product_row.price_per_unit,product_row.price),'subtotal',v_line));
  END LOOP;
  IF p_delivery_zone_id IS NOT NULL THEN
    SELECT * INTO zone_row FROM public.delivery_zones WHERE id=p_delivery_zone_id AND is_active FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_ZONE'; END IF;
    IF v_subtotal < coalesce(zone_row.min_order_amount,0) THEN RAISE EXCEPTION 'BELOW_MIN_ORDER'; END IF;
    v_fee:=coalesce(zone_row.fee,0);
  END IF;
  IF nullif(trim(p_coupon_code),'') IS NOT NULL THEN
    SELECT * INTO coupon_row FROM public.coupons WHERE upper(code)=upper(trim(p_coupon_code)) AND is_active FOR SHARE;
    IF NOT FOUND OR (coupon_row.expires_at IS NOT NULL AND coupon_row.expires_at<now()) THEN RAISE EXCEPTION 'INVALID_COUPON'; END IF;
    IF coupon_row.max_uses IS NOT NULL AND coalesce(coupon_row.uses_count,0)>=coupon_row.max_uses THEN RAISE EXCEPTION 'EXHAUSTED_COUPON'; END IF;
    IF coupon_row.min_order_amount IS NOT NULL AND v_subtotal<coupon_row.min_order_amount THEN RAISE EXCEPTION 'MIN_ORDER_NOT_MET'; END IF;
    IF coupon_row.discount_type IN ('percent','percentage') THEN v_discount:=round(v_subtotal*coupon_row.discount_value/100,2);
    ELSE v_discount:=coupon_row.discount_value; END IF;
    v_discount:=least(greatest(coalesce(v_discount,0),0),v_subtotal);
  END IF;
  v_total:=round(v_subtotal-v_discount+v_fee,2);
  INSERT INTO private.order_quote_tokens(actor_id,items,coupon_code,delivery_zone_id,subtotal,discount,delivery_fee,total)
  VALUES(auth.uid(),v_items,nullif(trim(p_coupon_code),''),p_delivery_zone_id,v_subtotal,v_discount,v_fee,v_total)
  RETURNING token INTO v_token;
  RETURN jsonb_build_object('token',v_token,'items',v_items,'subtotal',v_subtotal,'discount',v_discount,'delivery_fee',v_fee,'total',v_total,'currency','EGP','expires_at',now()+interval '15 minutes');
END $function$;
REVOKE ALL ON FUNCTION public.calculate_order_quote(jsonb,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calculate_order_quote(jsonb,text,uuid) TO anon, authenticated;

-- The trigger restores inventory on every valid transition into cancelled,
-- including admin workflows that update orders directly.
CREATE OR REPLACE FUNCTION private.restock_cancelled_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE item jsonb; product_row public.products%ROWTYPE; qty numeric(10,3);
        old_stock numeric(10,3); new_stock numeric(10,3);
BEGIN
  IF OLD.status IS DISTINCT FROM 'cancelled' AND NEW.status='cancelled' THEN
    FOR item IN SELECT value FROM jsonb_array_elements(coalesce(OLD.items,'[]'::jsonb)) LOOP
      IF (item->>'id') IS NULL THEN CONTINUE; END IF;
      SELECT * INTO product_row FROM public.products WHERE id=(item->>'id')::uuid FOR UPDATE;
      IF NOT FOUND THEN CONTINUE; END IF;
      qty:=(item->>'quantity')::numeric;
      old_stock:=coalesce(product_row.stock_quantity,product_row.stock,0); new_stock:=old_stock+qty;
      UPDATE public.products SET stock_quantity=new_stock,stock=new_stock WHERE id=product_row.id;
      INSERT INTO public.inventory_movements(product_id,order_id,quantity,stock_before,stock_after,movement_type,performed_by)
      VALUES(product_row.id,OLD.id,qty,old_stock,new_stock,'return',auth.uid());
    END LOOP;
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION private.restock_cancelled_order() FROM PUBLIC,anon,authenticated;
DO $trigger$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='wave2_orders_cancel_restock' AND tgrelid='public.orders'::regclass AND NOT tgisinternal) THEN
    CREATE TRIGGER wave2_orders_cancel_restock BEFORE UPDATE OF status ON public.orders
      FOR EACH ROW EXECUTE FUNCTION private.restock_cancelled_order();
  END IF;
END $trigger$;

-- Only an owner or admin may cancel. Trigger, status transition and inventory changes share one transaction.
CREATE OR REPLACE FUNCTION public.cancel_order_with_restock(p_order_id uuid,p_reason text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private
AS $function$
DECLARE order_row public.orders%ROWTYPE;
BEGIN
  SELECT * INTO order_row FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;
  IF order_row.user_id IS DISTINCT FROM auth.uid() AND NOT private.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF order_row.status='cancelled' THEN RETURN false; END IF;
  IF order_row.status NOT IN ('pending','processing','confirmed') THEN RAISE EXCEPTION 'ORDER_NOT_CANCELLABLE'; END IF;
  UPDATE public.orders SET status='cancelled',notes=concat_ws(E'\n',notes,nullif(trim(p_reason),'')) WHERE id=p_order_id;
  RETURN true;
END $function$;
REVOKE ALL ON FUNCTION public.cancel_order_with_restock(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_order_with_restock(uuid,text) TO authenticated, service_role;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS attributed_session_id uuid;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ai_preferences jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Backward-compatible overload: old callers keep using the existing RPC.
CREATE OR REPLACE FUNCTION public.create_order(
  p_customer_name text,p_phone text,p_address text,p_notes text,p_items jsonb,
  p_delivery_zone_id uuid,p_delivery_method text,p_payment_method text,
  p_payment_reference text,p_coupon_code text,p_ref_source text,
  p_idempotency_key text,p_attributed_session_id uuid,p_quote_token uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE v_order uuid; quote_row private.order_quote_tokens%ROWTYPE; quote_item jsonb;
        v_expected integer; v_supplied integer;
BEGIN
  SELECT * INTO quote_row FROM private.order_quote_tokens WHERE token=p_quote_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_QUOTE_TOKEN'; END IF;
  IF quote_row.actor_id IS DISTINCT FROM auth.uid() OR quote_row.expires_at<now()
    OR quote_row.delivery_zone_id IS DISTINCT FROM p_delivery_zone_id
    OR upper(coalesce(quote_row.coupon_code,''))<>upper(coalesce(p_coupon_code,'')) THEN
    RAISE EXCEPTION 'QUOTE_MISMATCH_OR_EXPIRED';
  END IF;
  IF quote_row.consumed_order_id IS NOT NULL THEN
    SELECT id INTO v_order FROM public.orders WHERE id=quote_row.consumed_order_id
      AND idempotency_key=p_idempotency_key;
    IF v_order IS NOT NULL THEN RETURN v_order; END IF;
    RAISE EXCEPTION 'QUOTE_ALREADY_USED';
  END IF;
  IF jsonb_array_length(quote_row.items)<>jsonb_array_length(p_items) THEN RAISE EXCEPTION 'QUOTE_ITEMS_MISMATCH'; END IF;
  FOR quote_item IN SELECT value FROM jsonb_array_elements(quote_row.items) LOOP
    SELECT count(*) INTO v_expected FROM jsonb_array_elements(quote_row.items) i
      WHERE i->>'id'=quote_item->>'id' AND (i->>'quantity')::numeric=(quote_item->>'quantity')::numeric;
    SELECT count(*) INTO v_supplied FROM jsonb_array_elements(p_items) i
      WHERE i->>'id'=quote_item->>'id' AND (i->>'quantity')::numeric=(quote_item->>'quantity')::numeric;
    IF v_expected<>v_supplied THEN RAISE EXCEPTION 'QUOTE_ITEMS_MISMATCH'; END IF;
  END LOOP;
  v_order:=public.create_order(p_customer_name,p_phone,p_address,p_notes,p_items,
    p_delivery_zone_id,p_delivery_method,p_payment_method,p_payment_reference,
    p_coupon_code,p_ref_source,p_idempotency_key);
  IF p_attributed_session_id IS NOT NULL THEN
    UPDATE public.orders SET attributed_session_id=p_attributed_session_id WHERE id=v_order;
  END IF;
  UPDATE private.order_quote_tokens SET consumed_order_id=v_order WHERE token=p_quote_token;
  RETURN v_order;
END $function$;
REVOKE ALL ON FUNCTION public.create_order(text,text,text,text,jsonb,uuid,text,text,text,text,text,text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_order(text,text,text,text,jsonb,uuid,text,text,text,text,text,text,uuid,uuid) TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.agent_exemplars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id uuid,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  conversation jsonb NOT NULL,
  rating smallint CHECK (rating BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.agent_exemplars ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.agent_exemplars TO authenticated;
GRANT ALL ON public.agent_exemplars TO service_role;
CREATE POLICY agent_exemplars_admin_read ON public.agent_exemplars FOR SELECT TO authenticated USING (private.has_role(auth.uid(),'admin'));
CREATE POLICY agent_exemplars_owner_insert ON public.agent_exemplars FOR INSERT TO authenticated
  WITH CHECK (
    user_id=auth.uid() AND order_id IS NOT NULL AND rating>=4
    AND EXISTS (SELECT 1 FROM public.orders o WHERE o.id=order_id AND o.user_id=auth.uid() AND o.status<>'cancelled')
  );
CREATE INDEX IF NOT EXISTS agent_exemplars_order_idx ON public.agent_exemplars(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_attributed_session_idx ON public.orders(attributed_session_id) WHERE attributed_session_id IS NOT NULL;
