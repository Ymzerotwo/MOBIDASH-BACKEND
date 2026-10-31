/**
 * ==========================================
 *        MobiDash Team Services
 * ==========================================
 * 
 * Business logic layer for managing Store Staff Members and Page Permissions.
 * Fully aligned with unified Users table in 0000_auth.sql.
 * 
 * Security Principles:
 *   - Owner Protection: The Store Owner cannot be deleted, modified, or suspended.
 *   - Granular Permissions: Regular staff access is governed by the permissions JSON field.
 *   - Instant Ban Revocation: Banning a user immediately purges their active session from KV and closes their shift.
 */

import { D1Database, KVNamespace } from '@cloudflare/workers-types';
import { getPaginationOptions, paginateQuery } from '../utils/pagination';
import { escapeLikePattern } from '../utils/sanitize';
import { hashPassword } from '../utils/crypto';
import { logger } from '../utils/logger';

export const TeamService = {
  /**
   * Retrieves summary statistics for team members in the current active store.
   */
  getStats: async (db: D1Database, currentUser: any) => {
    const dashboardId = currentUser.dashboard_id;
    if (!dashboardId) {
      return { stats: { total: 0, active: 0, suspended: 0 } };
    }

    const totalStaff = await db.prepare('SELECT COUNT(*) as c FROM Users WHERE dashboard_id = ?').bind(dashboardId).first('c') || 0;
    const activeStaff = await db.prepare('SELECT COUNT(*) as c FROM Users WHERE dashboard_id = ? AND is_active = 1 AND (is_banned = 0 OR is_banned IS NULL)').bind(dashboardId).first('c') || 0;
    const suspendedStaff = await db.prepare('SELECT COUNT(*) as c FROM Users WHERE dashboard_id = ? AND (is_banned = 1 OR is_active = 0)').bind(dashboardId).first('c') || 0;

    return {
      stats: {
        total: Number(totalStaff),
        active: Number(activeStaff),
        suspended: Number(suspendedStaff),
      }
    };
  },

  /**
   * Retrieves a paginated list of staff members in the current active store.
   */
  getAll: async (db: D1Database, search: string, page: any, limit: any, status: string, currentUser: any) => {
    const dashboardId = currentUser.dashboard_id;
    if (!dashboardId) {
      return { team: [], pagination: { total: 0, page: 1, limit: 25, totalPages: 0 } };
    }

    const paginationOptions = getPaginationOptions(page, limit, 25);

    let query = `
      SELECT 
        p.id,
        p.dashboard_id,
        p.name,
        p.phone,
        p.email,
        p.role,
        p.job_title,
        p.permissions,
        p.salary,
        p.commission_rate,
        p.max_discount_rate,
        p.can_open_drawer,
        p.can_view_cost_price,
        p.is_active,
        p.is_banned,
        p.last_login_at,
        p.created_at,
        p.updated_at
      FROM Users p
    `;

    let countQuery = `
      SELECT COUNT(*) as total
      FROM Users p
    `;

    const params: any[] = [dashboardId];
    const filterClauses: string[] = ['p.dashboard_id = ?'];

    if (search && search.trim()) {
      filterClauses.push(`(p.name LIKE ? ESCAPE '\\' OR p.phone LIKE ? ESCAPE '\\')`);
      const searchPattern = `%${escapeLikePattern(search.trim())}%`;
      params.push(searchPattern, searchPattern);
    }

    if (status === 'active') {
      filterClauses.push('p.is_active = 1 AND (p.is_banned = 0 OR p.is_banned IS NULL)');
    } else if (status === 'banned' || status === 'inactive') {
      filterClauses.push('(p.is_active = 0 OR p.is_banned = 1)');
    }

    const clause = ` WHERE ${filterClauses.join(' AND ')}`;
    query += clause + " ORDER BY CASE WHEN p.role = 'owner' THEN 0 ELSE 1 END, p.name ASC";
    countQuery += clause;

    const paginatedData = await paginateQuery(db, query, countQuery, params, paginationOptions);

    const team = paginatedData.data.map((member: any) => {
      let parsedPermissions: Record<string, boolean> = {};
      if (member.permissions) {
        try {
          parsedPermissions = typeof member.permissions === 'string' ? JSON.parse(member.permissions) : member.permissions;
        } catch {
          parsedPermissions = {};
        }
      }

      return {
        id: member.id,
        dashboard_id: member.dashboard_id,
        name: member.name,
        phone: member.phone || '',
        email: member.email || '',
        role: member.role === 'owner' ? 'owner' : 'user',
        job_title: member.job_title || (member.role === 'owner' ? 'صاحب المحل' : 'موظف'),
        permissions: parsedPermissions,
        salary: Number(member.salary) || 0,
        commission_rate: Number(member.commission_rate) || 0,
        max_discount_rate: Number(member.max_discount_rate) || 0,
        can_open_drawer: Boolean(member.can_open_drawer),
        can_view_cost_price: Boolean(member.can_view_cost_price),
        is_shift_active: false,
        is_active: Boolean(member.is_active),
        is_banned: Boolean(member.is_banned),
        last_login_at: member.last_login_at || null,
        created_at: member.created_at,
        updated_at: member.updated_at,
      };
    });

    return {
      team,
      pagination: paginatedData.pagination,
    };
  },

  /**
   * Retrieves single staff member details by ID.
   */
  getById: async (db: D1Database, id: string, currentUser: any) => {
    const dashboardId = currentUser.dashboard_id;
    if (!dashboardId) {
      return { error: 'NO_DASHBOARD', message: 'معرف المتجر غير متوفر بالجلسة', status: 400 };
    }

    const member = await db.prepare(`
      SELECT 
        p.id,
        p.dashboard_id,
        p.name,
        p.phone,
        p.email,
        p.role,
        p.job_title,
        p.permissions,
        p.salary,
        p.commission_rate,
        p.max_discount_rate,
        p.can_open_drawer,
        p.can_view_cost_price,
        p.is_active,
        p.is_banned,
        p.last_login_at,
        p.created_at,
        p.updated_at
      FROM Users p
      WHERE p.id = ? AND p.dashboard_id = ?
    `).bind(id, dashboardId).first() as any;

    if (!member) {
      return { error: 'USER_NOT_FOUND', message: 'حساب الموظف غير موجود', status: 404 };
    }

    let parsedPermissions: Record<string, boolean> = {};
    if (member.permissions) {
      try {
        parsedPermissions = typeof member.permissions === 'string' ? JSON.parse(member.permissions) : member.permissions;
      } catch {
        parsedPermissions = {};
      }
    }

    return {
      member: {
        ...member,
        role: member.role === 'owner' ? 'owner' : 'user',
        permissions: parsedPermissions,
      }
    };
  },

  /**
   * Adds a new staff member directly to Users.
   */
  createMember: async (db: D1Database, body: any, currentUser: any) => {
    const dashboardId = currentUser.dashboard_id;
    if (!dashboardId) {
      return { error: 'NO_DASHBOARD', message: 'معرف المتجر غير متوفر بالجلسة', status: 400 };
    }

    const cleanPhone = (body.phone || '').trim();
    const cleanName = (body.name || '').trim();

    // Check duplicate phone in the same store if phone is provided
    if (cleanPhone) {
      const existing = await db.prepare(`
        SELECT id FROM Users WHERE dashboard_id = ? AND phone = ?
      `).bind(dashboardId, cleanPhone).first();

      if (existing) {
        return { error: 'PHONE_ALREADY_EXISTS', message: 'رقم الهاتف مسجل بالفعل لموظف آخر بالمتجر', status: 400 };
      }
    }

    // Password is required for login without PIN
    const rawPassword = body.password ? body.password.trim() : (body.pin ? String(body.pin).trim() : '123456');
    const passwordHash = await hashPassword(rawPassword);

    const newId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    // Regular staff are always role: 'user'
    const role = 'user';
    const permissionsJson = JSON.stringify(body.permissions || {});

    await db.prepare(`
      INSERT INTO Users (
        id, dashboard_id, name, phone, email, password_hash, role, job_title,
        permissions, salary, commission_rate, max_discount_rate, can_open_drawer,
        can_view_cost_price, is_active, is_banned, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
    `).bind(
      newId,
      dashboardId,
      cleanName,
      cleanPhone || null,
      body.email ? body.email.trim() : null,
      passwordHash,
      role,
      body.job_title || 'موظف',
      permissionsJson,
      Number(body.salary) || 0,
      Number(body.commission_rate) || 0,
      Number(body.max_discount_rate) || 0,
      body.can_open_drawer === false ? 0 : 1,
      body.can_view_cost_price ? 1 : 0,
      nowIso,
      nowIso
    ).run();

    return {
      id: newId,
      name: cleanName,
      phone: cleanPhone,
      role: 'user',
      job_title: body.job_title || 'موظف',
      permissions: body.permissions || {},
      is_active: true,
      created_at: nowIso,
    };
  },

  /**
   * Updates an existing team member's profile and permissions.
   * STRICT OWNER PROTECTION: Owner profile cannot be modified from the team panel.
   */
  update: async (db: D1Database, k1: KVNamespace, id: string, body: any, currentUser: any) => {
    const dashboardId = currentUser.dashboard_id;
    if (!dashboardId) {
      return { error: 'NO_DASHBOARD', message: 'معرف المتجر غير متوفر', status: 400 };
    }

    const targetProfile = await db.prepare(`
      SELECT id, role, phone FROM Users WHERE id = ? AND dashboard_id = ?
    `).bind(id, dashboardId).first() as any;

    if (!targetProfile) {
      return { error: 'USER_NOT_FOUND', message: 'حساب الموظف غير موجود', status: 404 };
    }

    // CRITICAL: Protect the Owner account
    if (targetProfile.role === 'owner') {
      return { 
        error: 'CANNOT_MODIFY_OWNER', 
        message: 'لا يمكن تعديل حساب مالك المتجر من لوحة تحكم فريق العمل', 
        status: 403 
      };
    }

    // Check phone uniqueness if phone is being changed
    if (body.phone && body.phone.trim() !== targetProfile.phone) {
      const cleanPhone = body.phone.trim();
      const duplicate = await db.prepare(`
        SELECT id FROM Users WHERE dashboard_id = ? AND phone = ? AND id != ?
      `).bind(dashboardId, cleanPhone, id).first();

      if (duplicate) {
        return { error: 'PHONE_ALREADY_EXISTS', message: 'رقم الهاتف مسجل بالفعل لموظف آخر', status: 400 };
      }
    }

    const nowIso = new Date().toISOString();
    let updateQuery = 'UPDATE Users SET updated_at = ?';
    const params: any[] = [nowIso];

    if (body.name !== undefined) {
      updateQuery += ', name = ?';
      params.push(body.name.trim());
    }

    if (body.phone !== undefined) {
      updateQuery += ', phone = ?';
      params.push(body.phone ? body.phone.trim() : null);
    }

    if (body.password && body.password.trim()) {
      const hashed = await hashPassword(body.password.trim());
      updateQuery += ', password_hash = ?';
      params.push(hashed);
    }

    if (body.job_title !== undefined) {
      updateQuery += ', job_title = ?';
      params.push(body.job_title ? body.job_title.trim() : null);
    }

    if (body.permissions !== undefined) {
      updateQuery += ', permissions = ?';
      params.push(JSON.stringify(body.permissions || {}));
    }

    if (body.salary !== undefined) {
      updateQuery += ', salary = ?';
      params.push(Number(body.salary) || 0);
    }

    if (body.commission_rate !== undefined) {
      updateQuery += ', commission_rate = ?';
      params.push(Number(body.commission_rate) || 0);
    }

    if (body.can_open_drawer !== undefined) {
      updateQuery += ', can_open_drawer = ?';
      params.push(body.can_open_drawer ? 1 : 0);
    }

    if (body.can_view_cost_price !== undefined) {
      updateQuery += ', can_view_cost_price = ?';
      params.push(body.can_view_cost_price ? 1 : 0);
    }

    if (body.is_active !== undefined) {
      updateQuery += ', is_active = ?';
      params.push(body.is_active ? 1 : 0);
    }

    updateQuery += ' WHERE id = ? AND dashboard_id = ?';
    params.push(id, dashboardId);

    await db.prepare(updateQuery).bind(...params).run();

    return { success: true };
  },

  /**
   * Toggles the active/suspension status of a staff member.
   * STRICT OWNER PROTECTION: Owner cannot be banned or deactivated.
   * Instant Ban: Purges sessions from KV and closes active shift.
   */
  toggleStatus: async (db: D1Database, k1: KVNamespace, id: string, body: any, currentUser: any) => {
    const dashboardId = currentUser.dashboard_id;
    const targetProfile = await db.prepare(`
      SELECT id, role, is_active, is_banned FROM Users WHERE id = ? AND dashboard_id = ?
    `).bind(id, dashboardId).first() as any;

    if (!targetProfile) {
      return { error: 'USER_NOT_FOUND', message: 'حساب الموظف غير موجود', status: 404 };
    }

    // CRITICAL: Protect the Owner account
    if (targetProfile.role === 'owner') {
      return { 
        error: 'CANNOT_BAN_OWNER', 
        message: 'لا يمكن حظر أو تعطيل حساب مالك المتجر', 
        status: 403 
      };
    }

    const nowIso = new Date().toISOString();
    const isBanned = body.is_banned !== undefined ? (body.is_banned ? 1 : 0) : targetProfile.is_banned;
    const isActive = body.is_active !== undefined ? (body.is_active ? 1 : 0) : (isBanned ? 0 : 1);

    await db.prepare(`
      UPDATE Users 
      SET is_banned = ?, is_active = ?, ban_reason = ?, banned_by = ?, banned_at = ?, updated_at = ?
      WHERE id = ? AND dashboard_id = ?
    `).bind(
      isBanned,
      isActive,
      body.ban_reason || null,
      isBanned ? currentUser.id : null,
      isBanned ? nowIso : null,
      nowIso,
      id,
      dashboardId
    ).run();

    // Instant Ban Revocation: purge sessions from KV and close open shifts
    if (isBanned && k1) {
      const activeSessions = await db.prepare('SELECT id FROM Sessions WHERE user_id = ?').bind(id).all() as any;
      if (activeSessions?.results) {
        for (const s of activeSessions.results) {
          try { await k1.delete(s.id); } catch {}
        }
        await db.prepare('DELETE FROM Sessions WHERE user_id = ?').bind(id).run();
      }
      await db.prepare(`UPDATE shifts SET status = 'closed', end_time = CURRENT_TIMESTAMP WHERE cashier_profile_id = ? AND status = 'active'`).bind(id).run();
    }

    return { success: true };
  },

  /**
   * Deletes a team member's profile from the store.
   * STRICT OWNER PROTECTION: Owner cannot be deleted.
   */
  delete: async (db: D1Database, k1: KVNamespace, id: string, currentUser: any) => {
    const dashboardId = currentUser.dashboard_id;
    const targetProfile = await db.prepare(`
      SELECT id, role FROM Users WHERE id = ? AND dashboard_id = ?
    `).bind(id, dashboardId).first() as any;

    if (!targetProfile) {
      return { error: 'USER_NOT_FOUND', message: 'حساب الموظف غير موجود', status: 404 };
    }

    // Cannot delete yourself
    if (targetProfile.id === currentUser.id) {
      return { error: 'CANNOT_DELETE_SELF', message: 'لا يمكنك حذف حسابك الشخصي النشط', status: 403 };
    }

    // CRITICAL: Protect the Owner account
    if (targetProfile.role === 'owner') {
      return { 
        error: 'CANNOT_DELETE_OWNER', 
        message: 'لا يمكن حذف حساب مالك المتجر نهائياً', 
        status: 403 
      };
    }

    // Invalidate sessions & close open cashier shifts
    if (k1) {
      const activeSessions = await db.prepare('SELECT id FROM Sessions WHERE user_id = ?').bind(id).all() as any;
      if (activeSessions?.results) {
        for (const s of activeSessions.results) {
          try { await k1.delete(s.id); } catch {}
        }
      }
    }
    await db.prepare('DELETE FROM Sessions WHERE user_id = ?').bind(id).run();
    await db.prepare("UPDATE shifts SET status = 'closed', end_time = CURRENT_TIMESTAMP WHERE cashier_profile_id = ? AND status = 'active'").bind(id).run();

    await db.prepare('DELETE FROM Users WHERE id = ? AND dashboard_id = ?').bind(id, dashboardId).run();

    return { success: true };
  }
};
