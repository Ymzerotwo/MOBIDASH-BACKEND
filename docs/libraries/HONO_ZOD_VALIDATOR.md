# دليل وسيط التحقق `@hono/zod-validator` في MobiDash

> [!WARNING]
> **أرشيف الجيل السابق — لا يُعتمد في كود جديد.**
> المرجع المعتمد: [`../engineering/UNIFIED_METHODOLOGY.md`](../engineering/UNIFIED_METHODOLOGY.md) · [`../project/PROJECT_PROFILE.md`](../project/PROJECT_PROFILE.md).
> أمثلة الكود هنا قد لا تطابق الكود الحالي؛ لا تنسخ منها بلا مطابقة.

## 1. الغرض الهندسي في MobiDash (Engineering Purpose)
حزمة `@hono/zod-validator` (^0.7.6) هي الوسيط الرسمي المعتمد لربط مسارات `hono` بمخططات التحقق `zod`. تقوم الحزمة باعتراض الطلب قبل وصوله إلى طبقة الكنترولر (Controller)، وفحص المدخلات (`json`، `query`، `param`، `header`)، وإرجاع رد خطأ قياسي (HTTP 400) تلقائياً عند عدم مطابقة البيانات، مما يضمن وصول بيانات منقاة ومفحوصة بالكامل للكنترولر.

---

## 2. متى تُستخدم الحزمة؟ (When to Use)
- تُستخدم حصراً في طبقة المسارات `src/routes/` كـ Middleware يتم حقنه قبل استدعاء دوال الكنترولر.
- عند استقبال أي بيانات في جسم الطلب (`json`).
- عند استقبال معلمات تصفية أو بحث أو ترقيم في الاستعلام (`query`).
- عند استقبال معلمات في رابط المسار (`param` مثل معرف الكيان أو الـ UUID).

---

## 3. القواعد الصارمة والاستخدام الصحيح (Strict Rules & Correct Usage)

1. **الربط القياسي في المسارات:**
   - يتم تمرير `zValidator` مع نوع الهدف والمخطط المعتمد:
   ```typescript
   import { zValidator } from '@hono/zod-validator';
   import { loginSchema } from '../validators/auth.validators';

   router.post('/login', zValidator('json', loginSchema, (result, c) => {
     if (!result.success) {
       return sendResponse(c, 400, 'VALIDATION_ERROR', 'Invalid input data', null, result.error.issues);
     }
   }), authController.login);
   ```

2. **القاعدة الذهبية لاستخراج البيانات في الكنترولر:**
   - البيانات المفحوصة والمطهرة تُستخرج **حصراً** عبر:
     - `const body = c.req.valid('json');` لبيانات الـ JSON.
     - `const query = c.req.valid('query');` لمعلمات الـ Query.
     - `const params = c.req.valid('param');` لمعلمات الرابط.
   - هذه الدالة تعيد بيانات ذات أنواع دقيقة وموثوقة (Fully Typed) مستنبطة من Zod schema.
   - ملاحظة على الكود الحالي: الملفات القائمة تكتب `c.req.valid('json' as never) as X` للتوافق مع أنواع Hono في هذا المشروع؛ اتبع الاصطلاح السائد في الملف الذي تعدّله.

3. **التحقق المشترك (Multiple Validations):**
   - يمكن دمج عدة وسطاء في نفس المسار للتحقق من الرابط والـ Body معاً:
     `router.put('/:id', zValidator('param', idParamSchema), zValidator('json', updateSchema), controller.update);`

---

## 4. فخاخ وأخطاء الذكاء الاصطناعي القاتلة (AI Anti-Patterns & Traps)

> [!CAUTION]
> **1. الخطأ القاتل الأكبر: استدعاء `c.req.json()` بعد الـ Validator:**
> - ❌ خطأ متكرر جداً من النماذج:
>   ```typescript
>   // في الكنترولر بعد تطبيق zValidator
>   const body = await c.req.json(); // خطأ فادح!
>   ```
> - **لماذا هو خطأ فادح؟**
>   1. يؤدي إلى إعادة قراءة مجرى البيانات (Stream Re-consumption) أو استهلاك غير ضروري.
>   2. يتجاهل كافة عمليات التطهير والتحويل (`.transform(sanitizeForDb)`) التي قام بها Zod، ويعيد بيانات خام غير آمنة!
>   3. يفقد الاستنتاج الدقيق للأنواع (Type Safety).
> - ✅ الصحيح دائماً: `const body = c.req.valid('json');`

> [!CAUTION]
> **2. فخ تكرار التحقق داخل الكنترولر (Redundant Manual Checks):**
> - ❌ خطأ: كتابة `if (!body.email) return ...` داخل الكنترولر بعد التحقق بـ `zValidator`.
> - ✅ صحيح: الثقة بمخطط Zod؛ إذا وصل الكود إلى الكنترولر، فالبيانات مضمونة ومطابقة للمخطط.

> [!CAUTION]
> **3. فخ إرجاع أخطاء غير منسقة للمستخدم:**
> - ❌ خطأ: ترك `zValidator` يرمي رد افتراضي يختلف عن هيكل المشروع الموحد.
> - ✅ صحيح: تزويد `zValidator` بدالة معالجة الخطأ المخصصة لتعيد الرد عبر `sendResponse` مع كود 400.

---

## 5. مصفوفة القرارات السريعة (Cheat Sheet)

| السيناريو | الطريقة الإلزامية | ممنوع قطعياً |
| :--- | :--- | :--- |
| قراءة Body مفحوص | `c.req.valid('json')` | `await c.req.json()` |
| قراءة Query مفحوص | `c.req.valid('query')` | `c.req.query()` المباشر بدون فحص |
| قراءة Param مفحوص | `c.req.valid('param')` | `c.req.param()` المباشر للمعرفات الحساسة |
| معالجة فشل التحقق | استخدام `sendResponse` بكود 400 وتفاصيل `result.error.flatten()` | رمي Unhandled Exception أو إرجاع كائن غير متوافق |

