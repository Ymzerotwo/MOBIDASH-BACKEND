/**
 * ==============================================================================
 * MobiDash Platform - Telecom Controller
 * ==============================================================================
 * 
 * Handles incoming HTTP requests for electronic payment terminals, mobile wallets,
 * financial service transactions, top-ups, withdrawals, and internal transfers.
 */

import { Context } from 'hono';
import { sendResponse } from '../utils/response';
import { AppContext } from '../types';
import { TelecomService } from '../services/telecom.services';

export const TelecomController = {
  /**
   * Retrieves dashboard statistics and analytics for telecom operations.
   */
  getStats: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const stats = await TelecomService.getTelecomStats(db, user.dashboard_id);
      return sendResponse(c, 200, 'TELECOM_STATS_FETCHED', 'تم جلب إحصائيات المعاملات والماكينات بنجاح', { stats });
    } catch (error: any) {
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب إحصائيات ماكينات الدفع', null, error.message);
    }
  },

  /**
   * Retrieves a paginated list of terminals/wallets with filtering.
   */
  getTerminals: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const query = c.req.valid('query' as never) as any;
      const result = await TelecomService.getTerminals(db, user.dashboard_id, query || {});
      return sendResponse(c, 200, 'TERMINALS_FETCHED', 'تم جلب ماكينات ومحافظ الدفع بنجاح', result);
    } catch (error: any) {
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب قائمة الماكينات', null, error.message);
    }
  },

  /**
   * Retrieves single terminal details by ID.
   */
  getTerminalById: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const id = c.req.param('id') as string;
      const terminal = await TelecomService.getTerminalById(db, user.dashboard_id, id);
      if (!terminal) {
        return sendResponse(c, 404, 'TERMINAL_NOT_FOUND', 'الماكينة أو المحفظة غير موجودة');
      }
      return sendResponse(c, 200, 'TERMINAL_FETCHED', 'تم جلب بيانات الماكينة بنجاح', { terminal });
    } catch (error: any) {
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب بيانات الماكينة', null, error.message);
    }
  },

  /**
   * Creates a new terminal, wallet, or bank account.
   */
  createTerminal: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const body = c.req.valid('json' as never) as any;
      const terminal = await TelecomService.createTerminal(db, user.dashboard_id, body);
      return sendResponse(c, 201, 'TERMINAL_CREATED', 'تم إضافة الماكينة/المحفظة بنجاح', { terminal });
    } catch (error: any) {
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في إضافة الماكينة', null, error.message);
    }
  },

  /**
   * Updates an existing terminal or wallet.
   */
  updateTerminal: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const id = c.req.param('id') as string;
      const body = c.req.valid('json' as never) as any;
      const result = await TelecomService.updateTerminal(db, user.dashboard_id, id, body);
      if (result.error) {
        return sendResponse(c, (result.status || 400) as any, result.error, result.message || 'فشل في تحديث الماكينة');
      }
      return sendResponse(c, 200, 'TERMINAL_UPDATED', 'تم تحديث بيانات الماكينة بنجاح', { terminal: result.terminal });
    } catch (error: any) {
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في تحديث الماكينة', null, error.message);
    }
  },

  /**
   * Deletes or soft-archives a terminal.
   */
  deleteTerminal: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const id = c.req.param('id') as string;
      const result = await TelecomService.deleteTerminal(db, user.dashboard_id, id);
      if (result.error) {
        return sendResponse(c, (result.status || 400) as any, result.error, result.message || 'فشل في حذف الماكينة');
      }
      return sendResponse(c, 200, 'TERMINAL_DELETED', result.message, {
        suspended: result.suspended,
        deleted: result.deleted
      });
    } catch (error: any) {
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في إزالة الماكينة', null, error.message);
    }
  },

  /**
   * Tops up a terminal/wallet balance.
   */
  topUpTerminal: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const id = c.req.param('id') as string;
      const body = c.req.valid('json' as never) as any;
      const result = await TelecomService.topUpTerminal(db, user.dashboard_id, user, id, body);
      if (result.error) {
        return sendResponse(c, (result.status || 400) as any, result.error, result.message || 'فشل في شحن الرصيد');
      }
      return sendResponse(c, 200, 'TERMINAL_TOPPED_UP', result.message || 'تم شحن الرصيد بنجاح', {
        transaction: result.transaction,
        new_balance: result.new_balance
      });
    } catch (error: any) {
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في تغذية رصيد الماكينة', null, error.message);
    }
  },

  /**
   * Withdraws funds from a terminal/wallet to cash drawer or external account.
   */
  withdrawTerminal: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const id = c.req.param('id') as string;
      const body = c.req.valid('json' as never) as any;
      const result = await TelecomService.withdrawTerminal(db, user.dashboard_id, user, id, body);
      if (result.error) {
        return sendResponse(c, (result.status || 400) as any, result.error, result.message || 'فشل في سحب الرصيد');
      }
      return sendResponse(c, 200, 'TERMINAL_WITHDRAWN', result.message || 'تم سحب الرصيد بنجاح', {
        transaction: result.transaction,
        new_balance: result.new_balance
      });
    } catch (error: any) {
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في سحب الرصيد من الماكينة', null, error.message);
    }
  },

  /**
   * Transfers balance between two internal terminals.
   */
  internalTransfer: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const body = c.req.valid('json' as never) as any;
      const result = await TelecomService.internalTransfer(db, user.dashboard_id, user, body);
      if (result.error) {
        return sendResponse(c, (result.status || 400) as any, result.error, result.message || 'فشل في إجراء التحويل');
      }
      return sendResponse(c, 200, 'TRANSFER_SUCCESSFUL', result.message || 'تم التحويل بنجاح', {
        transaction: result.transaction
      });
    } catch (error: any) {
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في إجراء التحويل الداخلي', null, error.message);
    }
  },

  /**
   * Records a customer electronic transaction (utilities, recharge, bill, cash-in, cash-out).
   */
  recordTransaction: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const body = c.req.valid('json' as never) as any;
      const result = await TelecomService.recordTransaction(db, user.dashboard_id, user, body);
      if (result.error) {
        return sendResponse(c, (result.status || 400) as any, result.error, result.message || 'فشل في تسجيل المعاملة');
      }
      return sendResponse(c, 201, 'TRANSACTION_RECORDED', result.message || 'تم تنفيذ المعاملة بنجاح', {
        transaction: result.transaction,
        terminal: result.terminal
      });
    } catch (error: any) {
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في تسجيل المعاملة', null, error.message);
    }
  },

  /**
   * Retrieves a paginated list of telecom service transactions.
   */
  getTransactions: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    try {
      const query = c.req.valid('query' as never) as any;
      const result = await TelecomService.getTransactions(db, user.dashboard_id, query || {});
      return sendResponse(c, 200, 'TRANSACTIONS_FETCHED', 'تم جلب سجل المعاملات بنجاح', result);
    } catch (error: any) {
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب سجل المعاملات', null, error.message);
    }
  }
};
