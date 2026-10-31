/**
 * ==============================================================================
 * MobiDash Platform - Phones & IMEI Inventory Routes
 * ==============================================================================
 * 
 * Defines RESTful routing endpoints for smartphone inventory management,
 * IMEI serial tracking, conditional buyback compliance, reservations, and sales.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  checkImeiSchema,
  createPhoneSchema,
  updatePhoneSchema,
  reservePhoneSchema,
  sellPhoneSchema,
  phoneFilterSchema,
} from '../validators/phones.validators';
import { sendResponse } from '../utils/response';
import { PhonesController } from '../controllers/phones.controller';
import { AppContext } from '../types';
import { requirePermission } from '../middleware/permission';

const phoneRoutes = new Hono<AppContext>();

// Require inventory/phones/pos/sales permission (Owners/Admins bypass automatically)
phoneRoutes.use('*', requirePermission(['inventory', 'phones', 'pos', 'sales']));

/**
 * GET /api/phones/stats
 * Retrieves aggregated KPIs, capital valuation, counts, and sales profits.
 */
phoneRoutes.get('/stats', PhonesController.getStats);

/**
 * GET /api/phones/check-imei
 * Dedicated real-time IMEI availability and uniqueness verification endpoint.
 */
phoneRoutes.get(
  '/check-imei',
  zValidator('query', checkImeiSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(
        c,
        400,
        'VALIDATION_ERROR',
        'بيانات فحص السيريال غير صالحة',
        null,
        result.error.issues
      );
    }
  }),
  PhonesController.checkImei
);

/**
 * GET /api/phones/check-imei/:imei
 * Quick verification check for IMEI availability before form submission (Fallback).
 */
phoneRoutes.get('/check-imei/:imei', PhonesController.checkImei);

/**
 * GET /api/phones
 * Lists phones with tabs filtering, search, and pagination.
 */
phoneRoutes.get(
  '/',
  zValidator('query', phoneFilterSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'معاملات البحث والتصفية غير صالحة', null, result.error.issues);
    }
  }),
  PhonesController.getPhones
);

/**
 * POST /api/phones
 * Registers a new phone with conditional validation (new vs used/like-new).
 */
phoneRoutes.post(
  '/',
  zValidator('json', createPhoneSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'بيانات تسجيل الهاتف غير صالحة', null, result.error.issues);
    }
  }),
  PhonesController.createPhone
);

/**
 * GET /api/phones/:id
 * Retrieves single phone details by ID.
 */
phoneRoutes.get('/:id', PhonesController.getPhoneById);

/**
 * PUT /api/phones/:id
 * Updates phone specifications, pricing, or metadata.
 */
phoneRoutes.put(
  '/:id',
  zValidator('json', updatePhoneSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'بيانات تعديل الهاتف غير صالحة', null, result.error.issues);
    }
  }),
  PhonesController.updatePhone
);

/**
 * DELETE /api/phones/:id
 * Deletes an in-stock phone safely.
 */
phoneRoutes.delete('/:id', PhonesController.deletePhone);

/**
 * POST /api/phones/:id/reserve
 * Reserves a phone with deposit and customer details.
 */
phoneRoutes.post(
  '/:id/reserve',
  zValidator('json', reservePhoneSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'بيانات حجز الجهاز غير صالحة', null, result.error.issues);
    }
  }),
  PhonesController.reservePhone
);

/**
 * POST /api/phones/:id/cancel-reservation
 * Cancels a reservation and restores the phone to in_stock.
 */
phoneRoutes.post('/:id/cancel-reservation', PhonesController.cancelReservation);

/**
 * POST /api/phones/:id/sell
 * Sells a phone, logs the invoice, and updates cash drawer atomically.
 */
phoneRoutes.post(
  '/:id/sell',
  zValidator('json', sellPhoneSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'بيانات عملية البيع غير صالحة', null, result.error.issues);
    }
  }),
  PhonesController.sellPhone
);

export { phoneRoutes };

