# بطاقة المشروع (Project Profile)

> [!IMPORTANT]
> هذا هو **الملف الوحيد** المسموح أن يحتوي أسماء ومسارات وأرقام إصدارات وأسماء موارد.
> كل سطر هنا له **مصدر** يمكن التحقق منه، و**تاريخ آخر تحقق**. أي سطر بلا مصدر يُحذف.
> المنهج نفسه في [`UNIFIED_METHODOLOGY.md`](../engineering/UNIFIED_METHODOLOGY.md).

**آخر تحقق:** 2026-10-31 · **الطريقة:** قراءة الملفات المذكورة في عمود المصدر.

---

## 1) هوية التشغيل

| الحقيقة | القيمة | المصدر |
| :--- | :--- | :--- |
| اسم حزمة الـ backend | `ouradash-backend` | `backend/package.json` |
| اسم الـ Worker | `auradash-backend` | `backend/wrangler.jsonc` |
| محرك التشغيل | Cloudflare Workers (`workerd`) مع `nodejs_compat` | `backend/wrangler.jsonc` — `compatibility_flags` |
| تاريخ التوافق | `2026-04-28` | `backend/wrangler.jsonc` — `compatibility_date` |
| مدخل التطبيق | `src/index.ts` | `backend/wrangler.jsonc` — `main` |
| **تنبيه تسمية** | الاسم التاريخي `OuraDash`/`auradash`/`ouradash` ما زال حاضراً في أسماء الحزمة والحاوية والأنواع، بينما قاعدة البيانات والمشروع الحاليان باسم `MobiDash` — لا تعتمد على الاسم، اعتمد على المفتاح. | `backend/package.json`, `backend/wrangler.jsonc` |

---

## 2) الحزم والإصدارات (كما هي مثبتة)

| الحزمة | الإصدار | المصدر |
| :--- | :--- | :--- |
| `hono` | `^4.12.15` | `backend/package.json` |
| `@hono/zod-validator` | `^0.7.6` | `backend/package.json` |
| `zod` | `^4.4.1` | `backend/package.json` |
| `cloudflare` (REST SDK) | `^6.3.0` | `backend/package.json` |
| `sanitize-html` | `^2.17.4` | `backend/package.json` |
| `typescript` | `^6.0.3` | `backend/package.json` |
| `wrangler` | `^4.35.0` | `backend/package.json` |
| `vitest` + `@cloudflare/vitest-pool-workers` | `^4.1.8` + `^0.22.0` | `backend/package.json` |
| `@cloudflare/workers-types` | `^5.20260728.1` | `backend/package.json` |

> أنواع `tsc` تُحمَّل من `@cloudflare/workers-types/experimental` و`@cloudflare/vitest-pool-workers` — راجع `backend/tsconfig.json` (`types`).

---

## 3) الموارد السحابية والبايندنج (أسماء حقيقية)

| المورد | المفتاح في `env` | التفاصيل | المصدر |
| :--- | :--- | :--- | :--- |
| قاعدة البيانات (D1) | `DB` | `database_name: mobidash` · `migrations_dir: migrations` | `backend/wrangler.jsonc` — `d1_databases` |
| مساحة KV | `mobidash` | `id: 389eb059f51d4d3aada66bbcd6bba2e7` · `remote: false` | `backend/wrangler.jsonc` — `kv_namespaces` |
| التخزين (R2) | `STORAGE` | `bucket_name: auradash-storage` · `R2_PUBLIC_URL` في `vars` | `backend/wrangler.jsonc` |
| البريد | `EMAILER` | `send_email` binding | `backend/wrangler.jsonc` — `send_email` |

**محددات المعدل المعلنة (8):** `AUTH_LIMITER` (3/60ث) · `DASHBOARD_LIMITER` (100/60ث) · `LOGIN_RECOVERY_LIMITER` (5/60ث) · `VERIFY_CODE_LIMITER` (5/60ث) · `STATE_LIMITER` (60/60ث) · `NOTIFICATIONS_LIMITER` (40/60ث) · `FILES_LIMITER` (200/60ث) · `HEALTH_LIMITER` (30/60ث). المصدر: `backend/wrangler.jsonc` — `ratelimits`.

