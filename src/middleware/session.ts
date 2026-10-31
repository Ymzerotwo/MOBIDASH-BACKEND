/**
 * ==========================================
 *        MobiDash Session Middleware
 * ==========================================
 *
 * Session Authentication Middleware
 *
 * Verifies user identity and active shift using session tokens stored in Cloudflare KV.
 * Enforces session expiry, instant ban revocation, role/permission binding,
 * IP + User-Agent hijacking detection, and shift-token selection.
 */

import { Context, Next } from 'hono';
import { getCookie, deleteCookie } from 'hono/cookie';
import { AppContext } from '../types';
import { sendResponse } from '../utils/response';
import { logger } from '../utils/logger';
import { getClientFingerprint, isLocalHostname } from '../utils/request';

/**
 * Clears the session cookie from the client browser.
 */
const deleteSessionCookie = (c: Context<AppContext>) => {
  const isProduction = !isLocalHostname(c.req.url);
  deleteCookie(c, 'session_id', { path: '/', secure: isProduction, sameSite: 'Lax' });
};

/**
 * Normalizes any ban flag coming from KV (1 | true | "1" | "true") to a boolean.
 * Prevents a textual flag from silently bypassing the ban check.
 */
const isFlagOn = (value: unknown): boolean => {
  if (value === true) return true;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') return ['1', 'true', 'yes'].includes(value.trim().toLowerCase());
  return false;
};

/**
 * Validates the session token from cookies or authorization headers against Cloudflare KV storage.
 * Injects authenticated user context securely into Hono context variables.
 */
