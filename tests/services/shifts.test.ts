import { describe, it, expect, vi, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { AuthService } from '../../src/services/auth.services';
import { sessionMiddleware, requireActiveShift } from '../../src/middleware/session';
import { Hono } from 'hono';
import { AppContext } from '../../src/types';

describe('Single Active Shift & Session Architecture', () => {
  const sessionId = 'session:user_pos_1:uuid_pos_session';
  const dashboardId = 'dash_main_branch';
  const workerProfileId = 'prof_worker_cashier_1';

  beforeEach(async () => {
    // Clear KV
    await env.K1.delete(sessionId);
  });

  it('1. should create a flat terminal session in KV without user_profile tuple', async () => {
    // Prepare mock DB
    const mockDb = {
      prepare: vi.fn().mockImplementation((query: string) => ({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({
          id: 'user_1',
          email: 'store@mobidash.com',
          full_name: 'Store Terminal',
          password_hash: 'hashed_pwd',
          is_banned: 0,
          is_email_verified: 1,
        }),
        all: vi.fn().mockResolvedValue({
          results: [
            {
              id: 'prof_owner',
              dashboard_id: dashboardId,
              role: 'owner',
              permissions: null,
              is_banned: 0,
            }
          ]
        }),
        run: vi.fn().mockResolvedValue({ success: true }),
      })),
    } as any;

    // Spy on crypto verifyPassword
    const { verifyPassword } = await import('../../src/utils/crypto');
    vi.spyOn(await import('../../src/utils/crypto'), 'verifyPassword').mockResolvedValue(true);

    const loginRes = await AuthService.login(
      mockDb,
      env.K1,
      'store@mobidash.com',
      'password123',
      false,
      'Chrome Test',
      '1.2.3.4'
    );

    expect(loginRes.sessionId).toBeDefined();
    const storedSessionStr = await env.K1.get(loginRes.sessionId as string);
    expect(storedSessionStr).toBeDefined();

    const storedSession = JSON.parse(storedSessionStr as string);
    // Verifying user_profile is NOT stored in KV
    expect(storedSession.user_profile).toBeUndefined();
    // Verifying flat dashboard fields
    expect(storedSession.dashboard_id).toBe(dashboardId);
    expect(storedSession.profile_id).toBe('prof_owner');
    // Root role and permissions should not be present
    expect(storedSession.role).toBeUndefined();
    expect(storedSession.permissions).toBeUndefined();
    // active_shift is null initially
    expect(storedSession.active_shift).toBeNull();
  });

  it('2. should start a single shift and store role & permissions strictly inside active_shift', async () => {
    // Seed initial session in KV
    await env.K1.put(sessionId, JSON.stringify({
      session_id: sessionId,
      user_id: 'user_pos_1',
      email: 'terminal@mobidash.com',
      full_name: 'Main Store Terminal',
      dashboard_id: dashboardId,
      profile_id: 'prof_owner',
      active_shift: null,
      active_shifts: {},
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }));

    const mockDb = {
      prepare: vi.fn().mockImplementation((query: string) => ({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({
          id: workerProfileId,
          dashboard_id: dashboardId,
          name: 'محمود علي (كاشير)',
          phone: '01012345678',
          pin: '1234',
          role: 'cashier',
          permissions: JSON.stringify({ can_sell: true, can_discount: false }),
          is_shift_active: 0,
          is_active: 1,
          is_banned: 0,
        }),
        run: vi.fn().mockResolvedValue({ success: true }),
      })),
    } as any;

    const startRes = await AuthService.startShift(
      mockDb,
      env.K1,
      sessionId,
      '1234',
      undefined,
      500
    );

    expect(startRes.success).toBe(true);
    expect(startRes.shift_token).toMatch(/^shift:/);
    expect(startRes.worker.worker_name).toBe('محمود علي (كاشير)');
    expect(startRes.worker.role).toBe('cashier');
    expect(startRes.worker.permissions).toEqual({ can_sell: true, can_discount: false });
    expect(startRes.worker.opening_cash).toBe(500);

    // Verify in KV
    const sessionStr = await env.K1.get(sessionId);
    const sessionData = JSON.parse(sessionStr as string);

    expect(sessionData.active_shift).toBeDefined();
    expect(sessionData.active_shift.shift_token).toBe(startRes.shift_token);
    expect(sessionData.active_shift.role).toBe('cashier');
    expect(sessionData.active_shift.permissions).toEqual({ can_sell: true, can_discount: false });
    // Root level still has no role or permissions
    expect(sessionData.role).toBeUndefined();
    expect(sessionData.permissions).toBeUndefined();
  });

  it('3. should reject starting a second shift with 409 SHIFT_ALREADY_ACTIVE', async () => {
    // Seed session that already has an active shift
    const existingShiftToken = 'shift:existing_worker:123';
    await env.K1.put(sessionId, JSON.stringify({
      session_id: sessionId,
      user_id: 'user_pos_1',
      dashboard_id: dashboardId,
      active_shift: {
        shift_token: existingShiftToken,
        user_profile_id: 'prof_worker_1',
        worker_name: 'أحمد محمود',
        role: 'cashier',
        shift_id: 'shift_existing_01',
        permissions: { can_sell: true },
        started_at: new Date().toISOString(),
        last_action_at: new Date().toISOString(),
      },
      active_shifts: {
        [existingShiftToken]: {
          shift_token: existingShiftToken,
          user_profile_id: 'prof_worker_1',
          worker_name: 'أحمد محمود',
          role: 'cashier',
        }
      },
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }));

    const mockDb = {
      prepare: vi.fn(),
    } as any;

    const startRes = await AuthService.startShift(
      mockDb,
      env.K1,
      sessionId,
      '9999'
    );

    expect(startRes.error).toBe('SHIFT_ALREADY_ACTIVE');
    expect(startRes.status).toBe(409);
    expect(startRes.message).toContain('توجد وردية نشطة بالفعل على هذا الجهاز');
    expect(startRes.active_worker.worker_name).toBe('أحمد محمود');
  });

  it('4. sessionMiddleware should reflect active shift role & permissions when x-shift-token is sent', async () => {
    const shiftToken = 'shift:worker_99:tok123';
    await env.K1.put(sessionId, JSON.stringify({
      session_id: sessionId,
      user_id: 'user_pos_1',
      email: 'pos@mobidash.com',
      full_name: 'Store POS',
      dashboard_id: dashboardId,
      profile_id: 'prof_owner',
      active_shift: {
        shift_token: shiftToken,
        user_profile_id: 'prof_worker_99',
        worker_name: 'طارق فني صيانة',
        role: 'technician',
        shift_id: 'shift_tech_01',
        permissions: { can_repair: true, can_view_tickets: true },
        started_at: new Date().toISOString(),
        last_action_at: new Date().toISOString(),
      },
      active_shifts: {
        [shiftToken]: {
          shift_token: shiftToken,
          role: 'technician',
          permissions: { can_repair: true, can_view_tickets: true },
        }
      },
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }));

    const app = new Hono<AppContext>();
    app.use('*', sessionMiddleware);
    app.get('/test-context', (c) => {
      const user = c.get('user');
      const activeWorker = c.get('active_worker');
      const token = c.get('shift_token');
      return c.json({ user, activeWorker, token });
    });

    // Case A: Request WITH valid x-shift-token
    const resWithShift = await app.request('/test-context', {
      headers: {
        Cookie: `session_id=${sessionId}`,
        'x-shift-token': shiftToken,
      }
    }, env as any);

    expect(resWithShift.status).toBe(200);
    const dataWithShift = await resWithShift.json() as any;
    expect(dataWithShift.user.role).toBe('technician');
    expect(dataWithShift.user.permissions).toEqual({ can_repair: true, can_view_tickets: true });
    expect(dataWithShift.activeWorker.worker_name).toBe('طارق فني صيانة');
    expect(dataWithShift.token).toBe(shiftToken);

    // Case B: Request WITHOUT x-shift-token -> falls back to 'terminal' with null permissions
    const resWithoutShift = await app.request('/test-context', {
      headers: {
        Cookie: `session_id=${sessionId}`,
      }
    }, env as any);

    expect(resWithoutShift.status).toBe(200);
    const dataWithoutShift = await resWithoutShift.json() as any;
    expect(dataWithoutShift.user.role).toBe('terminal');
    expect(dataWithoutShift.user.permissions).toBeNull();
    expect(dataWithoutShift.activeWorker).toBeUndefined();
  });

  it('5. should end the shift and allow starting a new one afterwards', async () => {
    const shiftToken = 'shift:closing_worker:uuid';
    await env.K1.put(sessionId, JSON.stringify({
      session_id: sessionId,
      user_id: 'user_pos_1',
      dashboard_id: dashboardId,
      active_shift: {
        shift_token: shiftToken,
        user_profile_id: workerProfileId,
        worker_name: 'محمود علي',
        role: 'cashier',
        shift_id: 'shift_to_close',
        started_at: new Date(Date.now() - 3600000).toISOString(),
      },
      active_shifts: {
        [shiftToken]: {
          shift_token: shiftToken,
          user_profile_id: workerProfileId,
          worker_name: 'محمود علي',
          role: 'cashier',
          shift_id: 'shift_to_close',
          started_at: new Date(Date.now() - 3600000).toISOString(),
        }
      },
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }));

    const mockDb = {
      prepare: vi.fn().mockImplementation(() => ({
        bind: vi.fn().mockReturnThis(),
        run: vi.fn().mockResolvedValue({ success: true }),
      })),
    } as any;

    const endRes = await AuthService.endShift(
      mockDb,
      env.K1,
      sessionId,
      shiftToken,
      450,
      'إغلاق الوردية المسائية'
    );

    expect(endRes.success).toBe(true);
    expect(endRes.message).toContain('تم إغلاق وردية');

    // Verify active_shift is cleared in KV
    const sessionStr = await env.K1.get(sessionId);
    const sessionData = JSON.parse(sessionStr as string);
    expect(sessionData.active_shift).toBeNull();
    expect(sessionData.active_shifts).toEqual({});

    // Now starting a new shift should succeed without 409 Conflict
    const nextMockDb = {
      prepare: vi.fn().mockImplementation((query: string) => ({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({
          id: 'prof_worker_next',
          dashboard_id: dashboardId,
          name: 'سعيد عبد الله',
          pin: '5555',
          role: 'cashier',
          is_active: 1,
          is_banned: 0,
        }),
        run: vi.fn().mockResolvedValue({ success: true }),
      })),
    } as any;

    const nextShiftRes = await AuthService.startShift(
      nextMockDb,
      env.K1,
      sessionId,
      '5555'
    );

    expect(nextShiftRes.success).toBe(true);
    expect(nextShiftRes.worker.worker_name).toBe('سعيد عبد الله');
  });
});
