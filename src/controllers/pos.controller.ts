/**
 * ==============================================================================
 * MobiDash Platform - Unified POS Catalog Controller
 * Location: backend/src/controllers/pos.controller.ts
 * ==============================================================================
 * 
 * Provides unified, high-performance data retrieval endpoints for the Point of Sale (POS)
 * terminal across all departments:
 * 1. Accessories (with category filter, search, in-stock prioritization)
 * 2. Phones (only in_stock items, filtered by brand/condition/search)
 * 3. Spare Parts (active items with positive stock, filtered by category/search)
 * 4. Telecom & Digital Wallets (active/low_balance terminals with real-time balances)
 * 
 * Guarantees:
 * - Strict multi-tenant isolation (dashboard_id on every query)
 * - Safe response formatting via sendResponse
 * - Detailed error handling & structured logging
 */

import { Context } from 'hono';
import { sendResponse } from '../utils/response';
import { AppContext } from '../types';
import { AccessoriesService } from '../services/accessories.services';
import { PhonesService } from '../services/phones.services';
import { SparePartsService } from '../services/spare_parts.services';
import { TelecomService } from '../services/telecom.services';
import { FinancesService } from '../services/finances.services';
import {
  PosAccessoriesQueryInput,
  PosPhonesQueryInput,
  PosSparePartsQueryInput,
  PosTelecomQueryInput,
} from '../validators/pos.validators';
import { PosCheckoutInput, PosMovementFilterQuery } from '../types';
import { logger } from '../utils/logger';

export const PosController = {
  /**
   * GET /api/pos/accessories
   * Fast POS retrieval of active accessories with category filter and search.
   */
  getAccessoriesForPos: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const query = c.req.valid('query' as never) as PosAccessoriesQueryInput;
      const result = await AccessoriesService.getForPos(db, user.dashboard_id, query);

      return sendResponse(
        c,
        200,
        'POS_ACCESSORIES_FETCHED',
        'تم جلب قائمة إكسسوارات نقطة البيع بنجاح',
        result
      );
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'Failed to fetch accessories for POS', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب إكسسوارات نقطة البيع', null, error.message);
    }
  },

  /**
   * GET /api/pos/phones
   * POS retrieval of phones currently in stock, filtered by brand, condition, and search.
   */
  getPhonesForPos: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const query = c.req.valid('query' as never) as PosPhonesQueryInput;
      const result = await PhonesService.getForPos(db, user.dashboard_id, query);

      return sendResponse(
        c,
        200,
        'POS_PHONES_FETCHED',
        'تم جلب قائمة الهواتف المتاحة لنقطة البيع بنجاح',
        result
      );
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'Failed to fetch phones for POS', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب هواتف نقطة البيع', null, error.message);
    }
  },

  /**
   * GET /api/pos/spare-parts
   * POS retrieval of available spare parts with positive stock, filtered by category and search.
   */
  getSparePartsForPos: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const query = c.req.valid('query' as never) as PosSparePartsQueryInput;
      const result = await SparePartsService.getForPos(db, user.dashboard_id, query);

      return sendResponse(
        c,
        200,
        'POS_SPARE_PARTS_FETCHED',
        'تم جلب قائمة قطع الغيار لنقطة البيع بنجاح',
        result
      );
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'Failed to fetch spare parts for POS', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب قطع الغيار لنقطة البيع', null, error.message);
    }
  },

  /**
   * GET /api/pos/telecom
   * POS retrieval of electronic payment terminals and digital wallets with current balances.
   */
  getTelecomForPos: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const query = c.req.valid('query' as never) as PosTelecomQueryInput;
      const data = await TelecomService.getForPos(db, user.dashboard_id, query);

      return sendResponse(
        c,
        200,
        'POS_TELECOM_FETCHED',
        'تم جلب ماكينات ومحافظ نقطة البيع بنجاح',
        data
      );
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'Failed to fetch telecom terminals for POS', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب ماكينات ومحافظ نقطة البيع', null, error.message);
    }
  },

  /**
   * POST /api/pos/checkout
   * Atomic multi-table POS sale execution (D1 db.batch):
   * Decrements stock, sets phones sold, inserts telecom transaction, syncs shift & cash drawer,
   * updates customer balance if credit, and registers master financial movement.
   */
  checkout: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const body = c.req.valid('json' as never) as PosCheckoutInput;
      const movement = await FinancesService.checkout(db, user.dashboard_id, user, body);

      return sendResponse(
        c,
        201,
        'CHECKOUT_SUCCESSFUL',
        'تم تسجيل حركة البيع وتحديث المخزون بنجاح',
        movement
      );
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'POS checkout failed', error);
      return sendResponse(
        c,
        error.slug === 'EMPTY_CART' ? 400 : 500,
        error.slug || 'CHECKOUT_FAILED',
        error.message || 'فشل في إتمام عملية البيع لنقطة البيع',
        null,
        error.message
      );
    }
  },

  /**
   * GET /api/pos/movements
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
   * GET /api/pos/stats
   * Real-time today sales, profits, payment mix, and department totals.
   */
  getSalesStats: async (c: Context<AppContext>) => {
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
        'POS_STATS_FETCHED',
        'تم جلب إحصائيات المبيعات والأرباح لليوم بنجاح',
        stats
      );
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'Failed to fetch POS sales stats', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب إحصائيات المبيعات', null, error.message);
    }
  },
};
