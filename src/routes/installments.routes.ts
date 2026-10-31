/**
 * ==============================================================================
 * MobiDash Platform - Phone Installments Routes
 * ==============================================================================
 * 
 * Defines routing endpoints for phone installment contracts,
 * monthly payments, overdue alerts, contract completion, and cash drawer sync.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  createInstallmentSchema,
  updateInstallmentSchema,
  payInstallmentSchema,
  installmentFilterSchema,
} from '../validators/installments.validators';
import { sendResponse } from '../utils/response';
import { InstallmentsController } from '../controllers/installments.controller';
import { AppContext } from '../types';
import { requirePermission } from '../middleware/permission';

const installmentsRoutes = new Hono<AppContext>();

// Require store customers, phones, pos, or finances permission (Owners/Admins bypass automatically)
installmentsRoutes.use('*', requirePermission(['customers', 'phones', 'pos', 'finances']));

/**
 * GET /api/installments/stats
 * Retrieves aggregated analytics, total financed capital, and installment contract counts.
 */
installmentsRoutes.get('/stats', InstallmentsController.getStats);

/**
 * GET /api/installments
 * Lists all installment contracts with pagination, search, and status filters.
 */
installmentsRoutes.get(
  '/',
  zValidator('query', installmentFilterSchema, (result, c) => {
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
  InstallmentsController.getInstallments
);

/**
 * GET /api/installments/:id
 * Retrieves single installment contract details by ID.
 */
installmentsRoutes.get('/:id', InstallmentsController.getInstallmentById);

/**
 * GET /api/installments/:id/payments
 * Retrieves paginated payment history for a specific installment contract.
 */
installmentsRoutes.get('/:id/payments', InstallmentsController.getPayments);

/**
 * POST /api/installments
 * Creates and registers a new phone installment contract.
 */
installmentsRoutes.post(
  '/',
  zValidator('json', createInstallmentSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(
        c,
        400,
        'VALIDATION_ERROR',
        'بيانات عقد التقسيط غير صالحة',
        null,
        result.error.issues
      );
    }
  }),
  InstallmentsController.createInstallment
);

/**
 * PUT /api/installments/:id
 * Updates installment contract details (guarantor, notes, due date, status).
 */
installmentsRoutes.put(
  '/:id',
  zValidator('json', updateInstallmentSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(
        c,
        400,
        'VALIDATION_ERROR',
        'بيانات تعديل العقد غير صالحة',
        null,
        result.error.issues
      );
    }
  }),
  InstallmentsController.updateInstallment
);

/**
 * POST /api/installments/:id/pay
 * Records a monthly installment payment with auto-advancing due date and cash drawer sync.
 */
installmentsRoutes.post(
  '/:id/pay',
  zValidator('json', payInstallmentSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(
        c,
        400,
        'VALIDATION_ERROR',
        'بيانات سداد القسط غير صالحة',
        null,
        result.error.issues
      );
    }
  }),
  InstallmentsController.payInstallment
);

/**
 * DELETE /api/installments/:id
 * Deletes or cancels an installment contract.
 */
installmentsRoutes.delete('/:id', InstallmentsController.deleteInstallment);

export default installmentsRoutes;
