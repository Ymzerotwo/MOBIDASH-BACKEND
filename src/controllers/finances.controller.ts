/**
 * ==============================================================================
 * MobiDash Platform - Finances & General Ledger Controller
 * Location: backend/src/controllers/finances.controller.ts
 * ==============================================================================
 * 
 * Provides unified, multi-tenant endpoints for store finances, cash movements,
 * daily ledger auditing, and petty expense recording.
 */

import { Context } from 'hono';
import { sendResponse } from '../utils/response';
import { AppContext, PosMovementFilterQuery, CreateExpenseInput } from '../types';
import { CreateCashInInput } from '../validators/finances.validators';
import { FinancesService } from '../services/finances.services';
import { logger } from '../utils/logger';

export const FinancesController = {
  /**
   * GET /api/finances/movements
   * Search and filter unified financial movements log (audit trail).
   */
  getMovements: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const query = c.req.valid('query' as never) as PosMovementFilterQuery;
      const result = await FinancesService.getMovements(db, user.dashboard_id, query);

      return sendResponse(
        c,
        200,
        'FINANCIAL_MOVEMENTS_FETCHED',
        'تم جلب سجل الحركات المالية بنجاح',
        result.data,
        result.pagination
      );
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'Failed to fetch financial movements', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب سجل الحركات المالية', null, error.message);
    }
  },

  /**
   * GET /api/finances/stats
   * Real-time today sales, profits, drawer cash in/out, payment mix, and department totals.
   */
  getStats: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const stats = await FinancesService.getSalesStats(db, user.dashboard_id);

      return sendResponse(
        c,
        200,
        'FINANCES_STATS_FETCHED',
        'تم جلب إحصائيات الخزنة والمبيعات بنجاح',
        stats
      );
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'Failed to fetch finances stats', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب إحصائيات الخزنة', null, error.message);
    }
  },

  /**
   * POST /api/finances/expense
   * Registers a petty expense atomically into financial_movements and deducts shift cash.
   */
  recordExpense: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const body = c.req.valid('json' as never) as CreateExpenseInput;
      const movement = await FinancesService.recordExpense(db, user.dashboard_id, user, body);

      return sendResponse(
        c,
        201,
        'EXPENSE_RECORDED',
        'تم تسجيل المصروف النثري وخصمه من الدرج بنجاح',
        movement
      );
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'Failed to record expense', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في تسجيل المصروف النثري', null, error.message);
    }
  },

  /**
   * POST /api/finances/cash-in
   * Registers a cash deposit into drawer atomically into financial_movements and adds to shift cash.
   */
  recordCashIn: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const body = c.req.valid('json' as never) as CreateCashInInput;
      const movement = await FinancesService.recordCashIn(db, user.dashboard_id, user, body);

      return sendResponse(
        c,
        201,
        'CASH_IN_RECORDED',
        'تم تسجيل إيداع النقدية بالدرج بنجاح',
        movement
      );
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'Failed to record cash in', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في تسجيل إيداع النقدية', null, error.message);
    }
  },
};
