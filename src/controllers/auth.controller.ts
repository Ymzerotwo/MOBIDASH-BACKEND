/**
 * ==========================================
 *        OuraDash Auth Controller
 * ==========================================
 * 
 * Handles HTTP requests for Auth operations.
 */

import { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { sendResponse } from '../utils/response';
import { rotateCsrfToken } from '../middleware/csrf';
import { AppContext } from '../types';
import { AuthService } from '../services/auth.services';
import { logger } from '../utils/logger';
import { isProductionRequest } from '../utils/request';

// Authentication Controller
// Handles user login, session management, and password recovery flows.
// Integrates directly with Hono HTTP contexts and manages secure client cookies.
export const AuthController = {
  
  // CSRF Token Retrieval Handler
  // Generates and returns a fresh CSRF token for the client.
  // Leverages `rotateCsrfToken` to issue a token and secure state-changing endpoints.
  getCsrfToken: (c: Context<AppContext>) => {
    const token = rotateCsrfToken(c);
    return sendResponse(c, 200, 'CSRF_TOKEN_GENERATED', 'CSRF token generated successfully', { token });
  },

  /**
   * User Registration Handler
   * Creates a new user account, owner profile, default dashboard, and session.
   * Sets secure session cookie and rotates CSRF token.
   *
   * @param c - The Hono HTTP context.
   */
  register: async (c: Context<AppContext>) => {
    // إيقاف التسجيل المباشر للحسابات الجديدة بناءً على سياسة النظام مع الحفاظ على الكود بالكامل
    const REGISTRATION_ENABLED = false;
    if (!REGISTRATION_ENABLED) {
      return sendResponse(
        c,
        403,
        'REGISTRATION_DISABLED',
        'إنشاء الحسابات الجديدة معطل حالياً من قبل الإدارة. يرجى التواصل مع مالك المتجر أو تسجيل الدخول بحساب موجود.'
      );
    }

    const reqId = (c.get('requestId') as string) || 'unknown';
    const rawBody = c.req.valid('json' as never) as any;

    const db = c.env.DB;
    const rawUserAgent = c.req.header('user-agent') || 'Unknown';
    const rawIpAddress = c.req.header('cf-connecting-ip') || 'Unknown';

    const userAgent = rawUserAgent.substring(0, 255);
    const ipAddress = rawIpAddress;

    try {
      const k1 = c.env.ouradash_dashboard || (c.env as any)?.K1;
      if (!k1) throw new Error("Session KV binding (ouradash_dashboard/K1) is missing");

      const result = await AuthService.register(db, k1, rawBody, userAgent, ipAddress, c.env);

      if ('error' in result) {
        return sendResponse(c, (result.status || 400) as any, result.error || 'REGISTRATION_ERROR', result.message || 'Registration failed');
      }

      if ('requires_email_verification' in result) {
        return sendResponse(c, 200, 'VERIFICATION_CODE_SENT', result.message || 'Verification code sent', {
          requires_email_verification: true,
          email: result.email,
        });
      }

      const hostname = new URL(c.req.url).hostname;
      const isProduction = hostname !== 'localhost' && hostname !== '127.0.0.1';

      setCookie(c, 'session_id', result.sessionId as string, {
        path: '/',
        secure: isProduction,
        httpOnly: true,
        sameSite: 'Lax',
        expires: result.expiresAt
      });

      rotateCsrfToken(c);

      return sendResponse(c, 201, 'REGISTER_SUCCESS', 'Account registered successfully', { user: result.user });
    } catch (error: any) {
      logger.error(reqId, `Registration failed: ${error.message || error}`);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'Failed to register', null, error.message);
    }
  },

  /**
   * User Login Handler
   * Authenticates user credentials, provisions session in Cloudflare KV,
   * sets a secure HttpOnly cookie on the client, and rotates the CSRF token.
   * Handles edge cases like inactive/banned accounts and protects against session fixation.
   * 
   * @param c - The Hono HTTP context.
   */
  login: async (c: Context<AppContext>) => {
    const reqId = (c.get('requestId') as string) || 'unknown';
    const rawBody = c.req.valid('json' as never) as any;
    
    // Support identifier, email, or phone
    const identifier = (rawBody.identifier || rawBody.email || rawBody.phone || '').trim();
    const rememberMe = rawBody.rememberMe;
    const password = rawBody.password; // Securely processed using Web Crypto API PBKDF2 hashing
    
    const db = c.env.DB;
    const rawUserAgent = c.req.header('user-agent') || 'Unknown';
    const rawIpAddress = c.req.header('cf-connecting-ip') || 'Unknown';
    
    const userAgent = rawUserAgent.substring(0, 255); // Truncate user agent string to match DB storage limits
    const ipAddress = rawIpAddress;

    try {
      const k1 = c.env.ouradash_dashboard || (c.env as any)?.K1;
      if (!k1) throw new Error("Session KV binding (ouradash_dashboard/K1) is missing");
      
      const result = await AuthService.login(db, k1, identifier, password, rememberMe, userAgent, ipAddress, c.env);
      
      if (result.error) {
        return sendResponse(c, result.status as any, result.error, result.message);
      }

      if ('requires_email_verification' in result && result.requires_email_verification) {
        return sendResponse(c, 200, 'VERIFICATION_CODE_SENT', result.message || 'Verification code sent', {
          requires_email_verification: true,
          email: result.email,
        });
      }

      if ('requires_2fa' in result && result.requires_2fa) {
        const hostname = new URL(c.req.url).hostname;
        const isProduction = hostname !== 'localhost' && hostname !== '127.0.0.1';

        // Set secure HttpOnly cookie for 2FA pre-auth token (TTL: 5 minutes)
        // Immune to XSS attacks since JavaScript cannot access it
        setCookie(c, 'two_factor_token', result.two_factor_token as string, {
          path: '/',
          secure: isProduction,
          httpOnly: true,
          sameSite: 'Lax',
          maxAge: 300,
        });

        return sendResponse(c, 200, 'TWO_FACTOR_REQUIRED', result.message || 'Two-factor authentication required', {
          requires_2fa: true,
          two_factor_token: result.two_factor_token,
          email: result.email,
        });
      }

      const hostname = new URL(c.req.url).hostname;
      const isProduction = hostname !== 'localhost' && hostname !== '127.0.0.1';
      
      // Set secure HTTP-only cookie for session tracking.
      // Uses Lax SameSite attribute to allow standard cross-site navigation while preventing CSRF.
      setCookie(c, 'session_id', result.sessionId as string, {
        path: '/',
        secure: isProduction,
        httpOnly: true,
        sameSite: 'Lax',
        expires: result.expiresAt
      });

      // Crucial Security Measure: Rotate CSRF token on login to prevent Session Fixation attacks
      rotateCsrfToken(c);

      return sendResponse(c, 200, 'LOGIN_SUCCESS', 'Logged in successfully', { user: result.user });
    } catch (error: any) {
      logger.error(reqId, `Login failed: ${error.message || error}`);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'Failed to login', null, error.message);
    }
  },

  /**
   * User Logout Handler
   * Revokes the session from the globally distributed KV Cache,
   * deletes the cookie from the client browser, and resets authentication state.
   * 
   * @param c - The Hono HTTP context.
   */
  logout: async (c: Context<AppContext>) => {
    const reqId = (c.get('requestId') as string) || 'unknown';
    const k1 = c.env.ouradash_dashboard || (c.env as any)?.K1;
    const sessionId = c.get('session_id') || getCookie(c, 'session_id');
    const db = c.env.DB;
    
    try {
      await AuthService.logout(db, k1, sessionId);

      const hostname = new URL(c.req.url).hostname;
      const isProduction = hostname !== 'localhost' && hostname !== '127.0.0.1';
      deleteCookie(c, 'session_id', {
        path: '/',
        secure: isProduction,
      });
      deleteCookie(c, 'two_factor_token', {
        path: '/',
        secure: isProduction,
      });

      return sendResponse(c, 200, 'LOGOUT_SUCCESS', 'Logged out successfully');
    } catch (error: any) {
      logger.error(reqId, `Logout failed: ${error.message || error}`);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'Failed to logout', null, error.message);
    }
  },

  /**
   * Forgot Password Handler
   * Initiates the password recovery flow by generating and storing a 6-digit OTP in the DB,
   * then sending it to the user's email via Cloudflare Email Routing API.
   * Employs dummy database writes/reads to mitigate timing attacks (email enumeration).
   * 
   * @param c - The Hono HTTP context.
   */
  forgotPassword: async (c: Context<AppContext>) => {
    const reqId = (c.get('requestId') as string) || 'unknown';
    const rawBody = c.req.valid('json' as never) as any;
    const identifier = (rawBody.identifier || rawBody.email || rawBody.phone || '').trim();
    const db = c.env.DB;

    try {
      const result = await AuthService.forgotPassword(db, identifier, c.env);
      if (result.error) {
        return sendResponse(c, result.status as any, result.error, result.message);
      }
      return sendResponse(c, 200, 'RECOVERY_EMAIL_SENT', 'إذا كان الحساب مسجلاً، فقد تم إرسال رمز التحقق إلى بريدك الإلكتروني.');
    } catch (error: any) {
      logger.error(reqId, `Forgot password request failed: ${error.message || error}`);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'Failed to process request', null, error.message);
    }
  },

  /**
   * Resend Reset Code Handler
   * Generates and sends a new OTP verification code for password recovery.
   * Checks if the account is banned before resending.
   * 
   * @param c - The Hono HTTP context.
   */
  resendResetCode: async (c: Context<AppContext>) => {
    const reqId = (c.get('requestId') as string) || 'unknown';
    const rawBody = c.req.valid('json' as never) as any;
    const identifier = (rawBody.identifier || rawBody.email || rawBody.phone || '').trim();
    const db = c.env.DB;

    try {
      const result = await AuthService.resendResetCode(db, identifier, c.env);
      if (result.error) {
        return sendResponse(c, result.status as any, result.error, result.message);
      }
      return sendResponse(c, 200, 'RECOVERY_EMAIL_SENT', 'تم إرسال رمز تحقق جديد إلى بريدك الإلكتروني.');
    } catch (error: any) {
      logger.error(reqId, `Resend reset code failed: ${error.message || error}`);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'Failed to resend recovery code', null, error.message);
    }
  },

  /**
   * Verify Reset Code Handler
   * Validates the 6-digit OTP recovery code against the DB before password reset.
   * Implements strict brute-force protection using rate limiting on KV store to lock down attempts.
   * 
   * @param c - The Hono HTTP context.
   */
  verifyResetCode: async (c: Context<AppContext>) => {
    const reqId = (c.get('requestId') as string) || 'unknown';
    const rawBody = c.req.valid('json' as never) as any;
    const identifier = (rawBody.identifier || rawBody.email || rawBody.phone || '').trim();
    const code = rawBody.code;
    const db = c.env.DB;
    const k1 = c.env.ouradash_dashboard || (c.env as any)?.K1;
    const ipAddress = c.req.header('cf-connecting-ip') || 'Unknown';

    try {
      const result = await AuthService.verifyResetCode(db, k1, identifier, code, ipAddress);
      if (result.error) return sendResponse(c, result.status as any, result.error, result.message);
      return sendResponse(c, 200, 'CODE_VERIFIED', 'رمز التحقق صحيح.');
    } catch (error: any) {
      logger.error(reqId, `Verify reset code failed: ${error.message || error}`);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'Failed to verify code', null, error.message);
    }
  },

  /**
   * Reset Password Handler
   * Validates the OTP recovery code and updates the user's password in the database.
   * Wipes the OTP code and revokes all active sessions for the user to prevent post-exploit access.
   * 
   * @param c - The Hono HTTP context.
   */
  resetPassword: async (c: Context<AppContext>) => {
    const reqId = (c.get('requestId') as string) || 'unknown';
    const rawBody = c.req.valid('json' as never) as any;
    
    const identifier = (rawBody.identifier || rawBody.email || rawBody.phone || '').trim();
    const code = rawBody.code;
    const newPassword = rawBody.newPassword;
    
    const db = c.env.DB;
    const k1 = c.env.ouradash_dashboard || (c.env as any)?.K1;
    const ipAddress = c.req.header('cf-connecting-ip') || 'Unknown';

    try {
      const result = await AuthService.resetPassword(db, k1, identifier, code, newPassword, ipAddress);
      if (result.error) return sendResponse(c, result.status as any, result.error, result.message);
      return sendResponse(c, 200, 'PASSWORD_RESET_SUCCESS', 'تمت إعادة تعيين كلمة المرور بنجاح. يمكنك الآن تسجيل الدخول.');
    } catch (error: any) {
      logger.error(reqId, `Reset password failed: ${error.message || error}`);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'Failed to reset password', null, error.message);
    }
  },

  /**
   * Verify Invite Handler
   * Validates invitation token, expiration, and returns invited role/dashboard details.
   */
  verifyInvite: async (c: Context<AppContext>) => {
    const reqId = (c.get('requestId') as string) || 'unknown';
    const token = c.req.param('token');
    const db = c.env.DB;

    if (!token) {
      return sendResponse(c, 400, 'TOKEN_REQUIRED', 'Invitation token is required');
    }

    try {
      const result = await AuthService.verifyInvite(db, token);
      if ('error' in result && result.error) {
        return sendResponse(c, result.status as any, result.error, result.message || 'Invitation error');
      }

      // Check if client has an active session matching the invitation
      const k1 = c.env.ouradash_dashboard || (c.env as any)?.K1;
      let currentUser: any = null;
      const authHeader = c.req.header('Authorization');
      const sessionId = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : (getCookie(c, 'session_id') || '');
      if (k1 && sessionId && sessionId.startsWith('session:')) {
        try {
          const sessionStr = await k1.get(sessionId);
          if (sessionStr) currentUser = JSON.parse(sessionStr);
        } catch {}
      }

      const isCurrentUser = currentUser?.email ? currentUser.email.toLowerCase() === result.invite!.email.toLowerCase() : false;
      const loggedInEmail = currentUser?.email || null;

      return sendResponse(c, 200, 'INVITE_VERIFIED', 'Invitation is valid', {
        invite: {
          ...result.invite,
          is_current_user: isCurrentUser,
          logged_in_email: loggedInEmail,
        }
      });
    } catch (error: any) {
      logger.error(reqId, `Verify invite failed: ${error.message || error}`);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'Failed to verify invitation', null, error.message);
    }
  },

  /**
   * Accept Invite Handler
   * Registers/links the invited user, attaches their profile to the specific dashboard with invited role/permissions,
   * updates invitation status to 'accepted', sets session cookie, and rotates CSRF token.
   */
  acceptInvite: async (c: Context<AppContext>) => {
    const reqId = (c.get('requestId') as string) || 'unknown';
    const rawBody = c.req.valid('json' as never) as any;
    const db = c.env.DB;
    const rawUserAgent = c.req.header('user-agent') || 'Unknown';
    const rawIpAddress = c.req.header('cf-connecting-ip') || 'Unknown';
    const userAgent = rawUserAgent.substring(0, 255);
    const ipAddress = rawIpAddress;

    try {
      const k1 = c.env.ouradash_dashboard || (c.env as any)?.K1;
      if (!k1) throw new Error("Session KV binding (ouradash_dashboard/K1) is missing");

      // Check if client is already authenticated
      let currentUser: any = null;
      const authHeader = c.req.header('Authorization');
      const sessionId = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : (getCookie(c, 'session_id') || '');
      if (sessionId && sessionId.startsWith('session:')) {
        try {
          const sessionStr = await k1.get(sessionId);
          if (sessionStr) currentUser = JSON.parse(sessionStr);
        } catch {}
      }

      const result = await AuthService.acceptInvite(db, k1, rawBody, userAgent, ipAddress, currentUser);
      if ('error' in result) {
        return sendResponse(c, (result.status || 400) as any, result.error || 'INVITATION_ERROR', result.message || 'Invitation error');
      }

      const hostname = new URL(c.req.url).hostname;
      const isProduction = hostname !== 'localhost' && hostname !== '127.0.0.1';

      setCookie(c, 'session_id', result.sessionId as string, {
        path: '/',
        secure: isProduction,
        httpOnly: true,
        sameSite: 'Lax',
        expires: result.expiresAt
      });

      rotateCsrfToken(c);

      return sendResponse(c, 201, 'INVITE_ACCEPTED', 'Invitation accepted and account created successfully', { user: result.user });
    } catch (error: any) {
      logger.error(reqId, `Accept invite failed: ${error.message || error}`);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'Failed to accept invitation', null, error.message);
    }
  },

  /**
   * Verify Email OTP Handler
   * Validates the 6-digit OTP code sent to user email upon registration.
   * If correct, marks email as verified, provisions KV session, sets session_id cookie and rotates CSRF.
   */
  verifyEmailOtp: async (c: Context<AppContext>) => {
    const reqId = (c.get('requestId') as string) || 'unknown';
    const rawBody = c.req.valid('json' as never) as { email: string; code: string };
    const { email, code } = rawBody;
    const db = c.env.DB;
    const rawUserAgent = c.req.header('user-agent') || 'Unknown';
    const rawIpAddress = c.req.header('cf-connecting-ip') || 'Unknown';
    const userAgent = rawUserAgent.substring(0, 255);
    const ipAddress = rawIpAddress;

    try {
      const k1 = c.env.ouradash_dashboard || (c.env as any)?.K1;
      if (!k1) throw new Error("Session KV binding (ouradash_dashboard/K1) is missing");

      const result = await AuthService.verifyEmailOtp(db, k1, email, code, userAgent, ipAddress);
      if ('error' in result) {
        return sendResponse(c, (result.status || 400) as any, result.error || 'INVALID_CODE', result.message || 'Verification error');
      }

      const hostname = new URL(c.req.url).hostname;
      const isProduction = hostname !== 'localhost' && hostname !== '127.0.0.1';

      setCookie(c, 'session_id', result.sessionId as string, {
        path: '/',
        secure: isProduction,
        httpOnly: true,
        sameSite: 'Lax',
        expires: result.expiresAt
      });

      rotateCsrfToken(c);

      return sendResponse(c, 200, 'EMAIL_VERIFIED', 'Email verified successfully. You are now logged in.', { user: result.user });
    } catch (error: any) {
      logger.error(reqId, `Verify email OTP failed: ${error.message || error}`);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'Failed to verify email OTP', null, error.message);
    }
  },

  /**
   * Resend Email OTP Handler
   * Generates and dispatches a fresh 6-digit OTP code for email verification.
   */
  resendEmailOtp: async (c: Context<AppContext>) => {
    const reqId = (c.get('requestId') as string) || 'unknown';
    const rawBody = c.req.valid('json' as never) as { email: string };
    const { email } = rawBody;
    const db = c.env.DB;

    try {
      const result = await AuthService.resendEmailOtp(db, email, c.env);
      if ('error' in result) {
        return sendResponse(c, (result.status || 400) as any, result.error || 'RESEND_ERROR', result.message || 'Resend error');
      }

      return sendResponse(c, 200, 'OTP_RESENT', 'New verification code has been sent successfully to your email.');
    } catch (error: any) {
      logger.error(reqId, `Resend email OTP failed: ${error.message || error}`);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'Failed to resend email verification code', null, error.message);
    }
  },

  /**
   * Two-Factor Authentication Verification Handler
   * Validates the 6-digit 2FA code against the pre-auth two_factor_token.
   * On success: provisions user session, sets session_id cookie, rotates CSRF token.
   */
  verify2fa: async (c: Context<AppContext>) => {
    const reqId = (c.get('requestId') as string) || 'unknown';
    const rawBody = (c.req.valid('json' as never) as any) || {};
    const cookieToken = getCookie(c, 'two_factor_token');
    const two_factor_token = cookieToken || rawBody.two_factor_token;
    const code = rawBody.code;

    if (!two_factor_token) {
      return sendResponse(c, 400, 'SESSION_EXPIRED', 'Two-factor authentication session expired or invalid. Please sign in again.');
    }

    const db = c.env.DB;
    const rawUserAgent = c.req.header('user-agent') || 'Unknown';
    const rawIpAddress = c.req.header('cf-connecting-ip') || 'Unknown';
    const userAgent = rawUserAgent.substring(0, 255);
    const ipAddress = rawIpAddress;

    try {
      const k1 = c.env.ouradash_dashboard || (c.env as any)?.K1;
      if (!k1) throw new Error("Session KV binding (ouradash_dashboard/K1) is missing");

      const result = await AuthService.verify2fa(db, k1, two_factor_token, code, userAgent, ipAddress);

      if ('error' in result) {
        return sendResponse(c, (result.status || 400) as any, result.error as any, result.message || 'Two-factor verification failed');
      }

      const hostname = new URL(c.req.url).hostname;
      const isProduction = hostname !== 'localhost' && hostname !== '127.0.0.1';

      // Clean up the two_factor_token HttpOnly cookie immediately upon successful login
      deleteCookie(c, 'two_factor_token', {
        path: '/',
        secure: isProduction,
      });

      setCookie(c, 'session_id', result.sessionId as string, {
        path: '/',
        secure: isProduction,
        httpOnly: true,
        sameSite: 'Lax',
        expires: result.expiresAt
      });

      rotateCsrfToken(c);

      return sendResponse(c, 200, 'LOGIN_SUCCESS', 'Logged in successfully with two-factor authentication', { user: result.user });
    } catch (error: any) {
      logger.error(reqId, `Verify 2FA failed: ${error.message || error}`);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'Failed to verify two-factor authentication', null, error.message);
    }
  },

  /**
   * Two-Factor Authentication Resend Handler
   * Resends a fresh 6-digit 2FA code to the email bound to the two_factor_token.
   */
  resend2fa: async (c: Context<AppContext>) => {
    const reqId = (c.get('requestId') as string) || 'unknown';
    const rawBody = (c.req.valid('json' as never) as any) || {};
    const cookieToken = getCookie(c, 'two_factor_token');
    const two_factor_token = cookieToken || rawBody.two_factor_token;

    if (!two_factor_token) {
      return sendResponse(c, 400, 'SESSION_EXPIRED', 'Two-factor authentication session expired or invalid. Please sign in again.');
    }

    const db = c.env.DB;

    try {
      const k1 = c.env.ouradash_dashboard || (c.env as any)?.K1;
      if (!k1) throw new Error("Session KV binding (ouradash_dashboard/K1) is missing");

      const result = await AuthService.resend2fa(db, k1, two_factor_token, c.env);

      if ('error' in result) {
        return sendResponse(c, (result.status || 400) as any, result.error as any, result.message || 'Failed to resend code');
      }

      return sendResponse(c, 200, 'CODE_RESENT', result.message || 'Verification code resent successfully');
    } catch (error: any) {
      logger.error(reqId, `Resend 2FA failed: ${error.message || error}`);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'Failed to resend two-factor code', null, error.message);
    }
  },

  /**
   * Start Shift Controller (بدء وتسجيل الوردية للعامل)
   * Worker enters their quick PIN code.
   * Single active shift per session is enforced: any previously active shift in this session is closed automatically.
   */
  startShift: async (c: Context<AppContext>) => {
    const reqId = (c.get('requestId') as string) || 'unknown';
    const rawBody = c.req.valid('json' as never) as any;
    const { pin, phone, opening_cash } = rawBody;

    const db = c.env.DB;
    const k1 = c.env.ouradash_dashboard || (c.env as any)?.K1;
    if (!k1) {
      return sendResponse(c, 500, 'SERVER_ERROR', 'Session verification service unavailable');
    }

    // Extract master session
    const authHeader = c.req.header('Authorization');
    let sessionId = (c.get('session_id') as string) || '';
    if (!sessionId) {
      if (authHeader && authHeader.startsWith('Bearer ')) {
        sessionId = authHeader.split(' ')[1];
      } else {
        sessionId = getCookie(c, 'session_id') || '';
      }
    }

    if (!sessionId || !sessionId.startsWith('session:')) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً كجلسة رئيسية للمتجر');
    }

    const ipAddress = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'Unknown';
    const userAgent = (c.req.header('user-agent') || 'Unknown').substring(0, 255);

    try {
      const result = await AuthService.startShift(
        db,
        k1,
        sessionId,
        pin,
        phone,
        opening_cash,
        ipAddress,
        userAgent
      );

      if ('error' in result && result.error) {
        return sendResponse(c, result.status as any, result.error, result.message);
      }

      return sendResponse(c, 200, 'SHIFT_STARTED', result.message || 'تم بدء الوردية بنجاح', {
        shift_token: result.shift_token,
        worker: result.worker,
      });
    } catch (error: any) {
      logger.error(reqId, `Start shift failed: ${error.message || error}`);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في بدء الوردية', null, error.message);
    }
  },

  /**
   * End Shift Controller (تسجيل الخروج من الوردية)
   */
  endShift: async (c: Context<AppContext>) => {
    const reqId = (c.get('requestId') as string) || 'unknown';
    const rawBody = (c.req.valid('json' as never) as any) || {};
    
    // Shift token can be supplied via X-Shift-Token header or request body
    const headerShiftToken = c.req.header('x-shift-token') || c.req.header('X-Shift-Token');
    let shiftToken = (headerShiftToken || rawBody.shift_token || '').trim();

    const db = c.env.DB;
    const k1 = c.env.ouradash_dashboard || (c.env as any)?.K1;
    if (!k1) {
      return sendResponse(c, 500, 'SERVER_ERROR', 'Session verification service unavailable');
    }

    // Extract master session
    const authHeader = c.req.header('Authorization');
    let sessionId = (c.get('session_id') as string) || '';
    if (!sessionId) {
      if (authHeader && authHeader.startsWith('Bearer ')) {
        sessionId = authHeader.split(' ')[1];
      } else {
        sessionId = getCookie(c, 'session_id') || '';
      }
    }

    if (!sessionId) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'الجلسة غير صالحة أو غير موجودة');
    }

    // Fallback: extract shift_token from active session in KV if not explicitly passed
    if (!shiftToken) {
      try {
        const sessionStr = await k1.get(sessionId);
        if (sessionStr) {
          const sData = JSON.parse(sessionStr);
          shiftToken = sData.active_shift?.shift_id || '';
        }
      } catch {}
    }

    if (!shiftToken) {
      return sendResponse(c, 400, 'SHIFT_TOKEN_REQUIRED', 'توكين الوردية X-Shift-Token مطلوب لإنهاء الوردية');
    }

    try {
      const result = await AuthService.endShift(
        db,
        k1,
        sessionId,
        shiftToken,
        rawBody.closing_cash,
        rawBody.notes
      );

      if ('error' in result && result.error) {
        return sendResponse(c, result.status as any, result.error, result.message);
      }

      return sendResponse(c, 200, 'SHIFT_ENDED', result.message || 'تم إغلاق الوردية بنجاح', {
        shift_id: result.shift_id,
        duration_minutes: result.duration_minutes,
        closing_cash: result.closing_cash,
      });
    } catch (error: any) {
      logger.error(reqId, `End shift failed: ${error.message || error}`);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في إنهاء الوردية', null, error.message);
    }
  },

  /**
   * Quick Setup Handler
   * Creates Users, Dashboards, and user_profile in one atomic transaction.
   */
  quickSetup: async (c: Context<AppContext>) => {
    const reqId = (c.get('requestId') as string) || 'unknown';
    const rawBody = c.req.valid('json' as never) as any;
    const db = c.env.DB;

    try {
      const result = await AuthService.quickSetup(db, rawBody);
      if ('error' in result && result.error) {
        return sendResponse(c, result.status as any, result.error, result.message);
      }
      return sendResponse(c, 201, 'SETUP_SUCCESSFUL', 'تم إنشاء الحساب ولوحة التحكم والملف الشخصي بنجاح', result.data);
    } catch (error: any) {
      logger.error(reqId, `Quick setup failed: ${error.message || error}`);
      return sendResponse(c, 500, 'SETUP_FAILED', 'فشل في إنشاء الحساب ولوحة التحكم', null, error.message);
    }
  }
