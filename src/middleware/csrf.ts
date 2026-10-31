/**
 * ==========================================
 *        MobiDash CSRF Middleware
 * ==========================================
 * 
 * CSRF Protection Middleware (Double Submit Cookie Pattern)
 * 
 * Mitigates Cross-Site Request Forgery attacks by ensuring that state-changing
 * requests (POST, PUT, DELETE) originate from our own authenticated frontend.
 */

import { Context, Next } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { sendResponse } from '../utils/response';
import { timingSafeEqual } from '../utils/crypto';
import { logger } from '../utils/logger';
import { getAllowedOrigins, isProductionRequest } from '../utils/request';

/**
 * Token generation / protection helpers.
 * Environment detection lives in `utils/request.ts` (hostname-based, query-string-safe).
 */

/**
 * Generates a secure random token, sets it as a client cookie, and injects it into response headers.
 * 
 * CRITICAL: httpOnly is explicitly set to false. This is required because the frontend JS
 * checks if the `csrf_token` cookie exists in `document.cookie` before proceeding,
 * and clears it client-side on logout/errors.
 * 
 * @param c - The Hono request context.
 * @returns The generated hex token string.
 */
export const rotateCsrfToken = (c: Context): string => {
  const isProduction = isProductionRequest(c);
  
  // Web Crypto API is native and secure in Cloudflare Workers
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const token = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');

  setCookie(c, 'csrf_token', token, {
    path: '/',
    secure: isProduction, // HTTPS required in production
    sameSite: 'Lax',      // Prevents cookie from being sent on cross-site POSTs
    httpOnly: false,      // Frontend JS MUST be able to read this
    maxAge: 24 * 60 * 60, // 24 hours validity
  });

  c.header('X-CSRF-Token', token);
  return token;
};

/**
 * CSRF Protection middleware handler.
 * Implements the Double Submit Cookie pattern and strict Origin/Referer header checks.
 * 
 * @param c - The Hono request context.
 * @param next - The next middleware handler in Hono's execution chain.
 */
export const csrfProtection = async (c: Context, next: Next) => {
  const reqId = (c.get('requestId') as string) || 'unknown';
  const isProduction = isProductionRequest(c);
  const method = c.req.method;

  // 1. Skip safe methods (Read-only methods don't mutate state, so CSRF is irrelevant)
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return next();
  }

  // 2. Exempt the /csrf and /quick-setup endpoints to allow setup and initial token fetching
  const path = c.req.path;
  if (path.endsWith('/csrf') || path.endsWith('/quick-setup')) {
    return next();
  }

  // 3. Exempt Mobile Apps and API Key integrations (Non-Cookie Authentication)
  // CSRF attacks only exploit ambient browser credentials (cookies). Mobile apps or API clients
  // passing Bearer tokens or API keys without browser session cookies are naturally immune to CSRF.
  // NOTE: the API-key exemption requires a key verified by a real middleware, not a header that merely exists.
  const authHeader = c.req.header('authorization');
  const sessionCookie = getCookie(c, 'session_id');
  const isVerifiedApiKey = (c as any).get('isApiKeyAuthenticated') === true;

  if (!sessionCookie && (authHeader?.toLowerCase().startsWith('bearer ') || isVerifiedApiKey)) {
    return next();
  }

  // 4. Double Submit Cookie Validation
  // Attackers can't read cookies across domains due to the Same-Origin Policy.
  // Therefore, they can't duplicate the cookie value into the required header.
  const cookieToken = getCookie(c, 'csrf_token');
  const headerToken = c.req.header('x-csrf-token');

  // We use constant-time comparison (timingSafeEqual) to prevent timing side-channel attacks.
  if (!cookieToken || !headerToken || !timingSafeEqual(cookieToken, headerToken)) {
    logger.warn(reqId, `CSRF token validation failed. Cookie present: ${!!cookieToken}, Header present: ${!!headerToken}`);
    return sendResponse(c, 403, 'CSRF_TOKEN_MISMATCH', 'Invalid or Missing CSRF Token', null, {
      cookiePresent: !!cookieToken,
      headerPresent: !!headerToken
    });
  }

  // 5. Strict Origin Validation (Defense in Depth)
  // Ensures the request originated from a trusted domain.
  const origin = c.req.header('origin');
  const referer = c.req.header('referer');
  const source = origin ?? referer;

  // In production, we strictly require either Origin or Referer header to verify the source for browser requests.
  if (isProduction && !source) {
    logger.warn(reqId, 'CSRF validation failed: Missing Origin/Referer header in production');
    return sendResponse(c, 403, 'CSRF_MISSING_SOURCE', 'Missing Origin/Referer header', null);
  }

  if (source) {
    try {
      const sourceOrigin = new URL(source).origin.toLowerCase();

      // One allowlist for CORS, CSRF and origin validation (fails closed when empty).
      const allowedOrigins = getAllowedOrigins(c);

      // Checks the source origin against allowed origins in both dev and prod
      if (!allowedOrigins.includes(sourceOrigin)) {
        logger.warn(reqId, `CSRF validation failed: Origin '${sourceOrigin}' is not allowed`);
        return sendResponse(c, 403, 'CSRF_ORIGIN_MISMATCH', 'Cross-Origin Request Blocked', null);
      }
    } catch {
      logger.error(reqId, `CSRF validation failed: Invalid Origin/Referer header format: '${source}'`);
      return sendResponse(c, 403, 'CSRF_INVALID_SOURCE', 'Invalid Origin/Referer Header Format', null);
    }
  }

  await next();
};
