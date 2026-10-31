# دليل الأمان المتقدم، مكافحة الثغرات، وأفضل ممارسات Hono و Cloudflare Workers و TypeScript
# MobiDash Backend Security, Anti-Vulnerability & Engineering Best Practices Guide

> [!WARNING]
> **أرشيف الجيل السابق — لا يُعتمد في كود جديد.**
> المرجع المعتمد: [`engineering/UNIFIED_METHODOLOGY.md`](./engineering/UNIFIED_METHODOLOGY.md) · [`project/PROJECT_PROFILE.md`](./project/PROJECT_PROFILE.md).
> أمثلة الكود هنا قد لا تطابق الكود الحالي؛ لا تنسخ منها بلا مطابقة.

> **الغرض الإلزامي من هذا الملف:**
> هذا الدليل هو المرجع الأمني والهندسي الصارم لمنظومة MobiDash الخلفية.
> تم تصميمه ليكون حائط صد قطعي يمنع الذكاء الاصطناعي (AI Agent) والمهندسين من ارتكاب أخطاء أمنية، إضافة بيانات وهمية (Mock Data)، أو كتابة أكواد رديئة، ويوفر دليلاً عملياً دقيقاً لأحدث ثغرات الويب لعام 2025/2026 وأفضل ممارسات Hono و Cloudflare Workers و TypeScript.

---

## 1. القاعدة الذهبية: حظر البيانات الوهمية والتخمينية بشكل مطلق (Strict Zero-Mock & Dynamic Data Integrity Rule)

> [!CAUTION]
> **ممنوع منعاً باتاً كتابة أي بيانات وهمية (Mock Data) أو افتراض قيم ثابتة من رأس النموذج!**
> يجب أن تكون كافة البيانات المتداولة، المخزنة، أو المرجعة مرتبطة بشكل ديناميكي وحقيقي بسياق الطلب (Request Payload) أو مسحوبة فعلياً من قاعدة البيانات D1 أو ذاكرة KV.

### أمثلة على الأخطاء القاتلة الممنوعة قطعياً مقابل الأسلوب الصحيح:

#### أ. في إنشاء الجلسات والصلاحيات (Session & Permission Creation):
* ❌ **كارثة أمنية ممنوعة:** إعطاء صلاحيات ثابتة أو افتراض أن المستخدم يملك كل الصلاحيات:
  ```ts
  // خطأ فادح: وضع قيم ثابتة من رأس النموذج
  const sessionData = {
    user_id: user.id,
    role: 'owner', // خطأ: تثبيت الدور كمالك!
    permissions: { "*": true } // خطأ كارثي: منح كافة الصلاحيات بدون قراءتها من قاعدة البيانات!
  };
  ```
* ✅ **الأسلوب الصحيح الإلزامي:** استخراج الدور والصلاحيات الفعلية المخزنة للمستخدم من قاعدة البيانات:
  ```ts
  const userRecord = await db.prepare(
    'SELECT id, role, permissions, is_banned, is_active FROM Users WHERE id = ? AND dashboard_id = ?'
  ).bind(userId, dashboardId).first<any>();

  if (!userRecord) return { error: 'USER_NOT_FOUND', status: 404 };

  const parsedPermissions = typeof userRecord.permissions === 'string' 
    ? JSON.parse(userRecord.permissions) 
    : (userRecord.permissions || {});

  const sessionData = {
    user_id: userRecord.id,
    role: userRecord.role, // الدور الحقيقي المسجل في الداتابيز
    permissions: userRecord.role === 'owner' ? { "*": true } : parsedPermissions // الصلاحيات الفعلية فقط
  };
  ```

#### ب. في حفظ وتعديل البيانات (Entity Creation & Updates):
* ❌ **خطأ ممنوع:** تجاهل الحقول القادمة في الطلب وتثبيت نصوص أو أرقام وهمية:
  ```ts
  // خطأ: حفظ اسم ثابت أو رصيد وهمي
  await db.prepare('INSERT INTO Items (name, price) VALUES (?, ?)').bind('هاتف تجريبي', 100);
  ```
* ✅ **الأسلوب الصحيح الإلزامي:** استخدام البيانات المفحوصة والمعقمة القادمة من الطلب حصراً:
  ```ts
  const body = c.req.valid('json' as never) as CreateItemInput;
  await db.prepare('INSERT INTO Items (name, price) VALUES (?, ?)').bind(body.name, body.price);
  ```

