import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { SettingsService } from '../../src/services/settings.services';
import settingsRoutes, { requireAdminOrOwner } from '../../src/routes/settings.routes';
import { Hono } from 'hono';
import { AppContext } from '../../src/types';

describe('Empirical Verification: Settings Multi-Tenancy, RBAC & Security Logic', () => {
  const TENANT_1_ID = 'dash_tenant_alpha_111';
  const TENANT_2_ID = 'dash_tenant_beta_222';

  const TENANT_1_PHONE = '+201011111111';
  const TENANT_2_PHONE = '+201022222222';

  // DDL matching 0000_auth.sql for Dashboards table
  const createDashboardsTable = `
    CREATE TABLE IF NOT EXISTS Dashboards (
      id                          TEXT PRIMARY KEY,
      name                        TEXT NOT NULL,
      slug                        TEXT UNIQUE NOT NULL,
      phone                       TEXT UNIQUE NOT NULL,
      email                       TEXT,
      password_hash               TEXT NOT NULL,
      tagline                     TEXT,
      logo_url                    TEXT,
      address                     TEXT,
      city                        TEXT,
      currency                    TEXT DEFAULT 'EGP',
      timezone                    TEXT DEFAULT 'Africa/Cairo',
      receipt_header              TEXT,
      receipt_footer              TEXT,
      receipt_terms               TEXT,
      enable_thermal_print        INTEGER DEFAULT 1,
      thermal_paper_size          TEXT DEFAULT '80mm' CHECK (
          thermal_paper_size IN ('80mm', '58mm')
      ),
      show_tax_invoice            INTEGER DEFAULT 0,
      tax_rate                    REAL DEFAULT 0.0,
      repair_terms                TEXT,
      default_repair_warranty_days INTEGER DEFAULT 30,
      require_imei_for_phones     INTEGER DEFAULT 1,
      opening_cash_default        REAL DEFAULT 5000.0,
      enable_telecom_wallets      INTEGER DEFAULT 1,
      theme                       TEXT DEFAULT 'dark' CHECK (
          theme IN ('dark', 'light', 'system')
      ),
      locale                      TEXT DEFAULT 'ar' CHECK (
          locale IN ('ar', 'en')
      ),
      is_default                  INTEGER DEFAULT 1,
      status                      TEXT DEFAULT 'active' CHECK (
          status IN ('active', 'suspended', 'archived', 'maintenance')
      ),
      is_banned                   INTEGER DEFAULT 0,
      ban_reason                  TEXT,
      created_at                  DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at                  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `;

  beforeAll(async () => {
    // Ensure table exists in Miniflare D1
    await env.DB.prepare(createDashboardsTable).run();
  });

  beforeEach(async () => {
    // Clean and seed two isolated tenant dashboards
    await env.DB.prepare('DELETE FROM Dashboards').run();

    await env.DB.prepare(`
      INSERT INTO Dashboards (
        id, name, slug, phone, email, password_hash, tagline, logo_url,
        address, city, currency, timezone, receipt_header, receipt_footer, receipt_terms,
        enable_thermal_print, thermal_paper_size, show_tax_invoice, tax_rate,
        repair_terms, default_repair_warranty_days, require_imei_for_phones,
        opening_cash_default, enable_telecom_wallets, theme, locale,
        is_default, status, is_banned, ban_reason
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?
      )
    `).bind(
      TENANT_1_ID, 'Alpha Shop', 'alpha-shop', TENANT_1_PHONE, 'alpha@mobidash.com', 'SECRET_HASH_ALPHA', 'Alpha Best Store', 'https://alpha.com/logo.png',
      '123 Nile St', 'Cairo', 'EGP', 'Africa/Cairo', 'Alpha Header', 'Alpha Footer', 'Alpha Terms',
      1, '80mm', 0, 14.0,
      'Repair Policy 1', 45, 1,
      6000.0, 1, 'dark', 'ar',
      1, 'active', 0, null
    ).run();

    await env.DB.prepare(`
      INSERT INTO Dashboards (
        id, name, slug, phone, email, password_hash, tagline, logo_url,
        address, city, currency, timezone, receipt_header, receipt_footer, receipt_terms,
        enable_thermal_print, thermal_paper_size, show_tax_invoice, tax_rate,
        repair_terms, default_repair_warranty_days, require_imei_for_phones,
        opening_cash_default, enable_telecom_wallets, theme, locale,
        is_default, status, is_banned, ban_reason
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?
      )
    `).bind(
      TENANT_2_ID, 'Beta Shop', 'beta-shop', TENANT_2_PHONE, 'beta@mobidash.com', 'SECRET_HASH_BETA', 'Beta Best Store', 'https://beta.com/logo.png',
      '456 Corniche', 'Alexandria', 'USD', 'Africa/Cairo', 'Beta Header', 'Beta Footer', 'Beta Terms',
      0, '58mm', 1, 10.0,
      'Repair Policy 2', 30, 0,
      3000.0, 0, 'light', 'en',
      0, 'active', 0, null
    ).run();
  });

  // ============================================================================
  // 1. Multi-Tenancy Isolation Tests
  // ============================================================================
  describe('Multi-Tenancy Isolation', () => {
    it('1.1 should strictly query settings by dashboard_id and never leak other tenant data', async () => {
      const alphaSettings = await SettingsService.getSettings(env.DB, TENANT_1_ID);
      expect(alphaSettings).not.toBeNull();
      expect(alphaSettings?.id).toBe(TENANT_1_ID);
      expect(alphaSettings?.name).toBe('Alpha Shop');
      expect(alphaSettings?.phone).toBe(TENANT_1_PHONE);

      const betaSettings = await SettingsService.getSettings(env.DB, TENANT_2_ID);
      expect(betaSettings).not.toBeNull();
      expect(betaSettings?.id).toBe(TENANT_2_ID);
      expect(betaSettings?.name).toBe('Beta Shop');
      expect(betaSettings?.phone).toBe(TENANT_2_PHONE);
    });

    it('1.2 should strictly isolate updates: updating Tenant 1 does not mutate Tenant 2', async () => {
      const updateResult = await SettingsService.updateSettings(env.DB, TENANT_1_ID, {
        name: 'Alpha Shop Modified',
        currency: 'EUR',
      });

      expect('error' in updateResult).toBe(false);
      if (!('error' in updateResult)) {
        expect(updateResult.name).toBe('Alpha Shop Modified');
        expect(updateResult.currency).toBe('EUR');
      }

      // Tenant 2 MUST remain completely unaltered
      const betaSettings = await SettingsService.getSettings(env.DB, TENANT_2_ID);
      expect(betaSettings?.name).toBe('Beta Shop');
      expect(betaSettings?.currency).toBe('USD');
    });

    it('1.3 should safely parameterize malicious SQL injection attempts in dashboardId', async () => {
      const sqlInjectionPayload = `${TENANT_1_ID}' OR '1'='1`;
      const result = await SettingsService.getSettings(env.DB, sqlInjectionPayload);
      // Because of parameterization, no row matches the literal string with quotes
      expect(result).toBeNull();
    });

    it('1.4 should safely reject empty or whitespace dashboardId', async () => {
      expect(await SettingsService.getSettings(env.DB, '')).toBeNull();
      expect(await SettingsService.getSettings(env.DB, '   ')).toBeNull();

      const updateResEmpty = await SettingsService.updateSettings(env.DB, '', { name: 'Test' });
      expect('error' in updateResEmpty && updateResEmpty.error).toBe('INVALID_DASHBOARD_ID');

      const updateResSpaces = await SettingsService.updateSettings(env.DB, '   ', { name: 'Test' });
      expect('error' in updateResSpaces && updateResSpaces.error).toBe('INVALID_DASHBOARD_ID');
    });

    it('1.5 should return 404 error if updating non-existent dashboardId', async () => {
      const res = await SettingsService.updateSettings(env.DB, 'non-existent-uuid', { name: 'Test' });
      expect('error' in res).toBe(true);
      if ('error' in res) {
        expect(res.status).toBe(404);
        expect(res.error).toBe('SETTINGS_NOT_FOUND');
      }
    });
  });

  // ============================================================================
  // 2. Sensitive Credentials & Domain Constraints
  // ============================================================================
  describe('Domain Constraints & Sensitive Credentials', () => {
    it('2.1 should NEVER expose password_hash or internal audit flags in getSettings or updateSettings', async () => {
      const settings = await SettingsService.getSettings(env.DB, TENANT_1_ID);
      expect(settings).not.toBeNull();
      expect((settings as any).password_hash).toBeUndefined();
      expect((settings as any).is_banned).toBeUndefined();
      expect((settings as any).ban_reason).toBeUndefined();
      expect((settings as any).status).toBeUndefined();
      expect((settings as any).is_default).toBeUndefined();

      const updated = await SettingsService.updateSettings(env.DB, TENANT_1_ID, { name: 'Alpha Brand' });
      expect((updated as any).password_hash).toBeUndefined();
      expect((updated as any).is_banned).toBeUndefined();
      expect((updated as any).ban_reason).toBeUndefined();
      expect((updated as any).status).toBeUndefined();
      expect((updated as any).is_default).toBeUndefined();

      // Check raw DB to ensure password_hash in DB wasn't altered or wiped
      const rawRow = await env.DB.prepare('SELECT password_hash FROM Dashboards WHERE id = ?')
        .bind(TENANT_1_ID)
        .first<{ password_hash: string }>();
      expect(rawRow?.password_hash).toBe('SECRET_HASH_ALPHA');
    });

    it('2.2 should reject duplicate phone with 409 Conflict if phone belongs to another dashboard', async () => {
      // Tenant 1 attempts to use Tenant 2's phone
      const res = await SettingsService.updateSettings(env.DB, TENANT_1_ID, {
        phone: TENANT_2_PHONE,
      });

      expect('error' in res).toBe(true);
      if ('error' in res) {
        expect(res.status).toBe(409);
        expect(res.error).toBe('PHONE_ALREADY_IN_USE');
        expect(res.message).toBe('رقم الهاتف مسجل بالفعل لمتجر آخر');
      }

      // Check Tenant 1 phone remained unchanged
      const current = await SettingsService.getSettings(env.DB, TENANT_1_ID);
      expect(current?.phone).toBe(TENANT_1_PHONE);
    });

    it('2.3 should allow updating phone to its own current phone without 409 conflict', async () => {
      // Tenant 1 supplies its existing phone
      const res = await SettingsService.updateSettings(env.DB, TENANT_1_ID, {
        phone: TENANT_1_PHONE,
        tagline: 'Updated Tagline',
      });

      expect('error' in res).toBe(false);
      if (!('error' in res)) {
        expect(res.phone).toBe(TENANT_1_PHONE);
        expect(res.tagline).toBe('Updated Tagline');
      }
    });

    it('2.4 should correctly map SQLite integer flags (0/1) to JavaScript booleans', async () => {
      // Tenant 1 initially has enable_thermal_print: 1, show_tax_invoice: 0
      const initial = await SettingsService.getSettings(env.DB, TENANT_1_ID);
      expect(initial?.enable_thermal_print).toBe(true);
      expect(initial?.show_tax_invoice).toBe(false);
      expect(initial?.require_imei_for_phones).toBe(true);
      expect(initial?.enable_telecom_wallets).toBe(true);

      // Invert flags
      const updated = await SettingsService.updateSettings(env.DB, TENANT_1_ID, {
        enable_thermal_print: false,
        show_tax_invoice: true,
        require_imei_for_phones: false,
        enable_telecom_wallets: false,
      });

      expect('error' in updated).toBe(false);
      if (!('error' in updated)) {
        expect(updated.enable_thermal_print).toBe(false);
        expect(updated.show_tax_invoice).toBe(true);
        expect(updated.require_imei_for_phones).toBe(false);
        expect(updated.enable_telecom_wallets).toBe(false);
      }

      // Verify raw SQLite column values are integers 0 and 1
      const raw = await env.DB.prepare(`
        SELECT enable_thermal_print, show_tax_invoice, require_imei_for_phones, enable_telecom_wallets
        FROM Dashboards WHERE id = ?
      `).bind(TENANT_1_ID).first<any>();

      expect(raw.enable_thermal_print).toBe(0);
      expect(raw.show_tax_invoice).toBe(1);
      expect(raw.require_imei_for_phones).toBe(0);
      expect(raw.enable_telecom_wallets).toBe(0);
    });

    it('2.5 should safely preserve legitimate zero values (tax_rate: 0, opening_cash_default: 0) using ??', async () => {
      // Update with zero values
      const updated = await SettingsService.updateSettings(env.DB, TENANT_1_ID, {
        tax_rate: 0,
        opening_cash_default: 0,
        default_repair_warranty_days: 0,
      });

      expect('error' in updated).toBe(false);
      if (!('error' in updated)) {
        expect(updated.tax_rate).toBe(0);
        expect(updated.opening_cash_default).toBe(0);
        expect(updated.default_repair_warranty_days).toBe(0);
      }

      // Re-read directly via getSettings
      const reread = await SettingsService.getSettings(env.DB, TENANT_1_ID);
      expect(reread?.tax_rate).toBe(0);
      expect(reread?.opening_cash_default).toBe(0);
      expect(reread?.default_repair_warranty_days).toBe(0);
    });

    it('2.6 should support partial updates and preserve unspecified fields', async () => {
      const initial = await SettingsService.getSettings(env.DB, TENANT_1_ID);
      const initialAddress = initial?.address;
      const initialCity = initial?.city;

      // Only update name
      const updated = await SettingsService.updateSettings(env.DB, TENANT_1_ID, {
        name: 'Brand New Alpha Name',
      });

      expect('error' in updated).toBe(false);
      if (!('error' in updated)) {
        expect(updated.name).toBe('Brand New Alpha Name');
        // Unspecified fields remain untouched
        expect(updated.address).toBe(initialAddress);
        expect(updated.city).toBe(initialCity);
      }
    });

    it('2.7 should handle empty payload as a clean no-op', async () => {
      const initial = await SettingsService.getSettings(env.DB, TENANT_1_ID);
      const updated = await SettingsService.updateSettings(env.DB, TENANT_1_ID, {});
      expect('error' in updated).toBe(false);
      if (!('error' in updated)) {
        expect(updated.name).toBe(initial?.name);
      }
    });
  });

  // ============================================================================
  // 3. RBAC Guardrails & HTTP Transport Tests
  // ============================================================================
  describe('RBAC Guardrails & HTTP Layer', () => {
    // Construct test Hono app using the actual router
    const createTestApp = (userContext: any) => {
      const app = new Hono<AppContext>();
      app.use('*', async (c, next) => {
        c.set('user', userContext);
        c.set('requestId', 'req-test-uuid');
        c.env = { DB: env.DB } as any;
        await next();
      });
      app.route('/api/settings', settingsRoutes);
      return app;
    };

    it('3.1 GET /api/settings should allow cashier/technician with role "user"', async () => {
      const app = createTestApp({
        id: 'user_cashier',
        email: 'cashier@mobidash.com',
        role: 'user',
        dashboard_id: TENANT_1_ID,
      });

      const res = await app.request('/api/settings', { method: 'GET' });
      expect(res.status).toBe(200);

      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.slug).toBe('SETTINGS_FETCHED');
      expect(body.data.settings.name).toBe('Alpha Shop');
    });

    it('3.2 GET /api/settings should allow admin and owner roles', async () => {
      const appAdmin = createTestApp({
        id: 'user_admin',
        email: 'admin@mobidash.com',
        role: 'admin',
        dashboard_id: TENANT_1_ID,
      });
      const resAdmin = await appAdmin.request('/api/settings', { method: 'GET' });
      expect(resAdmin.status).toBe(200);

      const appOwner = createTestApp({
        id: 'user_owner',
        email: 'owner@mobidash.com',
        role: 'owner',
        dashboard_id: TENANT_1_ID,
      });
      const resOwner = await appOwner.request('/api/settings', { method: 'GET' });
      expect(resOwner.status).toBe(200);
    });

    it('3.3 PATCH /api/settings should REJECT non-admin/non-owner role "user" with 403 Forbidden', async () => {
      const appUser = createTestApp({
        id: 'user_cashier',
        email: 'cashier@mobidash.com',
        role: 'user', // Cashier / Staff
        dashboard_id: TENANT_1_ID,
      });

      const res = await appUser.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Hacked Store Name' }),
      });

      expect(res.status).toBe(403);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
      expect(body.slug).toBe('FORBIDDEN');
      expect(body.message).toContain('Admin / Owner');

      // Verify DB was NOT updated
      const current = await SettingsService.getSettings(env.DB, TENANT_1_ID);
      expect(current?.name).toBe('Alpha Shop');
    });

    it('3.4 PATCH /api/settings should REJECT unauthorized roles (viewer, manager, guest) with 403 Forbidden', async () => {
      for (const role of ['viewer', 'manager', 'guest', 'staff']) {
        const app = createTestApp({
          id: `user_${role}`,
          email: `${role}@mobidash.com`,
          role,
          dashboard_id: TENANT_1_ID,
        });

        const res = await app.request('/api/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Unauthorized Change' }),
        });

        expect(res.status).toBe(403);
        const body = await res.json() as any;
        expect(body.slug).toBe('FORBIDDEN');
      }
    });

    it('3.5 PATCH /api/settings should ALLOW owner and admin roles (case-insensitive)', async () => {
      // Test 'owner'
      const appOwner = createTestApp({
        id: 'user_owner',
        email: 'owner@mobidash.com',
        role: 'owner',
        dashboard_id: TENANT_1_ID,
      });

      const resOwner = await appOwner.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Owner Updated Alpha' }),
      });

      expect(resOwner.status).toBe(200);
      const bodyOwner = await resOwner.json() as any;
      expect(bodyOwner.success).toBe(true);
      expect(bodyOwner.slug).toBe('SETTINGS_UPDATED');
      expect(bodyOwner.data.settings.name).toBe('Owner Updated Alpha');

      // Test 'Admin' (capitalized)
      const appAdmin = createTestApp({
        id: 'user_admin',
        email: 'admin@mobidash.com',
        role: 'Admin',
        dashboard_id: TENANT_1_ID,
      });

      const resAdmin = await appAdmin.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagline: 'Admin Updated Tagline' }),
      });

      expect(resAdmin.status).toBe(200);
      const bodyAdmin = await resAdmin.json() as any;
      expect(bodyAdmin.success).toBe(true);
      expect(bodyAdmin.data.settings.tagline).toBe('Admin Updated Tagline');
    });

    it('3.6 PATCH /api/settings should reject unauthorized/system fields via Zod .strict() with 400 Bad Request', async () => {
      const appOwner = createTestApp({
        id: 'user_owner',
        email: 'owner@mobidash.com',
        role: 'owner',
        dashboard_id: TENANT_1_ID,
      });

      // Attack: attempt mass assignment of sensitive internal fields
      const attackPayloads = [
        { password_hash: 'evil_hash' },
        { is_banned: 0 },
        { status: 'archived' },
        { is_default: 1 },
        { arbitrary_hacked_field: 'malicious' },
      ];

      for (const payload of attackPayloads) {
        const res = await appOwner.request('/api/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        expect(res.status).toBe(400);
        const body = await res.json() as any;
        expect(body.success).toBe(false);
        expect(body.slug).toBe('VALIDATION_ERROR');
      }
    });

    it('3.7 PATCH /api/settings should reject out-of-bound values with 400 Bad Request', async () => {
      const appOwner = createTestApp({
        id: 'user_owner',
        email: 'owner@mobidash.com',
        role: 'owner',
        dashboard_id: TENANT_1_ID,
      });

      // Invalid tax_rate (> 100 or < 0)
      const resTaxHigh = await appOwner.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tax_rate: 150 }),
      });
      expect(resTaxHigh.status).toBe(400);

      const resTaxNeg = await appOwner.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tax_rate: -1 }),
      });
      expect(resTaxNeg.status).toBe(400);

      // Invalid thermal_paper_size enum
      const resPaper = await appOwner.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thermal_paper_size: '120mm' }),
      });
      expect(resPaper.status).toBe(400);

      // Invalid theme enum
      const resTheme = await appOwner.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: 'solarized' }),
      });
      expect(resTheme.status).toBe(400);

      // Invalid locale enum
      const resLocale = await appOwner.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: 'fr' }),
      });
      expect(resLocale.status).toBe(400);
    });

    it('3.8 should return 401 Unauthorized if user is not authenticated or dashboard_id is missing', async () => {
      // Unauthenticated (no user)
      const appNoUser = createTestApp(null);
      const resGetNoUser = await appNoUser.request('/api/settings', { method: 'GET' });
      expect(resGetNoUser.status).toBe(401);

      const resPatchNoUser = await appNoUser.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });
      // requireAdminOrOwner intercepts first and returns 403 (or 401 if user missing)
      expect([401, 403]).toContain(resPatchNoUser.status);

      // Authenticated but no dashboard_id
      const appNoDash = createTestApp({ id: 'u1', email: 'u1@test.com', role: 'admin' });
      const resGetNoDash = await appNoDash.request('/api/settings', { method: 'GET' });
      expect(resGetNoDash.status).toBe(401);
    });
  });

  // ============================================================================
  // 4. Adversarial Stress Testing & Edge Cases
  // ============================================================================
  describe('Adversarial Stress Testing & Edge Cases', () => {
    const createTestApp = (userContext: any) => {
      const app = new Hono<AppContext>();
      app.use('*', async (c, next) => {
        c.set('user', userContext);
        c.set('requestId', 'req-test-uuid');
        c.env = { DB: env.DB } as any;
        await next();
      });
      app.route('/api/settings', settingsRoutes);
      return app;
    };

    it('4.1 should strip XSS payloads in string fields via sanitizeForDb', async () => {
      const appOwner = createTestApp({
        id: 'user_owner',
        email: 'owner@mobidash.com',
        role: 'owner',
        dashboard_id: TENANT_1_ID,
      });

      const res = await appOwner.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tagline: '<script>alert("xss")</script>Safe Tagline',
          address: '<iframe src="evil.com"></iframe>Cairo, Egypt',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.data.settings.tagline).not.toContain('<script>');
      expect(body.data.settings.address).not.toContain('<iframe');
    });

    it('4.2 should clear nullable fields when explicitly passed null or empty string ""', async () => {
      const appOwner = createTestApp({
        id: 'user_owner',
        email: 'owner@mobidash.com',
        role: 'owner',
        dashboard_id: TENANT_1_ID,
      });

      // Clear tagline with null, clear address with ""
      const res = await appOwner.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tagline: null,
          address: '',
          receipt_terms: null,
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.data.settings.tagline).toBeNull();
      expect(body.data.settings.address).toBeNull();
      expect(body.data.settings.receipt_terms).toBeNull();

      // Check DB directly
      const raw = await env.DB.prepare('SELECT tagline, address, receipt_terms FROM Dashboards WHERE id = ?')
        .bind(TENANT_1_ID)
        .first<any>();
      expect(raw.tagline).toBeNull();
      expect(raw.address).toBeNull();
      expect(raw.receipt_terms).toBeNull();
    });

    it('4.3 should accurately support floating point numbers for tax_rate', async () => {
      const appOwner = createTestApp({
        id: 'user_owner',
        email: 'owner@mobidash.com',
        role: 'owner',
        dashboard_id: TENANT_1_ID,
      });

      const res = await appOwner.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tax_rate: 14.25 }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.data.settings.tax_rate).toBe(14.25);
    });

    it('4.4 should reject non-integer warranty days with 400 Bad Request', async () => {
      const appOwner = createTestApp({
        id: 'user_owner',
        email: 'owner@mobidash.com',
        role: 'owner',
        dashboard_id: TENANT_1_ID,
      });

      const res = await appOwner.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_repair_warranty_days: 14.5 }),
      });

      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.slug).toBe('VALIDATION_ERROR');
    });

    it('4.5 should strictly prevent cross-tenant parameter tampering via payload ID', async () => {
      const appOwner = createTestApp({
        id: 'user_owner',
        email: 'owner@mobidash.com',
        role: 'owner',
        dashboard_id: TENANT_1_ID,
      });

      // Tenant 1 tries to send id of Tenant 2 in body
      const res = await appOwner.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: TENANT_2_ID,
          name: 'Hacked Beta Name',
        }),
      });

      // Zod .strict() immediately rejects unknown field 'id' with 400
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.slug).toBe('VALIDATION_ERROR');

      // Check Tenant 2 was not modified
      const betaSettings = await SettingsService.getSettings(env.DB, TENANT_2_ID);
      expect(betaSettings?.name).toBe('Beta Shop');
    });

    it('4.6 should test boundary values (tax_rate: 100, warranty_days: 3650, opening_cash: 10000000)', async () => {
      const appOwner = createTestApp({
        id: 'user_owner',
        email: 'owner@mobidash.com',
        role: 'owner',
        dashboard_id: TENANT_1_ID,
      });

      const res = await appOwner.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tax_rate: 100,
          default_repair_warranty_days: 3650,
          opening_cash_default: 10000000,
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.data.settings.tax_rate).toBe(100);
      expect(body.data.settings.default_repair_warranty_days).toBe(3650);
      expect(body.data.settings.opening_cash_default).toBe(10000000);
    });
  });
});

