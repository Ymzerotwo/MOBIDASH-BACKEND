/**
 * ==============================================================================
 * MobiDash Platform - Phones & IMEI Inventory Controller
 * ==============================================================================
 * 
 * Handles HTTP requests for smartphone inventory management, IMEI tracking,
 * buyback KYC compliance, phone reservations, and sales transactions.
 */

import { Context } from 'hono';
import { sendResponse } from '../utils/response';
import { AppContext, CreatePhoneInput, UpdatePhoneInput, ReservePhoneInput, SellPhoneInput } from '../types';
import { PhonesService } from '../services/phones.services';
import { logger } from '../utils/logger';

export const PhonesController = {
  /**
   * جلب الإحصائيات والعدادات المجمعة للهواتف
   * GET /api/phones/stats
   */
  getStats: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const stats = await PhonesService.getStats(db, user.dashboard_id);
      return sendResponse(c, 200, 'PHONES_STATS_FETCHED', 'تم جلب إحصائيات المخزن بنجاح', { stats });
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'Failed to fetch phone stats', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب إحصائيات الهواتف', null, error.message);
    }
  },

  /**
   * جلب قائمة الهواتف مع التصفية والبحث والتبويبات
   * GET /api/phones
   */
  getPhones: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const query = c.req.valid('query' as never) as any;
      const result = await PhonesService.getPhones(db, user.dashboard_id, query || {});
      return sendResponse(c, 200, 'PHONES_FETCHED', 'تم جلب قائمة الهواتف بنجاح', result);
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'Failed to fetch phones list', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب قائمة الهواتف', null, error.message);
    }
  },

  /**
   * جلب تفاصيل هاتف محدد
   * GET /api/phones/:id
   */
  getPhoneById: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    const id = c.req.param('id');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }
    if (!id) {
      return sendResponse(c, 400, 'INVALID_ID', 'معرف الهاتف مطلوب');
    }

    try {
      const phone = await PhonesService.getPhoneById(db, user.dashboard_id, id);
      if (!phone) {
        return sendResponse(c, 404, 'PHONE_NOT_FOUND', 'لم يتم العثور على الجهاز المطلوب');
      }
      return sendResponse(c, 200, 'PHONE_FETCHED', 'تم جلب تفاصيل الهاتف بنجاح', { phone });
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', `Failed to fetch phone ${id}`, error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب بيانات الجهاز', null, error.message);
    }
  },

  /**
   * نقطة نهاية مخصصة للفحص اللحظي لتوفر وعدم تكرار رقم السيريال (IMEI / Code Availability Checker)
   * GET /api/phones/check-imei?imei=...&exclude_id=...
   * GET /api/phones/check-imei/:imei (Fallback)
   */
  checkImei: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      // 1. محاولة قراءة البيانات المفحوصة من الـ Query
      let imei = '';
      let excludeId: string | undefined;

      try {
        const validatedQuery = c.req.valid('query' as never) as { imei?: string; exclude_id?: string } | undefined;
        if (validatedQuery?.imei) {
          imei = validatedQuery.imei;
          excludeId = validatedQuery.exclude_id;
        }
      } catch {
        // في حال كان الطلب قادماً عبر المسار التقليدي /check-imei/:imei
      }

      if (!imei) {
        imei = c.req.param('imei') || c.req.query('imei') || '';
        excludeId = c.req.query('exclude_id') || undefined;
      }

      if (!imei || !imei.trim()) {
        return sendResponse(c, 400, 'INVALID_IMEI', 'رقم السيريال (IMEI) مطلوب');
      }

      const result = await PhonesService.checkImeiAvailability(
        db,
        user.dashboard_id,
        imei.trim(),
        excludeId
      );

      return sendResponse(c, 200, 'IMEI_CHECK_COMPLETED', result.message, result);
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'Failed to check IMEI availability', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في فحص توفر رقم السيريال', null, error.message);
    }
  },

  /**
   * تسجيل وإضافة جهاز جديد بالمخزن
   * POST /api/phones
   */
  createPhone: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const body = c.req.valid('json' as never) as CreatePhoneInput;
      const phone = await PhonesService.createPhone(db, user.dashboard_id, user, body);
      return sendResponse(c, 201, 'PHONE_CREATED', 'تم تسجيل الهاتف بنجاح في المخزن', { phone });
    } catch (error: any) {
      if (error.slug === 'IMEI_ALREADY_EXISTS') {
        return sendResponse(c, 409, 'IMEI_ALREADY_EXISTS', error.message);
      }
      if (error.slug === 'SUPPLIER_NOT_FOUND') {
        return sendResponse(c, 404, 'SUPPLIER_NOT_FOUND', error.message);
      }
      logger.error(c.get('requestId') || 'unknown', 'Failed to create phone', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', error.message || 'فشل في تسجيل الهاتف', null, error.message);
    }
  },

  /**
   * تحديث بيانات جهاز مسجل
   * PUT /api/phones/:id
   */
  updatePhone: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    const id = c.req.param('id');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }
    if (!id) {
      return sendResponse(c, 400, 'INVALID_ID', 'معرف الهاتف مطلوب');
    }

    try {
      const body = c.req.valid('json' as never) as UpdatePhoneInput;
      const phone = await PhonesService.updatePhone(db, user.dashboard_id, user, id, body);
      return sendResponse(c, 200, 'PHONE_UPDATED', 'تم تحديث بيانات الهاتف بنجاح', { phone });
    } catch (error: any) {
      if (error.slug === 'PHONE_NOT_FOUND') {
        return sendResponse(c, 404, 'PHONE_NOT_FOUND', error.message);
      }
      if (error.slug === 'PHONE_ALREADY_SOLD') {
        return sendResponse(c, 400, 'PHONE_ALREADY_SOLD', error.message);
      }
      if (error.slug === 'IMEI_ALREADY_EXISTS') {
        return sendResponse(c, 409, 'IMEI_ALREADY_EXISTS', error.message);
      }
      logger.error(c.get('requestId') || 'unknown', `Failed to update phone ${id}`, error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', error.message || 'فشل في تحديث بيانات الهاتف', null, error.message);
    }
  },

  /**
   * حذف جهاز متاح من المخزن
   * DELETE /api/phones/:id
   */
  deletePhone: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    const id = c.req.param('id');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }
    if (!id) {
      return sendResponse(c, 400, 'INVALID_ID', 'معرف الهاتف مطلوب');
    }

    try {
      await PhonesService.deletePhone(db, user.dashboard_id, id);
      return sendResponse(c, 200, 'PHONE_DELETED', 'تم حذف الهاتف من المخزن بنجاح', { id });
    } catch (error: any) {
      if (error.slug === 'PHONE_NOT_FOUND') {
        return sendResponse(c, 404, 'PHONE_NOT_FOUND', error.message);
      }
      if (error.slug === 'PHONE_ALREADY_SOLD') {
        return sendResponse(c, 400, 'PHONE_ALREADY_SOLD', error.message);
      }
      logger.error(c.get('requestId') || 'unknown', `Failed to delete phone ${id}`, error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', error.message || 'فشل في حذف الهاتف', null, error.message);
    }
  },

  /**
   * حجز جهاز بعربون لعميل
   * POST /api/phones/:id/reserve
   */
  reservePhone: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    const id = c.req.param('id');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }
    if (!id) {
      return sendResponse(c, 400, 'INVALID_ID', 'معرف الهاتف مطلوب');
    }

    try {
      const body = c.req.valid('json' as never) as ReservePhoneInput;
      const phone = await PhonesService.reservePhone(db, user.dashboard_id, user, id, body);
      return sendResponse(c, 200, 'PHONE_RESERVED', 'تم حجز الجهاز وتسجيل بيانات العربون بنجاح', { phone });
    } catch (error: any) {
      if (error.slug === 'PHONE_NOT_FOUND') {
        return sendResponse(c, 404, 'PHONE_NOT_FOUND', error.message);
      }
      if (error.slug === 'PHONE_ALREADY_SOLD') {
        return sendResponse(c, 400, 'PHONE_ALREADY_SOLD', error.message);
      }
      if (error.slug === 'PHONE_ALREADY_RESERVED') {
        return sendResponse(c, 409, 'PHONE_ALREADY_RESERVED', error.message);
      }
      logger.error(c.get('requestId') || 'unknown', `Failed to reserve phone ${id}`, error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', error.message || 'فشل في حجز الجهاز', null, error.message);
    }
  },

  /**
   * إلغاء حجز جهاز وإعادته للمخزن
   * POST /api/phones/:id/cancel-reservation
   */
  cancelReservation: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    const id = c.req.param('id');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }
    if (!id) {
      return sendResponse(c, 400, 'INVALID_ID', 'معرف الهاتف مطلوب');
    }

    try {
      const phone = await PhonesService.cancelReservation(db, user.dashboard_id, user, id);
      return sendResponse(c, 200, 'RESERVATION_CANCELLED', 'تم إلغاء الحجز وإعادة الجهاز إلى المخزن بنجاح', { phone });
    } catch (error: any) {
      if (error.slug === 'PHONE_NOT_FOUND') {
        return sendResponse(c, 404, 'PHONE_NOT_FOUND', error.message);
      }
      if (error.slug === 'PHONE_NOT_RESERVED') {
        return sendResponse(c, 400, 'PHONE_NOT_RESERVED', error.message);
      }
      logger.error(c.get('requestId') || 'unknown', `Failed to cancel reservation ${id}`, error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', error.message || 'فشل في إلغاء الحجز', null, error.message);
    }
  },

  /**
   * بيع جهاز وإصدار الفاتورة وتغذية درج النقدية
   * POST /api/phones/:id/sell
   */
  sellPhone: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    const id = c.req.param('id');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }
    if (!id) {
      return sendResponse(c, 400, 'INVALID_ID', 'معرف الهاتف مطلوب');
    }

    try {
      const body = c.req.valid('json' as never) as SellPhoneInput;
      const phone = await PhonesService.sellPhone(db, user.dashboard_id, user, id, body);
      return sendResponse(c, 200, 'PHONE_SOLD', 'تم تنفيذ عملية البيع وإصدار الفاتورة وتغذية الدرج بنجاح', { phone });
    } catch (error: any) {
      if (error.slug === 'PHONE_NOT_FOUND') {
        return sendResponse(c, 404, 'PHONE_NOT_FOUND', error.message);
      }
      if (error.slug === 'PHONE_ALREADY_SOLD') {
        return sendResponse(c, 400, 'PHONE_ALREADY_SOLD', error.message);
      }
      if (error.slug === 'PRICE_BELOW_MINIMUM') {
        return sendResponse(c, 400, 'PRICE_BELOW_MINIMUM', error.message);
      }
      logger.error(c.get('requestId') || 'unknown', `Failed to sell phone ${id}`, error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', error.message || 'فشل في تنفيذ عملية البيع', null, error.message);
    }
  },
};
