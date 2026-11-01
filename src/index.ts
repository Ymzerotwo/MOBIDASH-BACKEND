/**
 * ==========================================
 *        MobiDash API Entrypoint
 * ==========================================
 * 
 * Mobile Shop Management Platform (Edge Runtime on Cloudflare Workers)
 * 
 * Request Pipeline:
 * 1. Observability (Request ID & Execution Logger)
 * 2. Strict Security Headers (secureHeaders: HSTS, X-Frame-Options, CSP, nosniff)
 * 3. CORS Policy (dashboardCors with preflight OPTIONS handling)
 * 4. Body Limit (2MB for REST endpoints, 100MB for media/uploads)
 * 5. Strict Origin Validation (For Browser Cookies, bypassed for Bearer/ApiKey)
 * 6. Auth Pipeline & Protected Dashboard Routes
 */

import { Hono, Context, Next } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { requestId } from 'hono/request-id'
import { bodyLimit } from 'hono/body-limit'
import { AppContext, Bindings } from './types'
import { logger } from './utils/logger'
import { sendResponse } from './utils/response'
import { csrfProtection } from './middleware/csrf'
import { apiKeyAuth } from './middleware/apiKey.middleware'
import { getAllowedOrigins } from './utils/request'
import { sessionMiddleware } from './middleware/session'
import { rateLimiter } from './middleware/rateLimit.middleware'
import authRoutes from './routes/auth.routes'
import teamRoutes from './routes/team.routes'
import notificationRoutes from './routes/notification.routes'
import profileRoutes from './routes/profile.routes'
import uploadRoutes from './routes/upload.routes'
import dashboardRoutes from './routes/dashboard.routes'
import telecomRoutes from './routes/telecom.routes'
import suppliersRoutes from './routes/suppliers.routes'
import { phoneRoutes } from './routes/phones.routes'
import { accessoriesRoutes } from './routes/accessories.routes'
import { sparePartsRoutes } from './routes/spare_parts.routes'
import customersRoutes from './routes/customers.routes'
import installmentsRoutes from './routes/installments.routes'
import settingsRoutes from './routes/settings.routes'
import { posRoutes } from './routes/pos.routes'
import { financesRoutes } from './routes/finances.routes'

const app = new Hono<AppContext>()

// 1. Generate a unique Request ID for every request to facilitate log tracking.
app.use('*', requestId())

// 2. Log request details, response time, status, and client origin.
app.use('*', async (c, next) => {
  const reqId = c.get('requestId') || 'unknown'
  const method = c.req.method
  const url = c.req.url
  const origin = c.req.header('origin') || c.req.header('referer') || 'Unknown Origin'
  const start = Date.now()
  await next()
  const ms = Date.now() - start
  const status = c.res.status

  logger.info(reqId, `${method} ${url} - ${status} (${ms}ms) [from: ${origin}]`)
})

// 3. Inject Security Headers FIRST to ensure ALL responses (including 400, 401, 403, 500)
// carry defensive headers (HSTS, Clickjacking protection, XSS protection, MIME sniffing protection).
app.use('*', secureHeaders({
  xXssProtection: '1; mode=block',
  xFrameOptions: 'DENY',
  strictTransportSecurity: 'max-age=31536000; includeSubDomains; preload',
  xContentTypeOptions: 'nosniff',
  referrerPolicy: 'strict-origin-when-cross-origin',
  contentSecurityPolicy: {
    defaultSrc: ["'none'"],
    baseUri: ["'none'"],
    formAction: ["'none'"],
    frameAncestors: ["'none'"],
    connectSrc: ["'self'"],
  }
}))

// Helper to normalize origin URLs (handles trailing slashes, protocol cases)
const normalizeOriginUrl = (urlStr: string): string => {
  try {
    return new URL(urlStr).origin.toLowerCase()
  } catch {
    return urlStr.trim().toLowerCase().replace(/\/+$/, '')
  }
}

