/**
 * ==========================================
 *        OuraDash Notification Services
 * ==========================================
 * 
 * Business logic layer for managing Notification operations.
 * Architecture: Profile-Level & Workspace-Scoped Notifications.
 * 
 * Notifications are strictly scoped to the active workspace member profile
 * (user_profile.id) and dashboard (Dashboards.id).
 */

import { D1Database, KVNamespace } from '@cloudflare/workers-types';
import { getPaginationOptions, paginateQuery } from '../utils/pagination';

export interface PublishNotificationOptions {
  dashboardId?: string | null;
  targetProfileId?: string | null;
  requiredPermission?: string | null;
}

// Service layer handling Database (D1) and Key-Value (KV) interactions for Notifications.
export const NotificationService = {
  
  /**
   * Publishes an operational or customer event notification to relevant profile(s).
   * Automatically resolves active profiles in the target workspace and checks RBAC permissions.
   * 
   * @param db - The D1 Database instance.
   * @param k1 - The KV Namespace instance for State Hash updates.
   * @param type - Notification event type (e.g. 'NEW_INBOX_MESSAGE', 'NEW_COMMENT', 'NEW_BOOKING', 'QUOTA_EXCEEDED').
   * @param targetId - Entity ID related to the notification (e.g., message ID, comment ID, booking ID).
   * @param titleKey - Localization key for the notification title.
   * @param bodyJson - Payload variables for rendering the notification body dynamically.
   * @param url - Deep link URL for clicking the notification in the dashboard.
   * @param roomName - Optional room identifier or routing target.
   * @param options - Additional options including dashboardId, targetProfileId, and requiredPermission.
   */
  publishEvent: async (
    db: D1Database,
    k1: KVNamespace,
    type: string,
    targetId: string | null,
    titleKey: string,
    bodyJson: any,
    url: string | null,
    roomName: string = 'inbox',
    options?: PublishNotificationOptions
  ) => {
    let targetProfiles: Array<{ id: string; user_id: string; dashboard_id: string }> = [];

    const explicitProfileId = options?.targetProfileId || (roomName.startsWith('profile:') ? roomName.replace('profile:', '') : null);
    const explicitDashboardId = options?.dashboardId || null;
    const requiredPermission = options?.requiredPermission || (
      roomName === 'inbox' ? 'inbox' :
      roomName.startsWith('cms.') ? roomName.replace('cms.', '') :
      null
    );

    // 1. Resolve Target Profiles based on Profile ID, Dashboard ID, or User ID
    if (explicitProfileId) {
      const profile = await db.prepare(
        'SELECT id, user_id, dashboard_id FROM user_profile WHERE id = ? AND is_banned = 0'
      ).bind(explicitProfileId).first<{ id: string; user_id: string; dashboard_id: string }>();

      if (profile) {
        targetProfiles.push(profile);
      }
    } else if (explicitDashboardId) {
      // Scoped to a specific workspace/dashboard
      const profilesResult = await db.prepare(
        'SELECT id, user_id, dashboard_id, role, permissions FROM user_profile WHERE dashboard_id = ? AND is_banned = 0'
      ).bind(explicitDashboardId).all<{ id: string; user_id: string; dashboard_id: string; role: string; permissions: string | null }>();

      for (const p of profilesResult.results) {
        // Owner and Admin receive all workspace operational notifications
        if (p.role === 'Owner' || p.role === 'Admin') {
          targetProfiles.push({ id: p.id, user_id: p.user_id, dashboard_id: p.dashboard_id });
        } else if (p.role === 'User' && requiredPermission) {
          // Check granular permissions for User role
          let perms: any = {};
          if (p.permissions) {
            try { perms = typeof p.permissions === 'string' ? JSON.parse(p.permissions) : p.permissions; } catch {}
          }
          if (perms[requiredPermission] === true || (perms.cms && perms.cms[requiredPermission] === true)) {
            targetProfiles.push({ id: p.id, user_id: p.user_id, dashboard_id: p.dashboard_id });
          }
        } else if (p.role === 'User' && !requiredPermission) {
          targetProfiles.push({ id: p.id, user_id: p.user_id, dashboard_id: p.dashboard_id });
        }
      }
    } else if (roomName.startsWith('user:')) {
      // Target all active profiles of a specific user
      const targetUserId = roomName.replace('user:', '');
      const profilesResult = await db.prepare(
        'SELECT id, user_id, dashboard_id FROM user_profile WHERE user_id = ? AND is_banned = 0'
      ).bind(targetUserId).all<{ id: string; user_id: string; dashboard_id: string }>();

      for (const p of profilesResult.results) {
        targetProfiles.push(p);
      }
    } else {
      // Global fallback (roomName without dashboardId): broadcast to active staff across matching permissions
      const profilesResult = await db.prepare(
        'SELECT id, user_id, dashboard_id, role, permissions FROM user_profile WHERE is_banned = 0'
      ).all<{ id: string; user_id: string; dashboard_id: string; role: string; permissions: string | null }>();

      for (const p of profilesResult.results) {
        if (p.role === 'Owner' || p.role === 'Admin') {
          targetProfiles.push({ id: p.id, user_id: p.user_id, dashboard_id: p.dashboard_id });
        } else if (p.role === 'User' && requiredPermission) {
          let perms: any = {};
          if (p.permissions) {
            try { perms = typeof p.permissions === 'string' ? JSON.parse(p.permissions) : p.permissions; } catch {}
          }
          if (perms[requiredPermission] === true || (perms.cms && perms.cms[requiredPermission] === true)) {
            targetProfiles.push({ id: p.id, user_id: p.user_id, dashboard_id: p.dashboard_id });
          }
        }
      }
    }

    if (targetProfiles.length === 0) return;

    // Remove duplicates based on profile.id
    const uniqueProfilesMap = new Map<string, { id: string; user_id: string; dashboard_id: string }>();
    for (const p of targetProfiles) {
      uniqueProfilesMap.set(p.id, p);
    }
    const finalProfiles = Array.from(uniqueProfilesMap.values());

    const nowIso = new Date().toISOString();

    // 2. Prepare atomic batch insert into Notifications (profile_id, dashboard_id)
    const stmt = db.prepare(`
      INSERT INTO Notifications (id, profile_id, dashboard_id, type, target_id, message_title, message_body, url, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `);

    const batchStmts = finalProfiles.map(p => {
      const notifId = crypto.randomUUID();
      return stmt.bind(notifId, p.id, p.dashboard_id || explicitDashboardId || null, type, targetId, titleKey, JSON.stringify(bodyJson), url, nowIso);
    });

    // Cloudflare D1 batch execution in chunks of 100
    const D1_BATCH_SIZE = 100;
    for (let i = 0; i < batchStmts.length; i += D1_BATCH_SIZE) {
      await db.batch(batchStmts.slice(i, i + D1_BATCH_SIZE));
    }

    // 3. Update notifications_version in KV for both profile_id and user_id
    if (k1) {
      const keysToBump = new Set<string>();
      for (const p of finalProfiles) {
        keysToBump.add(`state_version:${p.id}`);
        if (p.user_id) {
          keysToBump.add(`state_version:${p.user_id}`);
        }
      }

      const keysArray = Array.from(keysToBump);
      const KV_CHUNK_SIZE = 20;
      for (let i = 0; i < keysArray.length; i += KV_CHUNK_SIZE) {
        const chunk = keysArray.slice(i, i + KV_CHUNK_SIZE);
        await Promise.all(chunk.map(async (key) => {
          try {
            let state: any = {};
            const existingState = await k1.get(key);
            if (existingState) {
              try { state = JSON.parse(existingState); } catch {}
            }
            state.notifications_version = 'v' + crypto.randomUUID().slice(0, 8);
            await k1.put(key, JSON.stringify(state));
          } catch {}
        }));
      }
    }
  },

  /**
   * Fetch paginated notifications for the active workspace profile.
   * 
   * @param db - The D1 Database instance.
   * @param profileId - The active member profile ID.
   * @param page - Page number.
   * @param limit - Page size.
   * @param dashboardId - Optional dashboard workspace scope.
   */
  getNotifications: async (db: D1Database, profileId: string, page: any, limit: any, dashboardId?: string) => {
    const paginationOptions = getPaginationOptions(page, limit, 20);

    let query = `
      SELECT id, profile_id, dashboard_id, type, target_id, message_title, message_body, url, is_read, created_at 
      FROM Notifications 
      WHERE profile_id = ?
    `;
    let countQuery = `
      SELECT COUNT(*) as total 
      FROM Notifications 
      WHERE profile_id = ?
    `;
    const params: any[] = [profileId];

    if (dashboardId) {
      query += ' AND dashboard_id = ?';
      countQuery += ' AND dashboard_id = ?';
      params.push(dashboardId);
    }

    query += ' ORDER BY created_at DESC';

    const paginatedData = await paginateQuery(db, query, countQuery, params, paginationOptions, params);
    
    const notifications = paginatedData.data.map((row: any) => {
      if (row.message_body && typeof row.message_body === 'string') {
        try { row.message_body = JSON.parse(row.message_body); } catch {}
      }
      return row;
    });

    return { notifications, pagination: paginatedData.pagination };
  },

  /**
   * Mark a specific notification as read and bump the KV hash to update frontend badge states.
   * 
   * @param db - The D1 Database instance.
   * @param k1 - The KV Namespace instance.
   * @param profileId - The active member profile ID.
   * @param notificationId - The notification UUID.
   */
  markAsRead: async (db: D1Database, k1: KVNamespace, profileId: string, notificationId: string) => {
    const result = await db.prepare(
      'UPDATE Notifications SET is_read = 1 WHERE id = ? AND profile_id = ?'
    ).bind(notificationId, profileId).run();

    if (result.meta.changes && result.meta.changes > 0 && k1) {
      await NotificationService.bumpNotificationHash(k1, profileId);
    }
    return { success: true };
  },

  /**
   * Mark all unread notifications as read simultaneously for the active profile.
   * 
   * @param db - The D1 Database instance.
   * @param k1 - The KV Namespace instance.
   * @param profileId - The active member profile ID.
   * @param dashboardId - Optional dashboard workspace scope.
   */
  markAllAsRead: async (db: D1Database, k1: KVNamespace, profileId: string, dashboardId?: string) => {
    let query = 'UPDATE Notifications SET is_read = 1 WHERE profile_id = ? AND is_read = 0';
    const params: any[] = [profileId];

    if (dashboardId) {
      query += ' AND dashboard_id = ?';
      params.push(dashboardId);
    }

    const result = await db.prepare(query).bind(...params).run();

    if (result.meta.changes && result.meta.changes > 0 && k1) {
      await NotificationService.bumpNotificationHash(k1, profileId);
    }
    return { success: true };
  },

  /**
   * Helper utility to bump the 'notifications_version' in the Meta-Cache (KV).
   * Notifies connected frontends that unread counts have changed, instantly updating badges.
   * 
   * @param k1 - The KV Namespace instance.
   * @param targetId - The target profile_id or user_id.
   */
  bumpNotificationHash: async (k1: KVNamespace, targetId: string) => {
    if (!k1 || !targetId) return;
    const stateKey = `state_version:${targetId}`;
    let state: any = {};
    const existingState = await k1.get(stateKey);
    if (existingState) {
      try { state = JSON.parse(existingState); } catch {}
    }
    
    state.notifications_version = 'v' + crypto.randomUUID().slice(0, 8);
    await k1.put(stateKey, JSON.stringify(state));
  }
};
