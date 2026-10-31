/**
 * ==============================================================================
 * MobiDash Platform - Suppliers Routes
 * ==============================================================================
 * 
 * Defines routing endpoints for suppliers directory, wholesale accounts,
 * debt settlement, statements, and vendor bookkeeping.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  createSupplierSchema,
  updateSupplierSchema,
  paySupplierSchema,
  supplierFilterSchema,
} from '../validators/suppliers.validators';
import { sendResponse } from '../utils/response';
import { SuppliersController } from '../controllers/suppliers.controller';
import { AppContext } from '../types';
import { requirePermission } from '../middleware/permission';

const suppliersRoutes = new Hono<AppContext>();

// Require store suppliers, inventory or pos permission (Owners/Admins bypass automatically)
suppliersRoutes.use('*', requirePermission(['suppliers', 'inventory', 'pos']));

/**
 * GET /api/suppliers/stats
 * Retrieves aggregated analytics, debt volumes, and supplier counts.
 */
suppliersRoutes.get('/stats', SuppliersController.getStats);

/**
 * GET /api/suppliers
 * Lists all suppliers with pagination, search, and category/balance filters.
 */
suppliersRoutes.get(
  '/',
  zValidator('query', supplierFilterSchema, (result, c) => {
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
  SuppliersController.getSuppliers
);

/**
 * GET /api/suppliers/:id
 * Retrieves single supplier details by ID.
 */
suppliersRoutes.get('/:id', SuppliersController.getSupplierById);

/**
 * GET /api/suppliers/:id/transactions
 * Retrieves paginated statement / ledger history for a specific supplier.
 */
suppliersRoutes.get('/:id/transactions', SuppliersController.getTransactions);

/**
 * POST /api/suppliers
 * Registers a new supplier or distributor.
 */
suppliersRoutes.post(
  '/',
  zValidator('json', createSupplierSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(
        c,
        400,
        'VALIDATION_ERROR',
        'بيانات المورد غير صالحة',
        null,
        result.error.issues
      );
    }
  }),
  SuppliersController.createSupplier
);

/**
 * POST /api/suppliers/:id/pay
 * Records a debt payment to a supplier with atomic balance deduction and cash drawer sync.
 */
suppliersRoutes.post(
  '/:id/pay',
  zValidator('json', paySupplierSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(
        c,
        400,
        'VALIDATION_ERROR',
        'بيانات السداد غير صالحة',
        null,
        result.error.issues
      );
    }
  }),
  SuppliersController.paySupplier
);

/**
 * PUT /api/suppliers/:id
 * Updates an existing supplier's details.
 */
suppliersRoutes.put(
  '/:id',
  zValidator('json', updateSupplierSchema, (result, c) => {
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
  SuppliersController.updateSupplier
);

/**
 * DELETE /api/suppliers/:id
 * Deletes or archives a supplier. Supports ?force=true.
 */
suppliersRoutes.delete('/:id', SuppliersController.deleteSupplier);

export default suppliersRoutes;
