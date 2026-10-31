/**
 * ==========================================
 *        OuraDash Auth Services
 * ==========================================
 * 
 * Business logic layer for managing Auth operations.
 */

import { D1Database, KVNamespace } from '@cloudflare/workers-types';
import { hashPassword, verifyPassword, generateSecureNumericOtp } from '../utils/crypto';
import Cloudflare from 'cloudflare';
import { logger } from '../utils/logger';
import { buildMimeMessage } from './email.services';
import { ProfileItem, UserProfileSession, ActiveShiftWorker } from '../types';
import { QuickSetupInput } from '../validators/auth.validators';

// Authentication Service
// Houses the core business logic for user authentication, session state management,
// and cryptography. Fully decoupled from HTTP contexts.
export const AuthService = {
  
  // Cryptographically Secure One-Time Password (OTP) Generator
  // Leverages rejection sampling on Web Crypto API to ensure uniform distribution without modulo bias.
  generateOtp: (digits = 6): string => {
    return generateSecureNumericOtp(digits);
  },

  /**
   * User Registration Handler
   * Validates input, hashes password, and creates an unverified user record in the Users table.
   * Dispatches a 6-digit email verification OTP.
   * All workspaces, dashboards, and profile creation are strictly deferred to 2FA verification (verifyEmailOtp).
   *
   * @param db - The D1 Database instance.
   * @param k1 - The Cloudflare KV namespace.
   * @param data - Registration input fields (full_name, email, password, optional phone_number, workspace_name, invite_code).
   */
  register: async (
    db: D1Database,
    k1: KVNamespace,
    data: { full_name: string; email: string; password: string; phone_number?: string; workspace_name?: string; invite_code?: string },
    userAgent: string,
    ipAddress: string,
    env?: any
  ) => {
    const normalizedEmail = data.email.toLowerCase().trim();

    // ─────────────────────────────────────────────────────────────
    // BRANCH A: Registering with an Invitation Code
    // ─────────────────────────────────────────────────────────────
    if (data.invite_code) {
      const verifyRes = await AuthService.verifyInvite(db, data.invite_code);
      if ('error' in verifyRes && verifyRes.error) {
        return { error: verifyRes.error, message: verifyRes.message || 'Invalid or expired invitation code.', status: verifyRes.status || 400 };
      }
      const invite = verifyRes.invite!;

      // Verify that the email matches the invitation recipient
      if (invite.email.toLowerCase() !== normalizedEmail) {
        return {
          error: 'INVITE_EMAIL_MISMATCH',
          message: 'This invitation code is designated for a different email address.',
          status: 400
        };
      }

      // Check if user already exists
      const existingUser = await db
        .prepare('SELECT id, password_hash, is_banned, is_email_verified FROM Users WHERE email = ?')
        .bind(normalizedEmail)
        .first() as any;

      if (existingUser) {
        if (existingUser.is_banned === 1) {
          return { error: 'ACCOUNT_BANNED', message: 'Your account is suspended. Please contact support.', status: 403 };
        }

        // If the user already has a password set, verify it.
        // If not (invited user setting their password for the first time), acceptInvite will securely set it.
        if (existingUser.password_hash) {
          const isPassValid = await verifyPassword(data.password, existingUser.password_hash);
          if (!isPassValid) {
            return {
              error: 'INVALID_CREDENTIALS',
              message: 'This email is already registered. Please enter your valid account password to join.',
              status: 401
            };
          }
        }

        // Join team workspace directly via invitation acceptance
        return await AuthService.acceptInvite(
          db,
          k1,
          {
            token: data.invite_code,
            full_name: data.full_name,
            password: data.password,
            phone_number: data.phone_number
          },
          userAgent,
          ipAddress
        );
      }

      // Brand new user with invite code where no Users row exists yet:
      // Insert user record with the provided password and accept invitation directly
      const userId = crypto.randomUUID();
      const hashedPassword = await hashPassword(data.password);
      const nowIso = new Date().toISOString();

      await db.prepare(`
        INSERT INTO Users (id, full_name, email, phone_number, password_hash, role, is_email_verified, is_banned, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'User', 1, 0, ?, ?)
      `).bind(userId, data.full_name.trim(), normalizedEmail, data.phone_number?.trim() || null, hashedPassword, nowIso, nowIso).run();

      return await AuthService.acceptInvite(
        db,
        k1,
        {
          token: data.invite_code,
          full_name: data.full_name,
          password: data.password,
          phone_number: data.phone_number
        },
        userAgent,
        ipAddress
      );
    }

    // ─────────────────────────────────────────────────────────────
    // BRANCH B: Standard Workspace Owner Registration
    // ─────────────────────────────────────────────────────────────
    const existingUser = await db
      .prepare('SELECT id, full_name, is_email_verified FROM Users WHERE email = ?')
      .bind(normalizedEmail)
      .first() as any;

    if (existingUser) {
      if (existingUser.is_email_verified === 1) {
        // Equalize execution time by computing PBKDF2 hash (protects against timing side-channel attacks)
        await hashPassword(data.password);

        // Dispatch security notification email to the user in English informing them they already have an account
        const frontendUrl = (env?.APP_FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
        const resetUrl = `${frontendUrl}/forgot-password?email=${encodeURIComponent(normalizedEmail)}`;
        const loginUrl = `${frontendUrl}/login`;

        await AuthService.dispatchEmail(
          env,
          normalizedEmail,
          existingUser.full_name || data.full_name.trim(),
          '',
          'account_already_exists',
          { resetUrl, loginUrl }
        );

        // Return identical success response to seamlessly navigate user to OTP verification screen
        return {
          requires_email_verification: true,
          email: normalizedEmail,
          message: 'Account created successfully. Please enter the 6-digit verification code sent to your email.'
        };
      }
      // If user exists but is unverified, update credentials and re-issue OTP
      const hashedPassword = await hashPassword(data.password);
      const nowIso = new Date().toISOString();
      await db.prepare(`
        UPDATE Users SET full_name = ?, phone_number = ?, password_hash = ?, updated_at = ? WHERE id = ?
      `).bind(data.full_name.trim(), data.phone_number?.trim() || null, hashedPassword, nowIso, existingUser.id).run();

      await k1.put(
        `reg_pending:${normalizedEmail}`,
        JSON.stringify({
          userId: existingUser.id,
          workspace_name: data.workspace_name?.trim() || null,
        }),
        { expirationTtl: 1800 }
      );

      await AuthService.sendEmailVerificationOtp(db, normalizedEmail, data.full_name.trim(), env);

      return {
        requires_email_verification: true,
        email: normalizedEmail,
        message: 'Account created successfully. Please enter the 6-digit verification code sent to your email.'
      };
    }

    const hashedPassword = await hashPassword(data.password);
    const userId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    // Create unverified user record ONLY
    await db.prepare(`
      INSERT INTO Users (id, full_name, email, phone_number, password_hash, role, is_email_verified, is_banned, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'User', 0, 0, ?, ?)
    `).bind(userId, data.full_name.trim(), normalizedEmail, data.phone_number?.trim() || null, hashedPassword, nowIso, nowIso).run();

    // Store pending registration metadata in KV (30 min TTL)
    await k1.put(
      `reg_pending:${normalizedEmail}`,
      JSON.stringify({
        userId,
        workspace_name: data.workspace_name?.trim() || null,
      }),
      { expirationTtl: 1800 }
    );

    await AuthService.sendEmailVerificationOtp(db, normalizedEmail, data.full_name.trim(), env);

    return {
      requires_email_verification: true,
      email: normalizedEmail,
      message: 'Account created successfully. Please enter the 6-digit verification code sent to your email.'
    };
  },

  /**
   * Verifies an invitation token/code and returns safe public invite details.
   */
  verifyInvite: async (db: D1Database, token: string) => {
    const cleanToken = token.trim();
    const profile = await db.prepare(`
      SELECT p.id, p.user_id, p.dashboard_id, p.job_title, p.role, p.permissions, p.invitation_token as token, p.status, p.invitation_expires_at as expires_at, p.created_by,
             u.email, u.full_name, u.photo_url, u.password_hash,
             d.name as dashboard_name, d.slug as dashboard_slug,
             inviter.full_name as inviter_name, inviter.email as inviter_email
      FROM user_profile p
      JOIN Users u ON u.id = p.user_id
      JOIN Dashboards d ON p.dashboard_id = d.id
      LEFT JOIN Users inviter ON inviter.id = p.created_by
      WHERE UPPER(p.invitation_token) = UPPER(?) OR p.invitation_token = ?
    `).bind(cleanToken, cleanToken).first() as any;

    if (!profile) {
      return { error: 'INVITATION_NOT_FOUND', message: 'Invalid or non-existent invitation code.', status: 404 };
    }

    if (profile.status !== 'pending') {
      return { 
        error: profile.status === 'active' ? 'INVITATION_ALREADY_ACCEPTED' : 'INVITATION_REVOKED', 
        message: profile.status === 'active' ? 'This invitation has already been accepted.' : 'This invitation has been revoked or is no longer valid.', 
        status: 410 
      };
    }

    if (profile.expires_at && new Date(profile.expires_at) < new Date()) {
      return { error: 'INVITATION_EXPIRED', message: 'This invitation code has expired.', status: 410 };
    }

    let parsedPermissions = null;
    if (profile.permissions) {
      try {
        parsedPermissions = typeof profile.permissions === 'string' ? JSON.parse(profile.permissions) : profile.permissions;
      } catch {}
    }

    const hasPassword = Boolean(profile.password_hash);

    return {
      invite: {
        id: profile.id,
        user_id: profile.user_id,
        token: profile.token,
        email: profile.email,
        job_title: profile.job_title || null,
        role: profile.role as 'Admin' | 'User',
        dashboard_id: profile.dashboard_id,
        dashboard_name: profile.dashboard_name,
        permissions: parsedPermissions,
        user_exists: hasPassword,
        existing_user_name: hasPassword ? profile.full_name : null,
        created_by: profile.created_by || null,
        created_by_name: profile.inviter_name || profile.inviter_email || null,
      }
    };
  },

  /**
   * Accepts an invitation and activates the invited user profile (Admin or User).
   * Seamlessly handles:
   * 1. Already authenticated user (1-click acceptance if emails match).
   * 2. Existing registered user (verifies password and activates profile).
   * 3. Brand new user (sets full name & password, activates profile, provisions session).
   */
  acceptInvite: async (
    db: D1Database,
    k1: KVNamespace,
    data: { token: string; full_name?: string; password?: string; phone_number?: string },
    userAgent: string,
    ipAddress: string,
    currentUser?: any
  ) => {
    // 1. Verify invitation
    const verifyRes = await AuthService.verifyInvite(db, data.token);
    if ('error' in verifyRes && verifyRes.error) {
      return { error: verifyRes.error, message: verifyRes.message || 'Invalid or expired invitation code.', status: verifyRes.status || 400 };
    }
    const invite = verifyRes.invite!;

    const normalizedEmail = invite.email.toLowerCase().trim();
    const nowIso = new Date().toISOString();

    // 2. Fetch user record from Users
    const existingUser = await db
      .prepare('SELECT id, full_name, email, phone_number, photo_url, password_hash, is_banned, created_at FROM Users WHERE email = ?')
      .bind(normalizedEmail)
      .first() as any;

    if (!existingUser) {
      return { error: 'USER_NOT_FOUND', message: 'User record for this invitation could not be found.', status: 404 };
    }

    let userId: string = existingUser.id;
    let userFullName: string = existingUser.full_name || '';
    let userPhotoUrl: string | null = existingUser.photo_url || null;
    let userPhone: string | null = existingUser.phone_number || data.phone_number?.trim() || null;
    let userCreatedAt: string = existingUser.created_at || nowIso;

    if (existingUser.is_banned === 1) {
      return { error: 'ACCOUNT_BANNED', message: 'Your account is suspended. Please contact support.', status: 403 };
    }

    if (currentUser && currentUser.email && currentUser.email.toLowerCase() === normalizedEmail) {
      // Authenticated session matches invite email -> 1-click acceptance without password prompt
      userId = currentUser.id;
      userFullName = currentUser.full_name || existingUser.full_name || 'Team Member';
      userPhotoUrl = currentUser.photo_url || existingUser.photo_url || null;
      userPhone = currentUser.phone_number || existingUser.phone_number || null;
      userCreatedAt = currentUser.created_at || existingUser.created_at || nowIso;
    } else if (existingUser.password_hash) {
      // User has existing password -> verify password
      if (!data.password) {
        return { error: 'PASSWORD_REQUIRED', message: 'Please enter your password to join this workspace.', status: 400 };
      }
      const isPassValid = await verifyPassword(data.password, existingUser.password_hash);
      if (!isPassValid) {
        return { error: 'INVALID_CREDENTIALS', message: 'Incorrect password. Please enter your valid account password.', status: 401 };
      }
      userFullName = existingUser.full_name;
    } else {
      // Pre-created user without password (invited for the first time) -> set full name & password
      if (!data.full_name || data.full_name.trim().length < 2) {
        return { error: 'NAME_REQUIRED', message: 'Full name must be at least 2 characters.', status: 400 };
      }
      if (!data.password || data.password.length < 8) {
        return { error: 'PASSWORD_TOO_SHORT', message: 'Password must be at least 8 characters.', status: 400 };
      }
      userFullName = data.full_name.trim();
      const hashedPassword = await hashPassword(data.password);
      await db.prepare(`
        UPDATE Users 
        SET full_name = ?, password_hash = ?, phone_number = COALESCE(?, phone_number), is_email_verified = 1, updated_at = ?
        WHERE id = ?
      `).bind(userFullName, hashedPassword, userPhone, nowIso, userId).run();
    }

    // 3. Activate the profile in user_profile
    const profileId = invite.id;
    await db.prepare(`
      UPDATE user_profile 
      SET status = 'active', invitation_token = NULL, created_by = COALESCE(created_by, ?), updated_at = ?
      WHERE id = ?
    `).bind(invite.created_by || null, nowIso, profileId).run();

    const assignedRole = invite.role;
    const jobTitle = invite.job_title || (assignedRole === 'Admin' ? 'Administrator' : 'Team Member');

    // 5. Build authentic user profile session (all active workspaces for this user)
    const newProfile: ProfileItem = {
      id: profileId,
      dashboard_id: invite.dashboard_id,
      dashboard_name: invite.dashboard_name,
      dashboard_slug: null,
      website_id: null,
      role: assignedRole,
      job_title: jobTitle,
      permissions: invite.permissions,
      is_banned: false,
    };

    const allProfilesRes = await db
      .prepare(`
        SELECT p.id, p.dashboard_id, p.role, p.job_title, p.permissions, p.is_banned,
               d.name as dashboard_name, d.slug as dashboard_slug, NULL as website_id
        FROM user_profile p
        JOIN Dashboards d ON p.dashboard_id = d.id
        WHERE p.user_id = ? AND (p.is_banned = 0 OR p.is_banned IS NULL)
        ORDER BY CASE WHEN p.id = ? THEN 0 ELSE 1 END, p.created_at DESC
      `)
      .bind(userId, profileId)
      .all() as any;

    const allProfiles: ProfileItem[] = (allProfilesRes?.results || []).map((p: any) => {
      let prPerms: Record<string, boolean> | null = null;
      if (p.permissions) {
        if (typeof p.permissions === 'string') {
          try { prPerms = JSON.parse(p.permissions); } catch {}
        } else {
          prPerms = p.permissions;
        }
      }
      return {
        id: p.id,
        dashboard_id: p.dashboard_id,
        dashboard_name: p.dashboard_name || null,
        dashboard_slug: p.dashboard_slug || null,
        website_id: p.website_id || null,
        role: p.role,
        job_title: p.job_title || null,
        permissions: prPerms,
        is_banned: false,
      };
    });

    const activeProfile = allProfiles.find(p => p.id === profileId) || allProfiles[0] || newProfile;
    const userProfileTuple: UserProfileSession = [
      allProfiles.length > 0 ? allProfiles : [newProfile],
      activeProfile,
    ];

    const sessionId = `session:${userId}:${crypto.randomUUID()}`;
    const daysToLive = 30;
    const expiresAt = new Date(Date.now() + daysToLive * 24 * 60 * 60 * 1000);

    const sessionData = {
      session_id: sessionId,
      user_id: userId,
      email: normalizedEmail,
      full_name: userFullName,
      photo_url: userPhotoUrl,
      is_banned: 0,
      dashboard_id: activeProfile?.dashboard_id || null,
      profile_id: activeProfile?.id || null,
      active_shift: null,
      active_shifts: {},
      expires_at: expiresAt.toISOString(),
      user_agent: userAgent,
      ip_address: ipAddress,
    };

    await k1.put(sessionId, JSON.stringify(sessionData), { expirationTtl: daysToLive * 24 * 60 * 60 });

    try {
      await db.prepare(`
        INSERT INTO UserSessions (id, user_id, user_profile, ip_address, user_agent, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(crypto.randomUUID(), userId, '[]', ipAddress, userAgent, expiresAt.toISOString(), nowIso).run();
    } catch {}

    const safeUser = {
      id: userId,
      email: normalizedEmail,
      full_name: userFullName,
      phone_number: userPhone,
      photo_url: userPhotoUrl,
      role: 'User',
      is_email_verified: true,
      is_banned: false,
      created_at: userCreatedAt,
      updated_at: nowIso,
      user_profile: userProfileTuple,
    };

    return { user: safeUser, sessionId, expiresAt };
  },

  /**
   * User Authentication Handler
   * Authenticates user credentials against the SQLite database, checks account status,
   * resolves active dashboard and workspace profile, and provisions a session in Cloudflare KV cache.
   * 
   * @param db - The D1 Database instance.
   * @param k1 - The Cloudflare KV namespace.
   * @param identifier - User email (or phone number).
   * @param password - Plain text password.
   */
  login: async (
    db: D1Database,
    k1: KVNamespace,
    identifier: string,
    password: string,
    rememberMe: boolean | undefined,
    userAgent: string,
    ipAddress: string,
    env?: any
  ) => {
    const cleanIdentifier = identifier.trim();
    const isEmail = cleanIdentifier.includes('@');
    const lookupParam = isEmail ? cleanIdentifier.toLowerCase() : cleanIdentifier;
    const user = await db
      .prepare(`
        SELECT id, full_name, email, phone_number, password_hash, role, photo_url, is_banned, is_email_verified
        FROM Users
        WHERE email = ? OR phone_number = ?
      `)
      .bind(lookupParam, lookupParam)
      .first() as any;
    
    // Mitigate timing-based user enumeration.
    let isValidPassword = false;
    if (user && user.password_hash) {
      isValidPassword = await verifyPassword(password, user.password_hash as string);
    } else {
      await hashPassword(password);
    }

    if (!user || !isValidPassword) {
      return { error: 'INVALID_CREDENTIALS', message: 'Invalid email or password', status: 401 };
    }
    if (user.is_banned === 1 || user.is_banned === true) {
      return { error: 'ACCOUNT_BANNED', message: 'This account has been banned', status: 403 };
    }

    // UX First: If user credentials are valid but their email has not been verified yet,
    // automatically generate and send a new 6-digit verification OTP and prompt them to verify
    if (user.is_email_verified === 0 || user.is_email_verified === false) {
      await AuthService.sendEmailVerificationOtp(db, user.email, user.full_name, env);

      return {
        requires_email_verification: true,
        email: user.email,
        message: 'Please verify your email address to complete sign-in. A 6-digit verification code has been sent to your email.'
      };
    }

    // Two-Factor Authentication (2FA) Security Check:
    // Check if the user has enabled 2FA via email.
    // If enabled, halt session creation, issue a pre-auth two_factor_token in Cloudflare KV,
    // dispatch a 6-digit OTP code to their email, and return requires_2fa: true.
    let is2faEnabled = false;
    try {
      const twoFaCheck = await db
        .prepare('SELECT is_two_factor_enabled FROM Users WHERE id = ?')
        .bind(user.id)
        .first() as any;
      is2faEnabled = Boolean(twoFaCheck?.is_two_factor_enabled === 1 || twoFaCheck?.is_two_factor_enabled === true);
    } catch {
      is2faEnabled = false;
    }

    if (is2faEnabled) {
      const otpCode = AuthService.generateOtp(6);
      const nowIso = new Date().toISOString();
      const expiresAtIso = new Date(Date.now() + 5 * 60 * 1000).toISOString();

      await db.prepare('DELETE FROM VerificationCodes WHERE target = ? AND type = ?')
        .bind(user.email, '2fa')
        .run();

      await db.prepare(`
        INSERT INTO VerificationCodes (id, user_id, code, type, target, expires_at, created_at)
        VALUES (?, ?, ?, '2fa', ?, ?, ?)
      `).bind(crypto.randomUUID(), user.id, otpCode, user.email, expiresAtIso, nowIso).run();

      const twoFactorToken = `2fa_tok_${crypto.randomUUID()}`;
      const tokenPayload = {
        token: twoFactorToken,
        user_id: user.id,
        email: user.email,
        full_name: user.full_name,
        remember_me: Boolean(rememberMe),
        attempts_left: 5,
        user_agent: userAgent,
        ip_address: ipAddress,
        created_at: Date.now(),
        last_sent_at: Date.now(),
      };

      await k1.put(`2fa_token:${twoFactorToken}`, JSON.stringify(tokenPayload), { expirationTtl: 300 });

      await AuthService.dispatchEmail(
        env,
        user.email,
        user.full_name,
        otpCode,
        'two_factor_code',
        {
          ipAddress,
          userAgent,
          timestampUtc: new Date().toUTCString(),
        }
      );

      logger.info('system', `[AUTH 2FA] Code dispatched for ${user.email} (Token: ${twoFactorToken})`);

      return {
        requires_2fa: true,
        two_factor_token: twoFactorToken,
        email: user.email,
        message: 'Two-factor authentication required. A 6-digit security code has been sent to your email.'
      };
    }

    // Resolve all memberships & active profile for the user
    const allProfilesRes = await db
      .prepare(`
        SELECT p.id, p.dashboard_id, p.role, p.job_title, p.permissions, p.is_banned,
               d.name as dashboard_name, d.slug as dashboard_slug, NULL as website_id, d.is_default
        FROM user_profile p
        JOIN Dashboards d ON p.dashboard_id = d.id
        WHERE p.user_id = ?
        ORDER BY d.is_default DESC, p.created_at ASC
      `)
      .bind(user.id)
      .all() as any;

    const rawProfiles: any[] = allProfilesRes?.results || [];

    // Filter to active profiles only (is_banned = 0 OR is_banned IS NULL)
    let activeProfiles: ProfileItem[] = rawProfiles
      .filter((p: any) => p.is_banned === 0 || p.is_banned === false || p.is_banned === null || p.is_banned === undefined)
      .map((p: any) => {
        let prPerms: Record<string, boolean> | null = null;
        if (p.permissions) {
          if (typeof p.permissions === 'string') {
            try { prPerms = JSON.parse(p.permissions); } catch { prPerms = null; }
          } else {
            prPerms = p.permissions;
          }
        }
        return {
          id: p.id,
          dashboard_id: p.dashboard_id,
          dashboard_name: p.dashboard_name || null,
          dashboard_slug: p.dashboard_slug || null,
          website_id: p.website_id || null,
          role: p.role,
          job_title: p.job_title || null,
          permissions: prPerms,
          is_banned: false,
        };
      });

    // Check if user has profiles but ALL of them are banned
    if (rawProfiles.length > 0 && activeProfiles.length === 0) {
      return { error: 'PROFILE_BANNED', message: 'Your workspace profile has been suspended', status: 403 };
    }

    // Active profile resolution: null if user has no workspace profiles yet (new business user)
    const activeProfile = activeProfiles.length > 0 ? activeProfiles[0] : null;
    const userProfileTuple: UserProfileSession = [
      activeProfiles, // 1. الملفات الشخصية النشطة كلها للمستخدم
      activeProfile,  // 2. الملف الشخصي النشط حالياً (أو null إذا لم ينشئ مساحة عمل بعد)
    ];

    const sessionId = `session:${user.id}:${crypto.randomUUID()}`;
    const daysToLive = rememberMe ? 30 : 7;
    const expiresAt = new Date(Date.now() + daysToLive * 24 * 60 * 60 * 1000);

    const sessionData = {
      session_id: sessionId,
      user_id: user.id,
      email: user.email,
      full_name: user.full_name,
      photo_url: user.photo_url,
      is_banned: user.is_banned,
      dashboard_id: activeProfile?.dashboard_id || null,
      profile_id: activeProfile?.id || null,
      active_shift: null,
      active_shifts: {},
      expires_at: expiresAt.toISOString(),
      user_agent: userAgent,
      ip_address: ipAddress,
    };

    // Cache the session in Cloudflare KV
    await k1.put(sessionId, JSON.stringify(sessionData), { expirationTtl: daysToLive * 24 * 60 * 60 });

    // Store in Sessions / UserSessions table with user_profile JSON
    try {
      await db.prepare(`
        INSERT INTO Sessions (id, user_id, user_profile, active_shifts, ip_address, user_agent, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(sessionId, user.id, '[]', '{}', ipAddress, userAgent, expiresAt.toISOString()).run();
    } catch {
      try {
        await db.prepare(`
          INSERT INTO UserSessions (id, user_id, user_profile, ip_address, user_agent, expires_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), user.id, '[]', ipAddress, userAgent, expiresAt.toISOString()).run();
      } catch (err) {
        // Non-fatal
      }
    }

    const safeUser = {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      phone_number: user.phone_number || null,
      photo_url: user.photo_url || null,
      role: user.role,
      is_email_verified: Boolean(user.is_email_verified),
      is_banned: Boolean(user.is_banned),
      created_at: user.created_at,
      user_profile: userProfileTuple,
    };

    return { user: safeUser, sessionId, expiresAt };
  },

  /**
   * Session Invalidation Handler
   * Removes the active session key from the KV Cache.
   * 
   * @param db - The D1 Database instance.
   */
  logout: async (db: D1Database, k1: KVNamespace, sessionId: string | undefined) => {
    if (sessionId && sessionId !== 'authenticated' && sessionId.startsWith('session:')) {
      await k1.delete(sessionId);
    }
    return { success: true };
  },

  /**
   * Password Recovery Initiator (Forgot Password)
   * Generates a 6-digit OTP, saves it to the database, and dispatches an HTML email.
   * Crucial Security Features:
   * 1. Email Enumeration Protection: Always returns `{ success: true }` regardless of user existence.
   * 2. Timing Attack Mitigation: Executes dummy database operations (DELETE and SELECT) when the user
   * is missing or banned, matching the database query time of the success path.
   * 3. Sync Execution / Cloudflare Worker Lifetime: Uses `await` on `client.emailSending.send` to block
   * worker termination, ensuring the Cloudflare email api call completes.
   * 4. OTP Visibility: Logs the OTP to the console to facilitate rapid testing in local/staging environments.
   * 
   * @param db - The D1 Database instance.
   */
  forgotPassword: async (db: D1Database, identifier: string, env: any) => {
    const clean = identifier.trim();
    const isEmail = clean.includes('@');
    const lookupParam = isEmail ? clean.toLowerCase() : clean;
    const user = await db.prepare('SELECT id, full_name, email, phone_number, is_banned FROM Users WHERE email = ? OR phone_number = ?')
      .bind(lookupParam, lookupParam).first() as any;
    
    if (!user) {
      AuthService.generateOtp();
      const dummyId = crypto.randomUUID();
      await db.prepare('DELETE FROM VerificationCodes WHERE user_id = ?').bind(dummyId).run();
      await db.prepare('SELECT 1').run();
      return { success: true };
    }

    if (user.is_banned === 1 || user.is_banned === true || String(user.is_banned) === '1') {
      return { error: 'ACCOUNT_BANNED', message: 'This account has been banned', status: 403 };
    }

    const code = AuthService.generateOtp();
    const codeId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const resetRef = 'AD-' + AuthService.generateOtp(6);
    const accountId = env?.CF_ACCOUNT_ID;
    const fromAddress = (env?.EMAIL_FROM_ADDRESS || 'noreply@yourdomain.com').trim();
    const frontendUrl = env?.APP_FRONTEND_URL || '';
    const recipientEmail = (user.email || '').toLowerCase().trim();

    // Invalidate existing codes first to prevent multiple active codes for the user
    await db.prepare('DELETE FROM VerificationCodes WHERE user_id = ?').bind(user.id as string).run();
    await db.prepare('INSERT INTO VerificationCodes (id, user_id, code, expires_at) VALUES (?, ?, ?, ?)')
      .bind(codeId, user.id as string, code, expiresAt.toISOString())
      .run();

    const emailHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
</head>
<body style="margin: 0; padding: 0; background-color: #09090b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #09090b; padding: 30px 10px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 560px; background-color: #121215; border: 1px solid #27272a; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);">
          <tr>
            <td style="height: 4px; background: linear-gradient(90deg, #4f46e5 0%, #7c3aed 50%, #06b6d4 100%);"></td>
          </tr>
          <tr>
            <td style="padding: 32px 32px 20px 32px; text-align: center;">
              <table role="presentation" border="0" cellspacing="0" cellpadding="0" align="center">
                <tr>
                  <td style="vertical-align: middle;">
                    <div style="width: 36px; height: 36px; background: linear-gradient(135deg, #4f46e5, #7c3aed); border-radius: 10px; text-align: center; line-height: 36px; color: #ffffff; font-weight: 800; font-size: 18px; display: inline-block;">O</div>
                  </td>
                  <td style="vertical-align: middle; padding-left: 10px;">
                    <span style="font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">Oura<span style="color: #6366f1;">Dash</span></span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 32px 32px 32px;">
              <h2 style="margin: 0 0 6px 0; font-size: 20px; font-weight: 700; color: #f4f4f5; text-align: center;">Password Reset Request</h2>
              <p style="margin: 0 0 24px 0; font-size: 12px; color: #71717a; text-align: center; font-family: monospace;">Ref: ${resetRef}</p>
              
              <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #a1a1aa;">
                Hello <strong style="color: #f4f4f5;">${user.full_name || 'User'}</strong>,<br>
                We received a request to reset your password for your OuraDash account. Use the verification code below to complete the reset process:
              </p>

              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #18181b; border: 1px solid #3f3f46; border-radius: 12px; padding: 24px; text-align: center;">
                    <span style="display: block; font-size: 11px; font-weight: 600; color: #a1a1aa; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 10px;">Your Verification Code</span>
                    <div style="font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 34px; font-weight: 800; color: #818cf8; letter-spacing: 10px; margin: 0;">
                      ${code}
                    </div>
                    <span style="display: block; font-size: 12px; color: #71717a; margin-top: 10px;">Valid for <strong>15 minutes</strong></span>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: rgba(239, 68, 68, 0.08); border-left: 3px solid #ef4444; border-radius: 4px; padding: 12px 16px;">
                    <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #fca5a5;">
                      <strong>Security Note:</strong> If you did not request a password reset, please ignore this email or secure your account if you have concerns.
                    </p>
                  </td>
                </tr>
              </table>

              <hr style="border: none; border-top: 1px solid #27272a; margin: 24px 0;">

              <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #71717a; text-align: center;">
                &copy; ${new Date().getFullYear()} OuraDash. All rights reserved.<br>
                <a href="${frontendUrl}" style="color: #6366f1; text-decoration: none; font-weight: 500;">${frontendUrl.replace(/^https?:\/\//, '')}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;
    const textContent = `Hello ${user.full_name},\n\nYou requested to reset your password. Your 6-digit code is: ${code}\n\nThis code is valid for 15 minutes.\n\nReference: ${resetRef}`;
    const subjectStr = `OuraDash - Password Reset Code [Ref: ${resetRef}]`;

    // 1. Primary: Native Cloudflare Workers Send Email Binding (EMAILER)
    // Zero API tokens or account IDs required! Works natively out of the box.
    if (env?.EMAILER && typeof env.EMAILER.send === 'function' && recipientEmail.includes('@')) {
      try {
        // Official Cloudflare Workers structured email send (exact string format from dashboard)
        await env.EMAILER.send({
          to: recipientEmail,
          from: fromAddress,
          subject: subjectStr,
          text: textContent,
          html: emailHtml
        });
        logger.info('system', `Password reset email dispatched natively via Workers EMAILER binding to ${recipientEmail}`);
      } catch (structuredErr: any) {
        // Fallback to EmailMessage if raw MIME is required by runtime
        try {
          const rawMime = buildMimeMessage({
            from: fromAddress,
            to: recipientEmail,
            subject: subjectStr,
            html: emailHtml,
            text: textContent
          });
          const EmailMsg = (globalThis as any).EmailMessage;
          if (EmailMsg) {
            await env.EMAILER.send(new EmailMsg(fromAddress, recipientEmail, rawMime));
            logger.info('system', `Password reset email dispatched natively via EmailMessage to ${recipientEmail}`);
          }
        } catch (mimeErr) {
          logger.warn('system', `Native EMAILER dispatch failed for password reset: ${structuredErr?.message || structuredErr}`);
        }
      }
    } else if (env?.CLOUDFLARE_API_TOKEN && accountId && recipientEmail.includes('@')) {
      // 2. Secondary Fallback: Cloudflare REST API Client
      try {
        const client = new Cloudflare({ apiToken: env.CLOUDFLARE_API_TOKEN });
        await client.emailSending.send({
          account_id: accountId,
          from: fromAddress,
          to: recipientEmail,
          subject: subjectStr,
          html: emailHtml,
          text: textContent
        });
        logger.info('system', `Password reset email successfully sent via REST API to ${recipientEmail}`);
      } catch (e: any) {
        logger.error('system', `Failed to send email via Cloudflare REST API: ${e.message || e}`);
      }
    } else {
      logger.warn('system', `Neither native EMAILER binding nor Cloudflare API tokens are available. Password reset email skipped.`);
    }

    return { success: true };
  },

  /**
   * Resends the verification code for password recovery.
   * Enforces account status check (is_banned) before dispatching a new OTP email.
   */
  resendResetCode: async (db: D1Database, email: string, env: any) => {
    return AuthService.forgotPassword(db, email, env);
  },

  /**
   * Verification Code Validator
   * Checks the provided recovery OTP against the database record.
   * Crucial Security Features:
   * 1. Brute-Force Rate Limiting: Lock attempts key to `ipAddress:email` combination inside
   * Cloudflare KV. Max 5 failures allowed within 15 minutes to block automation.
   * 2. Expiration Verification: Assures the code has not surpassed the 15-minute validity window.
   * 
   * @param db - The D1 Database instance.
   */
  verifyResetCode: async (db: D1Database, k1: KVNamespace, identifier: string, code: string, ipAddress: string) => {
    const clean = identifier.trim();
    const isEmail = clean.includes('@');
    const lookupParam = isEmail ? clean.toLowerCase() : clean;
    
    // Check brute-force attempts. Rate-limit key bound strictly to ip + identifier.
    const attemptsKey = `otp_attempts:${ipAddress}:${lookupParam}`;
    const failedAttempts = parseInt(await k1.get(attemptsKey) || '0', 10);
    if (failedAttempts >= 5) {
      return { error: 'ACCOUNT_LOCKED', message: 'Too many failed attempts. Try again in 15 minutes.', status: 429 };
    }

    const user = await db.prepare('SELECT id, email, is_banned FROM Users WHERE email = ? OR phone_number = ?')
      .bind(lookupParam, lookupParam).first() as any;
    if (!user) {
      await k1.put(attemptsKey, (failedAttempts + 1).toString(), { expirationTtl: 900 });
      return { error: 'INVALID_CODE', message: 'Invalid or expired recovery code.', status: 400 };
    }

    // Verify account status before verifying OTP code
    if (user.is_banned === 1 || user.is_banned === true || String(user.is_banned) === '1') {
      return { error: 'ACCOUNT_BANNED', message: 'This account has been banned', status: 403 };
    }

    const verification = await db.prepare(
      'SELECT id, expires_at FROM VerificationCodes WHERE user_id = ? AND code = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(user.id as string, code).first();

    if (!verification || new Date(verification.expires_at as string) < new Date()) {
      await k1.put(attemptsKey, (failedAttempts + 1).toString(), { expirationTtl: 900 });
      return { error: 'INVALID_CODE', message: 'Invalid or expired recovery code.', status: 400 };
    }

    // Reset brute-force counter upon successful verification
    await k1.delete(attemptsKey);

    return { success: true };
  },

  /**
   * Password Committer
   * Performs the final password update inside a database transaction batch.
   * Crucial Security Features:
   * 1. Transaction Atomic Batching: Updates the user's password and deletes the OTP code
   * in a single atomic `db.batch` call.
   * 2. Force Revocation: Calls `revokeAllUserSessions` to evict any existing active
   * sessions from the Cloudflare KV cache. This immediately logouts the user across
   * all active devices and browsers.
   * 
   * @param db - The D1 Database instance.
   */
  resetPassword: async (db: D1Database, k1: KVNamespace, identifier: string, code: string, newPassword: string, ipAddress: string) => {
    const clean = identifier.trim();
    const isEmail = clean.includes('@');
    const lookupParam = isEmail ? clean.toLowerCase() : clean;

    // Check brute-force attempts on password reset endpoint as well to block bypasses
    const attemptsKey = `otp_attempts:${ipAddress}:${lookupParam}`;
    const failedAttempts = parseInt(await k1.get(attemptsKey) || '0', 10);
    if (failedAttempts >= 5) {
      return { error: 'ACCOUNT_LOCKED', message: 'Too many failed attempts. Try again in 15 minutes.', status: 429 };
    }

    const user = await db.prepare('SELECT id, email, is_banned FROM Users WHERE email = ? OR phone_number = ?')
      .bind(lookupParam, lookupParam).first() as any;
    if (!user) {
      await k1.put(attemptsKey, (failedAttempts + 1).toString(), { expirationTtl: 900 });
      return { error: 'INVALID_CODE', message: 'Invalid or expired recovery code.', status: 400 };
    }

    // Verify account status before resetting the password
    if (user.is_banned === 1 || user.is_banned === true || String(user.is_banned) === '1') {
      return { error: 'ACCOUNT_BANNED', message: 'This account has been banned', status: 403 };
    }

    const verification = await db.prepare(
      'SELECT id, expires_at FROM VerificationCodes WHERE user_id = ? AND code = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(user.id as string, code).first();

    if (!verification) {
      await k1.put(attemptsKey, (failedAttempts + 1).toString(), { expirationTtl: 900 });
      return { error: 'INVALID_CODE', message: 'Invalid recovery code.', status: 400 };
    }
    if (new Date(verification.expires_at as string) < new Date()) {
      await k1.put(attemptsKey, (failedAttempts + 1).toString(), { expirationTtl: 900 });
      return { error: 'CODE_EXPIRED', message: 'Recovery code has expired.', status: 400 };
    }

    await k1.delete(attemptsKey);

    // Securely hash password using PBKDF2 Web Crypto API implementation
    const hashedPassword = await hashPassword(newPassword);
    
    // Batch operations to guarantee atomicity and track password update
    await db.batch([
      db.prepare('UPDATE Users SET password_hash = ?, password_updated_at = CURRENT_TIMESTAMP, password_updated_by = ? WHERE id = ?').bind(hashedPassword, 'self', user.id as string),
      db.prepare('DELETE FROM VerificationCodes WHERE user_id = ?').bind(user.id as string)
    ]);
    
    // Forcefully disconnect all active devices/sessions
    await AuthService.revokeAllUserSessions(k1, user.id as string);

    return { success: true };
  },

  /**
   * Central Session Revocation Utility
   * Evicts all active session records from Cloudflare KV matching a user ID prefix.
   * Critical for immediate privilege escalation mitigation when roles or status changes.
   * 
   * @param db - The D1 Database instance.
   */
  revokeAllUserSessions: async (k1: KVNamespace, userId: string) => {
    let cursor: string | undefined = undefined;
    let revokedCount = 0;
    
    do {
      const sessionsList: any = await k1.list({ prefix: `session:${userId}:`, cursor });
      const deletePromises = sessionsList.keys.map((key: any) => k1.delete(key.name));
      await Promise.all(deletePromises);
      revokedCount += sessionsList.keys.length;
      cursor = sessionsList.list_complete ? undefined : sessionsList.cursor;
    } while (cursor);

    return { success: true, revokedCount };
  },

  /**
   * Dispatches branded, security-hardened HTML & plaintext emails in English.
   * Supports:
   *  - 'email_verify': 6-digit OTP code for account activation
   *  - 'password_reset': 6-digit OTP code for resetting password
   *  - 'team_invite': Team invitation code & direct registration link
   *  - 'account_already_exists': Security notice sent when registration is attempted on an existing account
   */
  dispatchEmail: async (
    env: any,
    recipientEmail: string,
    fullName: string,
    code: string,
    type: 'email_verify' | 'password_reset' | 'team_invite' | 'account_already_exists' | 'two_factor_code' | 'two_factor_setup',
    meta?: { workspaceName?: string; role?: string; inviteUrl?: string; registerUrl?: string; inviterName?: string; resetUrl?: string; loginUrl?: string; ipAddress?: string; userAgent?: string; timestampUtc?: string }
  ) => {
    const normalizedRecipient = recipientEmail.toLowerCase().trim();
    const accountId = env?.CF_ACCOUNT_ID;
    const fromAddress = (env?.EMAIL_FROM_ADDRESS || 'noreply@yourdomain.com').trim();
    const frontendUrl = (env?.APP_FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

    let subject = '';
    let headline = '';
    let subheadline = '';
    let mainContentHtml = '';
    let footerNote = '';
    let textContent = '';

    if (type === 'email_verify') {
      subject = `OuraDash - Verify Your Email [${code}]`;
      headline = 'Verify Your Email Address';
      subheadline = `Hello ${fullName || 'there'}, welcome to OuraDash!`;
      mainContentHtml = `
        <p style="color:#a1a1aa;font-size:14px;line-height:22px;margin:0 0 20px 0;">
          Thank you for signing up with OuraDash. Please use the verification code below to verify your email address and activate your account:
        </p>
        <div style="background-color:#18181b;border:1px solid #27272a;border-radius:12px;padding:16px 24px;display:inline-block;letter-spacing:8px;font-size:32px;font-weight:700;color:#6366f1;font-family:monospace;margin:0 auto 20px auto;">
          ${code}
        </div>
      `;
      footerNote = 'This verification code is valid for 15 minutes. If you did not create an OuraDash account, you can safely ignore this email.';
      textContent = `Hello ${fullName || 'there'},\n\nThank you for signing up with OuraDash. Please use the following 6-digit verification code to complete your registration:\n\n${code}\n\nThis code expires in 15 minutes.\nIf you did not request this, please ignore this email.`;

      logger.info('system', `[OTP] email_verify code for ${normalizedRecipient}: ${code}`);
    } else if (type === 'password_reset') {
      const ref = 'AD-' + Math.floor(100000 + Math.random() * 900000);
      subject = `OuraDash - Password Reset Code [Ref: ${ref}]`;
      headline = 'Password Reset Request';
      subheadline = `Hello ${fullName || 'there'},`;
      mainContentHtml = `
        <p style="color:#a1a1aa;font-size:14px;line-height:22px;margin:0 0 20px 0;">
          We received a request to reset your password for your OuraDash account. Use the verification code below to proceed with resetting your password:
        </p>
        <div style="background-color:#18181b;border:1px solid #27272a;border-radius:12px;padding:16px 24px;display:inline-block;letter-spacing:8px;font-size:32px;font-weight:700;color:#6366f1;font-family:monospace;margin:0 auto 20px auto;">
          ${code}
        </div>
      `;
      footerNote = 'This verification code is valid for 15 minutes. If you did not request a password reset, please ignore this email or review your account security.';
      textContent = `Hello ${fullName || 'there'},\n\nWe received a request to reset your password. Use the following code to proceed:\n\n${code}\n\nThis code expires in 15 minutes.\nIf you did not request this, please ignore this email.`;

      logger.info('system', `[OTP] password_reset code for ${normalizedRecipient}: ${code}`);
    } else if (type === 'team_invite') {
      const wsName = meta?.workspaceName || 'OuraDash Workspace';
      const roleName = meta?.role === 'Admin' ? 'Administrator' : 'Team Member';
      const inviterDisplay = meta?.inviterName || fullName || 'A workspace administrator';
      const inviteUrl = meta?.inviteUrl || `${frontendUrl}/invite/${encodeURIComponent(code)}`;
      const registerUrl = meta?.registerUrl || `${frontendUrl}/register?invite=${encodeURIComponent(code)}`;

      subject = `You've been invited to join ${wsName} on OuraDash [${code}]`;
      headline = `You're Invited to Join ${wsName}`;
      subheadline = `Workspace Team Invitation`;
      mainContentHtml = `
        <p style="color:#f4f4f5;font-size:15px;line-height:24px;margin:0 0 12px 0;">
          Hello,<br>
          You have been invited by <strong style="color:#ffffff;">${inviterDisplay}</strong> to join the <strong style="color:#818cf8;">${wsName}</strong> workspace team as an <strong style="color:#6366f1;">${roleName}</strong>.
        </p>
        <p style="color:#a1a1aa;font-size:13px;line-height:22px;margin:0 0 24px 0;">
          To accept your invitation, create your account, and access the workspace dashboard, please click the button below or use your unique invitation code:
        </p>

        <!-- Big CTA Button -->
        <table role="presentation" border="0" cellspacing="0" cellpadding="0" align="center" style="margin:20px auto;">
          <tr>
            <td align="center" style="border-radius:12px;background:linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);box-shadow:0 6px 20px rgba(79,70,229,0.35);">
              <a href="${inviteUrl}" target="_blank" style="display:inline-block;padding:14px 34px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;border:1px solid rgba(255,255,255,0.2);">
                Accept Invitation & Create Account &rarr;
              </a>
            </td>
          </tr>
        </table>
        <div style="text-align:center;color:#71717a;font-size:12px;margin-top:-10px;margin-bottom:24px;">
          Set up your credentials and join the team
        </div>

        <!-- Code Highlight Box -->
        <div style="background-color:#18181b;border:1px dashed #6366f1;border-radius:12px;padding:18px 20px;text-align:center;margin:0 auto 24px auto;">
          <div style="color:#a1a1aa;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">
            YOUR INVITATION CODE
          </div>
          <div style="background-color:#09090b;border:1px solid #27272a;border-radius:8px;padding:12px 18px;display:inline-block;letter-spacing:4px;font-size:24px;font-weight:800;color:#818cf8;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;margin:0 auto;">
            ${code}
          </div>
          <div style="color:#10b981;font-size:11px;font-weight:600;margin-top:10px;">
            ✓ Valid for 7 days
          </div>
        </div>

        <!-- Instructions Card -->
        <div style="text-align:left;background-color:#18181b;border:1px solid #27272a;border-radius:12px;padding:18px 20px;margin-bottom:20px;">
          <div style="color:#ffffff;font-size:13px;font-weight:700;margin-bottom:10px;">
            💡 How to accept your invitation:
          </div>
          <ol style="margin:0;padding-left:20px;color:#a1a1aa;font-size:13px;line-height:22px;">
            <li style="margin-bottom:6px;">Click the <strong style="color:#ffffff;">Accept Invitation & Create Account</strong> button above.</li>
            <li style="margin-bottom:6px;">Enter your personal details (full name, phone number, and password).</li>
            <li>Your account will immediately be linked to <strong style="color:#818cf8;">${wsName}</strong> with full <strong style="color:#ffffff;">${roleName}</strong> access.</li>
          </ol>
          <div style="margin-top:14px;padding-top:12px;border-top:1px solid #27272a;font-size:12px;color:#71717a;">
            Direct URL:
            <div style="margin-top:4px;padding:8px 12px;background-color:#09090b;border-radius:8px;border:1px solid #27272a;word-break:break-all;">
              <a href="${inviteUrl}" style="color:#818cf8;font-family:monospace;text-decoration:none;">
                ${inviteUrl}
              </a>
            </div>
          </div>
        </div>
      `;
      footerNote = 'This invitation code will expire in 7 days. If you were not expecting this invitation, you can safely ignore this email.';
      textContent = `Team Invitation: Join "${wsName}" on OuraDash\n==================================================\n\nHello,\nYou have been invited by ${inviterDisplay} to join "${wsName}" on OuraDash as an ${roleName}.\n\nYour Invitation Code:\n${code}\n\nDirect Link to Accept & Create Account:\n${inviteUrl}\n\nAlternative Registration Link:\n${registerUrl}\n\nHow to accept:\n1. Click the link above or go to the registration page.\n2. Enter your details (name, phone number, password).\n3. Your account will automatically be activated with your assigned workspace permissions.\n\nNote: This invitation will expire in 7 days.\nIf you were not expecting this invitation, please ignore this email.`;

      logger.info('system', `[INVITE] team_invite code for ${normalizedRecipient}: ${code} (Workspace: ${wsName})`);
    } else if (type === 'account_already_exists') {
      const resetUrl = meta?.resetUrl || `${frontendUrl}/forgot-password?email=${encodeURIComponent(normalizedRecipient)}`;
      const loginUrl = meta?.loginUrl || `${frontendUrl}/login`;

      subject = 'OuraDash - Account Already Exists / Sign-In Assistance';
      headline = 'Account Already Exists';
      subheadline = `Hello ${fullName || 'there'},`;
      mainContentHtml = `
        <p style="color:#f4f4f5;font-size:15px;line-height:24px;margin:0 0 16px 0;">
          We noticed an attempt to register a new account on OuraDash using this email address (<strong style="color:#818cf8;">${normalizedRecipient}</strong>).
        </p>
        <p style="color:#a1a1aa;font-size:14px;line-height:22px;margin:0 0 24px 0;">
          Since you already have an active OuraDash account, no new account was created and your existing profile remains completely secure.
        </p>

        <!-- Reset Password CTA Button -->
        <table role="presentation" border="0" cellspacing="0" cellpadding="0" align="center" style="margin:20px auto 12px auto;">
          <tr>
            <td align="center" style="border-radius:12px;background:linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);box-shadow:0 6px 20px rgba(79,70,229,0.35);">
              <a href="${resetUrl}" target="_blank" style="display:inline-block;padding:14px 34px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;border:1px solid rgba(255,255,255,0.2);">
                Reset Your Password &rarr;
              </a>
            </td>
          </tr>
        </table>

        <!-- Log In Alternate Link -->
        <p style="color:#71717a;font-size:13px;line-height:20px;margin:12px 0 24px 0;text-align:center;">
          Remember your password? <a href="${loginUrl}" style="color:#818cf8;text-decoration:underline;font-weight:600;">Sign in directly</a>
        </p>

        <!-- Security Warning Box -->
        <div style="text-align:left;background-color:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:12px;padding:16px 18px;margin-top:20px;">
          <div style="color:#fca5a5;font-size:13px;font-weight:700;margin-bottom:4px;">
            🔒 Security Notice
          </div>
          <div style="color:#a1a1aa;font-size:12px;line-height:18px;">
            If you did not attempt this registration, you can safely ignore this email. No one can access your account without your password.
          </div>
        </div>
      `;
      footerNote = 'This is an automated security notification for your OuraDash account. If you suspect unauthorized activity, please review your account security.';
      textContent = `Hello ${fullName || 'there'},\n\nWe received an attempt to create a new OuraDash account using this email address (${normalizedRecipient}).\n\nSince you already have an active account, no new account was created and your existing account remains secure.\n\n- If you forgot your password, you can reset it here:\n${resetUrl}\n\n- If you know your password, you can log in here:\n${loginUrl}\n\nIf you did not attempt this registration, you can safely disregard this email.`;

      logger.info('system', `[AUTH NOTICE] account_already_exists notice dispatched to ${normalizedRecipient}`);
    } else if (type === 'two_factor_code') {
      subject = `OuraDash Security - Your Two-Factor Verification Code [${code}]`;
      headline = 'Two-Factor Authentication';
      subheadline = `Hello ${fullName || 'there'},`;
      mainContentHtml = `
        <p style="color:#f4f4f5;font-size:15px;line-height:24px;margin:0 0 16px 0;">
          A sign-in attempt was detected for your OuraDash account. Please use the 6-digit security code below to complete your authentication:
        </p>

        <!-- Code Highlight Box -->
        <div style="background-color:#18181b;border:1px solid #4f46e5;border-radius:12px;padding:18px 24px;text-align:center;margin:0 auto 24px auto;">
          <div style="color:#a1a1aa;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">
            SECURITY VERIFICATION CODE
          </div>
          <div style="background-color:#09090b;border:1px solid #27272a;border-radius:8px;padding:12px 20px;display:inline-block;letter-spacing:8px;font-size:32px;font-weight:800;color:#818cf8;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;margin:0 auto;">
            ${code}
          </div>
          <div style="color:#10b981;font-size:11px;font-weight:600;margin-top:10px;">
            ✓ Valid for 5 minutes
          </div>
        </div>

        <!-- Session Details Box -->
        <div style="text-align:left;background-color:#18181b;border:1px solid #27272a;border-radius:12px;padding:16px 18px;margin-bottom:20px;">
          <div style="color:#ffffff;font-size:12px;font-weight:700;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px;">
            📍 Sign-in Attempt Details
          </div>
          <div style="color:#a1a1aa;font-size:12px;line-height:20px;">
            <div><strong>Time:</strong> ${meta?.timestampUtc || new Date().toUTCString()}</div>
            <div><strong>IP Address:</strong> ${meta?.ipAddress || 'Unavailable'}</div>
            <div><strong>Device / Browser:</strong> ${meta?.userAgent || 'Unknown'}</div>
          </div>
        </div>

        <!-- Security Warning Box -->
        <div style="text-align:left;background-color:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:12px;padding:14px 16px;">
          <div style="color:#fca5a5;font-size:12px;font-weight:700;margin-bottom:4px;">
            🔒 Security Notice
          </div>
          <div style="color:#a1a1aa;font-size:12px;line-height:18px;">
            If you did not initiate this sign-in attempt, someone may have entered your password. Please change your password immediately.
          </div>
        </div>
      `;
      footerNote = 'This verification code will expire in 5 minutes. Never share this code with anyone. OuraDash support will never ask for your code.';
      textContent = `OuraDash Security: Two-Factor Authentication\n===========================================\n\nHello ${fullName || 'there'},\n\nA sign-in attempt was detected for your account. Please use the following 6-digit security code to complete your verification:\n\n${code}\n\nThis code will expire in 5 minutes.\n\nAttempt Details:\n- Time: ${meta?.timestampUtc || new Date().toUTCString()}\n- IP Address: ${meta?.ipAddress || 'Unavailable'}\n- Device: ${meta?.userAgent || 'Unknown'}\n\nSecurity Notice:\nIf you did not initiate this sign-in attempt, someone may have entered your password. Please change your password immediately.`;

      logger.info('system', `[2FA OTP] two_factor_code dispatched to ${normalizedRecipient}: ${code}`);
    } else if (type === 'two_factor_setup') {
      subject = `OuraDash Security - Confirm Enabling Two-Factor Authentication [${code}]`;
      headline = 'Two-Factor Authentication Setup';
      subheadline = `Hello ${fullName || 'there'},`;
      mainContentHtml = `
        <p style="color:#f4f4f5;font-size:15px;line-height:24px;margin:0 0 16px 0;">
          You recently requested to enable Two-Factor Authentication on your OuraDash account. Please enter the following 6-digit confirmation code in your profile settings to activate this feature:
        </p>

        <!-- Code Highlight Box -->
        <div style="background-color:#18181b;border:1px solid #4f46e5;border-radius:12px;padding:18px 24px;text-align:center;margin:0 auto 24px auto;">
          <div style="color:#a1a1aa;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">
            CONFIRMATION CODE
          </div>
          <div style="background-color:#09090b;border:1px solid #27272a;border-radius:8px;padding:12px 20px;display:inline-block;letter-spacing:8px;font-size:32px;font-weight:800;color:#818cf8;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;margin:0 auto;">
            ${code}
          </div>
          <div style="color:#10b981;font-size:11px;font-weight:600;margin-top:10px;">
            ✓ Valid for 10 minutes
          </div>
        </div>

        <!-- Security Warning Box -->
        <div style="text-align:left;background-color:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:12px;padding:14px 16px;">
          <div style="color:#fca5a5;font-size:12px;font-weight:700;margin-bottom:4px;">
            🔒 Security Notice
          </div>
          <div style="color:#a1a1aa;font-size:12px;line-height:18px;">
            If you did not request to enable Two-Factor Authentication, please review your account security and change your password immediately.
          </div>
        </div>
      `;
      footerNote = 'This confirmation code will expire in 10 minutes. Never share this code with anyone.';
      textContent = `OuraDash Security: Two-Factor Authentication Setup\n=================================================\n\nHello ${fullName || 'there'},\n\nYou requested to enable Two-Factor Authentication on your OuraDash account. Please use the following 6-digit confirmation code in your profile settings to activate this feature:\n\n${code}\n\nThis code will expire in 10 minutes.\n\nSecurity Notice:\nIf you did not request this, please review your account security immediately.`;

      logger.info('system', `[2FA SETUP] Confirmation code dispatched to ${normalizedRecipient}: ${code}`);
    }

    const emailHtml = `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${headline}</title>
</head>
<body style="margin:0;padding:0;background-color:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#09090b;padding:36px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:560px;background-color:#121215;border:1px solid #27272a;border-radius:16px;overflow:hidden;box-shadow:0 20px 25px -5px rgba(0,0,0,0.5);">
          <tr>
            <td style="height:4px;background:linear-gradient(90deg, #4f46e5 0%, #7c3aed 50%, #06b6d4 100%);"></td>
          </tr>
          <tr>
            <td style="padding:32px 32px 20px 32px;text-align:center;">
              <!-- Brand Header -->
              <table role="presentation" border="0" cellspacing="0" cellpadding="0" align="center" style="margin-bottom:20px;">
                <tr>
                  <td style="vertical-align:middle;">
                    <div style="width:34px;height:34px;background:linear-gradient(135deg, #4f46e5, #7c3aed);border-radius:10px;text-align:center;line-height:34px;color:#ffffff;font-weight:800;font-size:17px;display:inline-block;">O</div>
                  </td>
                  <td style="vertical-align:middle;padding-left:10px;">
                    <span style="font-size:20px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">Oura<span style="color:#6366f1;">Dash</span></span>
                  </td>
                </tr>
              </table>

              <h1 style="color:#ffffff;font-size:22px;font-weight:700;margin:0 0 8px 0;letter-spacing:-0.3px;">${headline}</h1>
              ${subheadline ? `<p style="color:#71717a;font-size:13px;font-weight:500;margin:0 0 20px 0;">${subheadline}</p>` : ''}
              
              ${mainContentHtml}

              <p style="color:#71717a;font-size:12px;line-height:18px;margin:24px 0 0 0;border-top:1px solid #27272a;padding-top:20px;">
                ${footerNote}
              </p>
            </td>
          </tr>
        </table>
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:560px;margin-top:16px;">
          <tr>
            <td style="text-align:center;color:#52525b;font-size:12px;">
              &copy; ${new Date().getFullYear()} OuraDash Enterprise. All rights reserved.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    if (env?.EMAILER && typeof env.EMAILER.send === 'function' && normalizedRecipient.includes('@')) {
      try {
        await env.EMAILER.send({
          to: normalizedRecipient,
          from: fromAddress,
          subject,
          text: textContent,
          html: emailHtml
        });
        logger.info('system', `[AUTH EMAIL] Dispatched via native EMAILER binding to ${normalizedRecipient} (Type: ${type})`);
      } catch (structuredErr: any) {
        // Fallback to EmailMessage if raw MIME is required by runtime
        try {
          const rawMime = buildMimeMessage({
            from: fromAddress,
            to: normalizedRecipient,
            subject,
            html: emailHtml,
            text: textContent
          });
          const EmailMsg = (globalThis as any).EmailMessage;
          if (EmailMsg) {
            await env.EMAILER.send(new EmailMsg(fromAddress, normalizedRecipient, rawMime));
            logger.info('system', `[AUTH EMAIL] Dispatched natively via EmailMessage to ${normalizedRecipient} (Type: ${type})`);
          } else {
            logger.warn('system', `EMAILER send notice: ${structuredErr?.message || structuredErr}`);
          }
        } catch (mimeErr: any) {
          logger.warn('system', `EMAILER MIME fallback notice: ${mimeErr?.message || mimeErr}`);
        }
      }
    } else if (env?.CLOUDFLARE_API_TOKEN && accountId && normalizedRecipient.includes('@')) {
      try {
        const client = new Cloudflare({ apiToken: env.CLOUDFLARE_API_TOKEN });
        await client.emailSending.send({
          account_id: accountId,
          from: fromAddress,
          to: normalizedRecipient,
          subject,
          html: emailHtml,
          text: textContent
        });
        logger.info('system', `[AUTH EMAIL] Dispatched via Cloudflare REST API to ${normalizedRecipient} (Type: ${type})`);
      } catch (e: any) {
        logger.warn('system', `Cloudflare REST API email notice: ${e?.message || e}`);
      }
    } else {
      logger.info('system', `[AUTH EMAIL SIMULATION] Email for ${normalizedRecipient} (Code: ${code}, Type: ${type}) logged.`);
    }
  },

  /**
   * Generates and dispatches a 6-digit OTP code to verify new user email.
   */
  sendEmailVerificationOtp: async (db: D1Database, email: string, fullName: string, env: any, dashboardId?: string | null) => {
    const normalizedEmail = email.toLowerCase().trim();
    const code = AuthService.generateOtp();
    const codeId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Remove any previous verification codes for this target
    await db.prepare("DELETE FROM VerificationCodes WHERE target = ? AND type = 'email_verify'").bind(normalizedEmail).run();

    const user = await db.prepare('SELECT id FROM Users WHERE email = ?').bind(normalizedEmail).first() as any;

    await db.prepare(`
      INSERT INTO VerificationCodes (id, user_id, code, type, target, expires_at, dashboard_id)
      VALUES (?, ?, ?, 'email_verify', ?, ?, ?)
    `).bind(codeId, user?.id || null, code, normalizedEmail, expiresAt.toISOString(), dashboardId || null).run();

    await AuthService.dispatchEmail(env, normalizedEmail, fullName, code, 'email_verify');

    return { success: true };
  },

  /**
   * Resends email verification code.
   */
  resendEmailOtp: async (db: D1Database, email: string, env: any) => {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await db.prepare('SELECT id, full_name, is_banned, is_email_verified FROM Users WHERE email = ?').bind(normalizedEmail).first() as any;

    if (!user) {
      // Timing attack mitigation
      AuthService.generateOtp();
      return { success: true };
    }
    if (user.is_banned === 1) {
      return { error: 'ACCOUNT_BANNED', message: 'Your account is suspended. Please contact support.', status: 403 };
    }
    if (user.is_email_verified === 1) {
      const frontendUrl = (env?.APP_FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
      const resetUrl = `${frontendUrl}/forgot-password?email=${encodeURIComponent(normalizedEmail)}`;
      const loginUrl = `${frontendUrl}/login`;

      await AuthService.dispatchEmail(
        env,
        normalizedEmail,
        user.full_name,
        '',
        'account_already_exists',
        { resetUrl, loginUrl }
      );
      return { success: true };
    }

    return await AuthService.sendEmailVerificationOtp(db, normalizedEmail, user.full_name, env);
  },

  /**
   * Verifies the 6-digit OTP code, marks email verified, dynamically provisions workspace & profile, and activates the authenticated session.
   */
  verifyEmailOtp: async (
    db: D1Database,
    k1: KVNamespace,
    email: string,
    code: string,
    userAgent: string,
    ipAddress: string
  ) => {
    const normalizedEmail = email.toLowerCase().trim();

    const verification = await db.prepare(`
      SELECT id, expires_at, dashboard_id FROM VerificationCodes
      WHERE target = ? AND code = ? AND type = 'email_verify'
      ORDER BY created_at DESC LIMIT 1
    `).bind(normalizedEmail, code.trim()).first() as any;

    if (!verification) {
      return { error: 'INVALID_CODE', message: 'Invalid verification code. Please check and try again.', status: 400 };
    }

    if (new Date(verification.expires_at) < new Date()) {
      return { error: 'CODE_EXPIRED', message: 'Verification code has expired. Please request a new code.', status: 400 };
    }

    const nowIso = new Date().toISOString();

    // Mark email as verified and delete used code
    await db.batch([
      db.prepare('UPDATE Users SET is_email_verified = 1, email_verified_at = ? WHERE email = ?').bind(nowIso, normalizedEmail),
      db.prepare('DELETE FROM VerificationCodes WHERE id = ?').bind(verification.id)
    ]);

    const user = await db.prepare('SELECT id, full_name, email, phone_number, photo_url, role, is_email_verified, is_banned, created_at FROM Users WHERE email = ?').bind(normalizedEmail).first() as any;

    if (!user) {
      return { error: 'USER_NOT_FOUND', message: 'User not found.', status: 404 };
    }

    // Retrieve pending registration metadata from KV
    let pending: any = null;
    try {
      const pendingRaw = await k1.get(`reg_pending:${normalizedEmail}`);
      if (pendingRaw) {
        pending = JSON.parse(pendingRaw);
      }
    } catch {}

    // Check if user already has an active profile
    const existingProfilesRes = await db
      .prepare('SELECT id FROM user_profile WHERE user_id = ?')
      .bind(user.id)
      .all() as any;

    const hasProfiles = (existingProfilesRes?.results || []).length > 0;

    if (!hasProfiles) {
      // ─────────────────────────────────────────────────────────────
      // CASE 1: Joining an existing team workspace via invitation
      // ─────────────────────────────────────────────────────────────
      let inviteToAccept: any = null;
      if (pending?.invite_code) {
        const verifyRes = await AuthService.verifyInvite(db, pending.invite_code);
        if ('invite' in verifyRes && verifyRes.invite) {
          inviteToAccept = verifyRes.invite;
        }
      }

      // Fallback: check if there is an active pending invitation for this email in DB
      if (!inviteToAccept) {
        const inviteDb = await db.prepare(`
          SELECT i.id, i.dashboard_id, i.email, i.role, i.permissions, i.status,
                 d.name as dashboard_name, d.slug as dashboard_slug
          FROM Invitations i
          JOIN Dashboards d ON i.dashboard_id = d.id
          WHERE LOWER(i.email) = ? AND i.status = 'pending' AND i.expires_at > ?
          ORDER BY i.created_at DESC LIMIT 1
        `).bind(normalizedEmail, nowIso).first() as any;

        if (inviteDb) {
          inviteToAccept = inviteDb;
        }
      }

      if (inviteToAccept) {
        const profileId = crypto.randomUUID();
        const assignedRole = inviteToAccept.role || 'User';
        const jobTitle = assignedRole === 'Admin' ? 'Administrator' : 'Team Member';
        const permissionsStr = inviteToAccept.permissions
          ? (typeof inviteToAccept.permissions === 'string' ? inviteToAccept.permissions : JSON.stringify(inviteToAccept.permissions))
          : null;

        await db.batch([
          db.prepare(`
            INSERT INTO user_profile (id, user_id, dashboard_id, role, job_title, permissions, is_banned, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
          `).bind(profileId, user.id, inviteToAccept.dashboard_id, assignedRole, jobTitle, permissionsStr, inviteToAccept.created_by || pending?.created_by || null, nowIso, nowIso),

          db.prepare("UPDATE Invitations SET status = 'accepted' WHERE id = ?").bind(inviteToAccept.id)
        ]);
      } else {
        // ─────────────────────────────────────────────────────────────
        // CASE 2: Standard Workspace Owner Setup
        // ─────────────────────────────────────────────────────────────
        const workspaceName = pending?.workspace_name?.trim() || `${user.full_name}'s Workspace`;
        const slugPrefix = workspaceName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .substring(0, 24) || 'ws';
        const slug = `${slugPrefix}-${user.id.substring(0, 6)}`;

        const websiteId = crypto.randomUUID();
        const dashboardId = crypto.randomUUID();
        const profileId = crypto.randomUUID();

        await db.batch([
          // 1. Insert Website
          db.prepare(`
            INSERT INTO Websites (id, slug, business_name, available_languages, default_language, is_active, is_deleted, created_by, created_at, updated_at)
            VALUES (?, ?, ?, '["ar"]', 'ar', 1, 0, ?, ?, ?)
          `).bind(websiteId, slug, workspaceName, user.id, nowIso, nowIso),

          // 2. Insert Dashboard (owner_profile_id is NULL initially to prevent circular FK constraint)
          db.prepare(`
            INSERT INTO Dashboards (id, user_id, owner_profile_id, name, slug, is_default, status, created_by, created_at, updated_at)
            VALUES (?, ?, NULL, ?, ?, 1, 'active', ?, ?, ?)
          `).bind(dashboardId, user.id, workspaceName, slug, user.id, nowIso, nowIso),

          // 3. Insert user_profile referencing user and dashboard (created_by is user.id for owner)
          db.prepare(`
            INSERT INTO user_profile (id, user_id, dashboard_id, role, job_title, permissions, is_banned, created_by, created_at, updated_at)
            VALUES (?, ?, ?, 'Owner', 'Owner', '{"*": true}', 0, ?, ?, ?)
          `).bind(profileId, user.id, dashboardId, user.id, nowIso, nowIso),

          // 4. Link owner_profile_id back to dashboard
          db.prepare(`
            UPDATE Dashboards SET owner_profile_id = ? WHERE id = ?
          `).bind(profileId, dashboardId)
        ]);
      }
    }

    // Clean up temporary pending registration key
    try {
      await k1.delete(`reg_pending:${normalizedEmail}`);
    } catch {}

    // Resolve active profiles
    const allProfilesRes = await db
      .prepare(`
        SELECT p.id, p.dashboard_id, p.role, p.job_title, p.permissions, p.is_banned,
               d.name as dashboard_name, d.slug as dashboard_slug, NULL as website_id
        FROM user_profile p
        JOIN Dashboards d ON p.dashboard_id = d.id
        WHERE p.user_id = ? AND (p.is_banned = 0 OR p.is_banned IS NULL)
        ORDER BY d.is_default DESC, p.created_at ASC
      `)
      .bind(user.id)
      .all() as any;

    const rawProfiles: any[] = allProfilesRes?.results || [];
    const activeProfiles: ProfileItem[] = rawProfiles.map((p: any) => {
      let prPerms: Record<string, boolean> | null = null;
      if (p.permissions) {
        if (typeof p.permissions === 'string') {
          try { prPerms = JSON.parse(p.permissions); } catch {}
        } else {
          prPerms = p.permissions;
        }
      }
      return {
        id: p.id,
        dashboard_id: p.dashboard_id,
        dashboard_name: p.dashboard_name || null,
        dashboard_slug: p.dashboard_slug || null,
        website_id: p.website_id || null,
        role: p.role,
        job_title: p.job_title || null,
        permissions: prPerms,
        is_banned: false,
      };
    });

    const activeProfile = activeProfiles[0] || null;
    const userProfileTuple: UserProfileSession = [
      activeProfiles,
      activeProfile,
    ];

    const sessionId = `session:${user.id}:${crypto.randomUUID()}`;
    const daysToLive = 30;
    const expiresAt = new Date(Date.now() + daysToLive * 24 * 60 * 60 * 1000);

    const sessionData = {
      session_id: sessionId,
      user_id: user.id,
      email: normalizedEmail,
      full_name: user.full_name,
      photo_url: user.photo_url || null,
      is_banned: 0,
      dashboard_id: activeProfile?.dashboard_id || null,
      profile_id: activeProfile?.id || null,
      active_shift: null,
      active_shifts: {},
      expires_at: expiresAt.toISOString(),
      user_agent: userAgent,
      ip_address: ipAddress,
    };

    await k1.put(sessionId, JSON.stringify(sessionData), { expirationTtl: daysToLive * 24 * 60 * 60 });

    try {
      await db.prepare(`
        INSERT INTO UserSessions (id, user_id, user_profile, ip_address, user_agent, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(crypto.randomUUID(), user.id, '[]', ipAddress, userAgent, expiresAt.toISOString(), nowIso).run();
    } catch {}

    const safeUser = {
      id: user.id,
      email: normalizedEmail,
      full_name: user.full_name,
      phone_number: user.phone_number || null,
      photo_url: user.photo_url || null,
      role: user.role,
      is_email_verified: true,
      is_banned: false,
      created_at: user.created_at,
      updated_at: user.created_at,
      user_profile: userProfileTuple,
    };

    return {
      user: safeUser,
      sessionId,
      expiresAt,
      message: 'Email verified successfully.'
    };
  },

  /**
   * Verifies Two-Factor Authentication OTP code using the pre-auth two_factor_token.
   * If valid: Provisions the active UserSessions record and returns session credentials.
   */
  verify2fa: async (
    db: D1Database,
    k1: KVNamespace,
    twoFactorToken: string,
    code: string,
    userAgent: string,
    ipAddress: string
  ) => {
    // 1. Retrieve the pre-auth token from Cloudflare KV
    const kvKey = `2fa_token:${twoFactorToken}`;
    const tokenRaw = await k1.get(kvKey);
    if (!tokenRaw) {
      return {
        error: 'SESSION_EXPIRED',
        message: 'Two-factor authentication session expired or invalid. Please sign in again.',
        status: 400
      };
    }

    let tokenData: any;
    try {
      tokenData = JSON.parse(tokenRaw);
    } catch {
      await k1.delete(kvKey);
      return { error: 'SESSION_EXPIRED', message: 'Invalid session data. Please sign in again.', status: 400 };
    }

    // 2. Check remaining attempts
    if (tokenData.attempts_left <= 0) {
      await k1.delete(kvKey);
      return {
        error: 'TOO_MANY_ATTEMPTS',
        message: 'Too many invalid attempts. Your 2FA session has been terminated. Please sign in again.',
        status: 429
      };
    }

    // 3. Query VerificationCodes for matching 2FA code
    const storedCode = await db.prepare(`
      SELECT id, code, expires_at 
      FROM VerificationCodes 
      WHERE user_id = ? AND target = ? AND code = ? AND type = '2fa'
    `).bind(tokenData.user_id, tokenData.email, code).first() as any;

    const isExpired = storedCode?.expires_at && new Date(storedCode.expires_at) < new Date();

    if (!storedCode || isExpired) {
      tokenData.attempts_left -= 1;
      if (tokenData.attempts_left <= 0) {
        await k1.delete(kvKey);
        return {
          error: 'TOO_MANY_ATTEMPTS',
          message: 'Too many invalid attempts. Your 2FA session has been terminated. Please sign in again.',
          status: 429
        };
      }
      await k1.put(kvKey, JSON.stringify(tokenData), { expirationTtl: 300 });
      return {
        error: 'INVALID_CODE',
        message: `Invalid or expired 2FA code. ${tokenData.attempts_left} attempt(s) remaining.`,
        status: 400
      };
    }

    // 4. Successful verification: Clean up OTP code and KV token immediately
    await db.prepare('DELETE FROM VerificationCodes WHERE id = ?').bind(storedCode.id).run();
    await k1.delete(kvKey);

    // 5. Fetch user record
    const user = await db.prepare(`
      SELECT id, full_name, email, phone_number, photo_url, role, is_banned, is_email_verified, created_at
      FROM Users WHERE id = ?
    `).bind(tokenData.user_id).first() as any;

    if (!user) {
      return { error: 'USER_NOT_FOUND', message: 'User not found.', status: 404 };
    }
    if (user.is_banned === 1) {
      return { error: 'ACCOUNT_BANNED', message: 'This account has been banned.', status: 403 };
    }

    // 6. Resolve all profiles/workspaces (matching login behavior)
    const allProfilesRes = await db
      .prepare(`
        SELECT p.id, p.dashboard_id, p.role, p.job_title, p.permissions, p.is_banned,
               d.name as dashboard_name, d.slug as dashboard_slug, NULL as website_id, d.is_default
        FROM user_profile p
        JOIN Dashboards d ON p.dashboard_id = d.id
        WHERE p.user_id = ?
        ORDER BY d.is_default DESC, p.created_at ASC
      `)
      .bind(user.id)
      .all() as any;

    const rawProfiles: any[] = allProfilesRes?.results || [];
    const activeProfiles: ProfileItem[] = rawProfiles
      .filter((p: any) => p.is_banned === 0 || p.is_banned === false || p.is_banned === null || p.is_banned === undefined)
      .map((p: any) => {
        let prPerms: Record<string, boolean> | null = null;
        if (p.permissions) {
          if (typeof p.permissions === 'string') {
            try { prPerms = JSON.parse(p.permissions); } catch { prPerms = null; }
          } else {
            prPerms = p.permissions;
          }
        }
        return {
          id: p.id,
          dashboard_id: p.dashboard_id,
          dashboard_name: p.dashboard_name || null,
          dashboard_slug: p.dashboard_slug || null,
          website_id: p.website_id || null,
          role: p.role,
          job_title: p.job_title || null,
          permissions: prPerms,
          is_banned: false,
        };
      });

    const activeProfile = activeProfiles.length > 0 ? activeProfiles[0] : null;
    const userProfileTuple: UserProfileSession = [activeProfiles, activeProfile];

    const sessionId = `session:${user.id}:${crypto.randomUUID()}`;
    const daysToLive = tokenData.remember_me ? 30 : 7;
    const expiresAt = new Date(Date.now() + daysToLive * 24 * 60 * 60 * 1000);

    const sessionData = {
      session_id: sessionId,
      user_id: user.id,
      email: user.email,
      full_name: user.full_name,
      photo_url: user.photo_url,
      is_banned: user.is_banned,
      dashboard_id: activeProfile?.dashboard_id || null,
      profile_id: activeProfile?.id || null,
      active_shift: null,
      active_shifts: {},
      expires_at: expiresAt.toISOString(),
      user_agent: userAgent,
      ip_address: ipAddress,
    };

    await k1.put(sessionId, JSON.stringify(sessionData), { expirationTtl: daysToLive * 24 * 60 * 60 });

    try {
      await db.prepare(`
        INSERT INTO UserSessions (id, user_id, user_profile, ip_address, user_agent, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(crypto.randomUUID(), user.id, '[]', ipAddress, userAgent, expiresAt.toISOString()).run();
    } catch {}

    const safeUser = {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      phone_number: user.phone_number || null,
      photo_url: user.photo_url || null,
      role: user.role,
      is_email_verified: Boolean(user.is_email_verified),
      is_banned: Boolean(user.is_banned),
      created_at: user.created_at,
      user_profile: userProfileTuple,
    };

    return { user: safeUser, sessionId, expiresAt };
  },

  /**
   * Resends a fresh 6-digit 2FA OTP code to the user's email.
   * Enforces a 60-second cooldown per session.
   */
  resend2fa: async (
    db: D1Database,
    k1: KVNamespace,
    twoFactorToken: string,
    env?: any
  ) => {
    const kvKey = `2fa_token:${twoFactorToken}`;
    const tokenRaw = await k1.get(kvKey);
    if (!tokenRaw) {
      return {
        error: 'SESSION_EXPIRED',
        message: 'Two-factor authentication session expired or invalid. Please sign in again.',
        status: 400
      };
    }

    let tokenData: any;
    try {
      tokenData = JSON.parse(tokenRaw);
    } catch {
      await k1.delete(kvKey);
      return { error: 'SESSION_EXPIRED', message: 'Invalid session data. Please sign in again.', status: 400 };
    }

    // Check cooldown (60 seconds)
    const now = Date.now();
    if (tokenData.last_sent_at && now - tokenData.last_sent_at < 60000) {
      const waitSeconds = Math.ceil((60000 - (now - tokenData.last_sent_at)) / 1000);
      return {
        error: 'RATE_LIMIT_EXCEEDED',
        message: `Please wait ${waitSeconds} seconds before requesting a new code.`,
        status: 429
      };
    }

    // Generate new OTP
    const otpCode = AuthService.generateOtp(6);
    const nowIso = new Date().toISOString();
    const expiresAtIso = new Date(now + 5 * 60 * 1000).toISOString();

    // Invalidate old 2FA codes for this target
    await db.prepare('DELETE FROM VerificationCodes WHERE target = ? AND type = ?')
      .bind(tokenData.email, '2fa')
      .run();

    // Insert new code
    await db.prepare(`
      INSERT INTO VerificationCodes (id, user_id, code, type, target, expires_at, created_at)
      VALUES (?, ?, ?, '2fa', ?, ?, ?)
    `).bind(crypto.randomUUID(), tokenData.user_id, otpCode, tokenData.email, expiresAtIso, nowIso).run();

    // Update KV token metadata
    tokenData.last_sent_at = now;
    tokenData.attempts_left = 5; // Reset attempts on fresh code
    await k1.put(kvKey, JSON.stringify(tokenData), { expirationTtl: 300 });

    // Send email
    await AuthService.dispatchEmail(
      env,
      tokenData.email,
      tokenData.full_name,
      otpCode,
      'two_factor_code',
      {
        ipAddress: tokenData.ip_address,
        userAgent: tokenData.user_agent,
        timestampUtc: new Date().toUTCString(),
      }
    );

    logger.info('system', `[2FA OTP Resend] Code for ${tokenData.email}: ${otpCode}`);

    return { success: true, message: 'New security code sent successfully.' };
  },

  /**
   * Start Shift Handler (تسجيل بدء وردية)
   * Enforces single active shift per device/session:
   * 1. Validates master session from KV.
   * 2. Resolves active store/dashboard.
   * 3. Authenticates worker using PIN (and optional phone) against user_profile.
   * 4. Single-shift protection: closes any active shift already open on this session/device.
   * 5. Generates unique shift_token and shift_id.
   * 6. Updates user_profile (is_shift_active = 1, current_shift_id).
   * 7. Saves shift data inside session.active_shifts in KV and Sessions DB table.
   */
  startShift: async (
    db: D1Database,
    k1: KVNamespace,
    sessionId: string,
    pin: string,
    phone?: string,
    openingCash?: number,
    ipAddress?: string,
    userAgent?: string
  ) => {
    // 1. Validate session exists in KV
    const sessionStr = await k1.get(sessionId);
    if (!sessionStr) {
      return { error: 'INVALID_SESSION', message: 'الجلسة غير صالحة أو منتهية، يرجى تسجيل الدخول أولاً', status: 401 };
    }

    let sessionData: any;
    try {
      sessionData = JSON.parse(sessionStr);
    } catch {
      return { error: 'CORRUPT_SESSION', message: 'بيانات الجلسة غير صالحة', status: 401 };
    }

    // Resolve active dashboard
    const dashboardId = sessionData.dashboard_id || sessionData.user_profile?.[1]?.dashboard_id;
    if (!dashboardId) {
      return { error: 'NO_ACTIVE_STORE', message: 'لا يوجد متجر أو فرع نشط في هذه الجلسة', status: 400 };
    }

    // 2. Strict Single Active Shift Enforcement:
    // Only ONE shift can be active on the device/session at any time. Opening multiple shifts is forbidden.
    const currentShift = sessionData.active_shift || (sessionData.active_shifts && Object.values(sessionData.active_shifts)[0]);
    if (currentShift) {
      return {
        error: 'SHIFT_ALREADY_ACTIVE',
        message: `توجد وردية نشطة بالفعل على هذا الجهاز للموظف (${(currentShift as any).worker_name}). يرجى إغلاق الوردية الحالية أولاً قبل فتح وردية جديدة.`,
        status: 409,
        active_worker: currentShift
      };
    }

    // 3. Query worker in user_profile
    let workerQuery = `
      SELECT id, dashboard_id, user_id, name, phone, pin, role, job_title, permissions, is_shift_active, current_shift_id, is_active, is_banned
      FROM user_profile
      WHERE dashboard_id = ? AND pin = ? AND is_active = 1 AND (is_banned = 0 OR is_banned IS NULL)
    `;
    const queryParams: any[] = [dashboardId, pin.trim()];

    if (phone && phone.trim()) {
      workerQuery += ' AND phone = ?';
      queryParams.push(phone.trim());
    }

    const worker = await db.prepare(workerQuery).bind(...queryParams).first() as any;

    if (!worker) {
      return { error: 'INVALID_CREDENTIALS', message: 'رمز الـ PIN غير صحيح أو حساب الموظف غير نشط بالمتجر', status: 401 };
    }

    // Deactivate any orphaned active shift for this specific worker in case they were open elsewhere
    try {
      await db.prepare(`
        UPDATE user_profile 
        SET is_shift_active = 0, current_shift_id = NULL, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).bind(worker.id).run();
    } catch {}

    // 4. Provision New Shift
    const shiftToken = `shift:${worker.id}:${crypto.randomUUID()}`;
    const shiftId = `shift_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
    const nowIso = new Date().toISOString();

    let parsedPermissions: Record<string, boolean> | null = null;
    if (worker.permissions) {
      try {
        parsedPermissions = typeof worker.permissions === 'string' ? JSON.parse(worker.permissions) : worker.permissions;
      } catch {
        parsedPermissions = null;
      }
    }

    const shiftData: ActiveShiftWorker = {
      shift_token: shiftToken,
      user_profile_id: worker.id,
      worker_name: worker.name,
      role: worker.role,
      job_title: worker.job_title || null,
      shift_id: shiftId,
      permissions: parsedPermissions,
      opening_cash: Number(openingCash) || 0,
      started_at: nowIso,
      last_action_at: nowIso,
    };

    sessionData.active_shift = shiftData;
    sessionData.active_shifts = { [shiftToken]: shiftData };

    // 5. Update worker status in user_profile
    await db.prepare(`
      UPDATE user_profile 
      SET is_shift_active = 1, current_shift_id = ?, last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).bind(shiftId, worker.id).run();

    // 6. Update KV cache
    const expiresAt = new Date(sessionData.expires_at || Date.now() + 7 * 24 * 60 * 60 * 1000);
    const remainingSeconds = Math.max(60, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
    await k1.put(sessionId, JSON.stringify(sessionData), { expirationTtl: remainingSeconds });

    // 7. Update Sessions DB table
    try {
      await db.prepare(`
        UPDATE Sessions 
        SET active_shifts = ?, last_active_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).bind(JSON.stringify(sessionData.active_shifts), sessionId).run();
    } catch {
      // Fallback if Sessions table has another ID format or if UserSessions is used
    }

    return {
      success: true,
      shift_token: shiftToken,
      worker: shiftData,
      message: `تم بدء وردية جديدة للعامل ${worker.name} بنجاح`,
    };
  },

  /**
   * End Shift Handler (تسجيل الخروج من الوردية)
   * 1. Finds the active shift in the session.
   * 2. Marks worker in user_profile as inactive.
   * 3. Clears active shift from session.
   * 4. Updates KV and Sessions DB.
   */
  endShift: async (
    db: D1Database,
    k1: KVNamespace,
    sessionId: string,
    shiftToken: string,
    closingCash?: number,
    notes?: string
  ) => {
    // 1. Retrieve session from KV
    const sessionStr = await k1.get(sessionId);
    if (!sessionStr) {
      return { error: 'INVALID_SESSION', message: 'الجلسة غير صالحة أو منتهية', status: 401 };
    }

    let sessionData: any;
    try {
      sessionData = JSON.parse(sessionStr);
    } catch {
      return { error: 'CORRUPT_SESSION', message: 'بيانات الجلسة غير صالحة', status: 401 };
    }

    const shiftData: ActiveShiftWorker = sessionData.active_shift || (sessionData.active_shifts && shiftToken ? sessionData.active_shifts[shiftToken] : (sessionData.active_shifts ? Object.values(sessionData.active_shifts)[0] : null));

    if (!shiftData || (shiftToken && shiftData.shift_token && shiftData.shift_token !== shiftToken && sessionData.active_shifts && !sessionData.active_shifts[shiftToken])) {
      return { error: 'SHIFT_NOT_FOUND', message: 'الوردية غير موجودة أو تم إغلاقها مسبقاً', status: 404 };
    }

    const startedAt = new Date(shiftData.started_at);
    const endedAt = new Date();
    const durationMinutes = Math.max(1, Math.round((endedAt.getTime() - startedAt.getTime()) / 60000));

    // 2. Mark shift as closed in shifts table
    const targetShiftId = shiftData.shift_id || (shiftData as any).id;
    const targetUserId = (shiftData as any).user_id || (shiftData as any).user_profile_id;
    const actualCashVal = closingCash !== undefined && closingCash !== null ? Number(closingCash) : null;
    const notesVal = notes ? notes.trim() : null;

    try {
      if (targetShiftId) {
        await db.prepare(`
          UPDATE shifts 
          SET status = 'closed',
              end_time = CURRENT_TIMESTAMP,
              actual_cash = ?,
              difference = CASE WHEN expected_cash IS NOT NULL AND ? IS NOT NULL THEN ? - expected_cash ELSE 0 END,
              notes = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ? OR (cashier_profile_id = ? AND status = 'active')
        `).bind(
          actualCashVal,
          actualCashVal,
          actualCashVal,
          notesVal,
          targetShiftId,
          targetUserId || ''
        ).run();
      } else if (targetUserId) {
        await db.prepare(`
          UPDATE shifts 
          SET status = 'closed',
              end_time = CURRENT_TIMESTAMP,
              actual_cash = ?,
              difference = CASE WHEN expected_cash IS NOT NULL AND ? IS NOT NULL THEN ? - expected_cash ELSE 0 END,
              notes = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE cashier_profile_id = ? AND status = 'active'
        `).bind(
          actualCashVal,
          actualCashVal,
          actualCashVal,
          notesVal,
          targetUserId
        ).run();
      }
    } catch (e: any) {
      logger.error('system', `Failed to update shifts table on endShift: ${e.message}`);
    }

    // 3. Mark worker as inactive in user_profile
    try {
      if ((shiftData as any).user_profile_id) {
        await db.prepare(`
          UPDATE user_profile 
          SET is_shift_active = 0, current_shift_id = NULL, updated_at = CURRENT_TIMESTAMP 
          WHERE id = ?
        `).bind((shiftData as any).user_profile_id).run();
      }
    } catch (e: any) {
      logger.error('system', `Failed to deactivate worker profile ${(shiftData as any).user_profile_id}: ${e.message}`);
    }

    // 4. Clear shift from session
    sessionData.active_shift = null;
    sessionData.active_shifts = {};

    // 5. Update KV cache
    const expiresAt = new Date(sessionData.expires_at || Date.now() + 7 * 24 * 60 * 60 * 1000);
    const remainingSeconds = Math.max(60, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
    await k1.put(sessionId, JSON.stringify(sessionData), { expirationTtl: remainingSeconds });

    // 6. Update Sessions DB table
    try {
      await db.prepare(`
        UPDATE Sessions 
        SET active_shifts = ?, last_active_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).bind(JSON.stringify(sessionData.active_shifts), sessionId).run();
    } catch {}

    const workerName = (shiftData as any).worker_name || (shiftData as any).name || 'الكاشير';

    return {
      success: true,
      message: `تم إغلاق وردية ${workerName} بنجاح`,
      shift_id: targetShiftId,
      duration_minutes: durationMinutes,
      closing_cash: closingCash,
      notes: notes,
    };
  },

  /**
   * إنشاء مستخدم ومتجر وملف شخصي مباشر وسريع (Quick Setup)
   */
  quickSetup: async (
    db: D1Database,
    data: QuickSetupInput
  ) => {
    const normalizedEmail = data.email.toLowerCase().trim();
    const phone = data.phone ? data.phone.trim() : null;

    // التحقق من عدم تكرار البريد الإلكتروني أو رقم الهاتف
    const existing = await db
      .prepare('SELECT id, email, phone FROM Users WHERE email = ? OR (phone IS NOT NULL AND phone = ?)')
      .bind(normalizedEmail, phone || '')
      .first() as any;

    if (existing) {
      if (existing.email === normalizedEmail) {
        return { error: 'EMAIL_ALREADY_EXISTS', message: 'البريد الإلكتروني مسجل بالفعل', status: 409 };
      }
      if (phone && existing.phone === phone) {
        return { error: 'PHONE_ALREADY_EXISTS', message: 'رقم الهاتف مسجل بالفعل', status: 409 };
      }
    }

    const userId = crypto.randomUUID();
    const dashboardId = crypto.randomUUID();
    const passwordHash = await hashPassword(data.password);
    const storeName = data.store_name?.trim() || `محل ${data.full_name.trim()} للهواتف`;
    const storePhone = phone || normalizedEmail;
    
    // إنشاء slug مميز
    const slugPrefix = storeName
      .toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06FF]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 24) || 'store';
    const slug = `${slugPrefix}-${dashboardId.substring(0, 6)}`;
    const nowIso = new Date().toISOString();

    await db.batch([
      // 1. إنشاء لوحة التحكم / المتجر في جدول Dashboards
      db.prepare(`
        INSERT INTO Dashboards (id, name, slug, phone, email, password_hash, is_default, status, is_banned, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, 'active', 0, ?, ?)
      `).bind(dashboardId, storeName, slug, storePhone, normalizedEmail, passwordHash, nowIso, nowIso),

      // 2. إنشاء حساب المالك في جدول Users بحساب موحد (role: owner)
      db.prepare(`
        INSERT INTO Users (
          id, dashboard_id, name, phone, email, password_hash,
          role, job_title, permissions, salary, commission_rate, max_discount_rate,
          can_open_drawer, can_view_cost_price, is_active, is_banned, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'owner', 'المالك / صاحب المحل', '{"*": true}', 0.0, 0.0, 100.0, 1, 1, 1, 0, ?, ?)
      `).bind(userId, dashboardId, data.full_name.trim(), phone, normalizedEmail, passwordHash, nowIso, nowIso)
    ]);

    return {
      success: true,
      data: {
        user_id: userId,
        dashboard_id: dashboardId,
        full_name: data.full_name.trim(),
        email: normalizedEmail,
        phone: phone,
        store_name: storeName,
        role: 'owner'
      }
    };
  },

  /**
   * تسجيل دخول المتجر / لوحة التحكم
   */
  storeLogin: async (db: D1Database, phone: string, password: string) => {
    const normalizedPhone = phone.trim();
    const store = await db.prepare(`
      SELECT id, name, slug, phone, password_hash, is_banned, ban_reason
      FROM Dashboards
      WHERE phone = ? OR email = ?
    `).bind(normalizedPhone, normalizedPhone).first() as any;

    if (!store) {
      return { error: 'STORE_NOT_FOUND', message: 'لم يتم العثور على متجر مسجل بهذا الهاتف أو البريد', status: 404 };
    }

    if (store.is_banned === 1) {
      return { error: 'STORE_SUSPENDED', message: 'تم إيقاف هذا المتجر من قبل إدارة المنصة', status: 403 };
    }

    const isMatch = await verifyPassword(password, store.password_hash);
    if (!isMatch) {
      return { error: 'INVALID_CREDENTIALS', message: 'كلمة مرور المتجر غير صحيحة', status: 401 };
    }

    return {
      success: true,
      data: {
        dashboard_id: store.id,
        name: store.name,
        slug: store.slug
      }
    };
  },

  /**
   * استرجاع حسابات المتجر المتاحة (للاختيار منها عند بدء الوردية)
   */
  getStoreAccounts: async (db: D1Database, dashboardId: string) => {
    if (!dashboardId) {
      return { error: 'NO_DASHBOARD_ID', message: 'معرف المتجر غير متوفر', status: 400 };
    }

    const accounts = await db.prepare(`
      SELECT id, name, role, job_title, phone
      FROM Users
      WHERE dashboard_id = ? AND is_active = 1 AND (is_banned = 0 OR is_banned IS NULL)
      ORDER BY CASE WHEN role = 'owner' THEN 0 ELSE 1 END, name ASC
    `).bind(dashboardId).all() as any;

    return {
      success: true,
      accounts: (accounts?.results || []).map((row: any) => ({
        id: row.id,
        name: row.name,
        role: row.role, // strictly 'owner' or 'user'
        job_title: row.job_title || (row.role === 'owner' ? 'المالك' : 'موظف'),
        phone: row.phone || ''
      }))
    };
  },

  /**
   * تسجيل دخول المستخدم وبدء الوردية (جلسة واحدة للجهاز، كلمة مرور بدون PIN)
   */
  loginShift: async (
    db: D1Database,
    k1: KVNamespace,
    data: {
      dashboard_id: string;
      user_id: string;
      password: string;
      opening_cash?: number;
      device_fingerprint?: string;
      ip_address?: string;
      user_agent?: string;
    }
  ) => {
    const user = await db.prepare(`
      SELECT id, dashboard_id, name, phone, role, job_title, password_hash, permissions, is_active, is_banned
      FROM Users
      WHERE id = ? AND dashboard_id = ?
    `).bind(data.user_id, data.dashboard_id).first() as any;

    if (!user) {
      return { error: 'USER_NOT_FOUND', message: 'المستخدم غير مسجل بهذا المتجر', status: 404 };
    }

    if (user.is_banned === 1) {
      return { error: 'ACCOUNT_BANNED', message: 'تم إيقاف هذا الحساب من قبل إدارة المتجر', status: 403 };
    }

    if (user.is_active === 0) {
      return { error: 'ACCOUNT_INACTIVE', message: 'هذا الحساب معطل حالياً', status: 403 };
    }

    const isMatch = await verifyPassword(data.password, user.password_hash);
    if (!isMatch) {
      return { error: 'INVALID_CREDENTIALS', message: 'كلمة المرور غير صحيحة', status: 401 };
    }

    const dashboard = await db.prepare(`
      SELECT id, name, slug, is_banned FROM Dashboards WHERE id = ?
    `).bind(data.dashboard_id).first() as any;

    if (!dashboard || dashboard.is_banned === 1) {
      return { error: 'STORE_SUSPENDED', message: 'المتجر موقوف', status: 403 };
    }

    // 1. تطبيق جلسة واحدة فقط للجهاز والمستخدم
    const fingerprint = data.device_fingerprint || 'default_terminal';
    const existingSessions = await db.prepare(`
      SELECT id FROM Sessions WHERE device_fingerprint = ? OR user_id = ?
    `).bind(fingerprint, user.id).all() as any;

    if (existingSessions?.results) {
      for (const s of existingSessions.results) {
        try { await k1.delete(s.id); } catch {}
      }
      await db.prepare(`DELETE FROM Sessions WHERE device_fingerprint = ? OR user_id = ?`).bind(fingerprint, user.id).run();
    }

    // 2. إغلاق أي وردية سابقة مفتوحة لنفس المستخدم
    await db.prepare(`
      UPDATE shifts SET status = 'closed', end_time = CURRENT_TIMESTAMP
      WHERE cashier_profile_id = ? AND status = 'active'
    `).bind(user.id).run();

    // 3. إنشاء وردية جديدة
    const shiftId = crypto.randomUUID();
    const openingCash = Number(data.opening_cash) || 0;
    await db.prepare(`
      INSERT INTO shifts (
        id, dashboard_id, shift_number, cashier_profile_id, cashier_name,
        opening_cash, status, start_time
      ) VALUES (
        ?, ?, (SELECT COALESCE(MAX(shift_number), 0) + 1 FROM shifts WHERE dashboard_id = ?),
        ?, ?, ?, 'active', CURRENT_TIMESTAMP
      )
    `).bind(shiftId, dashboard.id, dashboard.id, user.id, user.name, openingCash).run();

    // 4. إنشاء الجلسة في KV وجدول Sessions
    const sessionId = `session:${crypto.randomUUID()}`;
    let permissions: Record<string, boolean> = {};
    if (user.permissions) {
      if (typeof user.permissions === 'string') {
        try { permissions = JSON.parse(user.permissions); } catch {}
      } else {
        permissions = user.permissions;
      }
    }
    if (user.role === 'owner') {
      permissions = { '*': true };
    }

    const activeShift = {
      shift_id: shiftId,
      user_id: user.id,
      name: user.name,
      role: user.role, // 'owner' | 'user'
      job_title: user.job_title,
      permissions: permissions,
      opening_cash: openingCash,
      started_at: new Date().toISOString(),
      is_banned: false,
      ban_reason: null
    };

    const sessionData = {
      session_id: sessionId,
      dashboard_id: dashboard.id,
      dashboard_name: dashboard.name,
      dashboard_slug: dashboard.slug,
      user_id: user.id,
      name: user.name,
      role: user.role,
      device_fingerprint: fingerprint,
      ip_address: data.ip_address || 'unknown',
      user_agent: data.user_agent || 'unknown',
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      active_shift: activeShift
    };

    await k1.put(sessionId, JSON.stringify(sessionData), { expirationTtl: 30 * 24 * 60 * 60 });

    await db.prepare(`
      INSERT INTO Sessions (
        id, dashboard_id, user_id, shift_id, device_fingerprint,
        ip_address, user_agent, active_shift, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      sessionId, dashboard.id, user.id, shiftId, fingerprint,
      data.ip_address || null, data.user_agent || null,
      JSON.stringify(activeShift), sessionData.expires_at
    ).run();

    return {
      success: true,
      data: {
        sessionId,
        user: {
          id: user.id,
          dashboard_id: dashboard.id,
          name: user.name,
          role: user.role,
          job_title: user.job_title,
          permissions: permissions,
          active_shift: activeShift
        },
        dashboard: {
          id: dashboard.id,
          name: dashboard.name,
          slug: dashboard.slug
        }
      }
    };
  },

  /**
   * Retrieves active worker profiles for a specific store/dashboard from Users.
   */
  getStoreStaff: async (db: D1Database, dashboardId: string) => {
    if (!dashboardId) {
      return { error: 'NO_DASHBOARD_ID', message: 'معرف المتجر غير متوفر', status: 400 };
    }

    const staffQuery = `
      SELECT 
        id, 
        dashboard_id, 
        name, 
        phone, 
        role, 
        job_title, 
        permissions,
        is_active
      FROM Users
      WHERE dashboard_id = ? AND is_active = 1 AND (is_banned = 0 OR is_banned IS NULL)
      ORDER BY CASE WHEN role = 'owner' THEN 0 ELSE 1 END, name ASC
    `;

    const result = await db.prepare(staffQuery).bind(dashboardId).all();
    const staff = (result.results || []).map((row: any) => {
      let parsedPermissions: Record<string, boolean> = {};
      if (row.permissions) {
        try {
          parsedPermissions = typeof row.permissions === 'string' ? JSON.parse(row.permissions) : row.permissions;
        } catch {
          parsedPermissions = {};
        }
      }

      return {
        id: row.id,
        name: row.name,
        role: row.role === 'owner' ? 'admin' : 'cashier',
        phone: row.phone || '',
        job_title: row.job_title || (row.role === 'owner' ? 'صاحب المحل' : 'موظف'),
        permissions: parsedPermissions,
        active: Boolean(row.is_active),
        is_shift_active: false,
      };
    });

    return { staff };
  },

  /**
   * Verifies the store owner's password for returning to owner mode.
   */
  verifyOwnerPassword: async (db: D1Database, userId: string, password: string) => {
    if (!userId) {
      return { error: 'UNAUTHORIZED', message: 'غير مصرح - لم يتم العثور على حساب المالك بالجلسة', status: 401 };
    }

    const user = await db.prepare(`SELECT id, password_hash, is_banned FROM Users WHERE id = ?`).bind(userId).first() as any;
    if (!user) {
      return { error: 'USER_NOT_FOUND', message: 'حساب المستخدم غير موجود', status: 404 };
    }

    if (user.is_banned) {
      return { error: 'ACCOUNT_BANNED', message: 'هذا الحساب محظور', status: 403 };
    }

    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      return { error: 'INVALID_PASSWORD', message: 'كلمة المرور غير صحيحة', status: 401 };
    }

    return { success: true };
  }
};
