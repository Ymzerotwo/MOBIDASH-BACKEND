/**
 * ==============================================================================
 * MobiDash Platform - Accessories Routes
 * ==============================================================================
 * 
 * Defines routing endpoints for accessories catalog, chargers inventory,
 * stock adjustments, real-time barcode availability verification, and POS lookup.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  checkBarcodeSchema,
  createAccessorySchema,
  updateAccessorySchema,
  adjustStockSchema,
  accessoryFilterSchema,
} from '../validators/accessories.validators';
import { sendResponse } from '../utils/response';
import { AccessoriesController } from '../controllers/accessories.controller';
import { AppContext } from '../types';
import { requirePermission } from '../middleware/permission';

export const accessoriesRoutes = new Hono<AppContext>();

// Require inventory, accessories, pos, or sales permission (Owners/Admins bypass automatically)
accessoriesRoutes.use('*', requirePermission(['inventory', 'accessories', 'pos', 'sales']));

/**
 * GET /api/accessories/check-barcode
 * Dedicated real-time barcode availability verification endpoint.
 */
accessoriesRoutes.get(
  '/check-barcode',
  zValidator('query', checkBarcodeSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(
        c,
        400,
        'VALIDATION_ERROR',
        'بيانات التحقق من الباركود غير صالحة',
        null,
        result.error.issues
      );
    }
  }),
  AccessoriesController.checkBarcode
);

/**
 * GET /api/accessories/barcode/:barcode
 * Fast single accessory lookup by barcode (for POS barcode scanners).
 */
accessoriesRoutes.get('/barcode/:barcode', AccessoriesController.getByBarcode);

/**
 * GET /api/accessories/stats
 * Retrieves aggregated KPIs (counts, quantities, capital valuation, low-stock alerts).
 */
accessoriesRoutes.get('/stats', AccessoriesController.getStats);

/**
 * GET /api/accessories
 * Lists accessories with pagination, search, category, brand, and stock filters.
 */
accessoriesRoutes.get(
  '/',
  zValidator('query', accessoryFilterSchema, (result, c) => {
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
  AccessoriesController.getAccessories
);

/**
 * GET /api/accessories/:id/movements
 * Retrieves stock movements ledger and audit trail for an accessory.
 */
accessoriesRoutes.get('/:id/movements', AccessoriesController.getMovements);

/**
 * GET /api/accessories/:id
 * Retrieves single accessory details by ID.
 */
accessoriesRoutes.get('/:id', AccessoriesController.getAccessoryById);

/**
 * POST /api/accessories
 * Creates a new accessory with opening stock.
 */
accessoriesRoutes.post(
  '/',
  zValidator('json', createAccessorySchema, (result, c) => {
    if (!result.success) {
      return sendResponse(
        c,
        400,
        'VALIDATION_ERROR',
        'البيانات المدخلة لإضافة الإكسسوار غير صالحة',
        null,
        result.error.issues
      );
    }
  }),
  AccessoriesController.createAccessory
);

/**
 * PUT /api/accessories/:id
 * Updates an existing accessory.
 */
accessoriesRoutes.put(
  '/:id',
  zValidator('json', updateAccessorySchema, (result, c) => {
    if (!result.success) {
      return sendResponse(
        c,
        400,
        'VALIDATION_ERROR',
        'بيانات تعديل الإكسسوار غير صالحة',
        null,
        result.error.issues
      );
    }
  }),
  AccessoriesController.updateAccessory
);

/**
 * PATCH /api/accessories/:id/stock
 * Adjusts stock quantity atomically with audit trail (inventory audit / damage / purchase).
 */
accessoriesRoutes.patch(
  '/:id/stock',
  zValidator('json', adjustStockSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(
        c,
        400,
        'VALIDATION_ERROR',
        'بيانات تعديل المخزون غير صالحة',
        null,
        result.error.issues
      );
    }
  }),
  AccessoriesController.adjustStock
);

/**
 * DELETE /api/accessories/:id
 * Safely deletes or archives an accessory.
 */
accessoriesRoutes.delete('/:id', AccessoriesController.deleteAccessory);
