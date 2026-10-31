/**
 * ==============================================================================
 * MobiDash Platform - Spare Parts Controller
 * ==============================================================================
 * 
 * Handles HTTP requests for maintenance workshop spare parts inventory,
 * stock adjustments, real-time code verification, and aggregated KPIs.
 */

import { Context } from 'hono';
import { sendResponse } from '../utils/response';
import {
  AppContext,
  CreateSparePartInput,
  UpdateSparePartInput,
  AdjustSparePartStockInput,
  SparePartFilterQuery,
} from '../types';
import { SparePartsService } from '../services/spare_parts.services';
import { logger } from '../utils/logger';

export const SparePartsController = {
  /**
   * جلب إحصائيات وعدادات وقيمة مخزون قطع الغيار المجمعة
   * GET /api/spare-parts/stats
   */
  getStats: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const category = c.req.query('category');
      const stats = await SparePartsService.getStats(db, user.dashboard_id, category);
      return sendResponse(c, 200, 'SPARE_PARTS_STATS_FETCHED', 'تم جلب إحصائيات قطع الغيار بنجاح', { stats });
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'Failed to fetch spare parts stats', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب إحصائيات قطع الغيار', null, error.message);
    }
  },

  /**
   * الفحص اللحظي لتوفر كود أو باركود القطعة وعدم تكراره
   * GET /api/spare-parts/check-code?code=...&exclude_id=...
   */
  checkPartCode: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      let code = '';
      let excludeId: string | undefined;

      try {
        const validatedQuery = c.req.valid('query' as never) as { code?: string; exclude_id?: string } | undefined;
        if (validatedQuery?.code) {
          code = validatedQuery.code;
          excludeId = validatedQuery.exclude_id;
        }
      } catch {
        // Fallback reading
      }

      if (!code) {
        code = c.req.query('code') || '';
        excludeId = c.req.query('exclude_id') || undefined;
      }

      if (!code || !code.trim()) {
        return sendResponse(c, 400, 'INVALID_CODE', 'كود القطعة مطلوب للفحص');
      }

      const result = await SparePartsService.checkPartCodeAvailability(
        db,
        user.dashboard_id,
        code.trim(),
        excludeId
      );

      return sendResponse(c, 200, 'PART_CODE_CHECK_RESULT', result.message, result);
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'Failed to check part code availability', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في فحص توفر كود القطعة', null, error.message);
    }
  },

  /**
   * جلب قائمة قطع الغيار مع البحث والتصفية والتصفح
   * GET /api/spare-parts
   */
  getSpareParts: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const query = (c.req.valid('query' as never) || {}) as SparePartFilterQuery;
      const result = await SparePartsService.getSpareParts(db, user.dashboard_id, query);
      return sendResponse(c, 200, 'SPARE_PARTS_FETCHED', 'تم جلب قطع الغيار بنجاح', result);
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'Failed to fetch spare parts', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب قطع الغيار', null, error.message);
    }
  },

  /**
   * جلب قطع الغيار المتوافقة مع موديل هاتف محدد لورشة الصيانة
   * GET /api/spare-parts/compatible/:model
   */
  getCompatibleParts: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    const model = c.req.param('model');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }
    if (!model || !model.trim()) {
      return sendResponse(c, 400, 'INVALID_MODEL', 'موديل الهاتف مطلوب');
    }

    try {
      const parts = await SparePartsService.getCompatibleParts(db, user.dashboard_id, decodeURIComponent(model));
      return sendResponse(c, 200, 'COMPATIBLE_PARTS_FETCHED', 'تم جلب قطع الغيار المتوافقة بنجاح', { parts });
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', `Failed to fetch compatible parts for ${model}`, error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب القطع المتوافقة', null, error.message);
    }
  },

  /**
   * جلب تفاصيل قطعة غيار محددة
   * GET /api/spare-parts/:id
   */
  getSparePartById: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    const id = c.req.param('id');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }
    if (!id) {
      return sendResponse(c, 400, 'INVALID_ID', 'معرف قطعة الغيار مطلوب');
    }

    try {
      const part = await SparePartsService.getSparePartById(db, user.dashboard_id, id);
      if (!part) {
        return sendResponse(c, 404, 'SPARE_PART_NOT_FOUND', 'قطعة الغيار غير موجودة');
      }
      return sendResponse(c, 200, 'SPARE_PART_FETCHED', 'تم جلب بيانات قطعة الغيار بنجاح', { part });
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', `Failed to fetch spare part ${id}`, error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب بيانات قطعة الغيار', null, error.message);
    }
  },

  /**
   * تسجيل وإضافة قطعة غيار جديدة
   * POST /api/spare-parts
   */
  createSparePart: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const body = c.req.valid('json' as never) as CreateSparePartInput;
      const part = await SparePartsService.createSparePart(db, user.dashboard_id, user, body);
      return sendResponse(c, 201, 'SPARE_PART_CREATED', 'تم تسجيل قطعة الغيار بالدرج بنجاح', { part });
    } catch (error: any) {
      if (error.slug === 'PART_CODE_ALREADY_EXISTS') {
        return sendResponse(c, 409, 'PART_CODE_ALREADY_EXISTS', error.message);
      }
      logger.error(c.get('requestId') || 'unknown', 'Failed to create spare part', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', error.message || 'فشل في تسجيل قطعة الغيار', null, error.message);
    }
  },

  /**
   * تعديل بيانات وسعر ورصيد قطعة غيار قائمة
   * PUT /api/spare-parts/:id
   */
  updateSparePart: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    const id = c.req.param('id');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }
    if (!id) {
      return sendResponse(c, 400, 'INVALID_ID', 'معرف قطعة الغيار مطلوب');
    }

    try {
      const body = c.req.valid('json' as never) as UpdateSparePartInput;
      const part = await SparePartsService.updateSparePart(db, user.dashboard_id, user, id, body);
      return sendResponse(c, 200, 'SPARE_PART_UPDATED', 'تم تحديث بيانات قطعة الغيار بنجاح', { part });
    } catch (error: any) {
      if (error.slug === 'SPARE_PART_NOT_FOUND') {
        return sendResponse(c, 404, 'SPARE_PART_NOT_FOUND', error.message);
      }
      if (error.slug === 'PART_CODE_ALREADY_EXISTS') {
        return sendResponse(c, 409, 'PART_CODE_ALREADY_EXISTS', error.message);
      }
      logger.error(c.get('requestId') || 'unknown', `Failed to update spare part ${id}`, error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', error.message || 'فشل في تحديث قطعة الغيار', null, error.message);
    }
  },

  /**
   * تسوية وتعديل رصيد الدرج يدوياً
   * POST /api/spare-parts/:id/adjust-stock
   */
  adjustStock: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    const id = c.req.param('id');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }
    if (!id) {
      return sendResponse(c, 400, 'INVALID_ID', 'معرف قطعة الغيار مطلوب');
    }

    try {
      const body = c.req.valid('json' as never) as AdjustSparePartStockInput;
      const part = await SparePartsService.adjustStock(db, user.dashboard_id, user, id, body);
      return sendResponse(c, 200, 'STOCK_ADJUSTED', 'تمت تسوية رصيد قطعة الغيار بالدرج بنجاح', { part });
    } catch (error: any) {
      if (error.slug === 'SPARE_PART_NOT_FOUND') {
        return sendResponse(c, 404, 'SPARE_PART_NOT_FOUND', error.message);
      }
      if (error.slug === 'STOCK_CANNOT_BE_NEGATIVE') {
        return sendResponse(c, 400, 'STOCK_CANNOT_BE_NEGATIVE', error.message);
      }
      logger.error(c.get('requestId') || 'unknown', `Failed to adjust stock for spare part ${id}`, error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', error.message || 'فشل في تسوية الرصيد', null, error.message);
    }
  },

  /**
   * حذف آمن أو أرشفة قطعة غيار
   * DELETE /api/spare-parts/:id
   */
  deleteSparePart: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    const id = c.req.param('id');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }
    if (!id) {
      return sendResponse(c, 400, 'INVALID_ID', 'معرف قطعة الغيار مطلوب');
    }

    const force = c.req.query('force') === 'true' || c.req.query('force') === '1';

    try {
      const result = await SparePartsService.deleteSparePart(db, user.dashboard_id, user, id, force);
      return sendResponse(c, 200, result.archived ? 'SPARE_PART_ARCHIVED' : 'SPARE_PART_DELETED', result.message, result);
    } catch (error: any) {
      if (error.slug === 'SPARE_PART_NOT_FOUND') {
        return sendResponse(c, 404, 'SPARE_PART_NOT_FOUND', error.message);
      }
      logger.error(c.get('requestId') || 'unknown', `Failed to delete spare part ${id}`, error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', error.message || 'فشل في حذف قطعة الغيار', null, error.message);
    }
  },
};

