# دليل أدوات التطوير والاختبار (`wrangler`, `@cloudflare/workers-types`, `vitest`) في MobiDash

> [!WARNING]
> **أرشيف الجيل السابق — لا يُعتمد في كود جديد.**
> المرجع المعتمد: [`../engineering/UNIFIED_METHODOLOGY.md`](../engineering/UNIFIED_METHODOLOGY.md) · [`../project/PROJECT_PROFILE.md`](../project/PROJECT_PROFILE.md).
> أمثلة الكود هنا قد لا تطابق الكود الحالي؛ لا تنسخ منها بلا مطابقة.

## 1. الغرض الهندسي في MobiDash (Engineering Purpose)
تمثل هذه الحزم بيئة التشغيل الهندسية (DevOps & Testing Stack) للواجهة الخلفية:
- **`wrangler` (^4.35.0):** أداة السطر البرمجي الرسمية من كلاود فلير لإدارة التهيئة، التشغيل المحلي (`dev`)، وإدارة ترحيلات قواعد البيانات (`migrations`).
- **`@cloudflare/workers-types` (^5.20260728.1):** حزمة تعريفات الأنواع (TypeScript Definitions) للارتباطات السحابية مثل `D1Database`, `KVNamespace`, `R2Bucket`, `ExecutionContext`.
- **`vitest` (^4.1.8) و `@cloudflare/vitest-pool-workers` (^0.22.0):** إطار الاختبارات الآلية الذي يشغّل الاختبارات داخل المحرك السحابي الفعلي (`workerd`) مع عزل التخزين (Isolated Storage).

---

## 2. إدارة ملف التهيئة `wrangler.jsonc` (Single Source of Truth)
> [!IMPORTANT]
> ملف `backend/wrangler.jsonc` هو **المصدر الوحيد والمطلق للحقيقة** لكافة إعدادات البيئة:
> - تسميات قواعد البيانات (`d1_databases`: الربط `DB`).
> - مساحات التخزين (`kv_namespaces`: الربط `mobidash`).
> - حاويات الملفات (`r2_buckets`: الربط `STORAGE`).
> - محددات المعدل (`ratelimits`: مثل `AUTH_LIMITER`, `DASHBOARD_LIMITER`).
> - المتغيرات البيئية (`vars`).
>
> **قاعدة إلزامية:** عند إضافة أي ربط جديد في `wrangler.jsonc`، يجب فوراً تحديث واجهة الأنواع في `src/types.ts` (`export type Bindings = { ... }`).

---

## 3. القواعد الصارمة والاستخدام الصحيح (Strict Rules & Correct Usage)

1. **قواعد استيراد الأنواع (`@cloudflare/workers-types`):**
   - استيراد الأنواع يجب أن يكون حصرياً كـ **Type-Only Import**:
     `import type { D1Database, KVNamespace, R2Bucket } from '@cloudflare/workers-types';`
   - يُمنع محاولة استدعاء أي كائن تشغيلي (Runtime Object) من هذه الحزمة لأنها مجرد تعريفات أنواع لـ TypeScript.

2. **قواعد تشغيل الاختبارات (`vitest`):**
   - تعمل الاختبارات داخل محرك `workerd` السحابي عبر المكون الإضافي `@cloudflare/vitest-pool-workers`.
   - يتم حقن المتغيرات السحابية في الاختبارات عبر:
     ```typescript
     import { env } from 'cloudflare:test';
     // env.DB, env.STORAGE متاحة ومعزولة لكل اختبار تلقائياً
     ```
   - استخدام بيئة التخزين المعزولة (`isolatedStorage: true`) يضمن عدم تداخل البيانات بين الاختبارات.

3. **محاكاة الحزم غير المتوافقة مع Edge (Testing Mocks):**
   - تم ضبط `vitest.config.ts` لاستبدال الحزم التي تعتمد على بيئة Node (مثل `sanitize-html` و `cloudflare`) بمحاكيات خفيفة في `./tests/mocks/` لتجنب انهيار بيئة `workerd`.

4. **صلاحيات أوامر السطر البرمجي المسموحة للوكيل (Agent Command Permissions):**
   - ✅ **المسموح به دوماً للتحقق:**
     ```powershell
     cd F:\program\MobiDash\backend
     npx tsc --noEmit
     ```
   - ✅ **المسموح به لتشغيل الاختبارات:**
     ```powershell
     npm run test
     ```
   - ❌ **ممنوع منعاً باتاً تشغيل:**
     - `wrangler deploy` (النشر يتم يدوياً فقط بواسطة المستخدم).
     - `git push` أو `git commit`.

---

## 4. فخاخ وأخطاء الذكاء الاصطناعي القاتلة (AI Anti-Patterns & Traps)

> [!CAUTION]
> **1. فخ محاولة النشر التلقائي (`wrangler deploy`):**
> - ❌ خطأ خطير: تشغيل `wrangler deploy` أو محاولة تعديل إعدادات الإنتاج السحابية دون إذن صريح ومباشر من المستخدم.
> - ✅ صحيح: الاكتفاء بالتحقق المحلي الصارم عبر `npx tsc --noEmit` واختبارات `vitest`.

> [!CAUTION]
> **2. فخ استخدام دوال Jest في بيئة Vitest/Workerd:**
> - ❌ خطأ: استخدام `jest.mock()` أو استدعاء كائنات عامة خاصة بـ Node.js مثل `process.env`.
> - ✅ صحيح: استخدام دوال `vi` من `vitest` (مثل `vi.fn()`, `vi.spyOn()`) والوصول للبيئة عبر `env` من `cloudflare:test`.

> [!CAUTION]
> **3. فخ اختلاف أسماء الـ Bindings في الكود عن `wrangler.jsonc`:**
> - ❌ خطأ: تسمية الربط في الكود `c.env.DATABASE` بينما هو معرف في `wrangler.jsonc` باسم `DB`.
> - ✅ صحيح: مطابقة الأسماء حرفياً لما هو موثق في `wrangler.jsonc` و `src/types.ts`.

---

## 5. مصفوفة القرارات السريعة (Cheat Sheet)

| المكون / الأداة | الاستخدام السليم | الخطأ الشائع |
| :--- | :--- | :--- |
| `wrangler` | مرجع الـ Bindings وتطبيق الـ Migrations محلياً | تشغيل أمر Deploy بدون إذن |
| `@cloudflare/workers-types` | `import type { D1Database } from '...'` | محاولة استخدامها كـ Runtime Class |
| `vitest` | فحص الـ Endpoints والخدمات داخل محاكي Worker | استخدام Jest Mocks غير المتوافقة مع `workerd` |
| فحص جودة وتوافق الأنواع | `cd F:\program\MobiDash\backend; npx tsc --noEmit` | تجاهل الفحص البرمجي بعد التعديل |

