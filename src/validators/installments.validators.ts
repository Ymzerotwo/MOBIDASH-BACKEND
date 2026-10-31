/**
 * ==============================================================================
 * MobiDash Platform - Phone Installments Validation Schemas
 * ==============================================================================
 * 
 * Strict validation and sanitization for phone installment files and payment tracking.
 * Aligned with backend/migrations/customers.sql and backend/src/types.ts.
 */

import { z } from 'zod';
import { sanitizeForDb } from '../utils/sanitize';

const EGYPTIAN_NATIONAL_ID_REGEX = /^\d{14}$/;

/**
 * مخطط تسجيل عقد وملف تقسيط هاتف جديد
 */
export const createInstallmentSchema = z
  .object({
    customer_name: z
      .string()
      .trim()
      .min(2, { message: 'اسم العميل المشتري يجب ألا يقل عن حرفين' })
      .max(100, { message: 'اسم العميل طويل جداً' })
      .transform(sanitizeForDb),

    customer_phone: z
      .string()
      .trim()
      .min(8, { message: 'رقم هاتف العميل غير صالح' })
      .max(20, { message: 'رقم هاتف العميل طويل جداً' })
      .transform(sanitizeForDb),

    customer_national_id: z
      .string()
      .trim()
      .regex(EGYPTIAN_NATIONAL_ID_REGEX, {
        message: 'الرقم القومي للعميل يجب أن يتكون من 14 رقماً صحيحاً',
      })
      .optional()
      .nullable()
      .transform((val) => (val ? sanitizeForDb(val) : null)),

    guarantor_name: z
      .string()
      .trim()
      .max(100, { message: 'اسم الضامن طويل جداً' })
      .optional()
      .nullable()
      .transform((val) => (val ? sanitizeForDb(val) : null)),

    guarantor_phone: z
      .string()
      .trim()
      .max(20, { message: 'رقم هاتف الضامن طويل جداً' })
      .optional()
      .nullable()
      .transform((val) => (val ? sanitizeForDb(val) : null)),

    guarantor_national_id: z
      .string()
      .trim()
      .regex(EGYPTIAN_NATIONAL_ID_REGEX, {
        message: 'الرقم القومي للضامن يجب أن يتكون من 14 رقماً صحيحاً',
      })
      .optional()
      .nullable()
      .transform((val) => (val ? sanitizeForDb(val) : null)),

    device_purchased: z
      .string()
      .trim()
      .min(2, { message: 'يجب إدخال تفاصيل الجهاز المشترى وسيريال IMEI' })
      .max(200, { message: 'وصف الجهاز المشترى طويل جداً' })
      .transform(sanitizeForDb),

    phone_id: z
      .string()
      .trim()
      .optional()
      .nullable(),

    total_amount: z.coerce
      .number()
      .positive({ message: 'إجمالي مبلغ التقسيط يجب أن يكون أكبر من الصفر' }),

    paid_down_payment: z.coerce
      .number()
      .min(0, { message: 'قيمة المقدم لا يمكن أن تكون سالبة' })
      .default(0),

    monthly_amount: z.coerce
      .number()
      .positive({ message: 'قيمة القسط الشهري يجب أن تكون أكبر من الصفر' }),

    total_months: z.coerce
      .number()
      .int({ message: 'عدد الشهور يجب أن يكون رقماً صحيحاً' })
      .min(1, { message: 'مدة التقسيط يجب ألا تقل عن شهر واحد' })
      .default(12),

    next_due_date: z
      .string()
      .trim()
      .min(10, { message: 'تاريخ استحقاق القسط القادم مطلوب بصيغة YYYY-MM-DD' })
      .max(20, { message: 'صيغة تاريخ الاستحقاق غير صالحة' })
      .transform(sanitizeForDb),

    notes: z
      .string()
      .trim()
      .max(500, { message: 'الملاحظات لا يمكن أن تتجاوز 500 حرف' })
      .optional()
      .nullable()
      .transform((val) => (val ? sanitizeForDb(val) : null)),
  })
  .refine(
    (data) => data.paid_down_payment < data.total_amount,
    {
      message: 'قيمة المقدم النقدي لا يمكن أن تتجاوز أو تساوي إجمالي مبلغ التقسيط',
      path: ['paid_down_payment'],
    }
  );

/**
 * مخطط تعديل ملف تقسيط موجود
 */
export const updateInstallmentSchema = z.object({
  customer_name: z
    .string()
    .trim()
    .min(2, { message: 'اسم العميل يجب ألا يقل عن حرفين' })
    .max(100)
    .transform(sanitizeForDb)
    .optional(),

  customer_phone: z
    .string()
    .trim()
    .min(8)
    .max(20)
    .transform(sanitizeForDb)
    .optional(),

  customer_national_id: z
    .string()
    .trim()
    .regex(EGYPTIAN_NATIONAL_ID_REGEX, {
      message: 'الرقم القومي للعميل يجب أن يتكون من 14 رقماً',
    })
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),

  guarantor_name: z
    .string()
    .trim()
    .max(100)
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),

  guarantor_phone: z
    .string()
    .trim()
    .max(20)
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),

  guarantor_national_id: z
    .string()
    .trim()
    .regex(EGYPTIAN_NATIONAL_ID_REGEX, {
      message: 'الرقم القومي للضامن يجب أن يتكون من 14 رقماً',
    })
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),

  device_purchased: z
    .string()
    .trim()
    .min(2)
    .max(200)
    .transform(sanitizeForDb)
    .optional(),

  phone_id: z
    .string()
    .trim()
    .optional()
    .nullable(),

  monthly_amount: z.coerce
    .number()
    .positive({ message: 'قيمة القسط الشهري يجب أن تكون أكبر من الصفر' })
    .optional(),

  next_due_date: z
    .string()
    .trim()
    .min(10)
    .max(20)
    .transform(sanitizeForDb)
    .optional(),

  status: z.enum(['active', 'overdue', 'completed', 'cancelled'] as const).optional(),

  notes: z
    .string()
    .trim()
    .max(500)
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),
});

/**
 * مخطط تحصيل قسط شهري
 */
export const payInstallmentSchema = z.object({
  amount: z.coerce
    .number()
    .positive({ message: 'مبلغ القسط يجب أن يكون أكبر من الصفر' })
    .optional(),

  payment_method: z
    .enum(['cash', 'bank', 'wallet', 'other'] as const)
    .default('cash'),

  receipt_number: z
    .string()
    .trim()
    .max(50, { message: 'رقم الإيصال طويل جداً' })
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),

  notes: z
    .string()
    .trim()
    .max(500, { message: 'ملاحظات التحصيل لا يمكن أن تتجاوز 500 حرف' })
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),
});

/**
 * مخطط فلترة وبحث ملفات التقسيط
 */
export const installmentFilterSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  search: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'overdue', 'completed', 'cancelled', 'all'] as const).optional().default('all'),
  sort_by: z.enum(['created_at', 'customer_name', 'next_due_date', 'total_amount'] as const).optional().default('created_at'),
  sort_order: z.enum(['asc', 'desc'] as const).optional().default('desc'),
});
