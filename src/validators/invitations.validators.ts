import { z } from 'zod';
import { sanitizeForDb } from '../utils/sanitize';

/**
 * ==============================================================================
 * MobiDash Backend: Merchant Invitations & Onboarding Validators
 * Location: backend/src/validators/invitations.validators.ts
 * ==============================================================================
 */

/**
 * التحقق من كود الدعوة في مسار الفحص
 */
export const verifyInviteParamSchema = z.object({
  code: z
    .string()
    .trim()
    .min(4, { message: 'invite_code_too_short' })
    .max(50, { message: 'invite_code_too_long' })
    .transform(sanitizeForDb),
});

/**
 * التحقق من تسجيل حساب تاجر جديد بكود الدعوة
 */
export const registerWithInviteSchema = z.object({
  invite_code: z
    .string()
    .trim()
    .min(4, { message: 'invite_code_required' })
    .max(50, { message: 'invite_code_too_long' })
    .transform(sanitizeForDb),
  full_name: z
    .string()
    .trim()
    .min(2, { message: 'full_name_required' })
    .max(100, { message: 'full_name_too_long' })
    .transform(sanitizeForDb),
  phone: z
    .string()
    .trim()
    .min(8, { message: 'phone_required' })
    .max(30, { message: 'phone_too_long' })
    .regex(/^[0-9+\s-]+$/, { message: 'invalid_phone_format' }),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email({ message: 'invalid_email' })
    .max(255, { message: 'email_too_long' })
    .optional()
    .or(z.literal('')),
  password: z
    .string()
    .min(6, { message: 'password_too_short' })
    .max(255, { message: 'password_too_long' }),
  store_name: z
    .string()
    .trim()
    .min(2, { message: 'store_name_required' })
    .max(100, { message: 'store_name_too_long' })
    .transform(sanitizeForDb),
  store_address: z
    .string()
    .trim()
    .max(255, { message: 'store_address_too_long' })
    .optional()
    .transform((val) => (val ? sanitizeForDb(val) : undefined)),
  device_fingerprint: z
    .string()
    .trim()
    .max(128)
    .optional(),
});

export type RegisterWithInviteFormInput = z.infer<typeof registerWithInviteSchema>;
