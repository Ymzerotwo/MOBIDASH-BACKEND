/**
 * ==========================================
 *        Request Context Helpers
 * ==========================================
 *
 * أدوات مشتركة لقراءة خصائص الطلب بأمان بدل الاعتماد على مطابقة نصية
 * لهيكل الرابط (التي يمكن التلاعب بها عبر الـ query string).
 */

import { Context } from 'hono';

/** أسماء المضيفين التي تُعتبر بيئة تطوير محلية */
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

/**
 * يحدد إن كان رابط الطلب يشير إلى مضيف محلي.
 * يعتمد على الـ hostname المُحلَّل فقط، ولا يقرأ الـ query string أو المسار.
 */
export const isLocalHostname = (url: string): boolean => {
  try {
    return LOCAL_HOSTNAMES.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
};

/**
 * هل الطلب قادم من بيئة إنتاج؟ (مضيف غير محلي)
 * الفحص على الـ hostname يمنع خدعة `?redirect=http://localhost`.
 */
export const isProductionRequest = (c: Context): boolean => !isLocalHostname(c.req.url);

/**
 * قائمة الأصول المسموح بها، من مصدر واحد لكل الطبقات (CORS / CSRF / فحص المصدر).
 * الترتيب: ALLOWED_ORIGINS الصريح ← APP_FRONTEND_URL ← أصول محلية (للطلبات المحلية فقط) ← قائمة فارغة.
 * القائمة الفارغة تعني رفضاً (fail-closed) وليس سماحاً.
 */
const LOCAL_DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
  'http://localhost:3004',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001'
];

const normalizeOrigin = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed).origin.toLowerCase();
  } catch {
    return trimmed.replace(/\/+$/, '').toLowerCase();
  }
};

export const getAllowedOrigins = (c: Context): string[] => {
  const env = (c.env || {}) as any;
  const explicit = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);

  if (explicit.length > 0) return explicit;

  if (!isLocalHostname(c.req.url)) {
    const frontend = normalizeOrigin(String(env.APP_FRONTEND_URL || ''));
    return frontend ? [frontend] : [];
  }

  return LOCAL_DEV_ORIGINS.map(normalizeOrigin);
};

/**
 * عنوان العميل كما يراه Cloudflare Edge.
 * لا نستخدم X-Forwarded-For لأنه قابل للتزييف.
 */
export const getClientIp = (c: Context): string =>
  (c.req.header('cf-connecting-ip') || '').trim();

/** بصمة الجهاز المستخدمة لتثبيت الجلسة */
export const getClientFingerprint = (c: Context): { ip: string; userAgent: string } => ({
  ip: getClientIp(c),
  userAgent: (c.req.header('user-agent') || '').trim() || 'unknown',
});
