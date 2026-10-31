/**
 * ==========================================
 *        MobiDash Team Controller
 * ==========================================
 * 
 * Handles HTTP requests for Store Staff & Permissions management.
 */

import { Context } from 'hono';
import { sendResponse } from '../utils/response';
import { AppContext } from '../types';
import { TeamService } from '../services/team.services';

export const TeamController = {
  /**
   * Fetches a paginated list of team members in the active store.
   */
  getAll: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    try {
      const data = await TeamService.getAll(
        db,
        c.req.query('search') || '',
        c.req.query('page'),
        c.req.query('limit'),
        c.req.query('status') || 'all',
        c.get('user')!
      );
      return sendResponse(c, 200, 'TEAM_FETCHED', 'تم جلب فريق العمل بنجاح', data);
    } catch (error: any) {
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب فريق العمل', null, error.message);
    }
  },

  /**
   * Retrieves aggregated statistics for the store team.
   */
  getStats: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    try {
      const stats = await TeamService.getStats(db, c.get('user')!);
      return sendResponse(c, 200, 'TEAM_STATS_FETCHED', 'تم جلب إحصائيات الفريق بنجاح', { stats });
    } catch (error: any) {
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب إحصائيات الفريق', null, error.message);
    }
  },

  /**
   * Fetches a specific team member's details.
   */
  getById: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    try {
      const result = await TeamService.getById(db, c.req.param('id') as string, c.get('user')!);
      if (result.error) return sendResponse(c, result.status as any, result.error, result.message);
      return sendResponse(c, 200, 'TEAM_MEMBER_FETCHED', 'تم جلب بيانات الموظف بنجاح', result);
    } catch (error: any) {
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في جلب بيانات الموظف', null, error.message);
    }
  },

  /**
   * Adds a new staff member directly to user_profile.
   */
  create: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const body = c.req.valid('json' as never) as any;
    try {
      const result = await TeamService.createMember(db, body, c.get('user')!);
      if ('error' in result && result.error) {
        return sendResponse(c, result.status as any, result.error, result.message);
      }
      return sendResponse(c, 201, 'MEMBER_CREATED', 'تم إضافة الموظف بنجاح', { member: result });
    } catch (error: any) {
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في إضافة الموظف', null, error.message);
    }
  },

  /**
   * Updates an existing team member's profile and page permissions.
   * STRICT OWNER PROTECTION: Rejects modifications to the Owner account.
   */
  update: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const body = c.req.valid('json' as never) as any;
    try {
      const k1 = c.env.K1 || (c.env as any).ouradash_dashboard;
      const result = await TeamService.update(db, k1, c.req.param('id') as string, body, c.get('user')!);
      if (result.error) return sendResponse(c, result.status as any, result.error, result.message);
      return sendResponse(c, 200, 'TEAM_MEMBER_UPDATED', 'تم تحديث بيانات وصلاحيات الموظف بنجاح');
    } catch (error: any) {
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في تحديث بيانات الموظف', null, error.message);
    }
  },

  /**
   * Toggles the active/suspension status of a staff member.
   * STRICT OWNER PROTECTION: Rejects banning or deactivating the Owner account.
   */
  toggleStatus: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    const body = c.req.valid('json' as never) as any;
    try {
      const k1 = c.env.K1 || (c.env as any).ouradash_dashboard;
      const result = await TeamService.toggleStatus(db, k1, c.req.param('id') as string, body, c.get('user')!);
      if (result.error) return sendResponse(c, result.status as any, result.error, result.message);
      return sendResponse(c, 200, 'TEAM_MEMBER_STATUS_UPDATED', 'تم تحديث حالة تفعيل الموظف بنجاح');
    } catch (error: any) {
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في تحديث حالة تفعيل الموظف', null, error.message);
    }
  },

  /**
   * Removes a team member from the store.
   * STRICT OWNER PROTECTION: Rejects deletion of the Owner account.
   */
  delete: async (c: Context<AppContext>) => {
    const db = c.env.DB;
    try {
      const k1 = c.env.K1 || (c.env as any).ouradash_dashboard;
      const result = await TeamService.delete(db, k1, c.req.param('id') as string, c.get('user')!);
      if (result.error) return sendResponse(c, result.status as any, result.error, result.message);
      return sendResponse(c, 200, 'TEAM_MEMBER_DELETED', 'تم حذف حساب الموظف بنجاح');
    } catch (error: any) {
      return sendResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'فشل في حذف حساب الموظف', null, error.message);
    }
  }
};
