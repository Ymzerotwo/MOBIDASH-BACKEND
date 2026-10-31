import { D1Database, KVNamespace } from '@cloudflare/workers-types';
import { hashPassword } from '../utils/crypto';
import { RegisterWithInviteInput } from '../types';

/**
 * ==============================================================================
 * MobiDash Backend: Merchant Invitations Service
 * Location: backend/src/services/invitations.services.ts
 * Description: التحقق من أكواد دعوة التجار وإتمام تسجيل حسابات المتاجر الجديدة
 * ==============================================================================
 */

export const InvitationsService = {
  /**
   * فحص والتحقق من صلاحية كود الدعوة
   */
  async verifyInviteCode(db: D1Database, code: string) {
    const cleanCode = code.trim().toUpperCase();

    const record = await db
      .prepare(`
        SELECT id, code, status, note, expires_at, used_at, created_at
        FROM merchant_invitations
        WHERE UPPER(code) = ?
      `)
      .bind(cleanCode)
      .first<any>();

    if (!record) {
      return {
        error: 'INVITATION_NOT_FOUND',
        status: 404,
        message: 'كود الدعوة غير موجود، يرجى التأكد من كتابة الكود بدقة',
      };
    }

    if (record.status === 'used') {
      return {
        error: 'INVITATION_ALREADY_USED',
        status: 400,
        message: 'عذراً، كود الدعوة هذا تم استخدامه مسبقاً في إنشاء متجر آخر',
      };
    }

    if (record.status === 'revoked') {
      return {
        error: 'INVITATION_REVOKED',
        status: 400,
        message: 'تم إلغاء أو تعطيل كود الدعوة هذا',
      };
    }

    if (record.expires_at) {
      const expiresAt = new Date(record.expires_at).getTime();
      if (!isNaN(expiresAt) && expiresAt < Date.now()) {
        return {
          error: 'INVITATION_EXPIRED',
          status: 400,
          message: 'انتهت صلاحية كود الدعوة هذا',
        };
      }
    }

    return {
      success: true,
      valid: true,
      code: record.code,
      note: record.note,
      expires_at: record.expires_at,
      message: 'كود الدعوة صالح ومتاح للاستخدام',
    };
  },

  /**
   * إتمام تسجيل التاجر والمتجر الجديد باستخدام كود الدعوة (معاملة ذرية)
   */
  async registerWithInvite(
    db: D1Database,
    kv: KVNamespace,
    input: RegisterWithInviteInput,
    userAgent: string = 'unknown',
    ipAddress: string = 'unknown'
  ) {
    const cleanCode = input.invite_code.trim().toUpperCase();
    const cleanPhone = input.phone.trim();
    const cleanEmail = input.email ? input.email.trim().toLowerCase() : null;

    // 1. التحقق المسبق من الكود
    const verifyResult = await this.verifyInviteCode(db, cleanCode);
    if ('error' in verifyResult) {
      return verifyResult;
    }

    // 2. التحقق من عدم تكرار رقم الهاتف
    const existingPhone = await db
      .prepare(`
        SELECT id FROM Users WHERE phone = ?
        UNION
        SELECT id FROM Dashboards WHERE phone = ?
      `)
      .bind(cleanPhone, cleanPhone)
      .first();

    if (existingPhone) {
      return {
        error: 'PHONE_ALREADY_EXISTS',
        status: 409,
        message: 'رقم الهاتف مسجل بالفعل مسبقاً، يرجى استخدام رقم هاتف آخر أو تسجيل الدخول',
      };
    }

    // 3. التحقق من البريد الإلكتروني إذا تم تقديمه
    if (cleanEmail) {
      const existingEmail = await db
        .prepare(`
          SELECT id FROM Users WHERE LOWER(email) = ?
          UNION
          SELECT id FROM Dashboards WHERE LOWER(email) = ?
        `)
        .bind(cleanEmail, cleanEmail)
        .first();

      if (existingEmail) {
        return {
          error: 'EMAIL_ALREADY_EXISTS',
          status: 409,
          message: 'البريد الإلكتروني مسجل بالفعل مسبقاً',
        };
      }
    }

    // 4. توليد المعرفات وتشفير كلمة المرور
    const dashboardId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const sessionId = `session:${crypto.randomUUID()}`;
    const passwordHash = await hashPassword(input.password);
    const nowIso = new Date().toISOString();
    const sessionExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const fingerprint = input.device_fingerprint || crypto.randomUUID();

    // توليد slug فريد للمتجر
    const slugPrefix = input.store_name
      .toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06FF]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 24) || 'store';
    const slug = `${slugPrefix}-${dashboardId.substring(0, 6)}`;

    // كائن الجلسة للمتجر (بدون أي وردية وهمية - يبدأ المتجر نظيفاً حتى يختار الكاشير ويبدأ الوردية الفعلية)
    const sessionData = {
      id: sessionId,
      session_id: sessionId,
      dashboard_id: dashboardId,
      dashboard_name: input.store_name.trim(),
      dashboard_slug: slug,
      is_store_authenticated: true,
      user_id: userId,
      shift_id: null,
      device_fingerprint: fingerprint,
      ip_address: ipAddress,
      user_agent: userAgent,
      expires_at: sessionExpiresAt,
      active_shift: null,
      store: {
        dashboard_id: dashboardId,
        name: input.store_name.trim(),
        slug: slug,
        phone: cleanPhone,
      },
    };

    // 5. التنفيذ الذري لإنشاء الحساب والمتجر وتمييز الكود كمستخدم وفق الترتيب العلائقي السليم (Foreign Keys)
    const batchStatements = [
      // 1. إنشاء المتجر في جدول Dashboards أولاً (الجدول الرئيسي)
      db.prepare(`
        INSERT INTO Dashboards (
          id, name, slug, phone, email, password_hash, address, is_default, status, is_banned, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'active', 0, ?, ?)
      `).bind(
        dashboardId,
        input.store_name.trim(),
        slug,
        cleanPhone,
        cleanEmail,
        passwordHash,
        input.store_address ? input.store_address.trim() : null,
        nowIso,
        nowIso
      ),

      // 2. إنشاء حساب المالك في جدول Users (مرتبط بـ dashboard_id)
      db.prepare(`
        INSERT INTO Users (
          id, dashboard_id, name, phone, email, password_hash, role, job_title, permissions, is_active, is_banned, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'owner', 'المالك المسؤول', '{}', 1, 0, ?, ?)
      `).bind(
        userId,
        dashboardId,
        input.full_name.trim(),
        cleanPhone,
        cleanEmail,
        passwordHash,
        nowIso,
        nowIso
      ),

      // 3. تمييز الكود كـ used وربطه بـ used_by_user_id و used_by_dashboard_id (بعد وجودهما في الجداول)
      db.prepare(`
        UPDATE merchant_invitations
        SET status = 'used',
            used_at = ?,
            used_by_user_id = ?,
            used_by_dashboard_id = ?,
            updated_at = ?
        WHERE UPPER(code) = ? AND status = 'active'
      `).bind(nowIso, userId, dashboardId, nowIso, cleanCode),

      // 4. إنشاء الجلسة في جدول Sessions (مرتبط بـ dashboard_id و user_id بدون وردية وهمية)
      db.prepare(`
        INSERT INTO Sessions (
          id, dashboard_id, user_id, shift_id, device_fingerprint,
          ip_address, user_agent, active_shift, expires_at, created_at, last_active_at
        ) VALUES (?, ?, ?, NULL, ?, ?, ?, 'null', ?, ?, ?)
      `).bind(
        sessionId,
        dashboardId,
        userId,
        fingerprint,
        ipAddress,
        userAgent,
        sessionExpiresAt,
        nowIso,
        nowIso
      ),
    ];

    const batchResults = await db.batch(batchStatements);

    // التأكد من أن التحديث على الكود نجح وأثر على صف واحد
    const inviteUpdateMeta = (batchResults[2] as any)?.meta;
    if (inviteUpdateMeta && inviteUpdateMeta.rows_written === 0 && inviteUpdateMeta.changes === 0) {
      // التراجع عن إنشاء المتجر والحساب إذا كان الكود قد استهلك في عملية أخرى متزامنة
      await db.prepare('DELETE FROM Dashboards WHERE id = ?').bind(dashboardId).run();
      return {
        error: 'INVITATION_ALREADY_USED',
        status: 409,
        message: 'تم استهلاك كود الدعوة في عملية أخرى متزامنة، يرجى المحاولة بكود آخر',
      };
    }

    // حفظ الجلسة في Cloudflare KV لسرعة الفحص
    try {
      await kv.put(sessionId, JSON.stringify(sessionData), {
        expirationTtl: 30 * 24 * 60 * 60,
      });
    } catch (e) {
      // Ignored if KV is offline in local dev fallback
    }

    return {
      success: true,
      message: 'تم إنشاء المتجر وحساب المالك بنجاح',
      data: {
        sessionId,
        user: {
          id: userId,
          name: input.full_name.trim(),
          phone: cleanPhone,
          email: cleanEmail,
          role: 'owner',
          job_title: 'المالك المسؤول',
        },
        store: {
          dashboard_id: dashboardId,
          name: input.store_name.trim(),
          slug,
          phone: cleanPhone,
        },
      },
    };
  },
};