// 4. Configure CORS for Dashboard API based on ALLOWED_ORIGINS.
const dashboardCors = async (c: Context<any>, next: Next) => {
  const corsMiddleware = cors({
    origin: (origin) => {
      const allowedOrigins = getAllowedOrigins(c)
      // `Origin: null` arrives from sandboxed iframes and file:// pages. Never echo it back.
      if (!origin || origin === 'null') {
        return null
      }
      const reqOrigin = normalizeOriginUrl(origin)
      return allowedOrigins.includes(reqOrigin) ? origin : null
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'x-csrf-token', 'x-api-key', 'x-shift-token', 'X-Shift-Token'],
    exposeHeaders: ['X-Request-ID', 'X-RateLimit-Limit', 'X-CSRF-Token', 'x-shift-token', 'X-Shift-Token'],
    maxAge: 86400,
    credentials: true,
  })

  return corsMiddleware(c, next)
}

app.use('/api/*', dashboardCors)
app.use('/api/*', apiKeyAuth)

// 5. Strict Origin/Referer Validation Middleware for Browser-based Dashboard Requests
// Protects browser cookie sessions against unauthorized cross-origin requests.
// Crucially: Skips OPTIONS preflights and non-browser clients (Bearer tokens or API keys).
const strictOriginValidation = async (c: Context, next: Next) => {
  // Allow OPTIONS preflights to be handled cleanly by CORS
  if (c.req.method === 'OPTIONS') {
    return await next()
  }

  const isVitest = c.env && (c.env as any).IS_VITEST === true
  if (isVitest) {
    return await next()
  }

  const path = c.req.path
  // Only the health probe is exempt; setup and file paths must pass Origin validation like everything else.
  if (path === '/health') {
    return await next()
  }

  // Bypass native mobile apps and API clients using Authorization: Bearer or a *verified* API key
  // without browser cookies. A merely present `x-api-key` header is NOT sufficient.
  const authHeader = c.req.header('authorization')
  const isVerifiedApiKey = (c as any).get('isApiKeyAuthenticated') === true
  if (authHeader?.toLowerCase().startsWith('bearer ') || isVerifiedApiKey) {
    return await next()
  }

  const reqId = c.get('requestId') || 'unknown'
  const origin = c.req.header('origin')
  const referer = c.req.header('referer')
  const source = origin ?? referer

  if (!source) {
    logger.warn(reqId, `Block request to '${path}': Missing Origin/Referer header on browser request`)
    return sendResponse(c, 403, 'MISSING_SOURCE_HEADER', 'Requests to protected endpoints must include a valid Origin or Referer header.')
  }

  try {
    const sourceOrigin = normalizeOriginUrl(source)
    const allowedOrigins = getAllowedOrigins(c)

    if (!allowedOrigins.includes(sourceOrigin)) {
      logger.warn(reqId, `Block request to '${path}': Origin '${sourceOrigin}' is not allowed`)
      return sendResponse(c, 403, 'ORIGIN_NOT_ALLOWED', 'Cross-Origin Request Blocked')
    }
  } catch {
    logger.warn(reqId, `Block request to '${path}': Invalid Origin/Referer format: '${source}'`)
    return sendResponse(c, 403, 'INVALID_SOURCE_HEADER', 'Invalid Origin/Referer Header Format')
  }

  return await next()
}

app.use('/api/*', strictOriginValidation)

// 6. Body Size Limits (middleware instances are built once, not per request)
const standardBodyLimit = bodyLimit({
  maxSize: 2 * 1024 * 1024,
  onError: (c) => sendResponse(c, 413, 'PAYLOAD_TOO_LARGE', 'Payload too large (Max: 2MB)')
})

// Uploads are capped at 25MB: a Worker isolate has ~128MB of memory, so a 100MB body
// would exhaust the runtime instead of protecting it.
const uploadBodyLimit = bodyLimit({
  maxSize: 25 * 1024 * 1024,
  onError: (c) => sendResponse(c, 413, 'PAYLOAD_TOO_LARGE', 'Payload too large (Max: 25MB)')
})

