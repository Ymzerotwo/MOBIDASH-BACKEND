import { z } from 'zod';
import { sanitizeForDb, sanitizeSearchInput } from '../utils/sanitize';

/**
 * ==============================================================================
 * MobiDash Phones & IMEI Inventory Validation Schemas
 * ==============================================================================
 * 
 * Strict validation and sanitization for smartphones inventory, IMEI tracking,
 * conditional legal buyback KYC checks, reservations, sales, and filtering.
 * Fully aligned with migrations/phones.sql and backend/src/types.ts
 */

export const DEVICE_CONDITIONS = ['new', 'used_like_new', 'used'] as const;
export const PHONE_STATUSES = ['in_stock', 'sold', 'reserved'] as const;
export const PHONE_NETWORKS = ['3G', '4G', '5G'] as const;
export const PHONE_TABS = ['all', 'in_stock', 'new', 'used', 'reserved', 'sold'] as const;

/**
 * مخطط تسجيل وإضافة هاتف جديد في المخزن
 * يطبق التحقق الشرطي بناءً على حالة الجهاز (جديد vs كسر زيرو ومستعمل)
 */
export const createPhoneSchema = z.object({
  brand: z.string()
    .trim()
    .min(2, { message: 'يجب إدخال اسم الماركة التجارية (مثال: Apple, Samsung)' })
    .max(50, { message: 'اسم الماركة طويل جداً' })
    .transform(sanitizeForDb),
  model: z.string()
    .trim()
    .min(2, { message: 'يجب إدخال موديل الهاتف (مثال: iPhone 15 Pro Max)' })
    .max(100, { message: 'اسم الموديل طويل جداً' })
    .transform(sanitizeForDb),
  color: z.string()
    .trim()
    .min(2, { message: 'يجب إدخال لون الجهاز التجاري' })
    .max(50, { message: 'اللون طويل جداً' })
    .transform(sanitizeForDb),
  storage: z.string()
    .trim()
    .min(2, { message: 'يجب تحديد سعة التخزين (مثال: 128GB, 256GB)' })
    .max(50, { message: 'سعة التخزين غير صالحة' })
    .transform(sanitizeForDb),
  ram: z.string()
    .trim()
    .max(30, { message: 'الرام طويل جداً' })
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),
  battery_capacity: z.coerce.number()
    .int({ message: 'سعة البطارية يجب أن تكون رقماً صحيحاً' })
    .positive({ message: 'سعة البطارية يجب أن تكون أكبر من الصفر' })
    .optional()
    .nullable(),
  screen_size: z.string()
    .trim()
    .max(30)
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),
  network: z.enum(PHONE_NETWORKS, { message: 'جيل الشبكة غير صالح' })
    .optional()
    .default('4G'),
  processor: z.string()
    .trim()
    .max(80)
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),
  condition: z.enum(DEVICE_CONDITIONS, { message: 'يرجى تحديد حالة الجهاز (جديد، كسر زيرو، أو مستعمل)' }),
  battery_health: z.coerce.number()
    .int()
    .min(0, { message: 'نسبة صحة البطارية لا تقل عن 0' })
    .max(100, { message: 'نسبة صحة البطارية لا تزيد عن 100' })
    .optional()
    .nullable(),
  imei: z.string()
    .trim()
    .regex(/^\d{15}$/, { message: 'رقم السيريال الدولي (IMEI) يجب أن يتكون من 15 رقماً بالضبط' }),
  imei2: z.string()
    .trim()
    .regex(/^\d{15}$/, { message: 'رقم السيريال الثاني (IMEI 2) يجب أن يتكون من 15 رقماً بالضبط' })
    .optional()
    .nullable()
    .or(z.literal('')),
  purchase_price: z.coerce.number()
    .min(0, { message: 'سعر شراء الجهاز وتكلفته لا يمكن أن تكون سالبة' }),
  selling_price: z.coerce.number()
    .min(0, { message: 'سعر بيع الجهاز لا يمكن أن يكون سالباً' }),
  min_price: z.coerce.number()
    .min(0, { message: 'الحد الأدنى لسعر البيع لا يمكن أن يكون سالباً' })
    .optional(),
  warranty_period: z.string()
    .trim()
    .max(100)
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),
  supplier_id: z.string()
    .trim()
    .max(100)
    .optional()
    .nullable()
    .transform((val) => (val && val.trim().length > 0 ? sanitizeForDb(val) : null)),
  seller_name: z.string()
    .trim()
    .max(100)
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),
  seller_national_id: z.string()
    .trim()
    .optional()
    .nullable(),
  seller_phone: z.string()
    .trim()
    .optional()
    .nullable(),
  seller_id_front_url: z.string()
    .trim()
    .optional()
    .nullable()
    .or(z.literal('')),
  seller_id_back_url: z.string()
    .trim()
    .optional()
    .nullable()
    .or(z.literal('')),
  contract_image_url: z.string()
    .trim()
    .optional()
    .nullable()
    .or(z.literal('')),
  has_box: z.coerce.boolean()
    .optional()
    .default(false),
  has_charger: z.coerce.boolean()
    .optional()
    .default(false),
  notes: z.string()
    .trim()
    .max(500, { message: 'الملاحظات طويلة جداً (الحد الأقصى 500 حرف)' })
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),
  date_added: z.string()
    .trim()
    .optional()
    .nullable(),
  pay_from_drawer: z.coerce.boolean()
    .optional()
    .default(false),
}).superRefine((data, ctx) => {
  // فحص الحد الأدنى للبيع
  if (data.min_price !== undefined && data.min_price > data.selling_price) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'الحد الأدنى لسعر البيع لا يمكن أن يتجاوز سعر البيع المطلوب',
      path: ['min_price'],
    });
  }

  // اشتراطات التحقق الجنائي وعقد المبايعة للأجهزة المستعملة أو كسر زيرو
  if (data.condition === 'used' || data.condition === 'used_like_new') {
    if (!data.seller_name || data.seller_name.trim().length < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'يجب إدخال اسم العميل البائع بالكامل من واقع بطاقة الرقم القومي',
        path: ['seller_name'],
      });
    }

    const nid = (data.seller_national_id || '').trim();
    if (!nid || !/^\d{14}$/.test(nid)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'الرقم القومي للبائع يجب أن يتكون من 14 رقماً مصرياً صحيحاً',
        path: ['seller_national_id'],
      });
    }

    const phone = (data.seller_phone || '').trim();
    if (!phone || !/^01[0125]\d{8}$/.test(phone)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'رقم هاتف البائع يجب أن يكون رقم موبايل مصري صحيح (11 رقماً)',
        path: ['seller_phone'],
      });
    }
  }
});

