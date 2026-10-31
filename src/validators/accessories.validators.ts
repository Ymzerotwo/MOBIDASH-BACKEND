import { z } from 'zod';
import { sanitizeForDb, sanitizeSearchInput } from '../utils/sanitize';
import { paginationSchema } from './pagination.validators';

/**
 * ==============================================================================
 * MobiDash Accessories & Chargers Validation Schemas
 * ==============================================================================
 * 
 * Strict validation and sanitization for phone accessories, chargers, cases,
 * screen protectors, stock adjustments, barcode verification, and catalog queries.
 * Fully aligned with migrations/accessories.sql and backend/src/types.ts
 */

export const ACCESSORY_CATEGORIES = [
  'شواحن وكيابل',
  'جرابات وكفرات',
  'حمايات شاشة',
  'سماعات وصوتيات',
  'باور بانك',
  'إكسسوارات سيارة',
  'عام',
  'chargers_cables',
  'cases_covers',
  'screen_protectors',
  'audio_headphones',
  'power_banks',
  'car_accessories',
  'other',
] as const;

export const ACCESSORY_STATUSES = ['active', 'inactive', 'archived'] as const;
export const STOCK_ADJUSTMENT_TYPES = ['adjustment', 'damage', 'purchase', 'return'] as const;

/**
 * Schema for checking barcode availability / uniqueness
 */
export const checkBarcodeSchema = z.object({
  barcode: z.string()
    .trim()
    .min(1, { message: 'barcode_required' })
    .max(100, { message: 'too_long' })
    .transform(sanitizeForDb),
  exclude_id: z.string()
    .trim()
    .max(100)
    .optional()
    .transform((val) => (val ? sanitizeForDb(val) : undefined)),
});

/**
 * Schema for creating a new accessory or store product
 */
export const createAccessorySchema = z.object({
  name: z.string()
    .trim()
    .min(2, { message: 'name_too_short' })
    .max(150, { message: 'too_long' })
    .transform(sanitizeForDb),
  category: z.enum(ACCESSORY_CATEGORIES, { message: 'invalid_category' }),
  brand: z.string()
    .trim()
    .max(100, { message: 'too_long' })
    .optional()
    .default('عام')
    .transform((val) => sanitizeForDb(val || 'عام')),
  barcode: z.string()
    .trim()
    .max(100, { message: 'too_long' })
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),
  cost_price: z.number()
    .min(0, { message: 'cost_price_cannot_be_negative' })
    .default(0),
  retail_price: z.number()
    .min(0, { message: 'retail_price_cannot_be_negative' })
    .default(0),
  wholesale_price: z.number()
    .min(0, { message: 'wholesale_price_cannot_be_negative' })
    .optional()
    .nullable(),
  stock: z.number()
    .int({ message: 'stock_must_be_integer' })
    .min(0, { message: 'stock_cannot_be_negative' })
    .optional()
    .default(0),
  min_stock_alert: z.number()
    .int({ message: 'min_stock_alert_must_be_integer' })
    .min(0, { message: 'min_stock_alert_cannot_be_negative' })
    .optional()
    .default(3),
  compatibility: z.string()
    .trim()
    .max(250, { message: 'compatibility_too_long' })
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),
  location: z.string()
    .trim()
    .max(150, { message: 'location_too_long' })
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),
  supplier_id: z.string()
    .trim()
    .max(100)
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),
  notes: z.string()
    .trim()
    .max(500, { message: 'notes_too_long' })
    .optional()
    .nullable()
    .transform((val) => (val ? sanitizeForDb(val) : null)),
  date_added: z.string()
    .trim()
    .max(50)
    .optional()
    .nullable(),
});

/**
 * Schema for updating an existing accessory
 */
export const updateAccessorySchema = z.object({
  name: z.string()
    .trim()
    .min(2, { message: 'name_too_short' })
    .max(150, { message: 'too_long' })
    .optional()
    .transform((val) => (val ? sanitizeForDb(val) : undefined)),
  category: z.enum(ACCESSORY_CATEGORIES).optional(),
  brand: z.string()
    .trim()
    .max(100)
    .optional()
    .transform((val) => (val ? sanitizeForDb(val) : undefined)),
  barcode: z.string()
    .trim()
    .max(100)
    .optional()
    .nullable()
    .transform((val) => (val !== undefined ? (val ? sanitizeForDb(val) : null) : undefined)),
  cost_price: z.number()
    .min(0, { message: 'cost_price_cannot_be_negative' })
    .optional(),
  retail_price: z.number()
    .min(0, { message: 'retail_price_cannot_be_negative' })
    .optional(),
  wholesale_price: z.number()
    .min(0, { message: 'wholesale_price_cannot_be_negative' })
    .optional()
    .nullable(),
  min_stock_alert: z.number()
    .int()
    .min(0)
    .optional(),
  compatibility: z.string()
    .trim()
    .max(250)
    .optional()
    .nullable()
    .transform((val) => (val !== undefined ? (val ? sanitizeForDb(val) : null) : undefined)),
  location: z.string()
    .trim()
    .max(150)
    .optional()
    .nullable()
    .transform((val) => (val !== undefined ? (val ? sanitizeForDb(val) : null) : undefined)),
  status: z.enum(ACCESSORY_STATUSES).optional(),
  supplier_id: z.string()
    .trim()
    .max(100)
    .optional()
    .nullable()
    .transform((val) => (val !== undefined ? (val ? sanitizeForDb(val) : null) : undefined)),
  notes: z.string()
    .trim()
    .max(500)
    .optional()
    .nullable()
    .transform((val) => (val !== undefined ? (val ? sanitizeForDb(val) : null) : undefined)),
});

/**
 * Schema for adjusting stock count (inventory audit, damage, receiving purchase)
 */
export const adjustStockSchema = z.object({
  type: z.enum(STOCK_ADJUSTMENT_TYPES, { message: 'invalid_movement_type' }),
  quantity_change: z.number()
    .int({ message: 'quantity_change_must_be_integer' })
    .refine((val) => val !== 0, { message: 'quantity_change_cannot_be_zero' }),
  cost_price: z.number()
    .min(0)
    .optional()
    .nullable(),
  supplier_id: z.string()
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
 * Schema for filtering and searching accessories catalog with pagination
 */
export const accessoryFilterSchema = paginationSchema.extend({
  category: z.string()
    .optional()
    .transform((val) => (val && val !== 'all' ? sanitizeSearchInput(val, 50) : undefined)),
  brand: z.string()
    .optional()
    .transform((val) => (val && val !== 'all' ? sanitizeSearchInput(val, 50) : undefined)),
  stock_filter: z.enum(['all', 'low', 'available', 'out_of_stock'])
    .optional()
    .default('all'),
  status: z.enum(['active', 'inactive', 'archived', 'all'])
    .optional()
    .default('active'),
  sort_by: z.enum(['created_at', 'name', 'stock', 'retail_price'])
    .optional()
    .default('created_at'),
  sort_order: z.enum(['asc', 'desc'])
    .optional()
    .default('desc'),
});

export type CheckBarcodeSchemaType = z.infer<typeof checkBarcodeSchema>;
export type CreateAccessorySchemaType = z.infer<typeof createAccessorySchema>;
export type UpdateAccessorySchemaType = z.infer<typeof updateAccessorySchema>;
export type AdjustStockSchemaType = z.infer<typeof adjustStockSchema>;
export type AccessoryFilterSchemaType = z.infer<typeof accessoryFilterSchema>;
