# دليل استخدام إطار العمل `hono` في MobiDash (Hono Edge Framework Guide)

> [!WARNING]
> **أرشيف الجيل السابق — لا يُعتمد في كود جديد.**
> المرجع المعتمد: [`../engineering/UNIFIED_METHODOLOGY.md`](../engineering/UNIFIED_METHODOLOGY.md) · [`../project/PROJECT_PROFILE.md`](../project/PROJECT_PROFILE.md).
> أمثلة الكود هنا قد لا تطابق الكود الحالي؛ لا تنسخ منها بلا مطابقة.

## 1. الغرض الهندسي في MobiDash (Engineering Purpose)
حزمة `hono` (^4.12.15) هي إطار عمل الويب فائق الخفة والسرعة المعتمد لبناء واجهات برمجة التطبيقات على بيئة **Cloudflare Workers (workerd)**. تدير الحزمة دورة حياة الطلب (Request Lifecycle)، توجيه المسارات (Routing)، ربط الوسطاء (Middleware)، وتوفير كائن السياق `c` (Context) للوصول إلى بيئة كلاود فلير الأصلية (`c.env`).

---

## 2. متى تُستخدم الحزمة؟ (When to Use)
- تعريف المسارات ونقاط النهاية (Routes & Endpoints) في طبقة `src/routes/`.
- قراءة مدخلات الطلب (Headers, Path Params, Validated Body).
- حقن وقراءة متغيرات الطلب المؤقتة عبر `c.set()` و `c.get()` (مثل بيانات المستخدم والمستأجر والوردية).
- تشغيل المهام الخلفية غير الحاجبة بعد الاستجابة عبر `c.executionCtx.waitUntil()`.

---

## 3. القواعد الصارمة والاستخدام الصحيح (Strict Rules & Correct Usage)

1. **الوصول إلى الموارد السحابية (Cloudflare Bindings):**
   - استخراج قواعد البيانات والتخزين والمتغيرات حصراً عبر `c.env`:
     - `c.env.DB` لقاعدة بيانات D1.
     - `c.env.mobidash` لمساحة Cloudflare KV.
     - `c.env.STORAGE` لحاوية Cloudflare R2.
     - المتغيرات السرية المحددة في `wrangler.jsonc` (مثل `c.env.OURADASH_MASTER_SECRET`).

2. **إدارة نطاق الطلب (Scoped Context Variables):**
   - المتغيرات المشتركة بين Middleware والـ Controller يتم تخزينها واسترجاعها عبر:
     - `c.set('user', userPayload)` في الوسيط.
     - `const user = c.get('user')` في الكنترولر أو الخدمة.
   - تعريف أنواع المتغيرات في النوع العام لـ Hono: `Hono<{ Bindings: Bindings, Variables: Variables }>`.

3. **إرجاع الردود (Response Generation):**
   - يُمنع إرجاع كائنات عشوائية أو نص مجرد.
   - الردود القياسية يجب أن تمر حصراً عبر دالة الغلاف المعتمدة، وتوقيعها في المشروع:
     `sendResponse(c, code, slug, message, data?, errorDetails?)` — راجع `src/utils/response.ts`.

4. **المهام غير الحاجبة (Non-blocking Background Tasks):**
   - للمهام التي لا يجب أن تعطل استجابة العميل (مثل تسجيل الأحداث أو إرسال إشعارات خفيفة):
     `c.executionCtx.waitUntil(backgroundPromise);`
   - هذا يضمن استمرار تشغيل المعالج السحابي في Cloudflare حتى انتهاء الوعد دون تأخير إرجاع الرد للمستخدم.

5. **تجميع وتفريع المسارات (Modular Sub-routing):**
   - يتم إنشاء مثيل مستقل للمسار في كل ملف مسارات: `const router = new Hono<{ Bindings: Bindings }>();`
   - ثم يتم دمجه في التطبيق الأساسي في `src/index.ts` عبر: `app.route('/api/v1/auth', authRouter);`

---

## 4. فخاخ وأخطاء الذكاء الاصطناعي القاتلة (AI Anti-Patterns & Traps)

> [!CAUTION]
> **1. فخ استدعاء كائنات Express:**
> - ❌ خطأ قاتل: `req.body`, `res.status(200).json()`, `res.send()`, `next(err)`.
> - ✅ صحيح: كائن Hono الموحد هو `c`، والرد يتم عبر `c.json()` أو `sendResponse(c, ...)`.

> [!CAUTION]
> **2. فخ المتغيرات العامة وتسريب العزل (Isolate Bleeding):**
> - ❌ خطأ كارثي: تخزين بيانات الطلب أو معرف المستخدم في متغير عام خارج الدالة:
>   `let currentUser: any; // خطأ كارثي يتسرب لطلبات المستخدمين الآخرين!`
> - ✅ صحيح: التخزين حصراً داخل سياق الطلب عبر `c.set('user', data)`.

> [!CAUTION]
> **3. فخ إنشاء تطبيق جديد داخل الـ Handler:**
> - ❌ خطأ: استدعاء `const app = new Hono()` داخل دالة معالجة الطلب.
> - ✅ صحيح: إنشاء الراوتر مرة واحدة فقط على مستوى الملف خارج الـ Handlers.

> [!CAUTION]
> **4. فخ تجاهل تمرير الـ Middleware (Missing `await next()`):**
> - ❌ خطأ: عدم عمل `await next()` داخل الوسيط أو إرجاع رد قبل استدعاء `next()`.
> - ✅ صحيح: استدعاء `await next()` لاستكمال مسار المعالجة، إلا إذا كان هناك رفض أمني صريح (مثل فشل التوثيق).

---

## 5. مصفوفة القرارات السريعة (Cheat Sheet)

| المهمة | الطريقة المعتمدة في Hono | ممنوع تماماً |
| :--- | :--- | :--- |
| قراءة المسار المتغير | `c.req.param('id')` | `req.params.id` |
| قراءة معلمات الاستعلام | `c.req.query('page')` | `req.query.page` |
| قراءة الـ Headers | `c.req.header('authorization')` | `req.headers['authorization']` |
| الوصول لقاعدة البيانات | `c.env.DB` | استدعاء اتصالات خارجية غير سحابية |
| تشغيل مهمة خلفية | `c.executionCtx.waitUntil(...)` | ترك الوعد طافياً بدون await أو waitUntil |
| إرسال رد JSON موحد | `sendResponse(c, 200, 'SLUG', 'message', data)` | `res.json(...)` أو `c.text(...)` للردود الهيكلية |

