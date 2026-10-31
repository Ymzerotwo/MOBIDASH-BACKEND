import { describe, it, expect, vi } from 'vitest';
import { 
  hashPassword, verifyPassword, timingSafeEqual,
  normalizeDomain, generateApiKey, generateProductionApiKey, generateTestApiKey,
  parseApiKey, hashSha256, generateSecureRandom64,
  generateSecureNumericOtp
} from '../../src/utils/crypto';

// ─── hashPassword Tests ────────────────────────────────────────────────────────

describe('Utils: Crypto - hashPassword', () => {
  it('should return a string in salt:hash format', async () => {
    const hash = await hashPassword('TestPassword123');
    expect(hash).toContain(':');
    const [salt, hashPart] = hash.split(':');
    expect(salt).toBeDefined();
    expect(hashPart).toBeDefined();
  });

  it('should produce a 64-char hex salt (32 bytes)', async () => {
    const hash = await hashPassword('TestPassword123');
    const [salt] = hash.split(':');
    expect(salt.length).toBe(64);
    expect(/^[0-9a-f]+$/.test(salt)).toBe(true);
  });

  it('should produce a 64-char hex hash (256 bits)', async () => {
    const hash = await hashPassword('TestPassword123');
    const [, hashPart] = hash.split(':');
    expect(hashPart.length).toBe(64);
    expect(/^[0-9a-f]+$/.test(hashPart)).toBe(true);
  });

  it('should generate different salts for the same password', async () => {
    const hash1 = await hashPassword('SamePassword');
    const hash2 = await hashPassword('SamePassword');
    const [salt1] = hash1.split(':');
    const [salt2] = hash2.split(':');
    expect(salt1).not.toBe(salt2);
  });

  it('should generate different hashes for the same password (due to random salt)', async () => {
    const hash1 = await hashPassword('SamePassword');
    const hash2 = await hashPassword('SamePassword');
    expect(hash1).not.toBe(hash2);
  });

  it('should handle empty string password', async () => {
    const hash = await hashPassword('');
    expect(hash).toContain(':');
    const [salt, hashPart] = hash.split(':');
    expect(salt.length).toBe(64);
    expect(hashPart.length).toBe(64);
  });

  it('should handle unicode password', async () => {
    const hash = await hashPassword('unicode_password_🔐');
    expect(hash).toContain(':');
    const [salt, hashPart] = hash.split(':');
    expect(salt.length).toBe(64);
    expect(hashPart.length).toBe(64);
  });

  it('should handle very long password', async () => {
    const longPassword = 'A'.repeat(10000);
    const hash = await hashPassword(longPassword);
    expect(hash).toContain(':');
  });
});

// ─── verifyPassword Tests ──────────────────────────────────────────────────────