/**
 * مخطط تعديل بيانات هاتف مسجل
 */
export const updatePhoneSchema = z.object({
  brand: z.string().trim().min(2).max(50).optional().transform(val => val ? sanitizeForDb(val) : val),
  model: z.string().trim().min(2).max(100).optional().transform(val => val ? sanitizeForDb(val) : val),
  color: z.string().trim().min(2).max(50).optional().transform(val => val ? sanitizeForDb(val) : val),
  storage: z.string().trim().min(2).max(50).optional().transform(val => val ? sanitizeForDb(val) : val),
  ram: z.string().trim().max(30).optional().nullable().transform(val => val ? sanitizeForDb(val) : null),
  battery_capacity: z.coerce.number().int().positive().optional().nullable(),
  screen_size: z.string().trim().max(30).optional().nullable().transform(val => val ? sanitizeForDb(val) : null),
  network: z.enum(PHONE_NETWORKS).optional(),
  processor: z.string().trim().max(80).optional().nullable().transform(val => val ? sanitizeForDb(val) : null),
  condition: z.enum(DEVICE_CONDITIONS).optional(),
  battery_health: z.coerce.number().int().min(0).max(100).optional().nullable(),
  imei: z.string().trim().regex(/^\d{15}$/, { message: 'رقم IMEI يجب أن يتكون من 15 رقماً' }).optional(),
  imei2: z.string().trim().regex(/^\d{15}$/, { message: 'رقم IMEI الثاني يجب أن يتكون من 15 رقماً' }).optional().nullable().or(z.literal('')),
  purchase_price: z.coerce.number().min(0).optional(),
  selling_price: z.coerce.number().min(0).optional(),
  min_price: z.coerce.number().min(0).optional(),
  warranty_period: z.string().trim().max(100).optional().nullable().transform(val => val ? sanitizeForDb(val) : null),
  supplier_id: z.string().trim().max(100).optional().nullable().transform((val) => (val && val.trim().length > 0 ? sanitizeForDb(val) : null)),
  seller_name: z.string().trim().max(100).optional().nullable().transform(val => val ? sanitizeForDb(val) : null),
  seller_national_id: z.string().trim().optional().nullable(),
  seller_phone: z.string().trim().optional().nullable(),
  seller_id_front_url: z.string().trim().optional().nullable().or(z.literal('')),
  seller_id_back_url: z.string().trim().optional().nullable().or(z.literal('')),
  contract_image_url: z.string().trim().optional().nullable().or(z.literal('')),
  has_box: z.coerce.boolean().optional(),
  has_charger: z.coerce.boolean().optional(),
  notes: z.string().trim().max(500).optional().nullable().transform(val => val ? sanitizeForDb(val) : null),
}).superRefine((data, ctx) => {
  if (data.min_price !== undefined && data.selling_price !== undefined && data.min_price > data.selling_price) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'الحد الأدنى لسعر البيع لا يمكن أن يتجاوز سعر البيع المطلوب',
      path: ['min_price'],
    });
  }
});

