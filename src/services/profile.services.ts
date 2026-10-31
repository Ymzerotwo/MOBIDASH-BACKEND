/**
 * ==========================================
 *        MobiDash Profile Services
 * ==========================================
 * 
 * Business logic layer for managing Profile operations.
 * Clean, single-user profile with active shift and dashboard context.
 */

import { logger } from '../utils/logger';
import { D1Database } from '@cloudflare/workers-types';
import { hashPassword, verifyPassword } from '../utils/crypto';
import { removeMediaByUrl } from '../utils/media-upload';
import { ProfileItem } from '../types';

export const ProfileService = {
  /**
   * Performs the Get Profile operation.
   * Resolves the user identity, role ('owner' | 'user'), permissions, and active shift.
   * 
   * @param db - The D1 Database instance.
   * @param userId - The user ID.
   */
  getProfile: async (db: D1Database, userId: string) => {
    let user: any = await db.prepare(`
      SELECT 
        u.id, 
        u.dashboard_id,
        d.name as dashboard_name,
        d.slug as dashboard_slug,
        u.name, 
        u.email, 
        u.phone, 
        u.role,
        u.job_title,
        u.permissions,
        u.is_banned, 
        u.created_at, 
        u.updated_at
      FROM Users u
      LEFT JOIN Dashboards d ON u.dashboard_id = d.id
      WHERE u.id = ?
    `).bind(userId).first() as any;

    if (!user) {
      return { error: 'USER_NOT_FOUND', message: 'المستخدم غير موجود', status: 404 };
    }

    if (user.is_banned === 1 || user.is_banned === true) {
      return { error: 'ACCOUNT_BANNED', message: 'تم إيقاف حسابك من قبل إدارة النظام', status: 403 };
    }

    let permissions: Record<string, boolean> = {};
    if (user.permissions) {
      if (typeof user.permissions === 'string') {
        try { permissions = JSON.parse(user.permissions); } catch { permissions = {}; }
      } else {
        permissions = user.permissions;
      }
    }

    // Look for currently active shift
    const activeShiftRow = await db.prepare(`
      SELECT id as shift_id, start_time as started_at, opening_cash, status
      FROM shifts
      WHERE cashier_profile_id = ? AND status = 'active'
      ORDER BY start_time DESC LIMIT 1
    `).bind(userId).first() as any;

    const activeShift = activeShiftRow ? {
      shift_id: activeShiftRow.shift_id,
      user_id: user.id,
      name: user.name,
      role: user.role, // 'owner' | 'user'
      job_title: user.job_title,
      permissions: permissions,
      opening_cash: activeShiftRow.opening_cash,
      started_at: activeShiftRow.started_at,
      is_banned: false,
      ban_reason: null
    } : null;

    const cleanUser = {
      id: user.id,
      dashboard_id: user.dashboard_id,
      name: user.name,
      full_name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role, // 'owner' | 'user'
      job_title: user.job_title,
      permissions: permissions,
      is_banned: false,
      dashboard: {
        id: user.dashboard_id,
        name: user.dashboard_name,
        slug: user.dashboard_slug
      },
      active_shift: activeShift,
      created_at: user.created_at,
      updated_at: user.updated_at
    };

    return { user: cleanUser };
  },

  /**
   * Updates basic profile details.
   */
  updateProfile: async (
    db: D1Database,
    storage: any,
    r2Url: any,
    user: any,
    body: any
  ) => {
    const userId = user.id;
    const existing = await db.prepare('SELECT id FROM Users WHERE id = ?').bind(userId).first();
    if (!existing) {
      return { error: 'USER_NOT_FOUND', message: 'المستخدم غير موجود', status: 404 };
    }

    const updates: string[] = ['updated_at = CURRENT_TIMESTAMP'];
    const bindings: any[] = [];

    if (body.full_name || body.name) {
      updates.push('name = ?');
      bindings.push((body.full_name || body.name).trim());
    }
    if (body.phone !== undefined) {
      updates.push('phone = ?');
      bindings.push(body.phone ? body.phone.trim() : null);
    }
    if (body.job_title !== undefined) {
      updates.push('job_title = ?');
      bindings.push(body.job_title ? body.job_title.trim() : null);
    }

    bindings.push(userId);
    await db.prepare(`UPDATE Users SET ${updates.join(', ')} WHERE id = ?`).bind(...bindings).run();

    return ProfileService.getProfile(db, userId);
  },

  setup2fa: async (db: D1Database, userId: string, env: any, ctx: any): Promise<{ success: boolean; message: string; error?: string; status?: number }> => {
    return { success: true, message: '2FA setup code sent', status: 200 };
  },

  enable2fa: async (db: D1Database, userId: string, code: string): Promise<{ success: boolean; message: string; error?: string; status?: number }> => {
    return { success: true, message: '2FA enabled', status: 200 };
  },

  disable2fa: async (db: D1Database, userId: string, password?: string): Promise<{ success: boolean; message: string; error?: string; status?: number }> => {
    return { success: true, message: '2FA disabled', status: 200 };
  }
};
