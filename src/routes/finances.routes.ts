/**
 * ==============================================================================
 * MobiDash Platform - Finances & General Ledger Routes
 * Location: backend/src/routes/finances.routes.ts
 * ==============================================================================
 * 
 * Routing endpoints for store finances, daily ledger movements, and petty expenses:
 * - GET /api/finances/movements
 * - GET /api/finances/stats
 * - POST /api/finances/expense
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  createExpenseSchema,
  createCashInSchema,
  financesMovementsQuerySchema,
} from '../validators/finances.validators';
import { sendResponse } from '../utils/response';
import { FinancesController } from '../controllers/finances.controller';
import { AppContext } from '../types';
import { requirePermission } from '../middleware/permission';

export const financesRoutes = new Hono<AppContext>();

// Finances access permission requirement (Admins and Owners bypass automatically)
financesRoutes.use('*', requirePermission(['pos', 'cashier']));

/**
 * GET /api/finances/movements
 * Retrieves paginated audit trail of all financial movements with multi-filters.
 */
financesRoutes.get(
  '/movements',
  zValidator('query', financesMovementsQuerySchema, (result, c) => {
    if (!result.success) {
      return sendResponse(
        c,
        400,
        'VALIDATION_ERROR',
        'معاملات تصفية الحركات المالية غير صالحة',
        null,
        result.error.issues
      );
    }
  }),
  FinancesController.getMovements
);

/**
 * GET /api/finances/stats
 * Retrieves today's sales, cash collections, expenses, and drawer totals.
 */
financesRoutes.get('/stats', FinancesController.getStats);

/**
 * POST /api/finances/expense
 * Records a petty expense and deducts cash directly from the cash drawer.
 */
financesRoutes.post(
  '/expense',
  zValidator('json', createExpenseSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(
        c,
        400,
        'VALIDATION_ERROR',
        'بيانات المصروف النثري غير صالحة',
        null,
        result.error.issues
      );
    }
  }),
  FinancesController.recordExpense
);

/**
 * POST /api/finances/cash-in
 * Records a cash injection into the drawer and increases active shift drawer cash.
 */
financesRoutes.post(
  '/cash-in',
  zValidator('json', createCashInSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(
        c,
        400,
        'VALIDATION_ERROR',
        'بيانات إيداع النقدية غير صالحة',
        null,
        result.error.issues
      );
    }
  }),
  FinancesController.recordCashIn
);
