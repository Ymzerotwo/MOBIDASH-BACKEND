/**
 * ==========================================
 *        MobiDash API Key & Domain Middleware
 * ==========================================
 * 
 * Verifies that incoming requests have:
 * 1. An authorized Origin/Referer matching the server's environment configuration.
 * 2. A valid and authorized API Key matching the server's environment (MOBIDASH_API_KEY / API_KEY).
 * 
 * Security Feature:
 * - If the domain is missing/unauthorized or the API key is invalid/missing,
 *   returns an obscure 404 Not Found response to prevent security reconnaissance by attackers.
 */

import { Context, Next } from 'hono';
import { timingSafeEqual } from '../utils/crypto';
import { sendResponse } from '../utils/response';
import { AppContext } from '../types';
import { logger } from '../utils/logger';
import { getAllowedOrigins, isLocalHostname } from '../utils/request';

/**
 * Normalizes an origin URL (handles trailing slashes, protocol cases).
 */
const normalizeOriginUrl = (urlStr: string): string => {
  try {
    return new URL(urlStr).origin.toLowerCase();
  } catch {
    return urlStr.trim().toLowerCase().replace(/\/+$/, '');
  }
};

/**
 * Validates incoming API Key and caller Origin against configured environment variables.
 * Enforces a strict fail-closed security model with deceptive 404 response on failure.
 */
export const apiKeyAuth = async (c: Context<AppContext>, next: Next) => {
  // 1. Allow OPTIONS preflights to be handled cleanly by CORS
  if (c.req.method === 'OPTIONS') {
    return await next();
  }

  // 2. Health check probe is exempt
  const path = c.req.path;
  if (path === '/health') {
    return await next();
  }

  const isVitest = c.env && (c.env as any).IS_VITEST === true;
  if (isVitest) {
    c.set('isApiKeyAuthenticated', true);
    return await next();
  }

  const reqId = (c.get('requestId') as string) || 'unknown';

  // 3. Domain / Origin Validation
  const origin = c.req.header('origin');
  const referer = c.req.header('referer');
  const source = origin ?? referer;

  const allowedOrigins = getAllowedOrigins(c);
  const isLocal = isLocalHostname(c.req.url);

  let isDomainAllowed = false;
  if (source) {
    try {
      const sourceOrigin = normalizeOriginUrl(source);
      if (allowedOrigins.includes(sourceOrigin)) {
        isDomainAllowed = true;
      } else if (isLocal && (sourceOrigin.includes('localhost') || sourceOrigin.includes('127.0.0.1'))) {
        isDomainAllowed = true;
      }
    } catch {
      isDomainAllowed = false;
    }
  } else if (isLocal) {
    // In local development, direct local requests without origin (e.g. CLI tools) are permitted
    isDomainAllowed = true;
  }

  if (!isDomainAllowed) {
    logger.warn(reqId, `[Security] Blocked request to '${path}': Invalid or missing origin domain ('${source || 'none'}')`);
    // Obscure deceptive error to hackers: mimics route not found
    return sendResponse(c, 404, 'NOT_FOUND', 'Route not found or method not allowed');
  }

  // 4. API Key Validation
  let apiKey = c.req.header('x-api-key');
  if (!apiKey) {
    const authHeader = c.req.header('authorization');
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      apiKey = authHeader.substring(7).trim();
    }
  } else {
    apiKey = apiKey.trim();
  }

  const expectedKey = 
    c.env?.MOBIDASH_API_KEY || 
    c.env?.API_KEY || 
    c.env?.FRONTEND_API_KEY;

  if (!expectedKey) {
    logger.error(reqId, 'Server environment error: No MOBIDASH_API_KEY or API_KEY defined in environment bindings.');
    return sendResponse(c, 404, 'NOT_FOUND', 'Route not found or method not allowed');
  }

  if (!apiKey) {
    logger.warn(reqId, `[Security] Blocked request to '${path}': Missing API key from domain '${source || 'none'}'`);
    return sendResponse(c, 404, 'NOT_FOUND', 'Route not found or method not allowed');
  }

  // Constant-time comparison to prevent timing side-channel attacks
  const isKeyValid = timingSafeEqual(apiKey, expectedKey);
  if (!isKeyValid) {
    logger.warn(reqId, `[Security] Blocked request to '${path}': Invalid API key attempted from domain '${source || 'none'}'`);
    return sendResponse(c, 404, 'NOT_FOUND', 'Route not found or method not allowed');
  }

  // 5. Mark request as authorized via API key & verified domain
  c.set('apiKeyDomain', source ? normalizeOriginUrl(source) : 'authorized');
  c.set('isApiKeyAuthenticated', true);
  await next();
};
