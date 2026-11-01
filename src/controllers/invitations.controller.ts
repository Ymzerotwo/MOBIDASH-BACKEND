import { Context } from 'hono';
import { setCookie } from 'hono/cookie';
import { InvitationsService } from '../services/invitations.services';
import { sendResponse } from '../utils/response';
import { logger } from '../utils/logger';
import { AppContext } from '../types';
import { isProductionRequest } from '../utils/request';

/**
 * ==============================================================================
 * MobiDash Backend: Merchant Invitations Controller
 * Location: backend/src/controllers/invitations.controller.ts
 * ==============================================================================
 */

export const InvitationsController = {
  /**
   * GET /api/auth/verify-invite-code/:code
   * فحص صلاحية كود الدعوة للتاجر
   */
  async verifyInviteCode(c: Context<AppContext>) {
    const reqId = c.get('requestId') || 'req_verify_invite';
    const code = c.req.param('code');

    if (!code || code.trim().length < 4) {
      return sendResponse(c, 400, 'INVALID_CODE', 'يرجى إدخال كود دعوة صالح');
    }

    try {
      const result = await InvitationsService.verifyInviteCode(c.env.DB, code);

      if ('error' in result && result.error) {
        return sendResponse(c, result.status as any, result.error, result.message);
      }

      return sendResponse(c, 200, 'INVITE_CODE_VALID', result.message, {
        code: result.code,
        note: result.note,
        expires_at: result.expires_at,
      });
    } catch (err: any) {
      logger.error(reqId, `Failed to verify invitation code: ${err.message || err}`);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'حدث خطأ أثناء فحص كود الدعوة');
    }
  },

  /**
   * POST /api/auth/register-with-invite
   * إتمام إنشاء متجر وحساب جديد بكود الدعوة
   */
  async registerWithInvite(c: Context<AppContext>) {
    const reqId = c.get('requestId') || 'req_register_invite';
    const input = c.req.valid('json' as never) as any;
    const userAgent = c.req.header('user-agent') || 'unknown';
    const ipAddress = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '127.0.0.1';

    try {
      const k1 = c.env.ouradash_dashboard || (c.env as any)?.K1;
      const result = await InvitationsService.registerWithInvite(
        c.env.DB,
        k1,
        input,
        userAgent,
        ipAddress
      );

      if ('error' in result && result.error) {
        return sendResponse(c, result.status as any, result.error, result.message);
      }

      if (!('data' in result) || !result.data) {
        return sendResponse(c, 500, 'REGISTRATION_FAILED', 'فشل في إتمام إنشاء الحساب');
      }

      // ضبط كوكيز الجلسة للتسجيل المباشر
      const isProduction = isProductionRequest(c);
      setCookie(c, 'session_id', result.data.sessionId, {
        path: '/',
        secure: isProduction,
        httpOnly: true,
        sameSite: isProduction ? 'None' : 'Lax',
        maxAge: 30 * 24 * 60 * 60,
      });

      return sendResponse(c, 201, 'REGISTRATION_SUCCESS', result.message, result.data);
    } catch (err: any) {
      logger.error(reqId, `Failed to register with invitation code: ${err.message || err}`);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'حدث خطأ غير متوقع أثناء تسجيل الحساب', null, err.message);
    }
  },
};
