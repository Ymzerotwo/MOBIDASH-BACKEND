/**
 * ==========================================
 *        MobiDash Team Routes
 * ==========================================
 * 
 * Defines routing endpoints for Store Staff & Permissions management.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { 
  createTeamMemberSchema, 
  updateTeamMemberSchema, 
  toggleStatusSchema 
} from '../validators/team.validators';
import { sendResponse } from '../utils/response';
import { TeamController } from '../controllers/team.controller';
import { AppContext } from '../types';
import { requirePermission } from '../middleware/permission';
import { paginationSchema } from '../validators/pagination.validators';

const teamRoutes = new Hono<AppContext>();

// Require 'staff' or 'team' permission for all routes within this file (Owners automatically bypass)
teamRoutes.use('*', requirePermission(['staff', 'team', 'settings.team', 'settings']));

/**
 * GET /api/team
 * Lists all store team members with pagination and search.
 */
teamRoutes.get(
  '/',
  zValidator('query', paginationSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'معاملات البحث غير صالحة', null, result.error.issues);
    }
  }),
  TeamController.getAll
);

/**
 * GET /api/team/stats
 * Retrieves team management statistics.
 */
teamRoutes.get('/stats', TeamController.getStats);

/**
 * POST /api/team
 * Adds a new staff member directly to user_profile.
 */
teamRoutes.post(
  '/',
  zValidator('json', createTeamMemberSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'بيانات الموظف غير صالحة', null, result.error.issues);
    }
  }),
  TeamController.create
);

/**
 * GET /api/team/:id
 * Retrieves details of a specific staff member.
 */
teamRoutes.get('/:id', TeamController.getById);

/**
 * PUT /api/team/:id
 * Updates an existing team member profile and permissions.
 * STRICT OWNER PROTECTION: Rejects modifications to the Owner account.
 */
teamRoutes.put(
  '/:id',
  zValidator('json', updateTeamMemberSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'بيانات التحديث غير صالحة', null, result.error.issues);
    }
  }),
  TeamController.update
);

/**
 * PATCH /api/team/:id/status
 * Toggles a staff member's active/suspension status.
 * STRICT OWNER PROTECTION: Rejects banning or deactivating the Owner account.
 */
teamRoutes.patch(
  '/:id/status',
  zValidator('json', toggleStatusSchema, (result, c) => {
    if (!result.success) {
      return sendResponse(c, 400, 'VALIDATION_ERROR', 'بيانات الحالة غير صالحة', null, result.error.issues);
    }
  }),
  TeamController.toggleStatus
);

/**
 * DELETE /api/team/:id
 * Removes a staff member from the store.
 * STRICT OWNER PROTECTION: Rejects deletion of the Owner account.
 */
teamRoutes.delete('/:id', TeamController.delete);

export default teamRoutes;