#### ج. في الإحصائيات والحسابات المالية (Aggregations & Financials):
* ❌ **خطأ ممنوع:** إرجاع أرقام إحصائية ثابتة أو وهمية:
  ```ts
  // خطأ: اختراع أرقام وهمية لتمشية الكود
  return { totalRevenue: 50000, activeStaff: 5 };
  ```
* ✅ **الأسلوب الصحيح الإلزامي:** حساب الأرقام عبر استعلامات تجميعية SQL فعلية على بيانات المتجر:
  ```ts
  const stats = await db.prepare(`
    SELECT 
      COALESCE(SUM(total_amount), 0) as totalRevenue,
      COUNT(DISTINCT id) as totalSales
    FROM Invoices
    WHERE dashboard_id = ? AND status = 'completed'
  `).bind(dashboardId).first();
  ```

#### د. في الأسرار والمفاتيح والمصادقة (Secrets & Environment):
* ❌ **خطأ ممنوع:** وضع مفتاح سري احتياطي ثابت (Fallback Secret) في الكود:
  ```ts
  // خطأ أمني جسيم: وضع سر احتياطي مكشوف في الكود
  const secret = c.env.JWT_SECRET || 'super-secret-fallback-123';
  ```
* ✅ **الأسلوب الصحيح الإلزامي:** رمي استثناء فوري وتوقف آمن إذا غاب المتغير البيئي المشفر:
  ```ts
  const secret = c.env.MASTER_SECRET;
  if (!secret) {
    logger.error(reqId, 'CRITICAL_ENV_MISSING: MASTER_SECRET is not configured');
    return sendResponse(c, 500, 'SERVER_MISCONFIGURATION', 'خطأ في إعدادات الخادم الأمنية');
  }
  ```

---

## 2. قائمة الممنوعات الفورية (The Zero-Tolerance Blacklist)

إذا وُجد أي بند من البنود التالية في كود الواجهة الخلفية، **يُعتبر الكود معيباً ومرفوضاً تلقائياً**:

| # | العنصر المحظور | سبب الحظر القاطع | البديل الإلزامي المعتمد |
| :--- | :--- | :--- | :--- |
| **1** | المتغيرات العامة القابلة للتعديل (`let` أو mutable objects في نطاق الـ Module) | تسريب بيانات المتاجر والمستخدمين بين طلبات V8 Isolates في Cloudflare Workers | حصر كافة المتغيرات والبيانات داخل نطاق دالة الطلب (`c.get()`, `c.set()`, المعاملات) |
| **2** | استخدام النوع `any` بدون ضرورة قصوى | إلغاء فحص الأنواع البرمجية، فتح الباب للأخطاء الصامتة وكسر استقرار النظام | استخدام `unknown` مع Type Narrowing، أو تعريف Generics و Zod Inferred Types |
| **3** | دمج السلاسل النصية في SQL (String Concatenation أو Template Literals) | ثغرات حقن قواعد البيانات (SQL Injection) التي تدمر أو تسرب قاعدة بيانات D1 | استخدام الاستعلامات المجهزة المربوطة حصراً: `db.prepare(...).bind(...)` |
| **4** | استدعاء `SELECT`, `UPDATE`, `DELETE` بدون `dashboard_id = ?` | كسر عزل المستأجر وتداخل بيانات المحلات وحسابات الكاشير (BOLA / IDOR) | إرفاق `WHERE dashboard_id = currentUser.dashboard_id` في كل استعلام مشترك |
| **5** | مقارنة الرموز الأمنية، المفاتيح، والـ Hashes عبر `===` | ثغرات هجمات التوقيت (Timing Attacks) التي تكشف كلمات المرور والتفويض | استخدام المقارنة الآمنة زمنياً: `crypto.subtle.timingSafeEqual(...)` |
| **6** | استخدام `eval()` أو `new Function()` | إتاحة تنفيذ الأكواد عن بُعد (Remote Code Execution - RCE) | حظر كامل وتام بدون أي استثناء |
| **7** | جلب روابط إنترنت يوفرها المستخدم بدون فحص (`fetch(userProvidedUrl)`) | ثغرات طلبات الخادم المزورة (SSRF) وفحص شبكات Cloudflare الداخلية | تطبيق قائمة سماح بيضاء صارمة وحظر نطاقات الـ Loopback والـ Private IPs |
| **8** | الوصول المباشر لكائنات الصلاحيات دون حماية ضد التلاعب | ثغرات تلوث النموذج الأولي (Prototype Pollution) والترقية غير المصرح بها | فحص `hasOwnProperty` وحظر `__proto__` و `constructor` و `prototype` |
| **9** | التعابير النمطية المعقدة المتداخلة (Nested Regexes) بدون تقييد الطول | ثغرات التعطيل بالتعابير النمطية (ReDoS) واستهلاك زمن المعالج المحدود (CPU Limit) | تقييد طول السلاسل بـ `max(100)` واستخدام تعابير خطية غير تكرارية |
| **10** | حفظ مدخلات المستخدم النصية بدون تعقيم في قاعدة البيانات | ثغرات XSS المخزنة التي تستهدف لوحة التحكم عند استرجاع البيانات | تطبيق `.transform(sanitizeForDb)` مع كل حقل نصي في مخططات Zod |
| **11** | أوامر Git أو أوامر البناء الثقيلة (`git push`, `npm run build`, `wrangler deploy`) | استهلاك موارد ثقيلة، بطء التطوير، وتغيير المستودع دون إذن المستخدم | حظر تشغيلها إلا بطلب كتابي مباشر ومحدد من المستخدم |