describe('Utils: Crypto - verifyPassword', () => {
  it('should verify correct password against its hash', async () => {
    const password = 'SecurePassword123!';
    const hash = await hashPassword(password);
    const isValid = await verifyPassword(password, hash);
    expect(isValid).toBe(true);
  });

  it('should reject incorrect password', async () => {
    const hash = await hashPassword('CorrectPassword');
    const isValid = await verifyPassword('WrongPassword', hash);
    expect(isValid).toBe(false);
  });

  it('should reject empty password against a valid hash', async () => {
    const hash = await hashPassword('NonEmptyPassword');
    const isValid = await verifyPassword('', hash);
    expect(isValid).toBe(false);
  });

  it('should verify empty password if it was originally hashed as empty', async () => {
    const hash = await hashPassword('');
    const isValid = await verifyPassword('', hash);
    expect(isValid).toBe(true);
  });

  it('should reject plaintext stored hash (no colon separator)', async () => {
    const isValid = await verifyPassword('password', 'plaintext_no_colon');
    expect(isValid).toBe(false);
  });

  it('should reject corrupted salt (invalid hex)', async () => {
    const isValid = await verifyPassword('password', 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ:0000000000000000000000000000000000000000000000000000000000000000');
    expect(isValid).toBe(false);
  });

  it('should be case-sensitive for passwords', async () => {
    const hash = await hashPassword('CaseSensitive');
    const isValid = await verifyPassword('casesensitive', hash);
    expect(isValid).toBe(false);
  });

  it('should verify unicode passwords correctly', async () => {
    const password = 'hello_world_🌍';
    const hash = await hashPassword(password);
    const isValid = await verifyPassword(password, hash);
    expect(isValid).toBe(true);
  });

  it('should reject similar but different unicode passwords', async () => {
    const hash = await hashPassword('hello_world');
    const isValid = await verifyPassword('hell0_world', hash);
    expect(isValid).toBe(false);
  });

  it('should handle hash with empty salt part', async () => {
    const isValid = await verifyPassword('password', ':0000000000000000000000000000000000000000000000000000000000000000');
    expect(isValid).toBe(false);
  });
});

// ─── timingSafeEqual Tests ─────────────────────────────────────────────────────

describe('Utils: Crypto - timingSafeEqual', () => {
  it('should return true for identical strings', () => {
    expect(timingSafeEqual('abc123', 'abc123')).toBe(true);
  });

  it('should return false for different strings of same length', () => {
    expect(timingSafeEqual('abc123', 'abc124')).toBe(false);
  });

  it('should return false for different length strings', () => {
    expect(timingSafeEqual('short', 'longer_string')).toBe(false);
  });

  it('should return true for empty strings', () => {
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('should handle unicode strings', () => {
    expect(timingSafeEqual('hello_🌍', 'hello_🌍')).toBe(true);
    expect(timingSafeEqual('hello_🌍', 'hello_🌎')).toBe(false);
  });

  it('should handle 64-char hex tokens (CSRF-sized)', () => {
    const token = 'a'.repeat(64);
    const same = 'a'.repeat(64);
    const diff = 'a'.repeat(63) + 'b';
    expect(timingSafeEqual(token, same)).toBe(true);
    expect(timingSafeEqual(token, diff)).toBe(false);
  });
});

// ─── normalizeDomain Tests ─────────────────────────────────────────────────────

describe('Utils: Crypto - normalizeDomain', () => {
  it('should extract hostname from full URL', () => {
    expect(normalizeDomain('https://example.com/path')).toBe('example.com');
  });

  it('should remove www prefix', () => {
    expect(normalizeDomain('https://www.example.com')).toBe('example.com');
  });

  it('should handle bare domain without protocol', () => {
    expect(normalizeDomain('example.com')).toBe('example.com');
  });

  it('should handle domain with www and no protocol', () => {
    expect(normalizeDomain('www.example.com')).toBe('example.com');
  });

  it('should lowercase the domain', () => {
    expect(normalizeDomain('HTTPS://EXAMPLE.COM')).toBe('example.com');
  });

  it('should handle http protocol', () => {
    expect(normalizeDomain('http://example.com')).toBe('example.com');
  });

  it('should trim whitespace', () => {
    expect(normalizeDomain('  example.com  ')).toBe('example.com');
  });

  it('should handle subdomains', () => {
    expect(normalizeDomain('https://api.example.com')).toBe('api.example.com');
  });

  it('should handle domain with port', () => {
    expect(normalizeDomain('https://example.com:8080')).toBe('example.com');
  });

  it('should handle localhost', () => {
    expect(normalizeDomain('http://localhost:3000')).toBe('localhost');
  });
});

// ─── API Key Generation, Hashing & Parsing Tests ──────────────────────────────

describe('Utils: Crypto - API Key Generation & Verification', () => {
  const WEBSITE_ID = 'site-123456';

  describe('generateSecureRandom64', () => {
    it('should generate an alphanumeric string of exactly 64 characters', () => {
      const secret = generateSecureRandom64();
      expect(secret).toHaveLength(64);
      expect(/^[a-zA-Z0-9]{64}$/.test(secret)).toBe(true);
    });

    it('should produce unique values across multiple calls', () => {
      const s1 = generateSecureRandom64();
      const s2 = generateSecureRandom64();
      expect(s1).not.toBe(s2);
    });
  });

  describe('hashSha256', () => {
    it('should produce a 64-character lowercase hexadecimal hash', async () => {
      const hash = await hashSha256('hello-world');
      expect(hash).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
    });

    it('should generate identical hashes for identical inputs', async () => {
      const h1 = await hashSha256('oura-key-test');
      const h2 = await hashSha256('oura-key-test');
      expect(h1).toBe(h2);
    });
  });

  describe('generateProductionApiKey (oura-pk)', () => {
    it('should generate a production key with 3 underscore-separated parts', async () => {
      const result = await generateProductionApiKey(WEBSITE_ID, 'example.com');
      const parts = result.fullKey.split('_');
      expect(parts.length).toBe(3);
      expect(parts[0]).toBe('oura-pk');
      expect(parts[1]).toBe(WEBSITE_ID);
      expect(parts[2]).toHaveLength(64);
      expect(result.type).toBe('production');
      expect(result.expiresAt).toBeNull();
    });

    it('should produce valid keyHash matching hashSha256(fullKey)', async () => {
      const result = await generateProductionApiKey(WEBSITE_ID, 'example.com');
      const computedHash = await hashSha256(result.fullKey);
      expect(result.keyHash).toBe(computedHash);
    });

    it('should normalize domain in the key (strip www)', async () => {
      const result = await generateProductionApiKey(WEBSITE_ID, 'www.example.com');
      expect(result.domain).toBe('example.com');
    });
  });

  describe('generateTestApiKey (oura-tk)', () => {
    it('should generate a test key prefixed with oura-tk and 3 parts', async () => {
      const result = await generateTestApiKey(WEBSITE_ID, 7);
      const parts = result.fullKey.split('_');
      expect(parts.length).toBe(3);
      expect(parts[0]).toBe('oura-tk');
      expect(parts[1]).toBe(WEBSITE_ID);
      expect(parts[2]).toHaveLength(64);
      expect(result.type).toBe('test');
      expect(result.domain).toBe('test');
      expect(result.expiresAt).toBeDefined();
    });

    it('should clamp test key expiration to a maximum of 7 days', async () => {
      const result = await generateTestApiKey(WEBSITE_ID, 30); // Requested 30 days
      expect(result.expiresAt).toBeDefined();
      const expDate = new Date(result.expiresAt!).getTime();
      const maxExpDate = Date.now() + 7 * 24 * 3600 * 1000 + 1000;
      expect(expDate).toBeLessThanOrEqual(maxExpDate);
    });

    it('should clamp test key expiration to a minimum of 1 day', async () => {
      const result = await generateTestApiKey(WEBSITE_ID, 0); // Requested 0 days
      expect(result.expiresAt).toBeDefined();
      const expDate = new Date(result.expiresAt!).getTime();
      const minExpDate = Date.now() + 1 * 24 * 3600 * 1000 - 1000;
      expect(expDate).toBeGreaterThanOrEqual(minExpDate);
    });
  });

  describe('parseApiKey', () => {
    it('should parse valid production key correctly', () => {
      const key = `oura-pk_${WEBSITE_ID}_${'a'.repeat(64)}`;
      const parsed = parseApiKey(key);
      expect(parsed.valid).toBe(true);
      expect(parsed.prefix).toBe('oura-pk');
      expect(parsed.websiteId).toBe(WEBSITE_ID);
      expect(parsed.secretPart).toBe('a'.repeat(64));
      expect(parsed.isTestKey).toBe(false);
    });

    it('should parse valid test key correctly', () => {
      const key = `oura-tk_${WEBSITE_ID}_${'b'.repeat(64)}`;
      const parsed = parseApiKey(key);
      expect(parsed.valid).toBe(true);
      expect(parsed.prefix).toBe('oura-tk');
      expect(parsed.websiteId).toBe(WEBSITE_ID);
      expect(parsed.isTestKey).toBe(true);
    });

    it('should reject malformed keys (invalid prefix, wrong part count, short secret)', () => {
      expect(parseApiKey('').valid).toBe(false);
      expect(parseApiKey('invalid_key').valid).toBe(false);
      expect(parseApiKey(`wrong-prefix_${WEBSITE_ID}_${'a'.repeat(64)}`).valid).toBe(false);
      expect(parseApiKey(`oura-pk_${WEBSITE_ID}_short`).valid).toBe(false);
      expect(parseApiKey(`oura-pk_${WEBSITE_ID}_${'a'.repeat(65)}`).valid).toBe(false);
      expect(parseApiKey(`oura-pk__${'a'.repeat(64)}`).valid).toBe(false);
    });
  });

  describe('Additional Robustness Tests', () => {
    it('should return false in timingSafeEqual when strings have different lengths', () => {
      expect(timingSafeEqual('short', 'muchlongerstring')).toBe(false);
      expect(timingSafeEqual('muchlongerstring', 'short')).toBe(false);
    });

    it('should correctly normalize domain when Origin or Referer contains a path, query parameters, or hash', () => {
      expect(normalizeDomain('https://sub.domain.com/path/to/page?query=value#hash')).toBe('sub.domain.com');
      expect(normalizeDomain('http://localhost:3000/index.html')).toBe('localhost');
    });
  });

  describe('generateSecureNumericOtp', () => {
    it('should generate a 6-digit OTP string by default', () => {
      const otp = generateSecureNumericOtp();
      expect(otp).toHaveLength(6);
      expect(/^\d{6}$/.test(otp)).toBe(true);
    });

    it('should support custom digit lengths (1 to 9)', () => {
      for (const len of [1, 4, 6, 8, 9]) {
        const otp = generateSecureNumericOtp(len);
        expect(otp).toHaveLength(len);
        expect(new RegExp(`^\\d{${len}}$`).test(otp)).toBe(true);
      }
    });

    it('should throw RangeError for invalid digit values', () => {
      expect(() => generateSecureNumericOtp(0)).toThrow(RangeError);
      expect(() => generateSecureNumericOtp(-1)).toThrow(RangeError);
      expect(() => generateSecureNumericOtp(10)).toThrow(RangeError);
      expect(() => generateSecureNumericOtp(5.5)).toThrow(RangeError);
    });

    it('should generate diverse values across multiple invocations', () => {
      const set = new Set<string>();
      for (let i = 0; i < 50; i++) {
        set.add(generateSecureNumericOtp(6));
      }
      // With 1,000,000 possibilities, 50 random samples should all be unique
      expect(set.size).toBe(50);
    });
  });
});
