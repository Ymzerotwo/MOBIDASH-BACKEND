/**
 * ==============================================================================
 * MobiDash Platform - Telecom & Digital Wallets Routes
 * ==============================================================================
 * 
 * Defines routing endpoints for POS terminals, digital wallets,
 * customer bill payments, airtime, cash-in/cash-out, and internal transfers.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { 
  createTerminalSchema, 
  updateTerminalSchema, 
  topUpTerminalSchema, 
  withdrawTerminalSchema, 
  internalTransferSchema, 
  recordTransactionSchema, 
  telecomFilterSchema 
} from '../validators/telecom.validators';
import { sendResponse } from '../utils/response';
import { TelecomController } from '../controllers/telecom.controller';
import { AppContext } from '../types';
import { requirePermission } from '../middleware/permission';

const telecomRoutes = new Hono<AppContext>();

// Require store telecom/pos/services permission (Owners/Admins bypass automatically)
telecomRoutes.use('*', requirePermission(['telecom', 'pos', 'services', 'sales']));

/**
 * GET /api/telecom/stats
 * Retrieves aggregated analytics, daily volumes, profits, and terminal counts.
 */
telecomRoutes.get('/stats', TelecomController.getStats);

/**
 * GET /api/telecom/terminals
 * Lists all electronic payment terminals and wallets with pagination and filters.
 */
telecomRoutes.get(
  '/terminals',
  zValidator('query', telecomFilterSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'معاملات البحث والتصفية غير صالحة', null, result.error.issues);
    }
  }),
  TelecomController.getTerminals
);

/**
 * POST /api/telecom/terminals
 * Registers a new payment terminal, mobile wallet, or bank account.
 */
telecomRoutes.post(
  '/terminals',
  zValidator('json', createTerminalSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'بيانات الماكينة غير صالحة', null, result.error.issues);
    }
  }),
  TelecomController.createTerminal
);

/**
 * GET /api/telecom/terminals/:id
 * Retrieves details of a specific terminal by ID.
 */
telecomRoutes.get('/terminals/:id', TelecomController.getTerminalById);

/**
 * PUT /api/telecom/terminals/:id
 * Updates an existing terminal's details and configuration.
 */
telecomRoutes.put(
  '/terminals/:id',
  zValidator('json', updateTerminalSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'بيانات التحديث غير صالحة', null, result.error.issues);
    }
  }),
  TelecomController.updateTerminal
);

/**
 * DELETE /api/telecom/terminals/:id
 * Safely deletes or archives a terminal (prevents deletion if balance > 0).
 */
telecomRoutes.delete('/terminals/:id', TelecomController.deleteTerminal);

/**
 * POST /api/telecom/terminals/:id/top-up
 * Tops up / feeds balance into a terminal or mobile wallet.
 */
telecomRoutes.post(
  '/terminals/:id/top-up',
  zValidator('json', topUpTerminalSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'بيانات شحن الرصيد غير صالحة', null, result.error.issues);
    }
  }),
  TelecomController.topUpTerminal
);

/**
 * POST /api/telecom/terminals/:id/withdraw
 * Withdraws funds or profits from a terminal/wallet to cash drawer or bank.
 */
telecomRoutes.post(
  '/terminals/:id/withdraw',
  zValidator('json', withdrawTerminalSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'بيانات سحب الرصيد غير صالحة', null, result.error.issues);
    }
  }),
  TelecomController.withdrawTerminal
);

/**
 * POST /api/telecom/transfer
 * Transfers digital balance between two terminals/accounts inside the store.
 */
telecomRoutes.post(
  '/transfer',
  zValidator('json', internalTransferSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'بيانات التحويل الداخلي غير صالحة', null, result.error.issues);
    }
  }),
  TelecomController.internalTransfer
);

/**
 * POST /api/telecom/transactions
 * Executes a customer-facing service transaction (bills, recharge, cash-in, cash-out).
 */
telecomRoutes.post(
  '/transactions',
  zValidator('json', recordTransactionSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'بيانات المعاملة غير صالحة', null, result.error.issues);
    }
  }),
  TelecomController.recordTransaction
);

/**
 * GET /api/telecom/transactions
 * Retrieves a paginated and filtered ledger of telecom service transactions.
 */
telecomRoutes.get(
  '/transactions',
  zValidator('query', telecomFilterSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'معاملات تصفية المعاملات غير صالحة', null, result.error.issues);
    }
  }),
  TelecomController.getTransactions
);

export default telecomRoutes;

