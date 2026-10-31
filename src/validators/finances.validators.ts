import { z } from 'zod';
import { sanitizeForDb } from '../utils/sanitize';

/**
 * ==============================================================================
 * MobiDash Platform - Finances & Petty Expenses Validators
 * Location: backend/src/validators/finances.validators.ts
 * ==============================================================================
 */

export const createExpenseSchema = z.object({
  amount: z.coerce.number().positive('مبلغ المصروف يجب أن يكون رقماً أكبر من صفر'),
  category: z.string().trim().min(1, 'بند وتصنيف المصروف مطلوب').max(100),
  description: z.string().trim().min(1, 'بيان وشرح المصروف مطلوب').max(500),
});

export const createCashInSchema = z.object({
  amount: z.coerce.number().positive('مبلغ الإيداع يجب أن يكون رقماً أكبر من صفر'),
  source: z.string().trim().min(1, 'مصدر الإيداع مطلوب (من أين جاء المبلغ؟)').max(150),
  reason: z.string().trim().min(1, 'سبب وبيان الإيداع مطلوب').max(500),
});

export const financesMovementsQuerySchema = z.object({
  department: z.string().trim().optional(),
  movement_type: z.string().trim().optional(),
  payment_method: z.string().trim().optional(),
  shift_id: z.string().trim().optional(),
  start_date: z.string().trim().optional(),
  end_date: z.string().trim().optional(),
  search: z.string().trim().max(100).transform((val) => (val ? sanitizeForDb(val) : val)).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type CreateCashInInput = z.infer<typeof createCashInSchema>;
export type FinancesMovementsQueryInput = z.infer<typeof financesMovementsQuerySchema>;