,
  /**
   * Retrieves active worker profiles for the authenticated store session.
   */
  getStoreStaff: async (c: Context<AppContext>) => {
    const reqId = (c.get('requestId') as string) || 'unknown';
    const db = c.env.DB;
    const k1 = c.env.ouradash_dashboard || (c.env as any)?.K1;

    if (!k1) {
      return sendResponse(c, 500, 'SERVER_ERROR', 'Session verification service unavailable');
    }

    // Extract master session from Cookie or Bearer header for mobile apps
    const authHeader = c.req.header('Authorization');
    let sessionId = (c.get('session_id') as string) || '';
    if (!sessionId) {
      if (authHeader && authHeader.startsWith('Bearer ')) {
        sessionId = authHeader.split(' ')[1];
      } else {
        sessionId = getCookie(c, 'session_id') || '';
      }
    }

    if (!sessionId) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    const sessionStr = await k1.get(sessionId);
    if (!sessionStr) {
      return sendResponse(c, 401, 'INVALID_SESSION', 'الجلسة غير صالحة أو منتهية');
    }

    let sessionData: any;
    try {
      sessionData = JSON.parse(sessionStr);
    } catch {
      return sendResponse(c, 401, 'CORRUPT_SESSION', 'بيانات الجلسة غير صالحة');
    }

    const dashboardId = sessionData.dashboard_id || sessionData.user_profile?.[1]?.dashboard_id;
    if (!dashboardId) {
      return sendResponse(c, 400, 'NO_ACTIVE_STORE', 'لا يوجد متجر أو فرع نشط في هذه الجلسة');
    }

    try {
      const result = await AuthService.getStoreStaff(db, dashboardId);
      if ('error' in result && result.error) {
        return sendResponse(c, result.status as any, result.error, result.message);
      }
      return sendResponse(c, 200, 'STAFF_FETCHED', 'تم جلب طاقم العمل بنجاح', { staff: result.staff });
    } catch (error: any) {
      logger.error(reqId, `Fetch store staff failed: ${error.message || error}`);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب قائمة الموظفين', null, error.message);
    }
  },

  /**
   * Verifies the store owner's password when switching from worker mode back to owner mode.
   */
  verifyOwnerPassword: async (c: Context<AppContext>) => {
    const reqId = (c.get('requestId') as string) || 'unknown';
    const db = c.env.DB;
    const k1 = c.env.ouradash_dashboard || (c.env as any)?.K1;

    if (!k1) {
      return sendResponse(c, 500, 'SERVER_ERROR', 'Session verification service unavailable');
    }

    // Extract master session from Cookie or Bearer header for mobile apps
    const authHeader = c.req.header('Authorization');
    let sessionId = (c.get('session_id') as string) || '';
    if (!sessionId) {
      if (authHeader && authHeader.startsWith('Bearer ')) {
        sessionId = authHeader.split(' ')[1];
      } else {
        sessionId = getCookie(c, 'session_id') || '';
      }
    }

    if (!sessionId) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    const sessionStr = await k1.get(sessionId);
    if (!sessionStr) {
      return sendResponse(c, 401, 'INVALID_SESSION', 'الجلسة غير صالحة أو منتهية');
    }

    let sessionData: any;
    try {
      sessionData = JSON.parse(sessionStr);
    } catch {
      return sendResponse(c, 401, 'CORRUPT_SESSION', 'بيانات الجلسة غير صالحة');
    }

    const userId = sessionData.user_id || sessionData.id;
    const rawBody = (c.req.valid('json' as never) as any) || {};
    const password = (rawBody.password || '').trim();

    if (!password) {
      return sendResponse(c, 400, 'PASSWORD_REQUIRED', 'يرجى إدخال كلمة المرور');
    }

    try {
      const result = await AuthService.verifyOwnerPassword(db, userId, password);
      if ('error' in result && result.error) {
        return sendResponse(c, result.status as any, result.error, result.message);
      }
      return sendResponse(c, 200, 'PASSWORD_VERIFIED', 'تم التحقق من كلمة المرور بنجاح');
    } catch (error: any) {
      logger.error(reqId, `Verify owner password failed: ${error.message || error}`);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل التحقق من كلمة المرور', null, error.message);
    }
  },

  /**
   * GET /api/auth/session
   * Checks current active session from HttpOnly cookie or Authorization header.
   */
  getSession: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const k1 = c.env.ouradash_dashboard || (c.env as any)?.K1;

    if (!k1) {
      return sendResponse(c, 500, 'SERVER_ERROR', 'Session verification service unavailable');
    }

    const authHeader = c.req.header('Authorization');
    let sessionId = (c.get('session_id') as string) || '';
    if (!sessionId) {
      if (authHeader && authHeader.startsWith('Bearer ')) {
        sessionId = authHeader.split(' ')[1];
      } else {
        sessionId = getCookie(c, 'session_id') || '';
      }
    }

    if (!sessionId) {
      return sendResponse(c, 200, 'NO_SESSION', 'لا توجد جلسة نشطة', { isAuthenticated: false });
    }

    const sessionStr = await k1.get(sessionId);
    if (!sessionStr) {
      return sendResponse(c, 200, 'NO_SESSION', 'الجلسة منتهية أو غير موجودة', { isAuthenticated: false });
    }

    let sessionData: any;
    try {
      sessionData = JSON.parse(sessionStr);
    } catch {
      return sendResponse(c, 200, 'NO_SESSION', 'بيانات الجلسة غير صالحة', { isAuthenticated: false });
    }

    if (!sessionData.dashboard_id) {
      return sendResponse(c, 200, 'NO_SESSION', 'لا يوجد متجر مرتبط بالجلسة', { isAuthenticated: false });
    }

    // Verify store exists in DB and is not banned
    const store = await db.prepare(`
      SELECT id, name, slug, is_banned
      FROM Dashboards
      WHERE id = ?
    `).bind(sessionData.dashboard_id).first() as any;

    if (!store || store.is_banned === 1) {
      return sendResponse(c, 200, 'STORE_SUSPENDED', 'المتجر موقوف أو غير موجود', { isAuthenticated: false });
    }

    let activeShift = sessionData.active_shift || null;
    let currentUser = null;

    if (activeShift?.shift_id) {
      const dbShift = await db.prepare(`
        SELECT id, shift_number, opening_cash, start_time, status
        FROM shifts
        WHERE id = ? AND status = 'active'
      `).bind(activeShift.shift_id).first() as any;

      if (!dbShift) {
        activeShift = null;
      } else {
        activeShift = {
          ...activeShift,
          shift_number: dbShift.shift_number,
          opening_cash: dbShift.opening_cash,
          start_time: dbShift.start_time,
          status: dbShift.status,
        };
      }
    }

    if (sessionData.user_id) {
      const user = await db.prepare(`
        SELECT id, name, phone, role, job_title, permissions, is_active, is_banned
        FROM Users
        WHERE id = ? AND dashboard_id = ?
      `).bind(sessionData.user_id, sessionData.dashboard_id).first() as any;

      if (user && user.is_active === 1 && user.is_banned === 0) {
        let permissions: Record<string, boolean> = {};
        if (user.permissions) {
          if (typeof user.permissions === 'string') {
            try { permissions = JSON.parse(user.permissions); } catch {}
          } else {
            permissions = user.permissions;
          }
        }
        if (user.role === 'owner') {
          permissions = { '*': true };
        }
        currentUser = {
          id: user.id,
          name: user.name,
          phone: user.phone || '',
          role: user.role,
          job_title: user.job_title || (user.role === 'owner' ? 'المالك' : 'موظف'),
          permissions,
        };
      }
    }

    return sendResponse(c, 200, 'SESSION_ACTIVE', 'تم استرجاع الجلسة بنجاح', {
      isAuthenticated: true,
      isStaffSelected: Boolean(currentUser && activeShift),
      store: {
        dashboard_id: store.id,
        name: store.name,
        slug: store.slug,
      },
      user: currentUser,
      activeShift,
    });
  },

  /**
   * تسجيل دخول المتجر / لوحة التحكم
   */
  storeLogin: async (c: Context<AppContext>) => {
    const reqId = (c.get('requestId') as string) || 'unknown';
    const db = c.env.DB;
    const k1 = c.env.ouradash_dashboard || (c.env as any)?.K1;
    const body = (await c.req.json().catch(() => ({}))) as any;
    const phone = (body.phone || '').trim();
    const password = (body.password || '').trim();

    if (!phone || !password) {
      return sendResponse(c, 400, 'FIELDS_REQUIRED', 'يرجى إدخال هاتف المتجر وكلمة المرور');
    }

    try {
      const result = await AuthService.storeLogin(db, phone, password);
      if ('error' in result && result.error) {
        return sendResponse(c, result.status as any, result.error, result.message);
      }

      // Provision session in KV & set session_id cookie for store context
      if (k1 && result.data?.dashboard_id) {
        const sessionId = `session:${crypto.randomUUID()}`;
        const storeSession = {
          session_id: sessionId,
          dashboard_id: result.data.dashboard_id,
          dashboard_name: result.data.name,
          dashboard_slug: result.data.slug,
          is_store_authenticated: true,
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        };
        await k1.put(sessionId, JSON.stringify(storeSession), { expirationTtl: 30 * 24 * 60 * 60 });

        const isProduction = isProductionRequest(c);
        setCookie(c, 'session_id', sessionId, {
          path: '/',
          secure: isProduction,
          httpOnly: true,
          sameSite: 'Lax',
          maxAge: 30 * 24 * 60 * 60,
        });
      }

      return sendResponse(c, 200, 'STORE_AUTHENTICATED', 'تم تسجيل دخول المتجر بنجاح', result.data);
    } catch (error: any) {
      logger.error(reqId, `Store login failed: ${error.message || error}`);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل تسجيل دخول المتجر', null, error.message);
    }
  },

  /**
   * جلب حسابات المتجر المتاحة للدخول
   */
  getStoreAccounts: async (c: Context<AppContext>) => {
    const reqId = (c.get('requestId') as string) || 'unknown';
    const db = c.env.DB;
    const dashboardId = c.req.query('dashboard_id') || c.req.param('dashboard_id') || '';

    if (!dashboardId) {
      return sendResponse(c, 400, 'NO_DASHBOARD_ID', 'معرف المتجر مطلوب');
    }

    try {
      const result = await AuthService.getStoreAccounts(db, dashboardId);
      if ('error' in result && result.error) {
        return sendResponse(c, result.status as any, result.error, result.message);
      }
      return sendResponse(c, 200, 'ACCOUNTS_FETCHED', 'تم جلب الحسابات بنجاح', { accounts: result.accounts });
    } catch (error: any) {
      logger.error(reqId, `Get store accounts failed: ${error.message || error}`);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل جلب الحسابات', null, error.message);
    }
  },

  /**
   * تسجيل دخول المستخدم بالوردية
   */
  loginShift: async (c: Context<AppContext>) => {
    const reqId = (c.get('requestId') as string) || 'unknown';
    const db = c.env.DB;
    const k1 = c.env.ouradash_dashboard || (c.env as any)?.K1;

    if (!k1) {
      return sendResponse(c, 500, 'SERVER_ERROR', 'Session verification service unavailable');
    }

    const body = (await c.req.json().catch(() => ({}))) as any;
    const dashboardId = (body.dashboard_id || '').trim();
    const userId = (body.user_id || '').trim();
    const password = (body.password || '').trim();
    const openingCash = Number(body.opening_cash) || 0;
    const deviceFingerprint = (body.device_fingerprint || c.req.header('user-agent') || 'default_terminal').trim();

    if (!dashboardId || !userId || !password) {
      return sendResponse(c, 400, 'FIELDS_REQUIRED', 'يرجى اختيار الحساب وإدخال كلمة المرور');
    }

    const ipAddress = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '127.0.0.1';
    const userAgent = c.req.header('user-agent') || 'unknown';

    try {
      const result = await AuthService.loginShift(db, k1, {
        dashboard_id: dashboardId,
        user_id: userId,
        password,
        opening_cash: openingCash,
        device_fingerprint: deviceFingerprint,
        ip_address: ipAddress,
        user_agent: userAgent
      });

      if ('error' in result && result.error) {
        return sendResponse(c, result.status as any, result.error, result.message);
      }

      if (!('data' in result) || !result.data) {
        return sendResponse(c, 500, 'LOGIN_FAILED', 'فشل تسجيل الدخول');
      }

      // Set session cookie
      const isProduction = isProductionRequest(c);
      setCookie(c, 'session_id', result.data.sessionId, {
        path: '/',
        secure: isProduction,
        httpOnly: true,
        sameSite: 'Lax',
        maxAge: 30 * 24 * 60 * 60
      });

      return sendResponse(c, 200, 'SHIFT_LOGIN_SUCCESS', 'تم تسجيل الدخول وبدء الوردية بنجاح', result.data);
    } catch (error: any) {
      logger.error(reqId, `Shift login failed: ${error.message || error}`);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل تسجيل الدخول وبدء الوردية', null, error.message);
    }
  }
};
