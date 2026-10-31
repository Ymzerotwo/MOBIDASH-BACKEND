/**
 * ==============================================================================
 * MobiDash Platform - Customer Credits & Ledger Controller
 * ==============================================================================
 * 
 * Handles incoming HTTP requests for customer credit accounts (دفتر النوتة / الشكك),
 * debt collections, credit limits, account statements, and cash drawer sync.
 */

import { Context } from 'hono';
import { sendResponse } from '../utils/response';
import { AppContext } from '../types';
import { CustomersService } from '../services/customers.services';
import { logger } from '../utils/logger';

export const CustomersController = {
  /**
   * Retrieves aggregated KPI analytics for customer debts and credit ledger.
   */
  getStats: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const stats = await CustomersService.getCustomerCreditStats(db, user.dashboard_id);
      return sendResponse(c, 200, 'CUSTOMER_STATS_FETCHED', 'تم جلب إحصائيات دفتر النوتة بنجاح', { stats });
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'Failed to fetch customer credit stats', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب إحصائيات دفتر النوتة', null, error.message);
    }
  },

  /**
   * Retrieves a paginated list of customers with search and filters.
   */
  getCustomerCredits: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const query = c.req.valid('query' as never) as any;
      const result = await CustomersService.getCustomerCredits(db, user.dashboard_id, query || {});
      return sendResponse(c, 200, 'CUSTOMERS_FETCHED', 'تم جلب قائمة حسابات العملاء بنجاح', result);
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'Failed to fetch customer credits', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب قائمة العملاء', null, error.message);
    }
  },

  /**
   * Retrieves single customer account details by ID.
   */
  getCustomerCreditById: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    const id = c.req.param('id');
    if (!id) {
      return sendResponse(c, 400, 'INVALID_ID', 'معرف العميل غير محدد');
    }

    try {
      const customer = await CustomersService.getCustomerCreditById(db, user.dashboard_id, id);
      if (!customer) {
        return sendResponse(c, 404, 'CUSTOMER_NOT_FOUND', 'حساب العميل المطلوب غير موجود');
      }
      return sendResponse(c, 200, 'CUSTOMER_FETCHED', 'تم جلب بيانات حساب العميل بنجاح', { customer });
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', `Failed to fetch customer ${id}`, error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب بيانات العميل', null, error.message);
    }
  },

  /**
   * Creates a new customer credit ledger account.
   */
  createCustomerCredit: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    const activeShift = user.active_shift;

    try {
      const body = c.req.valid('json' as never) as any;
      const customer = await CustomersService.createCustomerCredit(db, user.dashboard_id, body, user, activeShift);
      return sendResponse(c, 201, 'CUSTOMER_CREATED', 'تم فتح حساب العميل في النوتة بنجاح', { customer });
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', 'Failed to create customer credit', error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في فتح حساب العميل في النوتة', null, error.message);
    }
  },

  /**
   * Updates an existing customer's contact and profile details.
   */
  updateCustomerCredit: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    const id = c.req.param('id');
    if (!id) {
      return sendResponse(c, 400, 'INVALID_ID', 'معرف العميل غير محدد');
    }

    try {
      const body = c.req.valid('json' as never) as any;
      const result = await CustomersService.updateCustomerCredit(db, user.dashboard_id, id, body, user);

      if ('error' in result) {
        return sendResponse(c, result.status as any, result.error, result.message);
      }

      return sendResponse(c, 200, 'CUSTOMER_UPDATED', 'تم تحديث بيانات العميل بنجاح', { customer: result });
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', `Failed to update customer ${id}`, error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في تحديث بيانات العميل', null, error.message);
    }
  },

  /**
   * Collects payment from customer, decreasing balance and logging to drawer if cash.
   */
  settleCustomerCredit: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    const id = c.req.param('id');
    if (!id) {
      return sendResponse(c, 400, 'INVALID_ID', 'معرف العميل غير محدد');
    }

    const activeShift = user.active_shift;

    try {
      const body = c.req.valid('json' as never) as any;
      const result = await CustomersService.settleCustomerCredit(db, user.dashboard_id, id, body, user, activeShift);

      if ('error' in result) {
        return sendResponse(c, result.status as any, result.error, result.message);
      }

      return sendResponse(c, 200, 'PAYMENT_RECORDED', 'تم تسجيل التحصيل وتحديث رصيد العميل بنجاح', result);
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', `Failed to settle customer debt ${id}`, error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في تسجيل التحصيل المالي', null, error.message);
    }
  },

  /**
   * Records a new debt / product pull on customer account.
   */
  addCustomerDebt: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    const id = c.req.param('id');
    if (!id) {
      return sendResponse(c, 400, 'INVALID_ID', 'معرف العميل غير محدد');
    }

    const activeShift = user.active_shift;

    try {
      const body = c.req.valid('json' as never) as any;
      const result = await CustomersService.addCustomerDebt(db, user.dashboard_id, id, body, user, activeShift);

      if ('error' in result) {
        return sendResponse(c, result.status as any, result.error, result.message);
      }

      return sendResponse(c, 200, 'DEBT_RECORDED', 'تم إضافة السحب الآجل لرصيد العميل بنجاح', result);
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', `Failed to add customer debt ${id}`, error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في تسجيل السحب الآجل', null, error.message);
    }
  },

  /**
   * Deletes or archives a customer account. Prohibits deleting active debtors.
   */
  deleteCustomerCredit: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    const id = c.req.param('id');
    if (!id) {
      return sendResponse(c, 400, 'INVALID_ID', 'معرف العميل غير محدد');
    }

    const force = c.req.query('force') === 'true';

    try {
      const result = await CustomersService.deleteCustomerCredit(db, user.dashboard_id, id, force);

      if ('error' in result) {
        return sendResponse(c, result.status as any, result.error, result.message);
      }

      return sendResponse(c, 200, 'CUSTOMER_DELETED', result.message, { action: result.action });
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', `Failed to delete customer ${id}`, error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في حذف حساب العميل', null, error.message);
    }
  },

  /**
   * Retrieves paginated transaction history / statement for a customer.
   */
  getTransactions: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    const id = c.req.param('id');
    if (!id) {
      return sendResponse(c, 400, 'INVALID_ID', 'معرف العميل غير محدد');
    }

    try {
      const query = c.req.valid('query' as never) as any;
      const result = await CustomersService.getCustomerTransactions(db, user.dashboard_id, id, query || {});
      return sendResponse(c, 200, 'TRANSACTIONS_FETCHED', 'تم جلب كشف حساب العميل بنجاح', result);
    } catch (error: any) {
      logger.error(c.get('requestId') || 'unknown', `Failed to fetch customer transactions ${id}`, error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب كشف حساب العميل', null, error.message);
    }
  },
};
