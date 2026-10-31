# دليل مفاهيم TypeScript النظيف ومكافحة أخطاء الذكاء الاصطناعي
# MobiDash Clean TypeScript Concepts & AI Anti-Patterns Guide

> [!WARNING]
> **أرشيف الجيل السابق — لا يُعتمد في كود جديد.**
> المرجع المعتمد: [`engineering/UNIFIED_METHODOLOGY.md`](./engineering/UNIFIED_METHODOLOGY.md) · [`project/PROJECT_PROFILE.md`](./project/PROJECT_PROFILE.md).
> أمثلة الكود هنا قد لا تطابق الكود الحالي؛ لا تنسخ منها بلا مطابقة.

> **الغرض الإلزامي من هذا الملف:**
> هذا الدليل هو المرجع اللغوي الصارم للذكاء الاصطناعي (AI Agent) والمهندسين لكتابة كود TypeScript نظيف، متطور، وخالٍ من الأخطاء والتعقيد الزائد في منظومة MobiDash.
> تم تصميمه بأسلوب مكثف يركز على القواعد المباشرة ومصفوفات القرار (Do vs Don't) لتوفير التوكنات وتوجيه النموذج لاستخدام الأداة اللغوية المناسبة في توقيتها الصحيح.

---

## 1. إدارة المتغيرات والتحوير (`const` مقابل `let`)

### القاعدة الذهبية:
* **`const` افتراضياً:** يجب أن يكون هو الخيار الافتراضي لجميع المتغيرات، الدوال، والمراجع. يمنع إعادة الإسناد العرضي ويساعد المترجم على تتبع الثوابت.
* **`let` فقط عند إعادة الإسناد (Reassignment):** يُستخدم فقط وفقط إذا كانت قيمة المتغير نفسه ستتغير لاحقاً عبر عملية إسناد جديدة (`count = count + 1`, `query += ...`).
* **حظر `var` قطعياً:** يُمنع استخدام `var` في كافة ملفات المشروع لتجنب مشاكل الـ Scope Hoisting وتسريب النطاق.

### الفرق الحاسم بين تحوير المرجع وتحوير الخصائص:
- الإعلان بـ `const` يحمي **المرجع فقط** ولا يمنع تعديل الخصائص الداخلية للكائن أو المصفوفة:
  ```ts
  // ✅ صحيح: تعديل خصائص الكائن دون تغيير مرجعه مسموح بـ const
  const user = { name: 'فوري 1', balance: 100 };
  user.balance = 200; 

  // ❌ خطأ يقع فيه الذكاء الاصطناعي: استخدام let لكائن تُعدل خصائصه فقط
  let userObj = { name: 'أمان' }; // لا داعي لـ let هنا طالما المرجع ثابت!
  ```
- **لفرض عدم القابلية للتعديل تماماً (Immutability):** استخدم `as const` أو `Readonly<T>`:
  ```ts
  const ROLES = ['owner', 'user'] as const;
  type Role = typeof ROLES[number]; // 'owner' | 'user'
  ```

---

## 2. تبسيط تدفق التحكم ومكافحة الأكواد الهرمية (Anti-Spaghetti & Guard Clauses)

### أ. حظر "هرم الموت" (No Pyramid of Doom / Deep If-Nesting)
- **يُمنع منعاً باتاً** تداخل جمل `if-else` لأكثر من مستويين.
- **البديل الإلزامي: أسلوب الحراس والإرجاع المبكر (Guard Clauses / Early Returns):**
  اعكس الشروط وافحص حالات الفشل والأخطاء أولاً واخرج فوراً، ليبقى المسار الرئيسي للوظيفة (Happy Path) مسطحاً عند المستوى الصفري من المحاذاة.

```ts
// ❌ خطأ شائع للذكاء الاصطناعي: هرم متداخل يصعب قراءته
function processPayment(user, shift, amount) {
  if (user) {
    if (user.isActive) {
      if (shift) {
        if (amount > 0) {
          // الكود الفعلي غارق في الداخل
          return executeTransaction(user, shift, amount);
        } else {
          return { error: 'INVALID_AMOUNT' };
        }
      } else {
        return { error: 'NO_SHIFT' };
      }
    } else {
      return { error: 'INACTIVE_USER' };
    }
  } else {
    return { error: 'NO_USER' };
  }
}

// ✅ الكود النظيف المعتمد: حراس مبكرون ومسار مسطح
function processPayment(user, shift, amount) {
  if (!user) return { error: 'NO_USER' };
  if (!user.isActive) return { error: 'INACTIVE_USER' };
  if (!shift) return { error: 'NO_SHIFT' };
  if (amount <= 0) return { error: 'INVALID_AMOUNT' };

  // المسار الرئيسي مسطح تماماً ونظيف
  return executeTransaction(user, shift, amount);
}
```

### ب. بدائل سلاسل `if-else if` الطويلة
- **استخدام القواميس (Lookup Tables / Record Maps):**
  بدلاً من سلسلة `if-else if` طويلة لتحويل الحالات أو النصوص، استخدم كائناً ثابتاً:
  ```ts
  // ❌ خطأ: سلسلة شروط مكررة
  let label = '';
  if (status === 'active') label = 'نشط';
  else if (status === 'closed') label = 'مغلق';
  else if (status === 'suspended') label = 'معلق';

  // ✅ الأسلوب النظيف: قاموس صريح وسريع
  const STATUS_LABELS: Record<string, string> = {
    active: 'نشط',
    closed: 'مغلق',
    suspended: 'معلق',
  };
  const label = STATUS_LABELS[status] ?? 'غير معروف';
  ```
- **المعامل الثلاثي (Ternary Operator):**
  مسموح فقط للتعيينات البسيطة ذات السطر الواحد (`const fee = isCash ? 0 : 5;`). **يُمنع منعاً باتاً** التداخل بالمعامل الثلاثي (`a ? b : c ? d : e`).

---

## 3. البرمجة غير المتزامنة المنضبطة (`async` و `await` و الوعود)

### أ. متى تُوسم الدالة بـ `async`؟
- **فقط** إذا كانت الدالة تستخدم `await` بداخلها أو يُراد لها أن ترجع `Promise` صراحة.
- **حظر وسم الدوال التزامنية بـ `async`:** وسم دالة عادية بـ `async` بلا حاجة يستهلك موارد إضافية لتغليف القيمة داخل Microtask في الذاكرة.

### ب. التوقيت الدقيق لاستخدام `await`:
1. **في نهاية الدوال (Tail Position) خارج `try/catch`:**
   - اكتب `return promise;` مباشرة بدون `await`؛ لا داعي لانتظار الوعد ثم إعادة إرجاعه.
2. **داخل كتلة `try/catch` الإلزامية:**
   - **يجب كتابة `return await promise;`** حتى يلتقط كود الـ `catch` المحلي أي استثناء؛ إذا حذفت `await` هنا سيتسرب الخطأ خارج الدالة دون أن يُلتقط بالـ `catch`!

```ts
// ✅ صحيح: خارج try/catch لا داعي لـ await
function fetchUser(id: string) {
  return db.prepare('SELECT * FROM Users WHERE id = ?').bind(id).first();
}

// ✅ صحيح: داخل try/catch يجب كتابة await لالتقاط الخطأ محلياً
async function safeFetchUser(id: string) {
  try {
    return await db.prepare('SELECT * FROM Users WHERE id = ?').bind(id).first();
  } catch (error: unknown) {
    logger.error('Fetch failed', error);
    return null;
  }
}
```

### ج. التنفيذ المتوازي مقابل المتسلسل (Parallel vs Sequential):
- **حظر الاستدعاءات المتسلسلة لمهام مستقلة:**
  ```ts
  // ❌ بطيء: ينتظر المهمة الأولى ثم الثانية بالرغم من استقلالهما
  const user = await getUser(userId);
  const settings = await getStoreSettings(storeId);

  // ✅ سريع ومتوازي: ينفذ العمليتين في نفس الوقت
  const [user, settings] = await Promise.all([
    getUser(userId),
    getStoreSettings(storeId)
  ]);
  ```

### د. حظر `await` داخل `.forEach()`:
- دالة `.forEach` في JavaScript لا تنتظر الوعود (Fire-and-forget)، مما يؤدي لانتهاء الدالة قبل اكتمال العمليات!
- **البديل الإلزامي:**
  - للتنفيذ المتسلسل خطوة بخطوة: `for (const item of items) { await process(item); }`
  - للتنفيذ المتوازي السريع: `await Promise.all(items.map(item => process(item)))`

---

## 4. احتراف نظام الأنواع والتعامل مع الأخطاء (Type System Mastery)

### أ. حظر `any` ومعاملة أخطاء الـ Catch كـ `unknown`:
- في TypeScript الحديثة، المتغير داخل `catch (error)` يكون نوعه `unknown`.
- **حظر كتابة `catch (error: any)`**؛ استعلم عن النوع بأمان عبر `instanceof Error`:
  ```ts
  // ❌ خطأ الذكاء الاصطناعي الشائع
  try { ... } catch (error: any) {
    console.log(error.message); // سيعطل السيرفر إذا كان المقذوف نصاً أو كائناً غير Error
  }

  // ✅ الكود النظيف المعتمد
  try { ... } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(reqId, 'Operation failed', message);
  }
  ```

### ب. تضييق الأنواع الحقيقي (Type Narrowing) بدلاً من القسر الأعمى (`as`):
- حظر استخدام `as SomeType` للهروب من اعتراضات المترجم.
- استخدم أدوات التضييق الرسمية:
  1. التحقق من البدائيات: `typeof val === 'string'`
  2. التحقق من الكائنات: `val instanceof Date`
  3. التحقق من الخصائص: `'permissions' in user`
  4. دوال التمييز المخصصة (Type Predicates):
     ```ts
     function isValidShift(shift: unknown): shift is ActiveShiftWorker {
       return typeof shift === 'object' && shift !== null && 'shift_id' in shift;
     }
     ```

### ج. المعامل الصفري `??` مقابل الـ OR المنطقي `||`:
- `||` يتحقق من كل القيم الخاطئة (Falsy: `false`, `0`, `""`, `null`, `undefined`).
- `??` يتحقق **حصراً** من `null` و `undefined`.
- **القاعدة:** للأرقام والكميات والأسعار والحالات المنطقية، **استخدم دائماً `??`** لمنع تصفير القيمة الحقيقية `0` أو تجاهل `false`:
  ```ts
  // ❌ خطأ: إذا كانت النقدية 0 ج.م، سيجعلها 5000 بالخطأ!
  const cash = inputCash || 5000; 

  // ✅ صحيح: يحافظ على 0 إذا أدخلها الكاشير كعهدة فارغة
  const cash = inputCash ?? 5000; 
  ```

### د. مركزية الأنواع في `src/types.ts` (Single Source of Truth):
- **قاعدة إلزامية:** كافة الأنواع والواجهات (Interfaces, Types, Models, DTOs, Input Fields) الخاصة بالنظام تُعرف حصراً وتُصدر من ملف `src/types.ts`.
- **ممنوع منعاً باتاً:** إنشاء ملفات `*.types.ts` متناثرة في المجلدات الفرعية (`routes`, `services`, `controllers`). جميع الطبقات تستورد الأنواع المشتركة مباشرة من `../types` أو `@/types`.

---

## 5. أشهر أخطاء الذكاء الاصطناعي القاتلة في TypeScript وطرق تجنبها

| الخطأ الشائع للـ AI | لماذا يفشل وما هي خطورته؟ | الحل النظيف المعتمد |
| :--- | :--- | :--- |
| **1. التحقق الوهمي بالأنواع (Phantom Types)** | يكتب النموذج `const body: User = req.body;` ظاناً أن هذا يفحص البيانات، بينما Types تتبخر تماماً وقت التشغيل! | استخدام مكتبات فحص وقت التشغيل حصراً: `zod.safeParse()` قبل أي استخدام للبيانات. |
| **2. الهروب بالكسر المزدوج (`as unknown as T`)** | عندما يعجز النموذج عن حل مشكلة Generics، يقوم بكسر النوع بالقوة، مخفياً أخطاء ستفجر السيرفر runtime. | كتابة Generics صحيحة، أو استخدام Type Narrowing، أو تصحيح بنية الكائن. |
| **3. التعقيد المفرط للأنواع (Type-Golfing)** | كتابة شروط جينات متداخلة ومعقدة لحل مسألة بسيطة تبطئ `tsc` وتجعل الكود غير قابل للصيانة. | تبسيط الأنواع والاعتماد على الأشكال الواضحة والمباشرة (KISS Principle). |
| **4. تخمين دوال وميثودات وهمية (API Hallucination)** | استدعاء دوال تبدو منطقية لكنها غير موجودة فعلياً في مكتبات مثل Hono أو Zod. | الالتزام بالدوال الموثقة رسمياً فقط دون اختراع أسماء من الذاكرة التخمينية. |

---

## 6. مصفوفة توقيت استخدام كل عنصر لغوي (Language Decision Matrix)

| الأداة اللغوية | متى تُستخدم؟ (The Right Timing) | متى تُمنع قطعياً؟ (Strict Prohibition) |
| :--- | :--- | :--- |
| **`const`** | الخيار الافتراضي الحتمي لكافة المتغيرات والمراجع. | إذا كان المتغير سيعاد إسناده بقيمة جديدة لاحقاً. |
| **`let`** | فقط عند إعادة إسناد المتغير (عداد، تجميع نصوص، شروط ديناميكية). | للمتغيرات الثابتة التي لا يتغير مرجعها أبداً. |
| **`var`** | **محظور تماماً في كافة أرجاء المشروع.** | يُمنع منعاً باتاً استخدامه نهائياً. |
| **`Guard Clause`** | عند بداية أي دالة لفحص المدخلات والأخطاء والإرجاع المبكر. | إذا كانت الشروط تمثل توزيعاً متكافئاً لحالات ثابتة (استخدم القاموس). |
| **`Record<K, V>`** | للتحويل والربط المباشر بين المفاتيح والقيم كبديل لـ `if-else if`. | إذا كانت العمليات تتطلب استدعاء خدمات غير متجانسة ببيانات مختلفة. |
| **`Promise.all`** | لتنفيذ مهام غير متزامنة مستقلة متوازية لا تعتمد على مخرجات بعضها. | إذا كانت المهمة الثانية تتطلب ناتج المهمة الأولى للبدء. |
| **`return await`** | **حصراً داخل كتل `try / catch`** لضمان التقاط الاستثناء محلياً. | في نهاية الدوال خارج كتل `try / catch` (استخدم `return promise`). |
| **`??` (Nullish)** | لتعيين القيم الافتراضية مع حماية القيم الصالحة مثل `0` و `false`. | إذا كنت تقصد استبدال السلسلة الفارغة `""` أو الصفر بالقيمة البديلة. |
| **`as Type`** | مع `as const` لثوابت القيم، أو بعد التحقق الصارم المسبق. | لتخطي أخطاء الـ TypeScript Compiler دون فحص حقيقي في وقت التشغيل. |
| **`unknown`** | لنوع الأخطاء في `catch`، وللبيانات غير الموثوقة قبل فحصها بـ Zod. | كبديل كسول لتعريف الأنواع الصريحة في العقود والـ Interfaces. |

