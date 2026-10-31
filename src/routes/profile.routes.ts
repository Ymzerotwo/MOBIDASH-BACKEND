/**
 * ==========================================
 *        OuraDash Profile Routes
 * ==========================================
 * 
 * Defines the routing endpoints for Profile operations.
 */

import { Hono } from 'hono';
import { ProfileController } from '../controllers/profile.controller';
import { AppContext } from '../types';
import { rateLimiter } from '../middleware/rateLimit.middleware';

const profileRoutes = new Hono<AppContext>();

/**
 * GET /api/profile
 * Retrieves the current authenticated user's profile.
 */
profileRoutes.get('/', ProfileController.getProfile);

/**
 * PUT /api/profile
 * Updates the current authenticated user's profile details.
 */
profileRoutes.put('/', ProfileController.updateProfile);

/**
 * POST /api/profile/2fa/setup
 * Generates and dispatches a 6-digit confirmation OTP to verify email before activating 2FA.
 */
profileRoutes.post(
  '/2fa/setup',
  rateLimiter('LOGIN_RECOVERY_LIMITER'),
  ProfileController.setup2fa
);

/**
 * POST /api/profile/2fa/enable
 * Confirms setup OTP and activates 2FA for the user.
 */
profileRoutes.post(
  '/2fa/enable',
  rateLimiter('VERIFY_CODE_LIMITER'),
  ProfileController.enable2fa
);

/**
 * POST /api/profile/2fa/disable
 * Re-authenticates with current password and disables 2FA for the user.
 */
profileRoutes.post(
  '/2fa/disable',
  rateLimiter('LOGIN_RECOVERY_LIMITER'),
  ProfileController.disable2fa
);

export default profileRoutes;
