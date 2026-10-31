import { z } from 'zod';
import { sanitizeForDb } from '../utils/sanitize';

/**
 * ==============================================================================
 * MobiDash Backend: Auth & Shift Validators
 * Location: backend/src/validators/auth.validators.ts
 * ==============================================================================
 */

/**
 * التحقق من تسجيل الدخول (يدعم المعرف: بريد إلكتروني أو رقم هاتف مع كلمة المرور)
 */
export const loginSchema = z.object({
  identifier: z.string().trim().min(1, { message: 'identifier_required' }).max(255, { message: 'too_long' }).optional(),
  email: z.string().trim().toLowerCase().min(1, { message: 'identifier_required' }).max(255, { message: 'too_long' }).optional(),
  phone: z.string().trim().max(30, { message: 'too_long' }).optional(),
  password: z.string().min(1, { message: 'password_required' }).max(255, { message: 'too_long' }),
  rememberMe: z.boolean().optional(),
}).refine((data) => Boolean(data.identifier || data.email || data.phone), {
  message: 'email_or_phone_required',
  path: ['identifier'],
});

/**
 * التحقق من طلب استعادة كلمة المرور
 */
export const forgotPasswordSchema = z.object({
  identifier: z.string().trim().min(1, { message: 'identifier_required' }).max(255, { message: 'too_long' }).optional(),
  email: z.string().trim().toLowerCase().max(255, { message: 'too_long' }).email({ message: 'invalid_email' }).optional(),
  phone: z.string().trim().max(30, { message: 'too_long' }).optional(),
}).refine((data) => Boolean(data.identifier || data.email || data.phone), {
  message: 'email_or_phone_required',
  path: ['identifier'],
});

/**
 * التحقق من كود إعادة التعيين (6 أرقام)
 */
export const verifyResetCodeSchema = z.object({
  identifier: z.string().trim().min(1, { message: 'identifier_required' }).max(255, { message: 'too_long' }).optional(),
  email: z.string().trim().toLowerCase().max(255, { message: 'too_long' }).email({ message: 'invalid_email' }).optional(),
  code: z.string().trim().length(6, { message: 'invalid_code' }).transform(sanitizeForDb),
}).refine((data) => Boolean(data.identifier || data.email), {
  message: 'email_or_phone_required',
  path: ['identifier'],
});

/**
 * التحقق من تعيين كلمة المرور الجديدة
 */
export const resetPasswordSchema = z.object({
  identifier: z.string().trim().min(1, { message: 'identifier_required' }).max(255, { message: 'too_long' }).optional(),
  email: z.string().trim().toLowerCase().max(255, { message: 'too_long' }).email({ message: 'invalid_email' }).optional(),
  code: z.string().trim().length(6, { message: 'invalid_code' }).transform(sanitizeForDb),
  newPassword: z
    .string()
    .min(8, { message: 'password_too_short' })
    .max(255, { message: 'too_long' })
    .regex(/[A-Z]/, { message: 'password_no_uppercase' })
    .regex(/[a-z]/, { message: 'password_no_lowercase' })
    .regex(/[0-9]/, { message: 'password_no_number' })
    .regex(/[^A-Za-z0-9]/, { message: 'password_no_special' }),
}).refine((data) => Boolean(data.identifier || data.email), {
  message: 'email_or_phone_required',
  path: ['identifier'],
});

/**
 * التحقق من بدء وردية جديدة للعامل بواسطة رمز PIN
 */
export const startShiftSchema = z.object({
  pin: z.string().trim().min(4, { message: 'pin_too_short' }).max(8, { message: 'pin_too_long' }).regex(/^\d+$/, { message: 'pin_digits_only' }),
  phone: z.string().trim().max(30).optional(),
  opening_cash: z.number().min(0, { message: 'invalid_amount' }).optional(),
});

/**
 * التحقق من إغلاق وتسجيل خروج الوردية
 */
export const endShiftSchema = z.object({
  shift_token: z.string().trim().optional(),
  closing_cash: z.number().min(0).optional(),
  notes: z.string().trim().max(500).optional().transform((val) => (val ? sanitizeForDb(val) : val)),
});

/**
 * التحقق من التحقق الثنائي (2FA)
 */
export const verify2faSchema = z.object({
  code: z.string().trim().length(6, { message: 'invalid_code' }).regex(/^\d{6}$/, { message: 'invalid_code' }).transform(sanitizeForDb),
  two_factor_token: z.string().trim().optional(),
});

