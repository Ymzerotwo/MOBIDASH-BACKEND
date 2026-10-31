/**
 * ==============================================================================
 * MobiDash Platform - Customer Credits & Ledger Validation Schemas
 * ==============================================================================
 * 
 * Strict validation and sanitization for customer debt, credit ledger (دفتر النوتة),
 * and payments. Aligned with backend/migrations/customers.sql and backend/src/types.ts.
 */

import { z } from 'zod';
import { sanitizeForDb } from '../utils/sanitize';

/**
 * مخطط تسجيل عميل جديد في دفتر النوتة / الآجل
 */
export const createCustomerCreditSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, { message: 'اسم العميل يجب ألا يقل عن حرفين' })
    .max(100, { message: 'اسم العميل لا يمكن أن يتجاوز 100 حرف' })
    .transform(sanitizeForDb),

  phone: z
    .string()
    .trim()
    .min(8, { message: 'رقم الهاتف غير صالح (8 أرقام على الأقل)' })
    .max(20, { message: 'رقم الهاتف طويل جداً' })
    .transform(sanitizeForDb),

  balance_due: z.coerce
    .number()
    .min(0, { message: 'مبلغ الدين لا يمكن أن يكون سالباً' })
    .default(0),

  notes: z
    .string()
    .trim()
    .max(500, { message: 'البيان والملاحظات لا يمكن أن تتجاوز 500 حرف' })
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),
});

/**
 * مخطط تعديل بيانات عميل النوتة
 */
export const updateCustomerCreditSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, { message: 'اسم العميل يجب ألا يقل عن حرفين' })
    .max(100, { message: 'اسم العميل لا يمكن أن يتجاوز 100 حرف' })
    .transform(sanitizeForDb)
    .optional(),

  phone: z
    .string()
    .trim()
    .min(8, { message: 'رقم الهاتف غير صالح (8 أرقام على الأقل)' })
    .max(20, { message: 'رقم الهاتف طويل جداً' })
    .transform(sanitizeForDb)
    .optional(),

  notes: z
    .string()
    .trim()
    .max(500, { message: 'البيان والملاحظات لا يمكن أن تتجاوز 500 حرف' })
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),

  status: z.enum(['active', 'cleared', 'archived'] as const).optional(),
});

/**
 * مخطط تحصيل وسداد دين النوتة (تسديد جزئي أو كلي)
 */
export const settleCustomerCreditSchema = z.object({
  amount: z.coerce
    .number()
    .positive({ message: 'مبلغ التحصيل يجب أن يكون أكبر من الصفر' }),

  payment_method: z
    .enum(['cash', 'bank', 'wallet', 'pos_split', 'other'] as const)
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
 * مخطط إضافة سحب آجل جديد (دين إضافي على العميل)
 */
export const addCustomerDebtSchema = z.object({
  amount: z.coerce
    .number()
    .positive({ message: 'مبلغ السحب الآجل يجب أن يكون أكبر من الصفر' }),

  notes: z
    .string()
    .trim()
    .max(500, { message: 'بيان المشتريات والمسحوبات لا يمكن أن يتجاوز 500 حرف' })
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),

  invoice_id: z
    .string()
    .trim()
    .optional()
    .nullable(),
});

/**
 * مخطط فلترة وبحث سجل العملاء والآجل
 */
export const customerFilterSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  search: z.string().trim().max(100).optional(),
  status_filter: z.enum(['all', 'due', 'cleared'] as const).optional().default('all'),
  status: z.enum(['active', 'cleared', 'archived', 'all'] as const).optional().default('active'),
  sort_by: z.enum(['created_at', 'name', 'balance_due', 'last_transaction_date'] as const).optional().default('created_at'),
  sort_order: z.enum(['asc', 'desc'] as const).optional().default('desc'),
});

/**
 * مخطط استعراض كشف حساب حركات العميل
 */
export const customerTransactionFilterSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  type: z.enum(['debt', 'payment', 'discount', 'adjustment', 'all'] as const).optional().default('all'),
});
