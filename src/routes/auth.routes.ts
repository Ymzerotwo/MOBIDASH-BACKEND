/**
 * ==========================================
 *        OuraDash Authentication Routes
 * ==========================================
 * 
 * Defines the routing endpoints for Authentication operations.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { 
  loginSchema, 
  registerSchema, 
  forgotPasswordSchema, 
  resetPasswordSchema, 
  verifyResetCodeSchema, 
  acceptInviteSchema, 
  verifyEmailOtpSchema, 
  resendEmailOtpSchema, 
  verify2faSchema, 
  resend2faSchema,
  startShiftSchema,
  endShiftSchema,
  quickSetupSchema,
  verifyOwnerPasswordSchema
} from '../validators/auth.validators';
import { sendResponse } from '../utils/response';
import { AuthController } from '../controllers/auth.controller';
import { InvitationsController } from '../controllers/invitations.controller';
import { registerWithInviteSchema } from '../validators/invitations.validators';
import { AppContext } from '../types';
import { rateLimiter } from '../middleware/rateLimit.middleware';

const authRoutes = new Hono<AppContext>();

/**
 * GET /api/auth/csrf
 * Returns a CSRF token.
 */
authRoutes.get('/csrf', AuthController.getCsrfToken);

/**
 * GET /api/auth/session
 * Returns the currently active session, store context, and active shift from KV/Cookie.
 */
authRoutes.get('/session', AuthController.getSession);

/**
 * GET /api/auth/invite/:token
 * Validates invitation token for new or invited team members.
 */
authRoutes.get('/invite/:token', AuthController.verifyInvite);

/**
 * POST /api/auth/invite/accept
 * Accepts invitation and creates/attaches user profile.
 */
authRoutes.post(
  '/invite/accept',
  rateLimiter('LOGIN_RECOVERY_LIMITER'),
  zValidator('json', acceptInviteSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'Invalid input data', null, result.error.issues);
    }
  }),
  AuthController.acceptInvite
);

/**
 * POST /api/auth/register
 * Registers a new user account, owner profile, and workspace.
 */
authRoutes.post(
  '/register',
  rateLimiter('LOGIN_RECOVERY_LIMITER'),
  zValidator('json', registerSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'Invalid input data', null, result.error.issues);
    }
  }),
  AuthController.register
);

/**
 * GET /api/auth/verify-invite-code/:code
 * فحص صلاحية كود دعوة التاجر الجديد
 */
authRoutes.get('/verify-invite-code/:code', InvitationsController.verifyInviteCode);

/**
 * POST /api/auth/register-with-invite
 * تسجيل حساب تاجر جديد وإنشاء متجره بكود الدعوة
 */
authRoutes.post(
  '/register-with-invite',
  rateLimiter('LOGIN_RECOVERY_LIMITER'),
  zValidator('json', registerWithInviteSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'بيانات تسجيل التاجر غير صالحة', null, result.error.issues);
    }
  }),
  InvitationsController.registerWithInvite
);

/**
 * POST /api/auth/login
 * Authenticates a user.
 */
authRoutes.post(
  '/login',
  rateLimiter('LOGIN_RECOVERY_LIMITER'),
  zValidator('json', loginSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'Invalid input data', null, result.error.issues);
    }
  }),
  AuthController.login
);

/**
 * POST /api/auth/logout
 * Terminates the user session.
 */
authRoutes.post('/logout', AuthController.logout);

/**
 * POST /api/auth/forgot-password
 * Initiates the password recovery flow.
 */
authRoutes.post(
  '/forgot-password',
  rateLimiter('LOGIN_RECOVERY_LIMITER'),
  zValidator('json', forgotPasswordSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'Invalid input data', null, result.error.issues);
    }
  }),
  AuthController.forgotPassword
);

/**
 * POST /api/auth/resend-code
 * Resends the password recovery OTP code.
 */
authRoutes.post(
  '/resend-code',
  rateLimiter('LOGIN_RECOVERY_LIMITER'),
  zValidator('json', forgotPasswordSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'Invalid input data', null, result.error.issues);
    }
  }),
  AuthController.resendResetCode
);

/**
 * POST /api/auth/reset-password
 * Resets the password using reset code.
 */
authRoutes.post(
  '/reset-password',
  rateLimiter('LOGIN_RECOVERY_LIMITER'),
  zValidator('json', resetPasswordSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'Invalid input data', null, result.error.issues);
    }
  }),
  AuthController.resetPassword
);

