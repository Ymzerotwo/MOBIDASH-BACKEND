/**
 * ==========================================
 *        OuraDash Profile Controller
 * ==========================================
 * 
 * Handles HTTP requests for Profile operations.
 */

import { Context } from 'hono';
import { sendResponse } from '../utils/response';
import { AppContext } from '../types';
import { ProfileService } from '../services/profile.services';
import { updateProfileSchema, enable2faSchema, disable2faSchema } from '../validators/profile.validators';
import { logger } from '../utils/logger';

export const ProfileController = {
  /**
   * Handles the Get Profile operation.
   * 
   * @param c - The Hono HTTP context.
   */
  getProfile: async (c: Context<AppContext>) => {
    const user = c.get('user');
    if (!user) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'Not authenticated');
    }

    const db = c.env.DB;
    try {
      const result = await ProfileService.getProfile(db, user.id);
      if (result.error) {
        return sendResponse(c, result.status as any, result.error, result.message);
      }
      return sendResponse(c, 200, 'PROFILE_FETCHED', 'User profile retrieved successfully', { user: result.user });
    } catch (error: any) {
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'Failed to fetch profile', null, error.message);
    }
  },

  /**
   * Handles the Update Profile operation.
   * 
   * @param c - The Hono HTTP context.
   */
  updateProfile: async (c: Context<AppContext>) => {
    const user = c.get('user')!;
    const db = c.env.DB;
    const rawBody = await c.req.json();

    const parsed = updateProfileSchema.safeParse(rawBody);
    if (!parsed.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'Invalid input data', null, parsed.error.issues);
    }
    const body = parsed.data;

    try {
      const result = await ProfileService.updateProfile(db, c.env.STORAGE, c.env.R2_PUBLIC_URL, user, body);
      if (result.error) {
        return sendResponse(c, result.status as any, result.error, result.message);
      }
      return sendResponse(c, 200, 'PROFILE_UPDATED', 'Profile updated successfully');
    } catch (error: any) {
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'Failed to update profile', null, error.message);
    }
  },

  /**
   * Generates and dispatches a 6-digit confirmation code to user's email to verify before enabling 2FA.
   */
  setup2fa: async (c: Context<AppContext>) => {
    const user = c.get('user');
    if (!user) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'Not authenticated');
    }

    const db = c.env.DB;
    try {
      const result = await ProfileService.setup2fa(db, user.id, c.env, c.executionCtx);
      if ('error' in result && result.error) {
        return sendResponse(c, (result.status || 400) as any, result.error as any, result.message);
      }
      return sendResponse(c, 200, 'SETUP_CODE_SENT', result.message || 'Confirmation code sent to your email.');
    } catch (error: any) {
      logger.error('system', `setup2fa error: ${error.message || error}`, error);
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'Failed to send 2FA setup code', null, error.message);
    }
  },

  /**
   * Confirms setup OTP and activates 2FA for the user.
   */
  enable2fa: async (c: Context<AppContext>) => {
    const user = c.get('user');
    if (!user) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'Not authenticated');
    }

    const rawBody = await c.req.json();
    const parsed = enable2faSchema.safeParse(rawBody);
    if (!parsed.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'Invalid input data', null, parsed.error.issues);
    }

    const db = c.env.DB;
    try {
      const result = await ProfileService.enable2fa(db, user.id, parsed.data.code);
      if ('error' in result && result.error) {
        return sendResponse(c, (result.status || 400) as any, result.error as any, result.message);
      }
      return sendResponse(c, 200, '2FA_ENABLED', result.message || 'Two-factor authentication enabled successfully.');
    } catch (error: any) {
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'Failed to enable 2FA', null, error.message);
    }
  },

  /**
   * Verifies current password and disables 2FA for the user.
   */
  disable2fa: async (c: Context<AppContext>) => {
    const user = c.get('user');
    if (!user) {
      return sendResponse(c, 401, 'UNAUTHORIZED', 'Not authenticated');
    }

    const rawBody = await c.req.json();
    const parsed = disable2faSchema.safeParse(rawBody);
    if (!parsed.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'Invalid input data', null, parsed.error.issues);
    }

    const db = c.env.DB;
    try {
      const result = await ProfileService.disable2fa(db, user.id, parsed.data.password);
      if ('error' in result && result.error) {
        return sendResponse(c, (result.status || 400) as any, result.error as any, result.message);
      }
      return sendResponse(c, 200, '2FA_DISABLED', result.message || 'Two-factor authentication disabled successfully.');
    } catch (error: any) {
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'Failed to disable 2FA', null, error.message);
    }
  }
};