app.use('/api/*', async (c, next) => {
  if (c.req.path.startsWith('/api/upload') || c.req.path.startsWith('/api/media')) {
    return await next()
  }
  return standardBodyLimit(c, next)
})

app.use('/api/media/*', uploadBodyLimit)
app.use('/api/upload/*', uploadBodyLimit)

// Server Health Check Endpoint with rate limiting
app.get('/health', rateLimiter('HEALTH_LIMITER'), (c) => 
  sendResponse(c, 200, 'SERVER_HEALTHY', 'MobiDash Backend is secure and running 🚀', { platform: 'MobiDash' })
)

// 7. Authentication Routes
// CSRF protection applies to cookie-based state-changing authentication calls
app.use('/api/auth/*', csrfProtection)
app.route('/api/auth', authRoutes)

// ==========================================
// Protected Routes (Dashboard & Store API)
// ==========================================
const protectedRoutes = new Hono<AppContext>()

// Session Middleware runs first to authenticate store user and active cashier shift
protectedRoutes.use('*', sessionMiddleware)

// CSRF Protection for browser mutation requests (automatically skips Bearer / ApiKey)
protectedRoutes.use('*', csrfProtection)

// Dedicated rate limiters
protectedRoutes.use('/state/*', rateLimiter('STATE_LIMITER'))
protectedRoutes.use('/notifications/*', rateLimiter('NOTIFICATIONS_LIMITER'))
protectedRoutes.use('*', rateLimiter('DASHBOARD_LIMITER', ['/api/state', '/api/notifications']))

// Mount protected feature routes
protectedRoutes.route('/profile', profileRoutes)
protectedRoutes.route('/team', teamRoutes)
protectedRoutes.route('/notifications', notificationRoutes)
protectedRoutes.route('/upload', uploadRoutes)
protectedRoutes.route('/dashboard', dashboardRoutes)
protectedRoutes.route('/telecom', telecomRoutes)
protectedRoutes.route('/suppliers', suppliersRoutes)
protectedRoutes.route('/phones', phoneRoutes)
protectedRoutes.route('/accessories', accessoriesRoutes)
protectedRoutes.route('/spare-parts', sparePartsRoutes)
protectedRoutes.route('/customers', customersRoutes)
protectedRoutes.route('/installments', installmentsRoutes)
protectedRoutes.route('/settings', settingsRoutes)
protectedRoutes.route('/pos', posRoutes)
protectedRoutes.route('/finances', financesRoutes)

app.route('/api', protectedRoutes)

// Fallback Route for 404 Not Found
app.notFound((c) => sendResponse(c, 404, 'ROUTE_NOT_FOUND', 'Route not found or method not allowed'))

// 8. Global Error Handler
app.onError((err, c) => {
  const reqId = c.get('requestId') || 'unknown'
  logger.error(reqId, 'Unhandled Exception', err)
  // Never echo internal error text to the client; details stay in the logs.
  return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'Internal Server Error', null, null)
})

export { app }

export default {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    

    const kvBinding = (env as any).mobidash || (env as any).ouradash_dashboard || (env as any).K1;

    const requiredEnv: string[] = [
      'DB',
      'CLOUDFLARE_API_TOKEN',
      'CF_ACCOUNT_ID'
    ];
    const missing = requiredEnv.filter(key => !(env as any)[key]);


    if (!kvBinding) {
      missing.push('mobidash (KV)');
    }

    if (missing.length > 0) {
      throw new Error(`CRITICAL_ENVIRONMENT_ERROR: Environment variables missing: ${missing.join(', ')}`);
    }

    const extendedEnv = {
      ...env,
      ouradash_dashboard: kvBinding,
      K1: kvBinding,
      mobidash: kvBinding,
      EMAIL_FROM_ADDRESS: env.EMAIL_FROM_ADDRESS,
      APP_FRONTEND_URL: env.APP_FRONTEND_URL,
      // No hard-coded default allowlist: utils/request.ts resolves it (explicit env → APP_FRONTEND_URL → local only).
    };

    return app.fetch(request, extendedEnv as Bindings, ctx);
  }
}
