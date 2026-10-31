/**
 * ==============================================================================
 * MobiDash Platform - Store & System Settings Controller
 * ==============================================================================
 * 
 * Handles incoming HTTP requests for retrieving and updating store & system settings.
 * Enforces strict multi-tenancy by scoping all queries to the authenticated user's dashboard_id.
 */

import { Context } from 'hono';
import { sendResponse } from '../utils/response';
import { AppContext, UpdateStoreSettingsInput } from '../types';
import { SettingsService } from '../services/settings.services';
import { logger } from '../utils/logger';

export const SettingsController = {
  /**
   * Retrieves store & system settings for the active tenant.
   * Accessible to all authenticated dashboard users.
   */
  getSettings: async (c: Context<AppContext>) => {
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    const db = c.env.DB;
    const reqId = c.get('requestId') || 'unknown';

    try {
      const settings = await SettingsService.getSettings(db, user.dashboard_id);
      if (!settings) {
        return sendResponse(c, 404, 'SETTINGS_NOT_FOUND', 'إعدادات المتجر غير موجودة');
      }

      if ('error' in settings && (settings as any).error) {
        const err = settings as any;
        return sendResponse(c, (err.status || 400) as any, err.error, err.message);
      }

      return sendResponse(c, 200, 'SETTINGS_FETCHED', 'تم جلب إعدادات المتجر بنجاح', { settings });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(reqId, `Failed to fetch store settings: ${message}`, error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب إعدادات المتجر', null, message);
    }
  },

  /**
   * Partially updates store & system settings for the active tenant.
   * Restricted to Admin / Owner roles via route RBAC guard.
   * Validated payload extracted via c.req.valid('json' as never).
   */
  updateSettings: async (c: Context<AppContext>) => {
    const user = c.get('user');
    if (!user?.dashboard_id) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'يرجى تسجيل الدخول أولاً');
    }

    const db = c.env.DB;
    const reqId = c.get('requestId') || 'unknown';

    try {
      const body = c.req.valid('json' as never) as UpdateStoreSettingsInput;
      const result = await SettingsService.updateSettings(db, user.dashboard_id, body);

      if ('error' in result && (result as any).error) {
        const err = result as any;
        return sendResponse(c, (err.status || 400) as any, err.error, err.message);
      }

      return sendResponse(c, 200, 'SETTINGS_UPDATED', 'تم تحديث إعدادات المتجر بنجاح', { settings: result });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(reqId, `Failed to update store settings: ${message}`, error);

      const status = (typeof error === 'object' && error !== null && 'status' in error && typeof (error as any).status === 'number')
        ? (error as any).status
        : 500;
      const slug = (typeof error === 'object' && error !== null && 'slug' in error && typeof (error as any).slug === 'string')
        ? (error as any).slug
        : 'INTERNAL_SERVER_ERROR';

      return sendResponse(c, status as any, slug, 'فشل في تحديث إعدادات المتجر', null, message);
    }
  }
};
