/**
 * ==============================================================================
 * MobiDash Platform - Suppliers Controller
 * ==============================================================================
 * 
 * Handles incoming HTTP requests for suppliers, wholesale accounts,
 * debt settlement, statement ledger, and vendor directory operations.
 */

import { Context } from 'hono';
import { sendResponse } from '../utils/response';
import { AppContext } from '../types';
import { SuppliersService } from '../services/suppliers.services';
import { logger } from '../utils/logger';

export const SuppliersController = {
  /**
   * Retrieves aggregated KPI analytics for suppliers (counts and balances).
   */
  getStats: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const stats = await SuppliersService.getSupplierStats(db, user.dashboard_id);
      return sendResponse(c, 200, 'SUPPLIERS_STATS_FETCHED', 'تم جلب إحصائيات الموردين بنجاح', { stats });
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'Failed to fetch supplier stats', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب إحصائيات الموردين', null, error.message);
    }
  },

  /**
   * Retrieves a paginated list of suppliers with search and filters.
   */
  getSuppliers: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const query = c.req.valid('query' as never) as any;
      const result = await SuppliersService.getSuppliers(db, user.dashboard_id, query || {});
      return sendResponse(c, 200, 'SUPPLIERS_FETCHED', 'تم جلب قائمة الموردين بنجاح', result);
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'Failed to fetch suppliers', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب قائمة الموردين', null, error.message);
    }
  },

  /**
   * Retrieves single supplier details by ID.
   */
  getSupplierById: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    const id = c.req.param('id');
    if (!id) {
      return sendResponse(c, 400, 'INVALID_ID', 'معرف المورد غير محدد');
    }

    try {
      const supplier = await SuppliersService.getSupplierById(db, user.dashboard_id, id);
      if (!supplier) {
        return sendResponse(c, 404, 'SUPPLIER_NOT_FOUND', 'المورد المطلوب غير موجود');
      }
      return sendResponse(c, 200, 'SUPPLIER_FETCHED', 'تم جلب بيانات المورد بنجاح', { supplier });
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', `Failed to fetch supplier ${id}`, error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب بيانات المورد', null, error.message);
    }
  },

  /**
   * Creates a new supplier or wholesale distributor.
   */
  createSupplier: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const body = c.req.valid('json' as never) as any;
      const supplier = await SuppliersService.createSupplier(db, user.dashboard_id, body, user);
      return sendResponse(c, 201, 'SUPPLIER_CREATED', 'تم إضافة المورد بنجاح', { supplier });
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'Failed to create supplier', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في إضافة المورد الجديد', null, error.message);
    }
  },

  /**
   * Updates an existing supplier's details.
   */
  updateSupplier: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    const id = c.req.param('id');
    if (!id) {
      return sendResponse(c, 400, 'INVALID_ID', 'معرف المورد غير محدد');
    }

    try {
      const body = c.req.valid('json' as never) as any;
      const result = await SuppliersService.updateSupplier(db, user.dashboard_id, id, body, user);

      if ('error' in result) {
        return sendResponse(c, result.status as any, result.error, result.message);
      }

      return sendResponse(c, 200, 'SUPPLIER_UPDATED', 'تم تحديث بيانات المورد بنجاح', { supplier: result });
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', `Failed to update supplier ${id}`, error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في تحديث بيانات المورد', null, error.message);
    }
  },

  /**
   * Deletes or archives a supplier.
   */
  deleteSupplier: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    const id = c.req.param('id');
    if (!id) {
      return sendResponse(c, 400, 'INVALID_ID', 'معرف المورد غير محدد');
    }

    const force = c.req.query('force') === 'true';

    try {
      const result = await SuppliersService.deleteSupplier(db, user.dashboard_id, id, force);

      if ('error' in result) {
        return sendResponse(c, result.status as any, result.error, result.message);
      }

      return sendResponse(c, 200, 'SUPPLIER_DELETED', result.message, { action: result.action });
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', `Failed to delete supplier ${id}`, error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في حذف حساب المورد', null, error.message);
    }
  },

  /**
   * Records a supplier debt payment and updates ledger & cash drawer.
   */
  paySupplier: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    const id = c.req.param('id');
    if (!id) {
      return sendResponse(c, 400, 'INVALID_ID', 'معرف المورد غير محدد');
    }

    const activeShift = user.active_shift;

    try {
      const body = c.req.valid('json' as never) as any;
      const result = await SuppliersService.paySupplier(db, user.dashboard_id, id, body, user, activeShift);

      if ('error' in result) {
        return sendResponse(c, result.status as any, result.error, result.message);
      }

      return sendResponse(c, 200, 'SUPPLIER_PAYMENT_SUCCESS', 'تم تسجيل دفعة المورد وخصمها بنجاح', result);
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', `Failed to pay supplier ${id}`, error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في تسجيل دفعة المورد', null, error.message);
    }
  },

  /**
   * Retrieves paginated transaction history / statement for a supplier.
   */
  getTransactions: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    const id = c.req.param('id');
    if (!id) {
      return sendResponse(c, 400, 'INVALID_ID', 'معرف المورد غير محدد');
    }

    try {
      const page = Number(c.req.query('page') || 1);
      const limit = Number(c.req.query('limit') || 20);

      const result = await SuppliersService.getSupplierTransactions(db, user.dashboard_id, id, page, limit);

      if ('error' in result) {
        return sendResponse(c, result.status as any, result.error, result.message);
      }

      return sendResponse(c, 200, 'SUPPLIER_TRANSACTIONS_FETCHED', 'تم جلب كشف حساب المورد بنجاح', result);
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', `Failed to fetch transactions for supplier ${id}`, error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب كشف حساب المورد', null, error.message);
    }
  },
};
