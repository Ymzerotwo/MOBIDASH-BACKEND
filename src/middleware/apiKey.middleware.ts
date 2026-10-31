/**
 * ==========================================
 *        MobiDash API Key Middleware
 * ==========================================
 * 
 * Verifies that incoming requests have a valid and authorized API Key
 * matching the server's environment configuration (API_KEY / MOBIDASH_API_KEY).
 * 
 * Designed for development and secure machine-to-machine integrations.
 */

import { Context, Next } from 'hono';
import { timingSafeEqual } from '../utils/crypto';
import { sendResponse } from '../utils/response';
import { AppContext } from '../types';
import { logger } from '../utils/logger';

/**
 * Validates incoming API Key against configured environment variables.
 * Enforces a strict fail-closed security model.
 * 
 * @param c - The Hono request context.
 * @param next - The next middleware function in the pipeline.
 * @returns Response or proceeds to next middleware.
 */
export const apiKeyAuth = async (c: Context<AppContext>, next: Next) => {
  const reqId = (c.get('requestId') as string) || 'unknown';

  // 1. Extract the API key securely from headers (x-api-key or Authorization: Bearer).
  let apiKey = c.req.header('x-api-key');
  if (!apiKey) {
    const authHeader = c.req.header('authorization');
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      apiKey = authHeader.substring(7).trim();
    }
  } else {
    apiKey = apiKey.trim();
  }

  // 2. Validate that an API key was actually supplied
  if (!apiKey) {
    return sendResponse(c, 401, 'API_KEY_MISSING', 'مفتاح الـ API مطلوب للوصول إلى هذه الخدمة.');
  }

  // 3. Resolve the expected key from environment variables
  const expectedKey = 
    c.env?.API_KEY || 
    c.env?.MOBIDASH_API_KEY || 
    c.env?.FRONTEND_API_KEY;

  // 4. Fail-Closed: If server environment does not have a configured API key, reject request securely
  if (!expectedKey) {
    logger.error(reqId, 'API Key check failed: No API_KEY or MOBIDASH_API_KEY defined in server environment bindings.');
    return sendResponse(
      c, 
      500, 
      'API_KEY_NOT_CONFIGURED', 
      'خدمة التحقق من مفتاح الـ API غير مهيأة في متغيرات البيئة للسيرفر.'
    );
  }

  // 5. Constant-time comparison to prevent timing side-channel attacks
  const isValid = timingSafeEqual(apiKey, expectedKey);
  if (!isValid) {
    logger.warn(reqId, 'محاولة وصول غير مصرح بها باستخدام مفتاح API غير صالح.');
    return sendResponse(c, 401, 'INVALID_API_KEY', 'مفتاح الـ API المقدم غير صحيح.');
  }

  // 6. Mark request as authorized via API key
  c.set('apiKeyDomain', 'authorized');
  c.set('isApiKeyAuthenticated', true);
  await next();
};
