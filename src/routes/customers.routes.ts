/**
 * ==============================================================================
 * MobiDash Platform - Customer Credits & Ledger Routes
 * ==============================================================================
 * 
 * Defines routing endpoints for customer debt ledger (دفتر النوتة / الشكك),
 * debt collections, credit limits, account statements, and cash drawer sync.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  createCustomerCreditSchema,
  updateCustomerCreditSchema,
  settleCustomerCreditSchema,
  addCustomerDebtSchema,
  customerFilterSchema,
  customerTransactionFilterSchema,
} from '../validators/customers.validators';
import { sendResponse } from '../utils/response';
import { CustomersController } from '../controllers/customers.controller';
import { AppContext } from '../types';
import { requirePermission } from '../middleware/permission';

const customersRoutes = new Hono<AppContext>();

// Require store customers, pos, or finances permission (Owners/Admins bypass automatically)
customersRoutes.use('*', requirePermission(['customers', 'pos', 'finances']));

/**
 * GET /api/customers/stats
 * Retrieves aggregated analytics, total debt balances, and customer counts.
 */
customersRoutes.get('/stats', CustomersController.getStats);

/**
 * GET /api/customers
 * Lists all customer credit accounts with pagination, search, and due/cleared filters.
 */
customersRoutes.get(
  '/',
  zValidator('query', customerFilterSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(
        c,
        400,
        'VALIDATION_ERROR',
        'معاملات البحث والتصفية غير صالحة',
        null,
        result.error.issues
      );
    }
  }),
  CustomersController.getCustomerCredits
);

/**
 * GET /api/customers/:id
 * Retrieves single customer credit details by ID.
 */
customersRoutes.get('/:id', CustomersController.getCustomerCreditById);

/**
 * GET /api/customers/:id/transactions
 * Retrieves paginated statement / transaction ledger history for a customer.
 */
customersRoutes.get(
  '/:id/transactions',
  zValidator('query', customerTransactionFilterSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(
        c,
        400,
        'VALIDATION_ERROR',
        'معاملات كشف الحساب غير صالحة',
        null,
        result.error.issues
      );
    }
  }),
  CustomersController.getTransactions
);

/**
 * POST /api/customers
 * Registers a new customer in the credit ledger / notebook.
 */
customersRoutes.post(
  '/',
  zValidator('json', createCustomerCreditSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(
        c,
        400,
        'VALIDATION_ERROR',
        'بيانات العميل غير صالحة',
        null,
        result.error.issues
      );
    }
  }),
  CustomersController.createCustomerCredit
);

/**
 * PUT /api/customers/:id
 * Updates customer details (name, phone, notes, status).
 */
customersRoutes.put(
  '/:id',
  zValidator('json', updateCustomerCreditSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(
        c,
        400,
        'VALIDATION_ERROR',
        'بيانات التعديل غير صالحة',
        null,
        result.error.issues
      );
    }
  }),
  CustomersController.updateCustomerCredit
);

/**
 * POST /api/customers/:id/settle
 * Collects a payment / settles debt from a customer with atomic balance deduction and cash drawer sync.
 */
customersRoutes.post(
  '/:id/settle',
  zValidator('json', settleCustomerCreditSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(
        c,
        400,
        'VALIDATION_ERROR',
        'بيانات التحصيل غير صالحة',
        null,
        result.error.issues
      );
    }
  }),
  CustomersController.settleCustomerCredit
);

/**
 * POST /api/customers/:id/debt
 * Adds new debt / product pull to customer ledger.
 */
customersRoutes.post(
  '/:id/debt',
  zValidator('json', addCustomerDebtSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(
        c,
        400,
        'VALIDATION_ERROR',
        'بيانات السحب الآجل غير صالحة',
        null,
        result.error.issues
      );
    }
  }),
  CustomersController.addCustomerDebt
);

/**
 * DELETE /api/customers/:id
 * Deletes or archives a customer account (safe archive if transactions exist, blocked if balance > 0).
 */
customersRoutes.delete('/:id', CustomersController.deleteCustomerCredit);

export default customersRoutes;
