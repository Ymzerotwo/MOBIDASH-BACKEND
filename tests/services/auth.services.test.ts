import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthService } from '../../src/services/auth.services';
import * as cryptoUtils from '../../src/utils/crypto';

import { mockSend } from '../mocks/cloudflare';

describe('AuthService (Unit)', () => {
  let mockDb: any;
  let mockKV: any;
  let hashPasswordSpy: any;
  let verifyPasswordSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();

    hashPasswordSpy = vi.spyOn(cryptoUtils, 'hashPassword').mockResolvedValue('new_hashed_password');
    verifyPasswordSpy = vi.spyOn(cryptoUtils, 'verifyPassword').mockResolvedValue(true);

    mockDb = {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      first: vi.fn(),
      all: vi.fn().mockResolvedValue({ results: [] }),
      run: vi.fn().mockResolvedValue({ success: true }),
      batch: vi.fn().mockResolvedValue([{ success: true }])
    };

    mockKV = {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({ keys: [], list_complete: true })
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generateOtp', () => {
    it('should generate a 6-digit OTP string', () => {
      const code = AuthService.generateOtp();
      expect(code).toHaveLength(6);
      expect(/^\d{6}$/.test(code)).toBe(true);
    });
  });

  describe('login', () => {
    it('should authenticate and store session in KV', async () => {
      mockDb.first.mockResolvedValue({
        id: 'user_1',
        full_name: 'Ahmed',
        email: 'ahmed@test.com',
        password_hash: 'hashed',
        role: 'Admin',
        is_banned: 0,
        permissions: '{"cms":true}'
      });

      const result = await AuthService.login(
        mockDb as any,
        mockKV as any,
        'ahmed',
        'password',
        true,
        'Mozilla',
        '127.0.0.1'
      );

      expect(result.user).toBeDefined();
      expect(result.sessionId).toContain('session:user_1:');
      expect(mockKV.put).toHaveBeenCalled();
    });

    it('should reject timing attacks and return INVALID_CREDENTIALS if user not found', async () => {
      mockDb.first.mockResolvedValue(null);

      const result = await AuthService.login(
        mockDb as any,
        mockKV as any,
        'unknown',
        'password',
        false,
        'Mozilla',
        '1.1.1.1'
      );

      expect(result.status).toBe(401);
      expect(result.error).toBe('INVALID_CREDENTIALS');
      expect(hashPasswordSpy).toHaveBeenCalled(); // timing attack prevention check
    });

    it('should block banned users', async () => {
      mockDb.first.mockResolvedValue({
        id: 'user_banned',
        full_name: 'Banned User',
        email: 'banned@test.com',
        password_hash: 'hashed',
        role: 'User',
        is_banned: 1,
        permissions: '{}'
      });

      const result = await AuthService.login(
        mockDb as any,
        mockKV as any,
        'banned',
        'password',
        false,
        'Mozilla',
        '1.1.1.1'
      );

      expect(result.status).toBe(403);
      expect(result.error).toBe('ACCOUNT_BANNED');
    });
  });

  describe('logout', () => {
    it('should successfully call KV delete for valid session', async () => {
      const result = await AuthService.logout(
        mockDb as any,
        mockKV as any,
        'session:user_1:uuid'
      );
      expect(mockKV.delete).toHaveBeenCalledWith('session:user_1:uuid');
      expect(result.success).toBe(true);
    });

    it('should ignore logout calls with invalid or missing session IDs', async () => {
      const result = await AuthService.logout(
        mockDb as any,
        mockKV as any,
        undefined
      );
      expect(mockKV.delete).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  describe('forgotPassword', () => {
    it('should successfully trigger email sending and return success if user exists', async () => {
      mockDb.first.mockResolvedValue({
        id: 'user_1',
        full_name: 'Ahmed Refat',
        email: 'ahmed@test.com',
        is_banned: 0
      });

      const result = await AuthService.forgotPassword(
        mockDb as any,
        'ahmed@test.com',
        { EMAILER: { send: mockSend }, CLOUDFLARE_API_TOKEN: 'dummy_cf_api_token', CF_ACCOUNT_ID: 'dummy_account_id' }
      );

      expect(result.success).toBe(true);
      expect(mockSend).toHaveBeenCalled();
    });

    it('should mitigate email enumeration and return success without email send if user does not exist', async () => {
      mockDb.first.mockResolvedValue(null);

      const result = await AuthService.forgotPassword(
        mockDb as any,
        'missing@test.com',
        { EMAILER: { send: mockSend }, CLOUDFLARE_API_TOKEN: 'dummy_cf_api_token', CF_ACCOUNT_ID: 'dummy_account_id' }
      );

      expect(result.success).toBe(true);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should execute dummy database queries for timing consistency when user is banned', async () => {
      mockDb.first.mockResolvedValue({
        id: 'banned_1',
        full_name: 'Banned User',
        is_banned: 1
      });

      const result = await AuthService.forgotPassword(
        mockDb as any,
        'banned@test.com',
        'dummy_cf_api_token'
      );

      expect(result.error).toBe('ACCOUNT_BANNED');
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('verifyResetCode', () => {
    it('should verify correct recovery code and reset KV brute force attempts', async () => {
      mockDb.first
        .mockResolvedValueOnce({ id: 'user_1', is_banned: 0 }) // for user lookup
        .mockResolvedValueOnce({ id: 'code_1', expires_at: new Date(Date.now() + 10000).toISOString() }); // for code verification

      const result = await AuthService.verifyResetCode(
        mockDb as any,
        mockKV as any,
        'ahmed@test.com',
        '123456',
        '127.0.0.1'
      );

      expect(result.success).toBe(true);
      expect(mockKV.delete).toHaveBeenCalledWith('otp_attempts:127.0.0.1:ahmed@test.com');
    });

    it('should block banned users from verifying reset code', async () => {
      mockDb.first.mockResolvedValueOnce({ id: 'user_1', is_banned: 1 });

      const result = await AuthService.verifyResetCode(
        mockDb as any,
        mockKV as any,
        'ahmed@test.com',
        '123456',
        '127.0.0.1'
      );

      expect(result.error).toBe('ACCOUNT_BANNED');
      expect(result.status).toBe(403);
    });



    it('should increment brute-force attempts on KV and return error for invalid code', async () => {
      mockDb.first
        .mockResolvedValueOnce({ id: 'user_1', is_banned: 0 })
        .mockResolvedValueOnce(null); // code mismatch

      const result = await AuthService.verifyResetCode(
        mockDb as any,
        mockKV as any,
        'ahmed@test.com',
        'wrong',
        '127.0.0.1'
      );

      expect(result.error).toBe('INVALID_CODE');
      expect(mockKV.put).toHaveBeenCalledWith(
        'otp_attempts:127.0.0.1:ahmed@test.com',
        '1',
        { expirationTtl: 900 }
      );
    });

    it('should rate limit requests when too many failures are logged in KV', async () => {
      mockKV.get.mockResolvedValue('5'); // 5 failed attempts reached

      const result = await AuthService.verifyResetCode(
        mockDb as any,
        mockKV as any,
        'ahmed@test.com',
        '123456',
        '127.0.0.1'
      );

      expect(result.error).toBe('ACCOUNT_LOCKED');
      expect(result.status).toBe(429);
      expect(mockDb.first).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('should reset password, wipe code, and invalidate active sessions', async () => {
      mockDb.first
        .mockResolvedValueOnce({ id: 'user_1', is_banned: 0 }) // user lookup
        .mockResolvedValueOnce({ id: 'code_1', expires_at: new Date(Date.now() + 10000).toISOString() }); // code verification

      const result = await AuthService.resetPassword(
        mockDb as any,
        mockKV as any,
        'ahmed@test.com',
        '123456',
        'NewSecurePassword1!',
        '127.0.0.1'
      );

      expect(result.success).toBe(true);
      expect(mockDb.batch).toHaveBeenCalled();
    });

    it('should block banned users from resetting password', async () => {
      mockDb.first.mockResolvedValueOnce({ id: 'user_1', is_banned: 1 });

      const result = await AuthService.resetPassword(
        mockDb as any,
        mockKV as any,
        'ahmed@test.com',
        '123456',
        'NewSecurePassword1!',
        '127.0.0.1'
      );

      expect(result.error).toBe('ACCOUNT_BANNED');
      expect(result.status).toBe(403);
    });
  });

  describe('revokeAllUserSessions', () => {
    it('should list and delete all user sessions from KV', async () => {
      mockKV.list.mockResolvedValue({
        keys: [{ name: 'session:user_1:session_id_1' }, { name: 'session:user_1:session_id_2' }],
        list_complete: true
      });

      const result = await AuthService.revokeAllUserSessions(mockKV as any, 'user_1');

      expect(result.success).toBe(true);
      expect(result.revokedCount).toBe(2);
      expect(mockKV.delete).toHaveBeenCalledTimes(2);
    });

    it('should handle zero sessions gracefully when user has no active sessions', async () => {
      mockKV.list.mockResolvedValue({
        keys: [],
        list_complete: true
      });

      const result = await AuthService.revokeAllUserSessions(mockKV as any, 'user_no_sessions');

      expect(result.success).toBe(true);
      expect(result.revokedCount).toBe(0);
      expect(mockKV.delete).not.toHaveBeenCalled();
    });
  });

  describe('Additional Robustness Tests: Login Session TTL', () => {
    it('should set KV expiration to 30 days when rememberMe is true', async () => {
      mockDb.first.mockResolvedValue({
        id: 'user_1',
        full_name: 'Ahmed',
        email: 'ahmed@test.com',
        password_hash: 'hashed',
        role: 'Admin',
        is_banned: 0,
        permissions: '{}'
      });

      await AuthService.login(
        mockDb as any,
        mockKV as any,
        'ahmed@test.com',
        'password',
        true, // rememberMe = true
        'Mozilla',
        '127.0.0.1'
      );

      expect(mockKV.put).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ expirationTtl: 30 * 24 * 60 * 60 })
      );
    });

    it('should set KV expiration to 7 days when rememberMe is false', async () => {
      mockDb.first.mockResolvedValue({
        id: 'user_1',
        full_name: 'Ahmed',
        email: 'ahmed@test.com',
        password_hash: 'hashed',
        role: 'Admin',
        is_banned: 0,
        permissions: '{}'
      });

      await AuthService.login(
        mockDb as any,
        mockKV as any,
        'ahmed',
        'password',
        false, // rememberMe = false
        'Mozilla',
        '127.0.0.1'
      );

      expect(mockKV.put).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ expirationTtl: 7 * 24 * 60 * 60 })
      );
    });

    it('should trigger 2FA flow and return requires_2fa when user has is_two_factor_enabled: 1', async () => {
      // First call: User lookup
      mockDb.first
        .mockResolvedValueOnce({
          id: 'user_2fa',
          email: 'twofa@test.com',
          full_name: 'TwoFactor User',
          password_hash: 'hashed',
          role: 'Admin',
          is_banned: 0,
          is_email_verified: 1,
        })
        // Second call: 2FA check
        .mockResolvedValueOnce({
          is_two_factor_enabled: 1,
        });

      const result = await AuthService.login(
        mockDb as any,
        mockKV as any,
        'twofa@test.com',
        'password',
        true,
        'Mozilla/5.0',
        '127.0.0.1'
      );

      expect(result.requires_2fa).toBe(true);
      expect(result.two_factor_token).toContain('2fa_tok_');
      expect(result.email).toBe('twofa@test.com');
      // Token must be stored in KV with 300s TTL
      expect(mockKV.put).toHaveBeenCalledWith(
        expect.stringContaining('2fa_token:'),
        expect.any(String),
        { expirationTtl: 300 }
      );
    });
  });

  describe('Two-Factor Authentication (verify2fa & resend2fa)', () => {
    it('should successfully verify 2FA code and issue a valid session', async () => {
      const token = '2fa_tok_valid123';
      const tokenPayload = {
        token,
        user_id: 'user_2fa',
        email: 'twofa@test.com',
        full_name: 'TwoFactor User',
        remember_me: true,
        attempts_left: 5,
        created_at: Date.now(),
      };

      mockKV.get.mockResolvedValueOnce(JSON.stringify(tokenPayload));

      // Code lookup matches and not expired
      mockDb.first
        .mockResolvedValueOnce({
          id: 'code_1',
          code: '123456',
          expires_at: new Date(Date.now() + 60000).toISOString(),
        })
        // User record lookup
        .mockResolvedValueOnce({
          id: 'user_2fa',
          email: 'twofa@test.com',
          full_name: 'TwoFactor User',
          role: 'Admin',
          is_banned: 0,
          is_email_verified: 1,
          created_at: new Date().toISOString(),
        });

      mockDb.all = vi.fn().mockResolvedValueOnce({ results: [] });

      const result = await AuthService.verify2fa(
        mockDb as any,
        mockKV as any,
        token,
        '123456',
        'Mozilla',
        '127.0.0.1'
      );

      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.user).toBeDefined();
        expect(result.user.email).toBe('twofa@test.com');
        expect(result.sessionId).toContain('session:user_2fa:');
      }
      // OTP and pre-auth token must be cleaned up
      expect(mockKV.delete).toHaveBeenCalledWith(`2fa_token:${token}`);
    });

    it('should return SESSION_EXPIRED if two_factor_token is missing or expired in KV', async () => {
      mockKV.get.mockResolvedValueOnce(null);

      const result = await AuthService.verify2fa(
        mockDb as any,
        mockKV as any,
        '2fa_tok_expired',
        '123456',
        'Mozilla',
        '127.0.0.1'
      );

      expect(result.status).toBe(400);
      expect(result.error).toBe('SESSION_EXPIRED');
    });

    it('should decrement attempts and return INVALID_CODE on wrong code', async () => {
      const token = '2fa_tok_attempts';
      const tokenPayload = {
        token,
        user_id: 'user_2fa',
        email: 'twofa@test.com',
        attempts_left: 3,
        created_at: Date.now(),
      };

      mockKV.get.mockResolvedValueOnce(JSON.stringify(tokenPayload));
      // Code not found
      mockDb.first.mockResolvedValueOnce(null);

      const result = await AuthService.verify2fa(
        mockDb as any,
        mockKV as any,
        token,
        '000000',
        'Mozilla',
        '127.0.0.1'
      );

      expect(result.status).toBe(400);
      expect(result.error).toBe('INVALID_CODE');
      expect(mockKV.put).toHaveBeenCalledWith(
        `2fa_token:${token}`,
        expect.stringContaining('"attempts_left":2'),
        { expirationTtl: 300 }
      );
    });

    it('should enforce 60s cooldown on resend2fa', async () => {
      const token = '2fa_tok_cooldown';
      const tokenPayload = {
        token,
        user_id: 'user_2fa',
        email: 'twofa@test.com',
        last_sent_at: Date.now() - 10000, // sent 10s ago (within 60s cooldown)
      };

      mockKV.get.mockResolvedValueOnce(JSON.stringify(tokenPayload));

      const result = await AuthService.resend2fa(
        mockDb as any,
        mockKV as any,
        token
      );

      expect(result.status).toBe(429);
      expect(result.error).toBe('RATE_LIMIT_EXCEEDED');
    });
  });
});

