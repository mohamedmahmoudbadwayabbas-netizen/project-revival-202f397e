# Roadmap — اقرأ IMPORT_PROTOCOL.md أولاً (خصوصًا القسم 6: ممنوع التوقف)

## حزمة إصلاح المرحلتين 1 و2 — 2026-11-27
- [ ] دمج تغييرات الحزمة مع الاحتفاظ بإصلاحات الأمان الأحدث وعدم استبدال الملفات عميانياً.
- [ ] مراجعة SQL مقابل Supabase الخاص بالمالك؛ تسليم النسخة المتوافقة وعدم تطبيقها قبل التحقق.
- [ ] تشغيل الاختبارات وفحص نتيجة البناء وتوثيق ما بقي خارج المرحلتين.

> Import is not complete until every open box here is done and tested.

## Phase 0 — تطبيق أرشيف المشروع

- [x] نسخ ملفات `project-revival-main-v2.zip` إلى مساحة العمل مع استثناء `.env` المحلي.
- [x] تشغيل الاختبارات والبناء والتحقق من نتيجة الاستبدال.
- [x] إصلاح أخطاء ESLint والتنسيق والتحقق من TypeScript والاختبارات والبناء.

## Phase N — Nawat + product page + AI self-test

Full details and pre-solved blockers: IMPORT_PROTOCOL.md section 6.

- [x] Nawat Groq lane uses `llama-3.3-70b-versatile` with `llama-3.1-8b-instant` fallback and Arabic-only system policy.
- [x] Unclosed `<think>` parsing keeps the visible reply outside the thinking box; regression tests added.
- [x] Live staged activity labels are shown while the assistant is waiting and searching.
- [x] Product picks are recovered from in-stock catalog results when the model omits its products block.
- [x] Long context keeps 40 messages and summarizes earlier turns plus suggested products.
- [x] Product page uses `WeightSelector` for weighted items.
- [x] Product page shows nutrition per 100 g, characteristics, storage, origin, and chef tip cards.
- [ ] Admin AI tools + copilot verified and fixed.
- [ ] Self-test of section 6.3 done and logged.

## Waves 3–13 — Hypermarket roadmap

- [x] Smart Search, typo tolerance, Arabic normalization, synonyms, suggestions, and advanced filters are wired into the storefront.
- [x] Order management, realtime status updates, driver assignment, tracking view, and admin KPI dashboard exist.
- [x] Product management, bulk-oriented admin surfaces, low-stock/expiry alerts, picker/driver views, coupons, and substitutions exist in the current app.
- [x] Delivery slot selection is available in checkout (within two hours, today evening, or tomorrow morning) and is shown in admin orders.
- [ ] Bundles/mix-and-match: admin bundle management and cart eligibility preview are available; server-authoritative bundle pricing still needs RPC/schema work.
- [ ] Wallet/loyalty: customer tier dashboard, referral link, and wallet activation-state card are available; migration 0016 now provides the guarded wallet ledger primitive, while automatic cashback/referral rewards still need a separate approved workflow.
- [ ] Suppliers/purchase orders: replenishment suggestions and a descriptive demand/stock forecast are available from live data; supplier records and purchase-order workflow still need schema/RPC work. Multi-branch inventory and standalone mobile apps remain open.
- [ ] Picker/Driver apps: existing `/driver` portal and new `/picker` mobile-first screen are available as UI foundations; persistent tasks, aisle/bin data, barcode workflow, role enforcement, and native packaging require the import Schema contract.
- [x] Driver data integrity: removed hard-coded branch, address, support phone, and fallback customer coordinates; live map now requires persisted coordinates and active GPS.
- [x] Admin order operations: canonical status display with legacy compatibility, settings-backed receipts, real customer summaries, mobile action cards, and KPI counters.
- [ ] Multi-branch: `/admin/branches` now reads and manages persisted `branches` only; no delivery-zone or hard-coded branch fallback remains. Independent branch inventory and nearest-branch allocation still require `branches`/`branch_inventory` Schema and RPCs.

## Critical operations hardening

- [x] Atomic inventory reservation, coupon locking, and server-side promotion validation in migration 0016.
- [x] Driver role/profile/assignment contract and guarded `assign_driver` RPC in migration 0016.
- [x] Append-only wallet ledger primitive with idempotent admin posting in migration 0016.
- [x] Removed unsupported Gemini model IDs and unverified model fallback labels from the client.
- [x] Apply migration 0016 in the target database (applied 2026-11-13 as 0017_critical_operations_hardening). [ ] Connect the admin assignment UI to `assign_driver`.

## Alwadi Assistant

- [x] Inline approval cards execute high-risk and destructive store tools after explicit admin confirmation.
- [x] Enabled `bulkPriceUpdate`, `manageUsersAndRoles`, `rollbackLastAction`, and `updateRawJsonMetadata` through the in-chat approval path.
- [x] Renamed misleading coupon and announcement tool names to match their real behavior.
- [x] Refreshed assistant typography, empty state, quick actions, and mobile approval presentation.
- [x] Rebranded the admin copilot as «نبراس» and completed the responsive visual redesign for desktop, tablet, and mobile.
- [x] Added the operational navigation rail and decision-review card treatment from the approved assistant direction.
- [x] Wired assistant shortcuts to live admin routes and populated executive KPIs from current Supabase orders and inventory.

