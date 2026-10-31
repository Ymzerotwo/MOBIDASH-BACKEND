/**
 * ==============================================================================
 * MobiDash Platform - Spare Parts Routes
 * ==============================================================================
 * 
 * Defines RESTful routing endpoints for maintenance workshop spare parts inventory,
 * real-time code verification, manual stock adjustments, and compatible parts lookup.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  createSparePartSchema,
  updateSparePartSchema,
  adjustSparePartStockSchema,
  sparePartFilterSchema,
  checkPartCodeSchema,
} from '../validators/spare_parts.validators';
import { sendResponse } from '../utils/response';
import { SparePartsController } from '../controllers/spare_parts.controller';
import { AppContext } from '../types';
import { requirePermission } from '../middleware/permission';

export const sparePartsRoutes = new Hono<AppContext>();

// Require inventory, maintenance, repairs, or pos permissions (Owners/Admins bypass automatically)
sparePartsRoutes.use('*', requirePermission(['inventory', 'maintenance', 'repairs', 'pos']));

/**
 * GET /api/spare-parts/stats
 * Retrieves aggregated KPIs, capital valuation, stock quantities, and low stock count.
 */
sparePartsRoutes.get('/stats', SparePartsController.getStats);

/**
 * GET /api/spare-parts/check-code
 * Dedicated real-time part code / barcode availability verification endpoint.
 */
sparePartsRoutes.get(
  '/check-code',
  zValidator('query', checkPartCodeSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(
        c,
        400,
        'VALIDATION_ERROR',
        'بيانات فحص كود القطعة غير صالحة',
        null,
        result.error.issues
      );
    }
  }),
  SparePartsController.checkPartCode
);

/**
 * GET /api/spare-parts/compatible/:model
 * Retrieves all spare parts compatible with a specific device model.
 */
sparePartsRoutes.get('/compatible/:model', SparePartsController.getCompatibleParts);

/**
 * GET /api/spare-parts
 * Lists spare parts with pagination, search, category, quality, and stock status filters.
 */
sparePartsRoutes.get(
  '/',
  zValidator('query', sparePartFilterSchema, (result, c) => {
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
  SparePartsController.getSpareParts
);

/**
 * GET /api/spare-parts/:id
 * Retrieves single spare part details by ID.
 */
sparePartsRoutes.get('/:id', SparePartsController.getSparePartById);

/**
 * POST /api/spare-parts
 * Registers a new spare part in the workshop inventory.
 */
sparePartsRoutes.post(
  '/',
  zValidator('json', createSparePartSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(
        c,
        400,
        'VALIDATION_ERROR',
        'بيانات تسجيل قطعة الغيار غير صالحة',
        null,
        result.error.issues
      );
    }
  }),
  SparePartsController.createSparePart
);

/**
 * PUT /api/spare-parts/:id
 * Updates an existing spare part's details, pricing, or stock alert thresholds.
 */
sparePartsRoutes.put(
  '/:id',
  zValidator('json', updateSparePartSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(
        c,
        400,
        'VALIDATION_ERROR',
        'بيانات تعديل قطعة الغيار غير صالحة',
        null,
        result.error.issues
      );
    }
  }),
  SparePartsController.updateSparePart
);

/**
 * POST /api/spare-parts/:id/adjust-stock
 * Manual stock adjustment (damage during repair, purchase, return, adjustment).
 */
sparePartsRoutes.post(
  '/:id/adjust-stock',
  zValidator('json', adjustSparePartStockSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(
        c,
        400,
        'VALIDATION_ERROR',
        'بيانات تسوية الرصيد غير صالحة',
        null,
        result.error.issues
      );
    }
  }),
  SparePartsController.adjustStock
);

/**
 * DELETE /api/spare-parts/:id
 * Safely deletes or archives a spare part from the inventory.
 */
sparePartsRoutes.delete('/:id', SparePartsController.deleteSparePart);