**أسماء قديمة تُعاد تسميتها وقت التشغيل:** `src/index.ts` يبني `extendedEnv` ويضع فيه `mobidash` و`ouradash_dashboard` و`K1` جميعاً على نفس مساحة KV، قبل تسليم الطلب للتطبيق. لذلك `c.env.mobidash` هو الاسم المعتمد، والبقية أسماء تاريخية للتوافق.

**متغيرات البيئة في `vars`:** `APP_FRONTEND_URL`, `mobidash_MASTER_SECRET`, `CF_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `EMAIL_FROM_ADDRESS`, `R2_PUBLIC_URL` — والقيم الحالية **قيم مؤقتة/سرية يجب نقلها إلى `wrangler secret`** لا أن تبقى نصاً في الملف.

**قائمة الأصول المسموح بها:** `ALLOWED_ORIGINS` غير معلنة في `wrangler.jsonc`. تُحسب في [`src/utils/request.ts`](../../src/utils/request.ts) بالترتيب: `ALLOWED_ORIGINS` الصريح ← `APP_FRONTEND_URL` ← نطاقات محلية (للطلبات المحلية فقط) ← قائمة فارغة (رفض). نفس القائمة تُستخدم في CORS و CSRF وفحص المصدر.

---

## 4) خريطة المجلدات

```text
backend/
├── src/
│   ├── index.ts          # تركيب التطبيق، الوسائط العامة، ترويسات الأمان، معالج الأخطاء
│   ├── types.ts          # المرجع المركزي الوحيد للأنواع (Bindings, UserSession, AppContext, ...)
│   ├── routes/           # تعريف المسارات وربط zValidator
│   ├── validators/       # مخططات Zod + التطهير
│   ├── controllers/      # قراءة المفحوص وتشكيل الرد
│   ├── services/         # المنطق التجاري واستعلامات D1
│   ├── middleware/       # session, permission, rateLimit, csrf, apiKey
│   ├── utils/            # sanitize, logger, response, crypto, pagination, request, media-upload, tenant.utils
│   └── db/               # أدوات تهيئة/بذر البيانات
├── migrations/           # 13 ملف SQL
├── wrangler.jsonc        # مصدر الحقيقة للموارد
├── worker-configuration.d.ts
└── tsconfig.json
```

المصدر: قائمة الملفات الفعلية داخل `backend/src` و`backend/migrations`.

---

## 5) الأوامر المعتمدة

| الغرض | الأمر | المصدر |
| :--- | :--- | :--- |
| فحص الأنواع (إلزامي قبل التسليم) | `npx tsc --noEmit` من داخل `backend` | `backend/tsconfig.json` + وجود `typescript` |
| التطوير المحلي | `npm run dev` (`wrangler dev`) | `backend/package.json` — `scripts` |
| الاختبارات | `npm run test` (`vitest run`) | `backend/package.json` — `scripts` |
| توليد الأنواع | `npm run cf-typegen` | `backend/package.json` — `scripts` |
| النشر | `npm run deploy` | `backend/package.json` — `scripts` — **لا يُشغَّل إلا بطلب صريح** |

---

## 6) عقد الرد الموحد (الحقول الفعلية)

`success: boolean` · `code: number` · `slug: string` · `message: string` · `data: any|null` · `meta: { requestId, timestamp }` · وعند الخطأ: `details?: any[]` (لمشكلات 400) و`debug?: any` (لا يظهر في الإنتاج). دالة الإنشاء: `sendResponse` في `src/utils/response.ts` — التوقيع `(c, code, slug, message, data?, errorDetails?)`.

---

## 7) نقاط المرجع الفعلية (اقرأها بدل التخمين)

| ماذا تريد أن تراه | الملف والسطر |
| :--- | :--- |
| مسار + مخطط + معالج خطأ التحقق | `src/routes/auth.routes.ts:58-67` |
| قراءة بيانات مفحوصة في كنترولر | `src/controllers/phones.controller.ts:147` |
| استعلام معزول بمستأجر | `src/services/accessories.services.ts:53` |
| دفعة كتابة ذرّية | `src/services/accessories.services.ts:334` |
| غلاف الرد | `src/utils/response.ts:48` |
| دوال التطهير | `src/utils/sanitize.ts:23` (`sanitizeHtml`) · `:37` (`sanitizeForDb`) · `:55` (`sanitizeSearchInput`) · `:81` (`escapeLikePattern`) |
| وسيط الجلسة | `src/middleware/session.ts:43` |
| حماية CSRF | `src/middleware/csrf.ts:68` |
| تحديد المعدل | `src/middleware/rateLimit.middleware.ts:92` |
| فحص الصلاحيات | `src/middleware/permission.ts:112` |
| تركيب المسارات المحمية | `src/index.ts:201-239` |
| أنواع السياق والموارد | `src/types.ts:3` (`Bindings`) · `:70` (`UserSession`) · `:88` (`AppContext`) |
| أدوات الطلب (hostname/origin/IP) | `src/utils/request.ts:19` |

---

## 8) ديون تقنية موثقة (معلومة لا تُخفى)

هذه فجوات حقيقية بين المنهج والكود؛ ذِكرُها هنا مقصود حتى لا يبني عليها النموذج افتراضاً خاطئاً:

| # | الفجوة | الأثر | الموضع |
| :--- | :--- | :--- | :--- |
| 1 | ~~نوع `Bindings` لا يعرّف `mobidash`~~ — **أُغلق:** أُضيف `mobidash` للنوع، وحُوِّل كاش الإشعارات إليه، وبقيت أسماء `ouradash_*` أسماء تاريخية فقط | لا أثر بعد الإغلاق؛ الأسماء القديمة تُعاد تسميتها في `src/index.ts` | `src/types.ts:3-15` · `src/controllers/notification.controller.ts:46` |
| 2 | مسار البروفايل يتحقق داخل الكنترولر (`safeParse`) لا عبر مخطط في طبقة المسار | البيانات مفحوصة ومطهَّرة فعلاً، لكنها تخالف قاعدة «التحقق عند الحد» | `src/routes/profile.routes.ts` · `src/controllers/profile.controller.ts:48` |
| 3 | ~~إعادة قراءة الجسم في `endShift` و`verifyOwnerPassword` رغم وجود مخطط في المسار~~ — **أُغلق:** صارا يقرآن من مخرَج المخطط | لا أثر بعد الإغلاق | `src/controllers/auth.controller.ts:645, 829` |
| 4 | `store-login` و`login-shift` بلا مخطط، تحقق يدوي داخل الكنترولر | مدخلات بلا سقوف طول موحدة | `src/controllers/auth.controller.ts:974, 1054` |
| 5 | كاش عام على مستوى الملف لبيانات المتجر، واستعلام `Websites` بـ `LIMIT 1` بلا شرط مستأجر | تلوث بين المتاجر في قوالب البريد | `src/services/email.services.ts:12, 70` |
| 6 | كثافة `as any` (216 موضعاً) مع قاعدة «لا Any» | إضعاف الأنواع وتضليل الفحص | `src/**` |
| 7 | تسمية قديمة `OURADASH_MASTER_SECRET` في النوع مقابل `mobidash_MASTER_SECRET` في الإعداد | خشونة في الأنواع فقط حالياً | `src/types.ts:21` · `src/index.ts:258` |
| 8 | أدلة الجيل السابق (`docs/*.md` و`docs/libraries/`) تحتوي أمثلة غير مطابقة للكود | خطر نسخ كود لا يترجم | `docs/` (معلَّمة بـ«أرشيف») |

---

## 9) قاعدة تحديث هذه البطاقة

1. أي تغيير في `package.json` أو `wrangler.jsonc` أو `tsconfig.json` يوجب تحديث السطر المقابل هنا في نفس المهمة.
2. لا يُضاف سطر بلا مصدر؛ ولا يُحدَّث تاريخ «آخر تحقق» بلا قراءة فعلية للمصادر.
3. البطاقة تصف **الواقع** لا الطموح؛ الفجوات تُسجَّل في القسم 8 ولا تُحذف للتجميل.
4. عند إغلاق أي فجوة في القسم 8: يُحذف سطرها ويُذكر التغيير في الوثيقة المعنية.