---

## 3. أحدث وأخطر ثغرات الويب والـ Edge للعامين 2025/2026 وطرق الحماية

### 1. ثغرة تسريب الذاكرة بين المستأجرين (V8 Isolate State Leakage)
* **طبيعة الثغرة في Cloudflare Workers:**
  لا يقوم Cloudflare بتدمير بيئة تشغيل الـ Worker بعد كل طلب، بل يُبقي الـ Isolate حياً في الذاكرة لخدمة طلبات متتالية من كاشيرات أو متاجر مختلفة للقضاء على الـ Cold Start.
  إذا قام المطور بتعريف متغير `let currentUser;` في أعلى الملف خارج `export default`، فإن بيانات المستخدم الأول ستظل مخزنة في الذاكرة وتظهر للمستخدم التالي!
* **كود الحماية الإلزامي:**
  ```ts
  // ❌ ثغرة أمنية فادحة: متغير عام خارج دالة الطلب
  let globalTenantId: string;

  export default {
    async fetch(req, env, ctx) {
      globalTenantId = req.headers.get('x-tenant-id')!; // سيتسرب للطلب التالي!
    }
  }

  // ✅ الحماية الصحيحة: حصر كافة الحالات داخل سياق Hono المخصص للطلب
  app.get('/api/resource', async (c) => {
    const tenantId = c.get('user')?.dashboard_id; // آمن تماماً ومعزول لكل طلب
  });
  ```

---

### 2. ثغرة كسر صلاحية الوصول على مستوى الكائنات (BOLA / IDOR)
* **طبيعة الثغرة:**
  يقوم المستخدم بتغيير معرّف السجل في المسار (مثال: `DELETE /api/invoices/inv-999`)، وإذا كان السيرفر يفحص فقط وجود الـ ID دون التحقق من أن الفاتورة تخص نفس متجر المستخدم المصادق، يتم حذف بيانات متجر آخر!
* **كود الحماية الإلزامي:**
  ```ts
  // ❌ ثغرة IDOR: فحص الـ ID فقط
  await db.prepare('DELETE FROM Invoices WHERE id = ?').bind(invoiceId).run();

  // ✅ الحماية الصحيحة: إلزام التحقق من الـ dashboard_id دائماً
  const result = await db.prepare(
    'DELETE FROM Invoices WHERE id = ? AND dashboard_id = ?'
  ).bind(invoiceId, currentUser.dashboard_id).run();

  if (result.meta.changes === 0) {
    return { error: 'NOT_FOUND', message: 'الفاتورة غير موجودة أو لا تملك صلاحية الوصول إليها', status: 404 };
  }
  ```

---

### 3. ثغرة طلبات الخادم المزورة (Server-Side Request Forgery - SSRF)
* **طبيعة الثغرة:**
  عند برمجة ميزات مثل "جلب صورة من رابط خارجي" أو "استدعاء Webhook"، إذا تم تمرير الرابط مباشرة إلى `fetch(url)`، يستطيع المهاجم استدعاء شبكات داخلية مثل `http://169.254.169.254/` (سحب توكنات السحابة) أو `http://127.0.0.1:8787`.
* **كود الحماية الإلزامي:**
  ```ts
  export function validateExternalUrl(urlString: string, allowedHosts: string[]): URL {
    const parsed = new URL(urlString);
    
    // 1. حظر البروتوكولات غير الآمنة
    if (parsed.protocol !== 'https:') {
      throw new Error('Only HTTPS URLs are allowed');
    }

    // 2. حظر عناوين الـ Loopback والـ Private IPs
    const hostname = parsed.hostname.toLowerCase();
    const isPrivate = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|169\.254\.)/.test(hostname);
    if (isPrivate) {
      throw new Error('Access to internal / private network is strictly prohibited');
    }

    // 3. التحقق من القائمة البيضاء إذا تم تحديدها
    if (allowedHosts.length > 0 && !allowedHosts.includes(hostname)) {
      throw new Error('Host is not in the allowed domains whitelist');
    }

    return parsed;
  }
  ```

