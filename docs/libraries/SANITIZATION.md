# دليل التطهير ومكافحة XSS وحقن Wildcard في MobiDash (`sanitize-html` و `utils/sanitize.ts`)

> [!WARNING]
> **أرشيف الجيل السابق — لا يُعتمد في كود جديد.**
> المرجع المعتمد: [`../engineering/UNIFIED_METHODOLOGY.md`](../engineering/UNIFIED_METHODOLOGY.md) · [`../project/PROJECT_PROFILE.md`](../project/PROJECT_PROFILE.md).
> أمثلة الكود هنا قد لا تطابق الكود الحالي؛ لا تنسخ منها بلا مطابقة.

## 1. الغرض الهندسي في MobiDash (Engineering Purpose)
حزمة `sanitize-html` (^2.17.4) ووحدة التطهير المركزية `backend/src/utils/sanitize.ts` هما درع الحماية ضد هجمات حقن الأكواد عبر المتصفح (Cross-Site Scripting - XSS) وهجمات حقن المحارف الخاصة في استعلامات البحث (SQL LIKE Wildcard Injection).

---

## 2. بيئة Cloudflare Workers وحقيقة مكتبات التطهير (Edge vs Node DOM)
> [!IMPORTANT]
> **لماذا يمتلك MobiDash محرك تطهير مخصص في `src/utils/sanitize.ts`؟**
> - حزمة `sanitize-html` التقليدية تعتمد داخلياً على محللات DOM خاصة ببيئة Node.js (`htmlparser2`) غير متوفرة أو تسبب حملاً كبيراً داخل محرك `workerd` السريع في كلاود فلير.
> - لذلك، يعتمد MobiDash على:
>   1. **محرك تعقيم خفيف وسريع بالـ Regular Expressions** في `src/utils/sanitize.ts` للتشغيل الفعلي في خوادم الـ Edge.
>   2. **محاكي معزول (Test Mock)** في `tests/mocks/sanitize-html.ts` لضمان عمل الاختبارات الآلية بسرعة ونقاء دون الاعتماد على مكتبات ثقيلة.

---

## 3. الدوال المركزية وقواعد الاستخدام الإلزامي (Core Functions & Usage)

توجد في `src/utils/sanitize.ts` أربع دوال رئيسية يجب على النموذج معرفة موعد استخدام كل منها:

### 1. `sanitizeForDb(val: string): string`
- **الغرض:** تعقيم وتطهير النصوص التي يُدخلها المستخدم قبل تخزينها في قاعدة بيانات D1.
- **الاستخدام:** تُستخدم داخل مخططات Zod عبر `.transform(sanitizeForDb)` أو يدوياً قبل إدخال النصوص الحرة.
- **ماذا تفعل؟** تقوم بتهذيب المسافات (`trim`) وترميز الحروف الحساسة للمتصفحات (`&`, `<`, `>`, `"`, `'`).

### 2. `escapeLikePattern(input: string, maxLength = 100): string`
- **الغرض:** تأمين استعلامات البحث بنمط `LIKE` في قاعدة بيانات D1 / SQLite.
- **الاستخدام:** **إلزامي قبل أي استعلام يحتوي على `LIKE '%' || ? || '%'`**.
- **ماذا تفعل؟**
  1. تفحص النص وتحد طوله الأقصى (افتراضياً 100 محرف) لمنع هجمات إنهاك المعالج.
  2. تلغي تأثير المحارف الخاصة في SQL (`%` و `_` و `\`) بإضافة الهروب (`\`).

### 3. `sanitizeSearchInput(input: unknown, maxLength = 100): string`
- **الغرض:** تنظيف معلمات البحث من البايتات الصفرية (`\0`) ومحارف التحكم المخفية، ونزع بروتوكولات الخطر مثل `javascript:` و `data:` ووسوم الـ HTML وأحداث الـ JS المضمنة (`onerror=`, `onload=`).

### 4. `sanitizeHtml(str: string | null | undefined): string`
- **الغرض:** ترميز محارف HTML لمنع تنفيذ الأكواد في سياق المتصفح أو في قوالب رسائل البريد الإلكتروني (Email Notifications).

---

## 4. فخاخ وأخطاء الذكاء الاصطناعي القاتلة (AI Anti-Patterns & Traps)

> [!CAUTION]
> **1. فخ الاعتماد على Parameter Binding لحماية استعلامات `LIKE`:**
> - ❌ خطأ متكرر جداً: يظن النموذج أن `db.prepare("SELECT ... WHERE name LIKE ?").bind('%' + input + '%')` كافٍ لمنع ثغرات LIKE!
> - **الحقيقة التقنية:** ربط المعاملات يمنع الـ SQL Injection الكلاسيكي فقط، لكن محرك SQLite سيعتبر الـ `%` أو `_` القادمة من المستخدم محارف مطابقة عامة (Wildcards). إذا أرسل المستخدم `%` متكررة أو أحرف بحث واسعة، يتم إجراء مسح كامل للجدول (Full Table Scan DoS)!
> - ✅ صحيح: تمرير المدخل أولاً عبر `escapeLikePattern`:
>   ```typescript
>   const safePattern = escapeLikePattern(searchTerm);
>   const stmt = db.prepare(`SELECT ... WHERE name LIKE '%' || ? || '%' ESCAPE '\\'`).bind(safePattern);
>   ```

> [!CAUTION]
> **2. فخ استيراد مكتبات DOM ثقيلة للباك إند:**
> - ❌ خطأ: استيراد مكتبات مثل `jsdom` أو استدعاء `sanitize-html` مباشرة دون التحقق من بيئة `workerd`.
> - ✅ صحيح: استخدام `src/utils/sanitize.ts` المصممة خصيصاً للـ Edge Runtime في المشروع.

> [!CAUTION]
> **3. فخ دمج نصوص المستخدم مباشرة في قوالب الإيميل:**
> - ❌ خطأ: كتابة `const html = `<div>مرحباً ${userName}</div>`` بدون تعقيم.
> - ✅ صحيح: تمرير `sanitizeHtml(userName)` قبل وضعه داخل قالب الإيميل.

---

## 5. مصفوفة القرارات السريعة (Cheat Sheet)

| نوع المعالجة | الدالة المعتمدة | موقع الاستدعاء |
| :--- | :--- | :--- |
| نص يدخل قاعدة البيانات (D1) | `sanitizeForDb(str)` | داخل Zod schemas أو قبل الإدخال |
| استعلام بحث `LIKE` | `escapeLikePattern(term)` | في طبقة الخدمات (Services) قبل بناء الاستعلام |
| تصفية مدخلات البحث العامة | `sanitizeSearchInput(query)` | في معالجة طلبات الـ Search |
| نصوص تُعرض في الإيميل أو المتصفح | `sanitizeHtml(rawText)` | في قوالب البريد الإلكتروني وإشعارات النظام |

