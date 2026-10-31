# دليل حزمة `cloudflare` وعميل الـ REST API في MobiDash (Cloudflare SDK Guide)

> [!WARNING]
> **أرشيف الجيل السابق — لا يُعتمد في كود جديد.**
> المرجع المعتمد: [`../engineering/UNIFIED_METHODOLOGY.md`](../engineering/UNIFIED_METHODOLOGY.md) · [`../project/PROJECT_PROFILE.md`](../project/PROJECT_PROFILE.md).
> أمثلة الكود هنا قد لا تطابق الكود الحالي؛ لا تنسخ منها بلا مطابقة.

## 1. الغرض الهندسي في MobiDash (Engineering Purpose)
حزمة `cloudflare` (^6.3.0) هي مكتبة الـ SDK الرسمية للتواصل مع واجهات برمجة تطبيقات كلاود فلير عبر الإنترنت (Cloudflare REST APIs). في معمارية MobiDash، تُستخدم هذه الحزمة **كخيار ثانوي احتياطي (Fallback Client)** حصراً للعمليات الإدارية أو لإرسال البريد الإلكتروني عبر Cloudflare Email Routing عندما لا يكون الـ Native Worker Binding متاحاً.

---

## 2. الفارق الجوهري بين الـ Bindings وحزمة الـ SDK (Edge Bindings vs REST SDK)

> [!IMPORTANT]
> **قاعدة معمارية ثابتة:**
> - **الارتباطات الأصلية (Native Bindings):** تعمل في الذاكرة مباشرة داخل الـ Edge Isolate (زمن استجابة شبه فوري بميكروثانية) عبر كائن البيئة `c.env` (مثل `c.env.DB` و `c.env.STORAGE` و `c.env.mobidash` و `c.env.EMAILER`).
> - **حزمة الـ SDK (`cloudflare`):** تُجري طلبات شبكة خارجية عبر بروتوكول HTTP إلى خوادم `api.cloudflare.com`، مما يستهلك وقتاً إضافياً (Latency) ويتطلب وجود `CLOUDFLARE_API_TOKEN`.

---

## 3. متى يُسمح باستخدام حزمة `cloudflare`؟ (Allowed Use Cases)

تُستخدم فقط في الحالات الاستثنائية التالية داخل طبقة الخدمات (مثل `services/email.services.ts` و `services/auth.services.ts`):
1. **إرسال البريد عند غياب الـ Native Binding:**
   - إذا لم يكن رابط `c.env.EMAILER` متوفراً (مثل بعض بيئات التطوير المحلية)، يتم اللجوء إلى الـ REST API:
   ```typescript
   if (env?.CLOUDFLARE_API_TOKEN && accountId) {
     const client = new Cloudflare({ apiToken: env.CLOUDFLARE_API_TOKEN });
     await client.emailSending.send({ ... });
   }
   ```
2. **الاستعلامات الإدارية الخاصة بحساب Cloudflare:**
   - قراءة إحصائيات خاصة أو إدارة إعدادات لا توفر لها بيئة الـ Worker رابطاً برمجياً مباشراً.

---

## 4. فخاخ وأخطاء الذكاء الاصطناعي القاتلة (AI Anti-Patterns & Traps)

> [!CAUTION]
> **1. الخطأ الكارثي للذكاء الاصطناعي: محاولة التعامل مع D1 أو KV عبر الـ SDK:**
> - ❌ خطأ قاتل: محاولة قراءة أو كتابة بيانات D1 أو KV أو R2 عبر استدعاء كائن `new Cloudflare()`:
>   ```typescript
>   // خطأ كارثي وممنوع منعاً باتاً!
>   const client = new Cloudflare({ apiToken: env.CLOUDFLARE_API_TOKEN });
>   await client.d1.database.query(...); 
>   ```
> - **لماذا هو كارثي؟**
>   - يؤدي لزمن تأخير هائل (تجاوز اتصال الذاكرة السريع وإجراء اتصالات إنترنت خارجية غير مشفرة بين الخوادم).
>   - يفقد الحماية المضمنة في عزل المستأجر وتدقيق الـ Types.
>   - يستهلك الـ Rate Limits المخصصة لواجهات كلاود فلير الإدارية بدلاً من الموارد المخصصة للتطبيق.
> - ✅ صحيح: استخدام الـ Binding المباشر فقط: `c.env.DB.prepare(...)` و `c.env.mobidash.get(...)`.

> [!CAUTION]
> **2. فخ إنشاء العميل بدون فحص وجود الـ Token:**
> - ❌ خطأ: كتابة `const client = new Cloudflare({ apiToken: env.CLOUDFLARE_API_TOKEN })` مباشرة دون التحقق من وجود المتغير. سيؤدي إلى انهيار الطلب إذا لم يكن التوكن مهيأ في البيئة.
> - ✅ صحيح: فحص مسبق: `if (env?.CLOUDFLARE_API_TOKEN) { ... } else { logger.warn(...) }`.

> [!CAUTION]
> **3. فخ إهمال كتلة try-catch وعزل الفشل (Fail-Safe):**
> - ❌ خطأ: ترك استدعاء `client.emailSending.send` يرمي استثناءً غير معالج يوقف استجابة المستخدم.
> - ✅ صحيح: تغليف استدعاءات الـ REST SDK دائماً بكتلة `try-catch` وتسجيل الخطأ في `logger.error`، وضمان عدم انهيار العملية الأساسية للمستخدم في حال تعطل خدمة الإيميل.

---

## 5. مصفوفة القرارات السريعة (Cheat Sheet)

| المورد السحابي | الطريقة المعتمدة حصراً | هل يجوز استخدام حزمة `cloudflare`؟ |
| :--- | :--- | :--- |
| قاعدة بيانات D1 | `c.env.DB` | ❌ **ممنوع قطعياً** |
| مخزن الذاكرة KV | `c.env.mobidash` | ❌ **ممنوع قطعياً** |
| تخزين الملفات R2 | `c.env.STORAGE` | ❌ **ممنوع قطعياً** |
| محدد المعدل Rate Limiter | `c.env.AUTH_LIMITER` | ❌ **ممنوع قطعياً** |
| إرسال البريد الإلكتروني | `c.env.EMAILER` (الأساسي) | ✅ **نعم، كخيار احتياطي (Fallback) فقط** عند غياب EMAILER |

