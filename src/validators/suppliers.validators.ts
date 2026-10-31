import { z } from 'zod';
import { sanitizeForDb, sanitizeSearchInput } from '../utils/sanitize';
import { paginationSchema } from './pagination.validators';

/**
 * ==============================================================================
 * MobiDash Suppliers Validation Schemas
 * ==============================================================================
 * 
 * Strict validation and sanitization for suppliers, vendor accounts,
 * wholesale transactions, supplier debt payments, and filtering queries.
 * Fully aligned with migrations/suppliers.sql and backend/src/types.ts
 */

export const SUPPLIER_CATEGORIES = [
  'هواتف',
  'إكسسوار',
  'إكسسوارات',
  'قطع غيار',
  'سنترال',
  'عام'
] as const;

export const SUPPLIER_STATUSES = ['active', 'inactive', 'archived'] as const;
export const PAYMENT_SOURCES = ['cash_drawer', 'bank', 'other'] as const;

/**
 * Schema for creating a new supplier or wholesale distributor
 */
export const createSupplierSchema = z.object({
  name: z.string()
    .trim()
    .min(2, { message: 'name_too_short' })
    .max(100, { message: 'too_long' })
    .transform(sanitizeForDb),
  company_name: z.string()
    .trim()
    .min(2, { message: 'company_name_too_short' })
    .max(100, { message: 'too_long' })
    .transform(sanitizeForDb),
  phone: z.string()
    .trim()
    .min(6, { message: 'phone_too_short' })
    .max(30, { message: 'too_long' })
    .transform(sanitizeForDb),
  category: z.enum(SUPPLIER_CATEGORIES, { message: 'invalid_category' }),
  address: z.string()
    .trim()
    .max(250, { message: 'address_too_long' })
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),
  balance_due: z.number()
    .min(0, { message: 'balance_cannot_be_negative' })
    .optional()
    .default(0),
  notes: z.string()
    .trim()
    .max(500, { message: 'notes_too_long' })
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),
});

/**
 * Schema for updating an existing supplier
 */
export const updateSupplierSchema = z.object({
  name: z.string()
    .trim()
    .min(2, { message: 'name_too_short' })
    .max(100, { message: 'too_long' })
    .optional()
    .transform((val) => (val ? sanitizeForDb(val) : undefined)),
  company_name: z.string()
    .trim()
    .min(2, { message: 'company_name_too_short' })
    .max(100, { message: 'too_long' })
    .optional()
    .transform((val) => (val ? sanitizeForDb(val) : undefined)),
  phone: z.string()
    .trim()
    .min(6, { message: 'phone_too_short' })
    .max(30, { message: 'too_long' })
    .optional()
    .transform((val) => (val ? sanitizeForDb(val) : undefined)),
  category: z.enum(SUPPLIER_CATEGORIES).optional(),
  address: z.string()
    .trim()
    .max(250)
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),
  status: z.enum(SUPPLIER_STATUSES).optional(),
  notes: z.string()
    .trim()
    .max(500)
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),
});

/**
 * Schema for paying a supplier debt/installment
 */
export const paySupplierSchema = z.object({
  amount: z.number()
    .gt(0, { message: 'amount_must_be_greater_than_zero' }),
  payment_source: z.enum(PAYMENT_SOURCES, { message: 'invalid_payment_source' }),
  receipt_number: z.string()
    .trim()
    .max(100)
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),
  notes: z.string()
    .trim()
    .max(500)
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),
});

/**
 * Schema for filtering and searching suppliers with pagination
 */
export const supplierFilterSchema = paginationSchema.extend({
  category: z.string()
    .optional()
    .transform((val) => (val && val !== 'all' ? sanitizeSearchInput(val, 50) : undefined)),
  status: z.enum(['active', 'inactive', 'archived', 'all'])
    .optional()
    .default('all'),
  balance_filter: z.enum(['all', 'due', 'cleared'])
    .optional()
    .default('all'),
  sort_by: z.enum(['created_at', 'company_name', 'balance_due'])
    .optional()
    .default('created_at'),
  sort_order: z.enum(['asc', 'desc'])
    .optional()
    .default('desc'),
});

export type CreateSupplierSchemaType = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierSchemaType = z.infer<typeof updateSupplierSchema>;
export type PaySupplierSchemaType = z.infer<typeof paySupplierSchema>;
export type SupplierFilterSchemaType = z.infer<typeof supplierFilterSchema>;