---

### 4. ثغرة هجمات التوقيت (Timing Attacks)
* **طبيعة الثغرة:**
  مقارنة النصوص الحساسة (مثل توكنات CSRF، أكواد التحقق OTP، أو تواقيع الـ Webhook) باستخدام معامل المساواة المباشر `tokenA === tokenB` يتوقف بمجرد مصادفة أول حرف غير متطابق. هذا الفارق الزمني (بالنانو ثانية) يسمح بهجمات إحصائية لمعرفة الرمز حرفاً بحرف.
* **كود الحماية الإلزامي:**
  ```ts
  /**
   * مقارنة آمنة زمنياً للرموز والمفاتيح الحساسة
   */
  export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
    const encoder = new TextEncoder();
    const aBuf = encoder.encode(a);
    const bBuf = encoder.encode(b);

    if (aBuf.byteLength !== bBuf.byteLength) {
      return false;
    }

    // استخدام الدالة الأصلية في Web Crypto API
    return crypto.subtle.timingSafeEqual(aBuf, bBuf);
  }
  ```

---

### 5. ثغرة تلوث النموذج الأولي (Prototype Pollution Defense)
* **طبيعة الثغرة:**
  في أنظمة الصلاحيات المعتمدة على الفحص المنقط (مثل `settings.team.manage`)، يمكن لمهاجم إرسال كائن يحتوي على `{"__proto__": {"admin": true}}` ليصبح مديراً للنظام بالكامل إذا لم يتم عزل المفاتيح الخاصة.
* **كود الحماية المعتمد في MobiDash:**
  ```ts
  for (const part of parts) {
    // رفض أي محاولة تلاعب بالنموذج الأولي
    if (part === '__proto__' || part === 'constructor' || part === 'prototype') {
      return false;
    }
    if (!Object.prototype.hasOwnProperty.call(current, part)) {
      return false;
    }
    current = current[part];
  }
  ```

---

## 4. أفضل الممارسات في إطار عمل Hono مع Cloudflare Workers

1. **الاستفادة القصوى من الروابط الأصلية (Native Bindings):**
   - لا تستخدم استدعاءات REST الخارجية لخدمات Cloudflare طالما تملك Binding مباشر في بيئتك (`c.env.DB`, `c.env.STORAGE`, `c.env.K1`).
   - الروابط الأصلية تعمل مباشرة على مستوى الذاكرة المحلية لخوادم Cloudflare بزمن وصول شبه معدوم (Zero Network Latency).
2. **المهام الخلفية غير المعطلة (`c.executionCtx.waitUntil`):**
   - إذا كانت لديك مهمة لا ينتظر العميل نتيجتها في الاستجابة (مثل: تسجيل حدث تدقيق Audit Log، إرسال إشعار للمدير، أو تنظيف كاش منتهي)، استخدم `c.executionCtx.waitUntil(promise)`:
   ```ts
   // أرجع الاستجابة فوراً للكاشير
   const response = sendResponse(c, 200, 'PAYMENT_RECORDED', 'تم تسجيل العملية بنجاح', { invoiceId });

   // تابع تسجيل العمليات التحليلية في الخلفية دون تعطيل الرد
   c.executionCtx.waitUntil(
     recordAuditLog(c.env.DB, user.id, 'PAYMENT_PROCESSED', invoiceId)
   );

   return response;
   ```
3. **سياسة الفتح عند الفشل (Fail-Open Strategy) لمحددات السرعة:**
   - يجب دائماً تغليف استدعاءات Rate Limiter داخل `try / catch` حتى لا يتسبب أي عطل خارجي في خوادم Cloudflare في إيقاف عمل المحل والكاشير.
4. **المسارات المعيارية والتركيبية (`app.route`):**
   - تجنب تكديس كافة المسارات في ملف واحد. قسّم المسارات حسب المجال التشغيلي (`auth.routes.ts`, `team.routes.ts`, `pos.routes.ts`) واربطها في الموجه الأساسي.

---

## 5. معايير TypeScript النظيف والخالي من الأخطاء (Zero-Error Clean TypeScript)