/**
 * مخطط حجز هاتف بعربون
 */
export const reservePhoneSchema = z.object({
  deposit_amount: z.coerce.number()
    .min(0, { message: 'مبلغ العربون لا يمكن أن يكون سالباً' })
    .optional()
    .default(0),
  customer_name: z.string()
    .trim()
    .min(2, { message: 'اسم العميل الحاجز مطلوب' })
    .max(100, { message: 'اسم العميل طويل جداً' })
    .transform(sanitizeForDb),
  customer_phone: z.string()
    .trim()
    .min(6, { message: 'رقم هاتف العميل غير صالح' })
    .max(30)
    .transform(sanitizeForDb),
  notes: z.string()
    .trim()
    .max(500)
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),
  collect_cash_to_drawer: z.coerce.boolean()
    .optional()
    .default(true),
});

/**
 * مخطط بيع هاتف وإصدار الفاتورة
 */
export const sellPhoneSchema = z.object({
  sold_price: z.coerce.number()
    .positive({ message: 'سعر البيع الفعلي يجب أن يكون أكبر من الصفر' }),
  buyer_name: z.string()
    .trim()
    .max(100)
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),
  buyer_phone: z.string()
    .trim()
    .max(30)
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),
  invoice_id: z.string()
    .trim()
    .max(100)
    .optional()
    .nullable(),
  payment_method: z.enum(['cash', 'bank', 'wallet', 'other'])
    .optional()
    .default('cash'),
  notes: z.string()
    .trim()
    .max(500)
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),
});

/**
 * مخطط تصفية وبحث الهواتف
 */
export const phoneFilterSchema = z.object({
  tab: z.enum(PHONE_TABS).optional().default('all'),
  condition: z.enum(['all', 'new', 'used_like_new', 'used']).optional().default('all'),
  status: z.enum(['all', 'in_stock', 'sold', 'reserved']).optional().default('all'),
  brand: z.string().trim().max(50).optional().transform(val => val ? sanitizeSearchInput(val, 50) : val),
  supplier_id: z.string().trim().max(100).optional(),
  search: z.string().trim().max(100).optional().transform(val => val ? sanitizeSearchInput(val, 100) : val),
  min_price: z.coerce.number().min(0).optional(),
  max_price: z.coerce.number().min(0).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  sort_by: z.enum(['date_added', 'created_at', 'selling_price', 'purchase_price']).optional().default('date_added'),
  sort_order: z.enum(['asc', 'desc']).optional().default('desc'),
});

/**
 * مخطط التحقق اللحظي من توفر وعدم تكرار رقم السيريال (IMEI / Code Availability Checker)
 */
export const checkImeiSchema = z.object({
  imei: z
    .string()
    .trim()
    .min(1, { message: 'رقم السيريال (IMEI) مطلوب' })
    .max(18, { message: 'رقم السيريال لا يجب أن يتجاوز 18 حرفاً' })
    .regex(/^[a-zA-Z0-9]+$/, { message: 'يجب أن يحتوي السيريال على رموز أو حروف إنجليزية فقط' })
    .transform(sanitizeForDb),
  exclude_id: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((val) => (val ? sanitizeForDb(val) : undefined)),
});

export type CheckImeiInput = z.infer<typeof checkImeiSchema>;

