/**
 * ==============================================================================
 * MobiDash Platform - Spare Parts Validation Schemas
 * ==============================================================================
 * 
 * Strict validation and sanitization for mobile shop maintenance workshop spare parts.
 * Fully aligned with backend/migrations/spare_parts.sql and backend/src/types.ts
 */

import { z } from 'zod';
import { sanitizeForDb, sanitizeSearchInput } from '../utils/sanitize';

export const SPARE_PART_CATEGORIES = [
  'screens',
  'batteries',
  'glass',
  'charging_ports',
  'cameras',
  'housing_frame',
  'ics',
  'speakers',
  'microphones',
  'flex_cables',
  'sensors',
  'wireless_charging',
  'antennas',
  'sim_trays',
  'vibrators',
  'small_parts',
  'other',
  'شاشات',
  'بطاريات',
  'باغات وزجاج',
  'فلاتات وبوردات شحن',
  'كاميرات وعدسات',
  'هاوسينج وشاصيه وظهر',
  'آيسيهات وبوردة',
  'سماعات وأجراس',
  'مايكات',
  'فلاتات وأزرار',
  'حساسات وفيس آي دي',
  'شحن لاسلكي وNFC',
  'هوائيات وشبكات',
  'أدراج وقارئات الشرائح',
  'هزازات ومحركات لمس',
  'أجزاء صغيرة ولواصق',
  'أخرى',
] as const;

export const SPARE_PART_QUALITIES = [
  'original_pull',
  'original_new',
  'oem',
  'refurbished',
  'soft_oled',
  'hard_oled',
  'incell',
  'high_copy',
  'copy',
  'خلع أصلي',
  'أصلي وكالة جديد',
  'فرز أول مصنع',
  'مجدد باغة',
  'سوفت أوليد',
  'هارد أوليد',
  'إن سيل',
  'هاي كوبي',
  'تجاري اقتصادي',
] as const;

export const SPARE_PART_STATUSES = ['available', 'low_stock', 'out_of_stock', 'archived'] as const;

/**
 * مخطط تسجيل وإضافة قطعة غيار جديدة
 */
export const createSparePartSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, { message: 'يجب إدخال اسم القطعة والمواصفات الفنية (2 أحرف على الأقل)' })
    .max(150, { message: 'اسم القطعة طويل جداً' })
    .transform(sanitizeForDb),
  part_code: z
    .string()
    .trim()
    .max(50, { message: 'كود القطعة طويل جداً' })
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),
  category: z.enum(SPARE_PART_CATEGORIES, {
    message: 'تصنيف نوع قطعة الغيار غير صالح',
  }),
  device_model: z
    .string()
    .trim()
    .min(2, { message: 'يجب إدخال موديل الهاتف المتوافق بدقة (مثال: iPhone 13 Pro Max)' })
    .max(100, { message: 'اسم الموديل طويل جداً' })
    .transform(sanitizeForDb),
  compatible_models: z
    .array(z.string().trim().max(100).transform(sanitizeForDb))
    .optional()
    .nullable(),
  quality: z.enum(SPARE_PART_QUALITIES, {
    message: 'درجة جودة القطعة غير صالحة',
  }).default('oem'),
  cost_price: z.coerce
    .number()
    .min(0, { message: 'سعر التكلفة والشراء لا يمكن أن يكون سالباً' }),
  selling_price: z.coerce
    .number()
    .min(0, { message: 'سعر البيع للعميل لا يمكن أن يكون سالباً' }),
  stock: z.coerce
    .number()
    .int({ message: 'الكمية يجب أن تكون عدداً صحيحاً' })
    .min(0, { message: 'رصيد القطع لا يمكن أن يكون سالباً' })
    .default(0),
  min_stock_alert: z.coerce
    .number()
    .int()
    .min(0, { message: 'حد النواقص لا يمكن أن يكون سالباً' })
    .default(2),
  warranty_days: z.coerce
    .number()
    .int()
    .min(0, { message: 'مدة الضمان باليوم لا يمكن أن تكون سالبة' })
    .default(30),
  shelf_location: z
    .string()
    .trim()
    .max(50, { message: 'رمز الرف أو الدرج طويل جداً' })
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),
  supplier_id: z
    .string()
    .trim()
    .max(100)
    .optional()
    .nullable(),
  notes: z
    .string()
    .trim()
    .max(500, { message: 'الملاحظات طويلة جداً' })
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),
});

/**
 * مخطط تعديل بيانات قطعة غيار قائمة
 */
export const updateSparePartSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, { message: 'اسم القطعة يجب أن يكون حرفين على الأقل' })
    .max(150)
    .transform(sanitizeForDb)
    .optional(),
  part_code: z
    .string()
    .trim()
    .max(50)
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),
  category: z.enum(SPARE_PART_CATEGORIES).optional(),
  device_model: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .transform(sanitizeForDb)
    .optional(),
  compatible_models: z
    .array(z.string().trim().max(100).transform(sanitizeForDb))
    .optional()
    .nullable(),
  quality: z.enum(SPARE_PART_QUALITIES).optional(),
  cost_price: z.coerce.number().min(0).optional(),
  selling_price: z.coerce.number().min(0).optional(),
  stock: z.coerce.number().int().min(0).optional(),
  min_stock_alert: z.coerce.number().int().min(0).optional(),
  warranty_days: z.coerce.number().int().min(0).optional(),
  shelf_location: z
    .string()
    .trim()
    .max(50)
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),
  supplier_id: z.string().trim().max(100).optional().nullable(),
  status: z.enum(SPARE_PART_STATUSES).optional(),
  notes: z
    .string()
    .trim()
    .max(500)
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),
});

/**
 * مخطط تسوية وتعديل رصيد الدرج يدوياً
 */
export const adjustSparePartStockSchema = z.object({
  type: z.enum(['adjustment', 'damage', 'purchase', 'used_in_repair', 'return'] as const, {
    message: 'نوع حركة تسوية المخزون غير صالحة',
  }),
  quantity_change: z.coerce
    .number()
    .int({ message: 'الكمية يجب أن تكون رقماً صحيحاً' })
    .refine((val) => val !== 0, { message: 'قيمة التعديل يجب ألا تساوي صفراً' }),
  notes: z
    .string()
    .trim()
    .max(500)
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),
});

/**
 * مخطط البحث والتصفية والتصفح لقطع الغيار
 */
export const sparePartFilterSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((val) => (val ? sanitizeSearchInput(val, 100) : val)),
  category: z.string().trim().max(50).optional(),
  quality: z.string().trim().max(50).optional(),
  stock_status: z.enum(['all', 'low_stock', 'available', 'out_of_stock']).default('all'),
  device_model: z.string().trim().max(100).optional(),
  supplier_id: z.string().trim().max(100).optional(),
  sort_by: z.enum(['created_at', 'name', 'stock', 'selling_price', 'cost_price']).default('created_at'),
  sort_order: z.enum(['asc', 'desc']).default('desc'),
});

/**
 * مخطط الفحص اللحظي لتوفر كود القطعة وعدم تكراره
 */
export const checkPartCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, { message: 'كود القطعة مطلوب' })
    .max(50, { message: 'كود القطعة طويل جداً' })
    .transform(sanitizeForDb),
  exclude_id: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((val) => (val ? sanitizeForDb(val) : undefined)),
});
