import { D1Database } from '@cloudflare/workers-types';

export interface TenantContext {
  dashboardId: string;
  profileId: string | null;
  websiteId?: string | null;
}

/**
 * Resolves valid dashboard_id and user_profile.id for database operations in MobiDash.
 * Prevents SQLite Foreign Key constraint failures by verifying foreign key targets
 * exist in Dashboards and user_profile tables before inserting.
 */
export async function resolveTenantContext(
  db: D1Database,
  currentUser: any
): Promise<TenantContext> {
  let dashboardId = currentUser?.dashboard_id;
  let profileId = currentUser?.profile_id;

  // 1. Verify existing dashboardId
  if (dashboardId) {
    const dash = await db
      .prepare('SELECT id, name, slug FROM Dashboards WHERE id = ?')
      .bind(dashboardId)
      .first<{ id: string; name: string; slug: string }>();

    if (!dash) {
      dashboardId = null;
    }
  }

  // 2. Resolve default dashboardId if missing
  if (!dashboardId) {
    try {
      const dash = await db
        .prepare('SELECT id FROM Dashboards ORDER BY is_default DESC, created_at ASC LIMIT 1')
        .first<{ id: string }>();
      dashboardId = dash?.id || null;
    } catch {
      dashboardId = null;
    }
  }

  // 3. Resolve profileId safely against user_profile foreign key
  if (profileId) {
    const validProfile = await db
      .prepare('SELECT id FROM user_profile WHERE id = ?')
      .bind(profileId)
      .first<{ id: string }>();
    if (!validProfile) {
      profileId = null;
    }
  }
  if (!profileId && currentUser?.id) {
    const userProf = await db
      .prepare('SELECT id FROM user_profile WHERE user_id = ? ORDER BY created_at ASC LIMIT 1')
      .bind(currentUser.id)
      .first<{ id: string }>();
    profileId = userProf?.id || null;
  }

  return {
    dashboardId,
    profileId: profileId || null,
    websiteId: null
  };
}