/**
 * POST /api/auth/verify-code
 * Validates the password recovery OTP code.
 */
authRoutes.post(
  '/verify-code',
  rateLimiter('VERIFY_CODE_LIMITER'),
  zValidator('json', verifyResetCodeSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'Invalid input data', null, result.error.issues);
    }
  }),
  AuthController.verifyResetCode
);

/**
 * POST /api/auth/verify-email-otp
 * Validates the email verification OTP code and provisions the session.
 */
authRoutes.post(
  '/verify-email-otp',
  rateLimiter('VERIFY_CODE_LIMITER'),
  zValidator('json', verifyEmailOtpSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'Invalid input data', null, result.error.issues);
    }
  }),
  AuthController.verifyEmailOtp
);

/**
 * POST /api/auth/resend-email-otp
 * Resends the email verification OTP code.
 */
authRoutes.post(
  '/resend-email-otp',
  rateLimiter('LOGIN_RECOVERY_LIMITER'),
  zValidator('json', resendEmailOtpSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'Invalid input data', null, result.error.issues);
    }
  }),
  AuthController.resendEmailOtp
);

/**
 * POST /api/auth/2fa/verify
 * Validates the 6-digit Two-Factor Authentication OTP code and provisions the session.
 */
authRoutes.post(
  '/2fa/verify',
  rateLimiter('VERIFY_CODE_LIMITER'),
  zValidator('json', verify2faSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'Invalid input data', null, result.error.issues);
    }
  }),
  AuthController.verify2fa
);

/**
 * POST /api/auth/2fa/resend
 * Resends a fresh 6-digit Two-Factor Authentication OTP code.
 */
authRoutes.post(
  '/2fa/resend',
  rateLimiter('LOGIN_RECOVERY_LIMITER'),
  zValidator('json', resend2faSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'Invalid input data', null, result.error.issues);
    }
  }),
  AuthController.resend2fa
);

/**
 * POST /api/auth/shift/start
 * Authenticates a staff worker via PIN code and opens an active shift on the current session.
 * Automatically closes any previous active shift on the session.
 */
authRoutes.post(
  '/shift/start',
  rateLimiter('LOGIN_RECOVERY_LIMITER'),
  zValidator('json', startShiftSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'بيانات بدء الوردية غير صالحة', null, result.error.issues);
    }
  }),
  AuthController.startShift
);

/**
 * POST /api/auth/shift/end
 * Terminates and logs out of the active worker shift.
 */
authRoutes.post(
  '/shift/end',
  zValidator('json', endShiftSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'بيانات إغلاق الوردية غير صالحة', null, result.error.issues);
    }
  }),
  AuthController.endShift
);

/**
 * POST /api/auth/quick-setup
 * Creates Users, Dashboards, and user_profile directly in an atomic transaction.
 */
authRoutes.post(
  '/quick-setup',
  rateLimiter('AUTH_LIMITER'),
  zValidator('json', quickSetupSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'بيانات غير صالحة لإنشاء الحساب', null, result.error.issues);
    }
  }),
  AuthController.quickSetup
);


/**
 * GET /api/auth/staff
 * Retrieves active worker profiles for the current authenticated store session.
 */
authRoutes.get('/staff', AuthController.getStoreStaff);

/**
 * POST /api/auth/verify-owner-password
 * Verifies owner password when switching from worker mode back to owner mode.
 */
authRoutes.post(
  '/verify-owner-password',
  rateLimiter('LOGIN_RECOVERY_LIMITER'),
  zValidator('json', verifyOwnerPasswordSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'كلمة المرور مطلوبة', null, result.error.issues);
    }
  }),
  AuthController.verifyOwnerPassword
);

/**
 * POST /api/auth/store-login
 * تسجيل دخول المتجر / لوحة التحكم عبر الهاتف وكلمة المرور
 */
authRoutes.post('/store-login', AuthController.storeLogin);

/**
 * GET /api/auth/store-accounts
 * جلب حسابات المتجر المتاحة للدخول
 */
authRoutes.get('/store-accounts', AuthController.getStoreAccounts);

/**
 * POST /api/auth/login-shift
 * تسجيل دخول المستخدم بالوردية
 */
authRoutes.post('/login-shift', AuthController.loginShift);

export default authRoutes;