export const sessionMiddleware = async (c: Context<AppContext>, next: Next) => {
  const reqId = (c.get('requestId') as string) || 'unknown';

  // 1. Extract session ID from Authorization header (Bearer token) or HTTP Cookie
  const authHeader = c.req.header('Authorization');
  let sessionId = '';

  if (authHeader && authHeader.startsWith('Bearer ')) {
    sessionId = authHeader.split(' ')[1] || '';
  } else {
    sessionId = getCookie(c, 'session_id') || '';
  }

  if (!sessionId || !sessionId.startsWith('session:')) {
    deleteSessionCookie(c);
    return sendResponse(c, 401, 'UNAUTHORIZED', 'No session provided or invalid format');
  }

  // KV binding (legacy aliases are still supported; index.ts maps them all to the same namespace)
  const k1 = c.env?.ouradash_dashboard || c.env?.mobidash || (c.env as any)?.K1;
  if (!k1) {
    logger.error(reqId, 'Session KV binding is missing from environment');
    return sendResponse(c, 500, 'SERVER_ERROR', 'Session verification service unavailable');
  }

  // 2. Retrieve session from KV Cache
  const sessionDataStr = await k1.get(sessionId);

  if (!sessionDataStr) {
    deleteSessionCookie(c);
    return sendResponse(c, 401, 'INVALID_SESSION', 'الجلسة منتهية أو غير صالحة، يرجى تسجيل الدخول مجدداً');
  }

  let sessionData: any;
  try {
    sessionData = JSON.parse(sessionDataStr);
  } catch {
    logger.error(reqId, `Corrupted session data in KV for key: ${sessionId}`);
    await k1.delete(sessionId);
    deleteSessionCookie(c);
    return sendResponse(c, 401, 'CORRUPT_SESSION', 'Session data is corrupted');
  }

  if (!sessionData || typeof sessionData !== 'object') {
    logger.error(reqId, `Invalid session schema in KV for key: ${sessionId}`);
    await k1.delete(sessionId);
    deleteSessionCookie(c);
    return sendResponse(c, 401, 'INVALID_SESSION_DATA', 'بيانات الجلسة غير مكتملة');
  }

  // 3. Resolve the effective shift (explicit x-shift-token wins over the default shift)
  const shiftTokenHeader = (c.req.header('x-shift-token') || c.req.header('X-Shift-Token') || '').trim();
  const shiftsMap =
    sessionData.active_shifts && typeof sessionData.active_shifts === 'object' && !Array.isArray(sessionData.active_shifts)
      ? sessionData.active_shifts
      : null;

  const selectedShift =
    (shiftTokenHeader && shiftsMap && shiftsMap[shiftTokenHeader]) || sessionData.active_shift || null;

  // 4. Instant Ban Check (store-level or active worker)
  if (isFlagOn(sessionData.is_banned)) {
    logger.warn(reqId, `Banned dashboard ${sessionData.dashboard_id} attempted access`);
    deleteSessionCookie(c);
    await k1.delete(sessionId);
    return sendResponse(c, 403, 'ACCOUNT_BANNED', 'تم إيقاف حسابك من قبل إدارة النظام');
  }

  if (selectedShift && isFlagOn((selectedShift as any).is_banned)) {
    logger.warn(reqId, `Banned user ${(selectedShift as any).user_id} attempted access on session ${sessionId}`);
    deleteSessionCookie(c);
    await k1.delete(sessionId);
    return sendResponse(c, 403, 'ACCOUNT_BANNED', 'تم إيقاف حسابك من قبل إدارة النظام');
  }

  // 5. Expiration Check (a malformed date must never produce a never-ending session)
  const expiresAtMs = typeof sessionData.expires_at === 'string' ? Date.parse(sessionData.expires_at) : NaN;
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    logger.info(reqId, `Expired session cleanup for session ${sessionId}`);
    await k1.delete(sessionId);
    deleteSessionCookie(c);
    return sendResponse(c, 401, 'SESSION_EXPIRED', 'انتهت مدة الجلسة، يرجى تسجيل الدخول مجدداً');
  }

  // 6. Schema Validation (store sessions are dashboard-scoped; user sessions need a user id)
  const hasUser = typeof sessionData.user_id === 'string' && sessionData.user_id.length > 0;
  const isStoreSession = sessionData.is_store_authenticated === true && typeof sessionData.dashboard_id === 'string';
  if (!hasUser && !isStoreSession) {
    logger.error(reqId, `Invalid session schema in KV for key: ${sessionId}`);
    await k1.delete(sessionId);
    deleteSessionCookie(c);
    return sendResponse(c, 401, 'INVALID_SESSION_DATA', 'بيانات الجلسة غير مكتملة');
  }

  // 7. Hijacking Detection (IP + User-Agent binding).
  // Changing both signals invalidates the session; changing only the IP is tolerated and recorded.
  const storedIp = typeof sessionData.ip_address === 'string' ? sessionData.ip_address : '';
  const storedUserAgent = typeof sessionData.user_agent === 'string' ? sessionData.user_agent : '';
  const hasFingerprint =
    storedIp.length > 0 && storedIp !== 'unknown' && storedUserAgent.length > 0 && storedUserAgent !== 'unknown';

  if (hasFingerprint) {
    const current = getClientFingerprint(c);
    const ipChanged = current.ip.length > 0 && current.ip !== storedIp;
    const userAgentChanged = current.userAgent !== storedUserAgent;

    if (ipChanged && userAgentChanged) {
      logger.warn(reqId, `Session ${sessionId} invalidated: IP and User-Agent both changed`);
      await k1.delete(sessionId);
      deleteSessionCookie(c);
      return sendResponse(c, 401, 'SESSION_INVALIDATED', 'تم إنهاء الجلسة لأسباب أمنية، يرجى تسجيل الدخول مجدداً');
    }

    if (ipChanged) {
      sessionData.ip_address = current.ip;
      const remainingSeconds = Math.max(60, Math.floor((expiresAtMs - Date.now()) / 1000));
      try {
        // Preserve the original TTL ceiling by rewriting with the remaining lifetime.
        await k1.put(sessionId, JSON.stringify(sessionData), { expirationTtl: remainingSeconds });
      } catch (e: any) {
        logger.error(reqId, `Failed to refresh session IP for ${sessionId}: ${e?.message || e}`);
      }
    }
  }

  // 8. Extract Effective User & Shift
  const effectiveUserId = (selectedShift as any)?.user_id || sessionData.user_id;
  const effectiveName = (selectedShift as any)?.name || (selectedShift as any)?.worker_name || sessionData.name || 'User';
  const effectiveRole = (selectedShift as any)?.role || sessionData.role || 'user';
  const effectiveJobTitle = (selectedShift as any)?.job_title || null;
  const effectivePermissions =
    (selectedShift as any)?.permissions || (effectiveRole === 'owner' ? { '*': true } : null);

  // 9. Attach clean context to Request
  c.set('session_id', sessionData.session_id || sessionId);
  c.set('user', {
    id: effectiveUserId,
    name: effectiveName,
    full_name: effectiveName,
    email: sessionData.email || null,
    phone: sessionData.phone || null,
    dashboard_id: sessionData.dashboard_id,
    dashboard_name: sessionData.dashboard_name,
    dashboard_slug: sessionData.dashboard_slug,
    role: effectiveRole,
    job_title: effectiveJobTitle,
    permissions: effectivePermissions,
    is_banned: false,
    active_shift: selectedShift || null,
    profile_id: effectiveUserId,
  });

  if (selectedShift) {
    c.set('active_worker', selectedShift);
    c.set('shift_token', shiftTokenHeader || (selectedShift as any).shift_id);
  }

  await next();
};

/**
 * Middleware Guard: Requires an active worker shift
 */
export const requireActiveShift = async (c: Context<AppContext>, next: Next) => {
  const activeWorker = c.get('active_worker');
  if (!activeWorker) {
    return sendResponse(
      c,
      403,
      'NO_ACTIVE_SHIFT',
      'هذه العملية تتطلب فتح وردية نشطة للكاشير أو المالك'
    );
  }
  await next();
};
