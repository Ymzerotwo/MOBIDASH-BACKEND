import { z } from 'zod';
import { sanitizeForDb } from '../utils/sanitize';

/**
 * ==============================================================================
 * MobiDash Store & System Settings Validation Schemas
 * Location: backend/src/validators/settings.validators.ts
 * ==============================================================================
 * 
 * Strict validation and sanitization for Store & System Settings in Dashboards table.
 * Covers all 23 settings fields, supports partial updates, sanitizes string inputs,
 * enforces length/numeric bounds, and strictly rejects unauthorized/system keys.
 */

export const THERMAL_PAPER_SIZES = ['80mm', '58mm'] as const;
export const DASHBOARD_THEMES = ['dark', 'light', 'system'] as const;
export const DASHBOARD_LOCALES = ['ar', 'en'] as const;

/**
 * Helper to sanitize optional nullable strings.
 * - If undefined (omitted in partial update), returns undefined so field is not touched in DB.
 * - If null or empty string, returns null so DB column is cleared.
 * - If non-empty string, returns sanitized string.
 */
const sanitizeOptionalNullableString = (val: string | null | undefined): string | null | undefined => {
  if (val === undefined) return undefined;
  if (val === null || val === '') return null;
  return sanitizeForDb(val);
};

/**
 * Schema for updating store settings via PATCH /api/settings
 * Covers all 23 settings fields with partial update support and strict key isolation.
 */
export const updateStoreSettingsSchema = z.object({
  // 1. Store Identity & Contact
  name: z.string()
    .trim()
    .min(2, { message: 'name_too_short' })
    .max(100, { message: 'too_long' })
    .transform(sanitizeForDb)
    .optional(),

  phone: z.string()
    .trim()
    .min(8, { message: 'phone_too_short' })
    .max(30, { message: 'too_long' })
    .regex(/^[0-9+\s\-()]+$/, { message: 'invalid_phone_format' })
    .optional(),

  email: z.string()
    .trim()
    .toLowerCase()
    .max(255, { message: 'too_long' })
    .optional()
    .nullable()
    .refine(
      (val) => {
        if (val === undefined || val === null || val === '') return true;
        return z.string().email().safeParse(val).success;
      },
      { message: 'invalid_email' }
    )
    .transform((val) => {
      if (val === undefined) return undefined;
      if (val === null || val === '') return null;
      return val;
    }),

  tagline: z.string()
    .trim()
    .max(255, { message: 'too_long' })
    .optional()
    .nullable()
    .transform(sanitizeOptionalNullableString),

  logo_url: z.string()
    .trim()
    .max(1000, { message: 'too_long' })
    .optional()
    .nullable()
    .refine(
      (val) => {
        if (val === undefined || val === null || val === '') return true;
        return z.string().url().safeParse(val).success;
      },
      { message: 'invalid_url' }
    )
    .transform((val) => {
      if (val === undefined) return undefined;
      if (val === null || val === '') return null;
      return sanitizeForDb(val);
    }),

  address: z.string()
    .trim()
    .max(500, { message: 'too_long' })
    .optional()
    .nullable()
    .transform(sanitizeOptionalNullableString),

  city: z.string()
    .trim()
    .max(100, { message: 'too_long' })
    .optional()
    .nullable()
    .transform(sanitizeOptionalNullableString),

  // 2. Regional Settings
  currency: z.string()
    .trim()
    .min(2, { message: 'currency_too_short' })
    .max(10, { message: 'too_long' })
    .toUpperCase()
    .regex(/^[A-Z]{2,10}$/, { message: 'invalid_currency_code' })
    .optional(),

  timezone: z.string()
    .trim()
    .min(3, { message: 'timezone_too_short' })
    .max(100, { message: 'too_long' })
    .regex(/^[A-Za-z0-9_\-+/]+$/, { message: 'invalid_timezone_format' })
    .optional(),

  // 3. POS & Receipt Layout
  receipt_header: z.string()
    .trim()
    .max(1000, { message: 'too_long' })
    .optional()
    .nullable()
    .transform(sanitizeOptionalNullableString),

  receipt_footer: z.string()
    .trim()
    .max(1000, { message: 'too_long' })
    .optional()
    .nullable()
    .transform(sanitizeOptionalNullableString),

  receipt_terms: z.string()
    .trim()
    .max(2000, { message: 'too_long' })
    .optional()
    .nullable()
    .transform(sanitizeOptionalNullableString),

  enable_thermal_print: z.boolean({ message: 'invalid_boolean' }).optional(),

  thermal_paper_size: z.enum(THERMAL_PAPER_SIZES, { message: 'invalid_thermal_paper_size' }).optional(),

  // 4. Invoicing & Tax
  show_tax_invoice: z.boolean({ message: 'invalid_boolean' }).optional(),

  tax_rate: z.number({ message: 'invalid_number' })
    .min(0, { message: 'tax_rate_min_zero' })
    .max(100, { message: 'tax_rate_max_100' })
    .optional(),

  // 5. Repairs & Warranty Policies
  repair_terms: z.string()
    .trim()
    .max(2000, { message: 'too_long' })
    .optional()
    .nullable()
    .transform(sanitizeOptionalNullableString),

  default_repair_warranty_days: z.number({ message: 'invalid_number' })
    .int({ message: 'warranty_days_must_be_integer' })
    .min(0, { message: 'warranty_days_min_zero' })
    .max(3650, { message: 'warranty_days_max_limit' })
    .optional(),

  require_imei_for_phones: z.boolean({ message: 'invalid_boolean' }).optional(),

  // 6. Cashier & Telecom Switches
  opening_cash_default: z.number({ message: 'invalid_number' })
    .min(0, { message: 'opening_cash_min_zero' })
    .max(10000000, { message: 'opening_cash_max_limit' })
    .optional(),

  enable_telecom_wallets: z.boolean({ message: 'invalid_boolean' }).optional(),

  // 7. System Interface Preferences
  theme: z.enum(DASHBOARD_THEMES, { message: 'invalid_theme' }).optional(),

  locale: z.enum(DASHBOARD_LOCALES, { message: 'invalid_locale' }).optional(),
}).strict();

export type UpdateStoreSettingsSchemaType = z.infer<typeof updateStoreSettingsSchema>;
