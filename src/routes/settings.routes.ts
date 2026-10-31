/**
 * ==============================================================================
 * MobiDash Platform - Store & System Settings Routes
 * ==============================================================================
 * 
 * Defines routing endpoints for Store & System Settings:
 * - GET  /api/settings: Open to all authenticated dashboard users
 * - PATCH /api/settings: Restricted to Admin/Owner, validated via Zod schema
 */

import { Hono, Context, Next } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { AppContext } from '../types';
import { updateStoreSettingsSchema } from '../validators/settings.validators';
import { SettingsController } from '../controllers/settings.controller';
import { sendResponse } from '../utils/response';

const settingsRoutes = new Hono<AppContext>();

/**
 * RBAC Guard Middleware: requireAdminOrOwner
 * Restricts route modification exclusively to Store Owners and Admins.
 * Rejects non-admin users (e.g. cashier/staff with role 'user') with 403 Forbidden.
 */
export const requireAdminOrOwner = async (c: Context<AppContext>, next: Next) => {
  const user = c.get('user');
  const role = user?.role?.toLowerCase();
  if (!user || (role !== 'owner' && role !== 'admin')) {
    return sendResponse(
      c,
      403,
      'FORBIDDEN',
      'هذا الإجراء محصور بمسؤولي المتجر ولوحة التحكم فقط (Admin / Owner)'
    );
  }
  await next();
};

/**
 * GET /api/settings
 * Retrieves store & system settings for the active tenant.
 * Accessible to all authenticated store staff (no role restriction).
 */
settingsRoutes.get('/', SettingsController.getSettings);

/**
 * PATCH /api/settings
 * Partially updates store & system settings for the active tenant.
 * Pipeline:
 * 1. requireAdminOrOwner -> 403 FORBIDDEN if not Owner/Admin
 * 2. zValidator -> 400 VALIDATION_ERROR if invalid payload
 * 3. SettingsController.updateSettings -> 200 SETTINGS_UPDATED
 */
settingsRoutes.patch(
  '/',
  requireAdminOrOwner,
  zValidator('json', updateStoreSettingsSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(
        c,
        400,
        'VALIDATION_ERROR',
        'البيانات المدخلة غير صالحة',
        null,
        result.error.issues
      );
    }
  }),
  SettingsController.updateSettings
);

export default settingsRoutes;
