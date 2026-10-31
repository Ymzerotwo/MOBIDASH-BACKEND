# دليل استخدام مكتبة `zod` في MobiDash (Zod Validation Guide)

> [!WARNING]
> **أرشيف الجيل السابق — لا يُعتمد في كود جديد.**
> المرجع المعتمد: [`../engineering/UNIFIED_METHODOLOGY.md`](../engineering/UNIFIED_METHODOLOGY.md) · [`../project/PROJECT_PROFILE.md`](../project/PROJECT_PROFILE.md).
> أمثلة الكود هنا قد لا تطابق الكود الحالي؛ لا تنسخ منها بلا مطابقة.

## 1. الغرض الهندسي في MobiDash (Engineering Purpose)
حزمة `zod` (^4.4.1) هي أداة بناء مخططات التحقق من البيانات (Schema Validation) واستنباط الأنواع الصارمة لـ TypeScript أثناء وقت التشغيل (Runtime Type Checking). تُستخدم في طبقة `src/validators/` كخط دفاع أمامي أول لحماية خوادم الـ Edge من البيانات المشوهة، وتطهير المدخلات قبل وصولها لقاعدة البيانات.

---

## 2. متى تُستخدم المكتبة؟ (When to Use)
- تعريف كافة مخططات الإدخال للواجهة الخلفية (Body, Query, Params, Headers).
- تحويل وتطهير النصوص آلياً (`.transform(sanitizeForDb)`).
- استنباط أنواع TypeScript الصارمة المشتركة بين الطبقات عبر `z.infer`.
- تدقيق شروط الاعتماد المتبادل بين الحقول (Cross-field Validation عبر `.refine()`).

---

## 3. القواعد الصارمة والاستخدام الصحيح (Strict Rules & Correct Usage)

1. **التقييد الصارم للنصوص لمنع هجمات الذاكرة (Length Caps & Trimming):**
   - **قاعدة إلزامية:** يُمنع منعاً باتاً ترك أي حقل نصي `z.string()` مفتوحاً بدون حد أقصى `.max(N)` وبدون `.trim()`.
   ```typescript
   export const createItemSchema = z.object({
     name: z.string().trim().min(1, { message: 'name_required' }).max(150, { message: 'too_long' }),
     description: z.string().trim().max(1000, { message: 'too_long' }).optional(),
   });
   ```

2. **التطهير والتعقيم التلقائي عند الحفظ (Sanitization Transform):**
   - الحقول النصية التي قد تحتوي على نصوص حرة أو أكواد يجب تطهيرها بربطها بدالة التعقيم المعتمدة:
     `code: z.string().trim().length(6).transform(sanitizeForDb)`

3. **توحيد حالة النصوص (Case Normalization):**
   - البريد الإلكتروني وأسماء المستخدمين غير الحساسة لحالة الأحرف يجب تحويلها آلياً لأحرف صغيرة:
     `email: z.string().trim().toLowerCase().email({ message: 'invalid_email' }).max(255)`

4. **استنباط الأنواع الموحدة (Type Inference):**
   - يُمنع إعادة كتابة الـ TypeScript Interface يدوياً؛ يتم استنباط النوع مباشرة من المخطط وتصديره:
     `export type LoginInput = z.infer<typeof loginSchema>;`

5. **التحقق المشروط والمتبادل (Refinement):**
   - عند اشتراط وجود حقل من بين عدة حقول اختيارية (مثل رقم الهاتف أو البريد)، يُستخدم `.refine()`:
     ```typescript
     .refine((data) => Boolean(data.email || data.phone), {
       message: 'email_or_phone_required',
       path: ['email'],
     });
     ```

---

## 4. فخاخ وأخطاء الذكاء الاصطناعي القاتلة (AI Anti-Patterns & Traps)

> [!CAUTION]
> **1. فخ استعلام قاعدة البيانات داخل مخطط Zod:**
> - ❌ خطأ متكرر: محاولة التحقق مما إذا كان الإيميل مسجلاً أو المستخدم موجوداً داخل Zod عبر استعلام غير متزامن `z.string().refine(async (email) => checkDb(email))`.
> - **لماذا هو خطأ؟** Zod مخصص للتحقق من **شكل وهيئة البيانات (Syntactic Validation)** وليس الحالة السحابية (Semantic/State Validation). فحص قاعدة البيانات مكانه الحصري هو طبقة **الخدمات (Services Layer)**.

> [!CAUTION]
> **2. فخ النصوص المفتوحة بدون حدود (Unbounded Strings):**
> - ❌ خطأ: كتابة `z.string()` بدون `.max()`. يتيح للمهاجمين إرسال نصوص بحجم ميجابايتات تؤدي إلى استنزاف ذاكرة الـ Worker واختناق المعالج (Memory Exhaustion / ReDoS).
> - ✅ صحيح: وضع حد أقصى واقعي لكل حقل دائماً (مثلاً: الاسم 150، الوصف 1000، البريد 255).

> [!CAUTION]
> **3. فخ استخدام `z.any()` أو `z.unknown()`:**
> - ❌ خطأ: استخدام `z.any()` للهروب من التدقيق، مما يعطل الغرض الأمني بالكامل.
> - ✅ صحيح: تعريف الحقول المعقدة بدقة عبر `z.record()`, `z.array()`, أو `z.discriminatedUnion()`.

> [!CAUTION]
> **4. فخ تكرار كتابة النوع (Type Divergence):**
> - ❌ خطأ: كتابة `interface User { name: string }` بجانب `userSchema = z.object(...)`. إذا تم تعديل أحدهما يقع تعارض صامت.
> - ✅ صحيح: المصدر الوحيد للنوع هو `z.infer<typeof userSchema>`.

---

## 5. مصفوفة القرارات السريعة (Cheat Sheet)

| نوع البيانات | النمط المعتمد في Zod |
| :--- | :--- |
| بريد إلكتروني | `z.string().trim().toLowerCase().max(255).email({ message: 'invalid_email' })` |
| نص مخصص لقاعدة البيانات | `z.string().trim().max(N).transform(sanitizeForDb)` |
| معرف UUID | `z.string().trim().uuid({ message: 'invalid_id' })` |
| رقم صحيح موجب | `z.number().int().positive({ message: 'invalid_positive_number' })` |
| قيمة منطقية اختيارية | `z.boolean().optional().default(false)` |
| نوع الإخراج المشتق | `export type MyType = z.infer<typeof mySchema>;` |

