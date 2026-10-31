/**
 * ==============================================================================
 * MobiDash Platform - Accessories Controller
 * ==============================================================================
 * 
 * Handles HTTP requests for phone accessories, chargers, cases,
 * stock adjustments, real-time barcode verification, and inventory catalog.
 */

import { Context } from 'hono';
import { sendResponse } from '../utils/response';
import { AppContext } from '../types';
import { AccessoriesService } from '../services/accessories.services';
import { logger } from '../utils/logger';

export const AccessoriesController = {
  /**
   * Dedicated endpoint: Checks if a barcode is available / unused in this store.
   * GET /api/accessories/check-barcode?barcode=...&exclude_id=...
   */
  checkBarcode: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const query = c.req.valid('query' as never) as { barcode: string; exclude_id?: string };
      const result = await AccessoriesService.checkBarcodeAvailability(
        db,
        user.dashboard_id,
        query.barcode,
        query.exclude_id
      );

      return sendResponse(c, 200, 'BARCODE_CHECK_RESULT', result.message, result);
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'Failed to check barcode availability', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في التحقق من الباركود', null, error.message);
    }
  },

  /**
   * Fast lookup of an accessory by barcode for POS barcode scanner gun.
   * GET /api/accessories/barcode/:barcode
   */
  getByBarcode: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const barcode = c.req.param('barcode');
      if (!barcode || !barcode.trim()) {
        return sendResponse(c, 400, 'INVALID_BARCODE', 'يرجى إدخال الباركود للبحث');
      }

      const accessory = await AccessoriesService.getAccessoryByBarcode(db, user.dashboard_id, barcode);
      if (!accessory) {
        return sendResponse(c, 404, 'ACCESSORY_NOT_FOUND', `لم يتم العثور على صنف بالباركود: ${barcode}`);
      }

      return sendResponse(c, 200, 'ACCESSORY_FETCHED', 'تم العثور على الصنف بنجاح', { accessory });
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'Failed to fetch accessory by barcode', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب الصنف بالباركود', null, error.message);
    }
  },

  /**
   * Retrieves aggregated KPI analytics for accessories.
   * GET /api/accessories/stats
   */
  getStats: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const category = c.req.query('category');
      const stats = await AccessoriesService.getAccessoryStats(db, user.dashboard_id, category);
      return sendResponse(c, 200, 'ACCESSORIES_STATS_FETCHED', 'تم جلب إحصائيات الإكسسوارات بنجاح', { stats });
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'Failed to fetch accessory stats', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب إحصائيات الإكسسوارات', null, error.message);
    }
  },

  /**
   * Retrieves a paginated list of accessories with search and filters.
   * GET /api/accessories
   */
  getAccessories: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const query = c.req.valid('query' as never) as any;
      const result = await AccessoriesService.getAccessories(db, user.dashboard_id, query || {});
      return sendResponse(c, 200, 'ACCESSORIES_FETCHED', 'تم جلب قائمة الإكسسوارات بنجاح', result);
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'Failed to fetch accessories', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب قائمة الإكسسوارات', null, error.message);
    }
  },

  /**
   * Retrieves single accessory details by ID.
   * GET /api/accessories/:id
   */
  getAccessoryById: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const id = c.req.param('id');
      if (!id) {
        return sendResponse(c, 400, 'INVALID_ID', 'معرف الصنف مطلوب');
      }
      const accessory = await AccessoriesService.getAccessoryById(db, user.dashboard_id, id);
      if (!accessory) {
        return sendResponse(c, 404, 'ACCESSORY_NOT_FOUND', 'صنف الإكسسوار المطلوب غير موجود');
      }

      return sendResponse(c, 200, 'ACCESSORY_FETCHED', 'تم جلب بيانات الإكسسوار بنجاح', { accessory });
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'Failed to fetch accessory by ID', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب بيانات الإكسسوار', null, error.message);
    }
  },

  /**
   * Creates a new accessory with opening stock.
   * POST /api/accessories
   */
  createAccessory: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const input = c.req.valid('json' as never) as any;
      const result = await AccessoriesService.createAccessory(db, user.dashboard_id, input, user);

      if ('error' in result) {
        return sendResponse(c, result.status as any, result.error, result.message);
      }

      return sendResponse(c, 201, 'ACCESSORY_CREATED', 'تمت إضافة صنف الإكسسوار بنجاح', { accessory: result });
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'Failed to create accessory', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في إضافة صنف الإكسسوار', null, error.message);
    }
  },

  /**
   * Updates an existing accessory.
   * PUT /api/accessories/:id
   */
  updateAccessory: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const id = c.req.param('id');
      if (!id) {
        return sendResponse(c, 400, 'INVALID_ID', 'معرف الصنف مطلوب');
      }
      const input = c.req.valid('json' as never) as any;
      const result = await AccessoriesService.updateAccessory(db, user.dashboard_id, id, input, user);

      if ('error' in result) {
        return sendResponse(c, result.status as any, result.error, result.message);
      }

      return sendResponse(c, 200, 'ACCESSORY_UPDATED', 'تم تحديث بيانات الصنف بنجاح', { accessory: result });
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'Failed to update accessory', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في تحديث بيانات الصنف', null, error.message);
    }
  },

  /**
   * Adjusts stock quantity atomically with audit trail.
   * PATCH /api/accessories/:id/stock
   */
  adjustStock: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const id = c.req.param('id');
      if (!id) {
        return sendResponse(c, 400, 'INVALID_ID', 'معرف الصنف مطلوب');
      }
      const input = c.req.valid('json' as never) as any;
      const shiftId = (user as any)?.shift_id || null;

      const result = await AccessoriesService.adjustStock(db, user.dashboard_id, id, input, user, shiftId);

      if ('error' in result) {
        return sendResponse(c, result.status as any, result.error, result.message);
      }

      return sendResponse(c, 200, 'STOCK_ADJUSTED', 'تم تعديل كمية المخزون وتسجيل الحركة بنجاح', result);
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'Failed to adjust stock', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في تعديل كمية المخزون', null, error.message);
    }
  },

  /**
   * Deletes or archives an accessory.
   * DELETE /api/accessories/:id
   */
  deleteAccessory: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const id = c.req.param('id');
      if (!id) {
        return sendResponse(c, 400, 'INVALID_ID', 'معرف الصنف مطلوب');
      }
      const force = c.req.query('force') === 'true';

      const result = await AccessoriesService.deleteAccessory(db, user.dashboard_id, id, force);

      if ('error' in result) {
        return sendResponse(c, result.status as any, result.error, result.message);
      }

      return sendResponse(c, 200, 'ACCESSORY_DELETED', result.message, result);
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'Failed to delete accessory', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في حذف صنف الإكسسوار', null, error.message);
    }
  },

  /**
   * Retrieves stock movements ledger for an accessory.
   * GET /api/accessories/:id/movements
   */
  getMovements: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const id = c.req.param('id');
      if (!id) {
        return sendResponse(c, 400, 'INVALID_ID', 'معرف الصنف مطلوب');
      }
      const page = Number(c.req.query('page') || 1);
      const limit = Number(c.req.query('limit') || 20);

      const result = await AccessoriesService.getAccessoryMovements(db, user.dashboard_id, id, page, limit);

      if ('error' in result) {
        return sendResponse(c, result.status as any, result.error, result.message);
      }

      return sendResponse(c, 200, 'MOVEMENTS_FETCHED', 'تم جلب سجل حركات الصنف بنجاح', result);
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'Failed to fetch accessory movements', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب سجل حركات الصنف', null, error.message);
    }
  },
};
