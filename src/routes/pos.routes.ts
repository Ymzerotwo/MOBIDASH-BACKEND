/**
 * ==============================================================================
 * MobiDash Platform - POS Catalog Routes
 * Location: backend/src/routes/pos.routes.ts
 * ==============================================================================
 * 
 * Routing endpoints for Point of Sale item catalog and fast cash desk retrieval:
 * - GET /api/pos/accessories
 * - GET /api/pos/phones
 * - GET /api/pos/spare-parts
 * - GET /api/pos/telecom
 * 
 * Security:
 * - Protected by requirePermission(['pos', 'cashier']) allowing store cashiers and POS operators
 *   to access sellable items without requiring broad administrative/inventory privileges.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  posAccessoriesQuerySchema,
  posPhonesQuerySchema,
  posSparePartsQuerySchema,
  posTelecomQuerySchema,
} from '../validators/pos.validators';
import {
  posCheckoutSchema,
  posMovementsQuerySchema,
} from '../validators/pos_checkout.validators';
import { sendResponse } from '../utils/response';
import { PosController } from '../controllers/pos.controller';
import { AppContext } from '../types';
import { requirePermission } from '../middleware/permission';

export const posRoutes = new Hono<AppContext>();

// Dedicated POS and Cashier permission requirement (Owners and Admins bypass automatically)
posRoutes.use('*', requirePermission(['pos', 'cashier']));

/**
 * GET /api/pos/accessories
 * Retrieves sellable accessories with category filter, search, and pagination.
 */
posRoutes.get(
  '/accessories',
  zValidator('query', posAccessoriesQuerySchema, (result, c) => {
    if (!result.success) {
      return sendResponse(
        c,
        400,
        'VALIDATION_ERROR',
        'معاملات البحث عن الإكسسوارات لنقطة البيع غير صالحة',
        null,
        result.error.issues
      );
    }
  }),
  PosController.getAccessoriesForPos
);

/**
 * GET /api/pos/phones
 * Retrieves sellable phones currently in stock with brand/condition filters and pagination.
 */
posRoutes.get(
  '/phones',
  zValidator('query', posPhonesQuerySchema, (result, c) => {
    if (!result.success) {
      return sendResponse(
        c,
        400,
        'VALIDATION_ERROR',
        'معاملات البحث عن الهواتف لنقطة البيع غير صالحة',
        null,
        result.error.issues
      );
    }
  }),
  PosController.getPhonesForPos
);

/**
 * GET /api/pos/spare-parts
 * Retrieves sellable spare parts in stock with category filter, search, and pagination.
 */
posRoutes.get(
  '/spare-parts',
  zValidator('query', posSparePartsQuerySchema, (result, c) => {
    if (!result.success) {
      return sendResponse(
        c,
        400,
        'VALIDATION_ERROR',
        'معاملات البحث عن قطع الغيار لنقطة البيع غير صالحة',
        null,
        result.error.issues
      );
    }
  }),
  PosController.getSparePartsForPos
);

/**
 * GET /api/pos/telecom
 * Retrieves active payment terminals and wallets with real-time balance queries.
 */
posRoutes.get(
  '/telecom',
  zValidator('query', posTelecomQuerySchema, (result, c) => {
    if (!result.success) {
      return sendResponse(
        c,
        400,
        'VALIDATION_ERROR',
        'معاملات البحث عن ماكينات الدفع والمحافظ غير صالحة',
        null,
        result.error.issues
      );
    }
  }),
  PosController.getTelecomForPos
);

/**
 * POST /api/pos/checkout
 * Processes full shopping cart checkout atomically and updates stock/finances/shift.
 */
posRoutes.post(
  '/checkout',
  zValidator('json', posCheckoutSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(
        c,
        400,
        'VALIDATION_ERROR',
        'بيانات عملية البيع غير صالحة، يرجى مراجعة العناصر وطريقة الدفع',
        null,
        result.error.issues
      );
    }
  }),
  PosController.checkout
);

/**
 * GET /api/pos/movements
 * Retrieves paginated audit trail of all financial movements with multi-filters.
 */
posRoutes.get(
  '/movements',
  zValidator('query', posMovementsQuerySchema, (result, c) => {
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
  PosController.getMovements
);

/**
 * GET /api/pos/stats
 * Retrieves today's sales revenue, profit KPIs, payment breakdown, and counts.
 */
posRoutes.get('/stats', PosController.getSalesStats);