## Phase A — AI unification + admin fixes

- [x] Dahl in DB, Groq primary via GROQ_API_KEY secret, shared generatePlainText, product copy for new products, save payload fixed, speed fixes.
- [ ] Image generator needs an image-capable key (Dahl/Groq are text-only).

## Phase B — Governance blueprint

- [ ] Nawat logging for guests.
- [ ] Executable keyword-add / reorder-threshold proposals with raw JSON before approval.
- [ ] Ops agent: COD reconciliation + delivery slot grouping (proposals only).
- [ ] Tests for proposal approve/reject permissions.

## Phase C — Data import

- [ ] Old products/categories/orders/customers exports, images.
- [x] تحديث شامل لتصميم المتجر وألوان الهايبر ماركت (الهاتف/التابلت/الكمبيوتر)
- [x] صقل هوية الهايبرماركت: tokens زمردية/ثلجية، بطاقات أقسام دائرية، وكبسولة موقع ووقت التوصيل في الهيدر.

## خزانة مفاتيح الذكاء
- [x] جدول ai_key_vault + محرك تبديل فوري + لوحة إدارة + توثيق
- [ ] إضافة مفاتيح Dahl (ينتظر المستخدم يلصقها في اللوحة)
- [ ] إظهار سلسلة تفكير نبراس + تعريب تفكير نواة

## دستور الأدوات (19)
- [x] Intent Router + Tool Cluster Router
- [ ] أدوات نواة: manageCart, smartReorder, smartListManager, deliveryAndTracking, walletAndLoyalty
- [ ] أدوات نبراس: supplierManager, customerManager, inventoryManager كامل, fulfillmentManager (سائقين/تجهيز), mediaManager بـ gemini-3.1-flash-image


## Wave 1 progress

- [x] Make the browser Supabase client use deployment environment variables and fail closed on invalid configuration.
- [ ] Reconcile live schema and migration history; repair the database-backed Wave 1 findings with forward-only changes.
- Validation pending: npm registry TLS failure prevented dependency installation, so build/tests could not run.


- [x] Add forward-only source baseline for the six live tables, policies, indexes, and grants.
- [ ] Reconcile the live store_settings_public projection without changing existing column compatibility.
- [ ] Complete Wave 1 order, inventory, driver, and governance fixes; validate against a disposable database.

- [x] Expand the source-created settings view from 30 to 34 columns without reordering existing columns; live 34-column view is unchanged.

## Wave 2 progress

- [x] Add forward-only migration for fractional stock, Egypt delivery zones, quote tokens, atomic cancellation restock, attribution, AI preferences storage, and positive-order exemplars.
- [x] Wire checkout to server quote validation and attribute checkout to the current Nawat thread.
- [x] Enable existing cart, reorder, inventory adjustment, and dead-stock routes.
- [ ] Implement recipe/budget cart optimization, perishables and bundle recommendations, and automatic preference/exemplar capture.
- [ ] Apply Wave 2 migration to a verified live database and reconcile its resulting schema.

## Security hardening — 2026-11-20

- [x] Protect admin routes with redirect-to-login and loading/unauthorized guards.
- [x] Restrict order lookup to user ID or tracking token; mask guest-visible customer details and require authentication for reorder.
- [x] Limit non-image/non-maps Gemini request bodies to 16 KB and add per-user in-memory sliding-window request limits.
- [ ] Run build and focused checks when validation is requested; rate limits are per server process and are not shared across instances.

## Phase — مركز المفاتيح المجانية وشبكة Keyless (2026-11-21)

- [x] إضافة دليل مزودي المفاتيح المجانية وروابط لوحاتهم، مع Cerebras وGemini وGroq وMistral وOpenRouter.
- [x] إضافة استيراد `.env` جماعي مع استنتاج المزود، ترتيب افتراضي للمفاتيح، منع التكرار، وعدم إرجاع أي سر للمتصفح.
- [x] إضافة فحص صحة فردي وجماعي للمفاتيح وتحديث الحالة بما يتفق مع قيم الجدول الحالية، من خلال دوال خادم محمية للمسؤول.
- [x] تفعيل محول Kilo المجهول لمسارات `:free` بعد فشل/غياب مسارات المفاتيح، وتمريره عبر محول Gemini/OpenAI حتى تبقى استدعاءات الأدوات متوافقة.
- [x] استخدام ترتيب الخزانة للأولوية، ثم المفاتيح المجانية، ثم Kilo؛ وتوثيق القيود والخصوصية وعدم ضمان توافر مزود خارجي.
- [x] تحديث `WORK_LOG.md` و`SYSTEM_MANIFEST.md`.
- [ ] تشغيل `npm test` بعد تثبيت الاعتماديات.
- ملاحظة تحقق: أرشيف FreeLLMAPI يثبت مسار Kilo المجهول؛ وثائق LLM7 الرسمية تتطلب رمز API وتصف استخدامًا مدفوعًا، لذلك لا يُعامل كـ Keyless.
- الحالة الحالية: التنفيذ 95%؛ اختبارات الحزمة متبقية لأن `vitest` غير مثبت، وطلب تنزيل الاعتماديات ينتظر موافقة المستخدم.