1. **مبدأ "الاشتقاق بدلاً من التكرار" (Infer, Don't Duplicate):**
   - حظر إنشاء `interface` يدوي للبيانات ثم إنشاء `z.object` يماثله. اكتب مخطط Zod كمرجع أوحد، واشتق النوع منه:
     ```ts
     export const ShiftSchema = z.object({
       opening_cash: z.number().min(0),
       notes: z.string().trim().optional(),
     });

     export type ShiftInput = z.infer<typeof ShiftSchema>; // تطابق دائم 100%
     ```
2. **الاتحادات المميزة للخدمات (Discriminated Unions for Service Results):**
   - بدلاً من إرجاع كائنات مجهولة أو استخدام `as`، استخدم شكلاً قياسياً مُميزاً يُجبر المعالج على التحقق من الحالة:
     ```ts
     export type ServiceResult<T> =
       | { success: true; data: T }
       | { success: false; error: string; message: string; status: number };
     ```
3. **تجنب القسر الأعمى للأنواع (No Blind Type Casting `as T`):**
   - استخدام `as SomeType` يُعطل فحص TypeScript ويتسبب في أخطاء وقت التشغيل غير المتوقعة (Runtime Crashes). استخدم دوال التحقق ومخططات Zod لضمان سلامة الهيكل فعلياً.
4. **معالجة القيم الاختيارية و `null` بأمان:**
   - اعتمد دائماً على الـ Optional Chaining (`user?.permissions?.pos`) والـ Nullish Coalescing (`val ?? defaultValue`) وتجنب معامل التأكيد القسري `!` إلا عند وجود ضمان مسبق قاطع (مثل بعد مرور الطلب عبر `sessionMiddleware`).

---

## 6. مصفوفة اتخاذ القرار: متى نستخدم كل عنصر والتوقيت المناسب له (Decision Matrix)

| العنصر البرمجي | متى يُستخدم؟ (Timing & Context) | أين يُكتب مكانه؟ | متى يُمنع استخدامه؟ (Strict Prohibition) |
| :--- | :--- | :--- | :--- |
| **`Middleware`** | للفحوصات العامة قبل الوصول للمسار: فحص الجلسة، التحقق من الصلاحيات، فحص الوردية، وحماية CSRF/Origin. | في مجلد `src/middleware/` | يُمنع لكتابة استعلامات الجداول التشغيلية أو منطق حسابات الفواتير والمنتجات. |
| **`zValidator`** | عند بوابة استقبال الطلب مباشرة لفحص وتطهير الـ Body أو الـ Query أو الـ Params. | داخل ملفات `src/routes/*.routes.ts` | يُمنع تأجيل فحص المدخلات إلى مرحلة الـ Controller أو الـ Service. |
| **`Controller`** | لترجمة الطلب الشبكي: استخراج المعاملات المفحوصة، استدعاء الـ Service، وإرجاع الرد عبر `sendResponse`. | في مجلد `src/controllers/` | يُمنع لكتابة استعلامات SQL المباشرة أو تنفيذ العمليات الحسابية ومنطق البيانات. |
| **`Service`** | لمنطق الأعمال الصافي: العمليات الحسابية، استعلامات D1، تحديث المخزون، وإدارة الكاش في KV. | في مجلد `src/services/` | يُمنع للتعامل مع كائن `Context` الخاص بـ Hono أو قراءة الكوكيز ورؤوس HTTP. |
| **`sendResponse`** | الدالة الوحيدة المعتمدة لإخراج أي استجابة HTTP (نجاح أو خطأ) موحدة للعميل. | داخل ملفات الـ Controllers فقط | يُمنع استدعاؤها داخل ملفات الـ Services (الخدمات تُرجع بيانات أو كائن خطأ). |
| **`c.executionCtx.waitUntil`** | للمهام الخلفية المستقلة التي لا يجب أن ينتظرها العميل (مثل إرسال الإيميل وتسجيل سجلات التدقيق). | داخل الـ Controller أو Middleware | يُمنع للعمليات التي يحتاج العميل نتيجتها في نفس الرد (مثل رقم الفاتورة أو رمز التوكن). |
| **`KV Storage` (`K1`)** | للبيانات السريعة ذات القراءة المكثفة: الجلسات، مفاتيح الحظر اللحظية، والبيانات المؤقتة (Cache). | عبر `c.env.K1` في الـ Services | يُمنع لاستخدامه كقاعدة بيانات علائقية للمعاملات المالية وحركات البيع والشراء. |
| **`D1 Database` (`DB`)** | للبيانات العلائقية المنضبطة: المستخدمين، الفواتير، الأجهزة، المخازن، والتقارير المالية. | عبر `c.env.DB` في الـ Services | يُمنع إرسال استعلامات متكررة متطابقة يمكن قراءتها من كاش KV لتفادي إجهاد القاعدة. |

