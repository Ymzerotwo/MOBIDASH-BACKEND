/**
 * ==============================================================================
 * MobiDash Platform - Phone Installments Controller
 * ==============================================================================
 * 
 * Handles incoming HTTP requests for phone installment contracts,
 * monthly payment collections, overdue tracking, and cash drawer sync.
 */

import { Context } from 'hono';
import { sendResponse } from '../utils/response';
import { AppContext } from '../types';
import { InstallmentsService } from '../services/installments.services';
import { logger } from '../utils/logger';

export const InstallmentsController = {
  /**
   * Retrieves aggregated KPI analytics for phone installment contracts.
   */
  getStats: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const stats = await InstallmentsService.getInstallmentStats(db, user.dashboard_id);
      return sendResponse(c, 200, 'INSTALLMENT_STATS_FETCHED', 'تم جلب إحصائيات ملفات التقسيط بنجاح', { stats });
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'Failed to fetch installment stats', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب إحصائيات التقسيط', null, error.message);
    }
  },

  /**
   * Retrieves a paginated list of installment contracts with search and filters.
   */
  getInstallments: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const query = c.req.valid('query' as never) as any;
      const result = await InstallmentsService.getInstallments(db, user.dashboard_id, query || {});
      return sendResponse(c, 200, 'INSTALLMENTS_FETCHED', 'تم جلب قائمة ملفات التقسيط بنجاح', result);
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'Failed to fetch installments', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب قائمة ملفات التقسيط', null, error.message);
    }
  },

  /**
   * Retrieves single installment contract details by ID.
   */
  getInstallmentById: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    const id = c.req.param('id');
    if (!id) {
      return sendResponse(c, 400, 'INVALID_ID', 'معرف ملف التقسيط غير محدد');
    }

    try {
      const installment = await InstallmentsService.getInstallmentById(db, user.dashboard_id, id);
      if (!installment) {
        return sendResponse(c, 404, 'INSTALLMENT_NOT_FOUND', 'ملف التقسيط المطلوب غير موجود');
      }
      return sendResponse(c, 200, 'INSTALLMENT_FETCHED', 'تم جلب بيانات ملف التقسيط بنجاح', { installment });
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', `Failed to fetch installment ${id}`, error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب بيانات ملف التقسيط', null, error.message);
    }
  },

  /**
   * Creates a new phone installment contract.
   */
  createInstallment: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    const activeShift = user.active_shift;

    try {
      const body = c.req.valid('json' as never) as any;
      const installment = await InstallmentsService.createInstallment(db, user.dashboard_id, body, user, activeShift);
      return sendResponse(c, 201, 'INSTALLMENT_CREATED', 'تم إنشاء ملف وعقد التقسيط بنجاح', { installment });
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'Failed to create installment', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في إنشاء ملف التقسيط', null, error.message);
    }
  },

  /**
   * Updates an existing installment contract.
   */
  updateInstallment: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    const id = c.req.param('id');
    if (!id) {
      return sendResponse(c, 400, 'INVALID_ID', 'معرف ملف التقسيط غير محدد');
    }

    try {
      const body = c.req.valid('json' as never) as any;
      const result = await InstallmentsService.updateInstallment(db, user.dashboard_id, id, body, user);

      if ('error' in result) {
        return sendResponse(c, result.status as any, result.error, result.message);
      }

      return sendResponse(c, 200, 'INSTALLMENT_UPDATED', 'تم تحديث بيانات عقد التقسيط بنجاح', { installment: result });
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', `Failed to update installment ${id}`, error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في تحديث بيانات عقد التقسيط', null, error.message);
    }
  },

  /**
   * Collects a monthly installment payment.
   */
  payInstallment: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    const id = c.req.param('id');
    if (!id) {
      return sendResponse(c, 400, 'INVALID_ID', 'معرف ملف التقسيط غير محدد');
    }

    const activeShift = user.active_shift;

    try {
      const body = c.req.valid('json' as never) as any;
      const result = await InstallmentsService.payInstallment(db, user.dashboard_id, id, body, user, activeShift);

      if ('error' in result) {
        return sendResponse(c, result.status as any, result.error, result.message);
      }

      return sendResponse(
        c,
        200,
        'INSTALLMENT_PAID',
        result.is_completed
          ? 'تم سداد القسط الأخير واكتمال عقد التقسيط بالكامل بنجاح'
          : 'تم تسجيل سداد القسط وترحيل موعد الاستحقاق القادم بنجاح',
        result
      );
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', `Failed to pay installment ${id}`, error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في تسجيل سداد القسط', null, error.message);
    }
  },

  /**
   * Deletes or cancels an installment contract.
   */
  deleteInstallment: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    const id = c.req.param('id');
    if (!id) {
      return sendResponse(c, 400, 'INVALID_ID', 'معرف ملف التقسيط غير محدد');
    }

    const force = c.req.query('force') === 'true';

    try {
      const result = await InstallmentsService.deleteInstallment(db, user.dashboard_id, id, force);

      if ('error' in result) {
        return sendResponse(c, result.status as any, result.error, result.message);
      }

      return sendResponse(c, 200, 'INSTALLMENT_DELETED', result.message, { action: result.action });
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', `Failed to delete installment ${id}`, error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في حذف عقد التقسيط', null, error.message);
    }
  },

  /**
   * Retrieves paginated payment history for a specific installment contract.
   */
  getPayments: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    const id = c.req.param('id');
    if (!id) {
      return sendResponse(c, 400, 'INVALID_ID', 'معرف ملف التقسيط غير محدد');
    }

    try {
      const query = c.req.valid('query' as never) as any;
      const result = await InstallmentsService.getInstallmentPayments(db, user.dashboard_id, id, query || {});
      return sendResponse(c, 200, 'PAYMENTS_FETCHED', 'تم جلب سجل دفعات القسط بنجاح', result);
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', `Failed to fetch installment payments ${id}`, error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب سجل دفعات القسط', null, error.message);
    }
  },
};