export const resend2faSchema = z.object({
  two_factor_token: z.string().trim().optional(),
}).optional();

/**
 * التحقق من إنشاء حساب المالك
 */
export const registerSchema = z.object({
  full_name: z.string().trim().min(2, { message: 'full_name_required' }).max(100, { message: 'too_long' }).transform(sanitizeForDb),
  email: z.string().trim().toLowerCase().email({ message: 'invalid_email' }).min(1, { message: 'email_required' }).max(255, { message: 'too_long' }),
  password: z
    .string()
    .min(8, { message: 'password_too_short' })
    .max(255, { message: 'too_long' })
    .regex(/[A-Z]/, { message: 'password_no_uppercase' })
    .regex(/[a-z]/, { message: 'password_no_lowercase' })
    .regex(/[0-9]/, { message: 'password_no_number' })
    .regex(/[^A-Za-z0-9]/, { message: 'password_no_special' }),
  phone_number: z.string().trim().max(30, { message: 'too_long' }).optional(),
});

/**
 * التحقق من كود البريد الإلكتروني (Email OTP)
 */
export const verifyEmailOtpSchema = z.object({
  email: z.string().trim().toLowerCase().email({ message: 'invalid_email' }).min(1, { message: 'email_required' }),
  code: z.string().trim().length(6, { message: 'invalid_code' }).transform(sanitizeForDb),
});

/**
 * إعادة إرسال كود التحقق من البريد
 */
export const resendEmailOtpSchema = z.object({
  email: z.string().trim().toLowerCase().email({ message: 'invalid_email' }).min(1, { message: 'email_required' }),
});

/**
 * التحقق من قبول دعوة الانضمام
 */
export const acceptInviteSchema = z.object({
  token: z.string().trim().min(1, { message: 'invite_token_required' }),
  full_name: z.string().trim().min(2, { message: 'full_name_required' }).max(100, { message: 'too_long' }).transform(sanitizeForDb).optional(),
  password: z.string().min(1, { message: 'password_required' }).max(255, { message: 'too_long' }).optional(),
  phone_number: z.string().trim().max(30, { message: 'too_long' }).optional(),
});

/**
 * التحقق من إنشاء حساب سريع (Users + Dashboards + user_profile)
 */
export const quickSetupSchema = z.object({
  full_name: z.string().trim().min(2, { message: 'full_name_required' }).max(100, { message: 'too_long' }).transform(sanitizeForDb),
  email: z.string().trim().toLowerCase().email({ message: 'invalid_email' }).min(1, { message: 'email_required' }).max(255, { message: 'too_long' }),
  phone: z.string().trim().max(30, { message: 'too_long' }).optional(),
  password: z.string().min(6, { message: 'password_too_short' }).max(255, { message: 'too_long' }),
  store_name: z.string().trim().min(2, { message: 'store_name_required' }).max(100, { message: 'too_long' }).optional().transform((val) => (val ? sanitizeForDb(val) : val)),
  pin: z.string().trim().min(4, { message: 'pin_too_short' }).max(8, { message: 'pin_too_long' }).regex(/^\d+$/, { message: 'pin_digits_only' }).default('1234'),
  role: z.enum(['owner', 'manager', 'cashier', 'technician', 'accountant']).default('owner'),
});

export const verifyOwnerPasswordSchema = z.object({
  password: z.string().min(1, { message: 'password_required' }).max(255, { message: 'too_long' }),
});

// تصدير الأنواع
export type LoginInput = z.infer<typeof loginSchema>;
export type VerifyOwnerPasswordInput = z.infer<typeof verifyOwnerPasswordSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type VerifyResetCodeInput = z.infer<typeof verifyResetCodeSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type StartShiftInput = z.infer<typeof startShiftSchema>;
export type EndShiftInput = z.infer<typeof endShiftSchema>;
export type Verify2faInput = z.infer<typeof verify2faSchema>;
export type Resend2faInput = z.infer<typeof resend2faSchema>;
export type VerifyEmailOtpInput = z.infer<typeof verifyEmailOtpSchema>;
export type ResendEmailOtpInput = z.infer<typeof resendEmailOtpSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
export type QuickSetupInput = z.infer<typeof quickSetupSchema>;


