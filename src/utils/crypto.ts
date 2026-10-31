/**
 * ==========================================
 *      OuraDash Cryptography Utility
 * ==========================================
 * 
 * Cryptography Utilities
 * Uses the native Web Crypto API which is fully supported and hardware-accelerated
 * in Cloudflare Workers edge environment.
 */

/**
 * Hashes a password using PBKDF2 with SHA-256 and 100,000 iterations.
 * This is computationally expensive by design to resist brute-force attacks.
 * @returns A string in the format "saltHex:hashHex"
 */
export const hashPassword = async (password: string): Promise<string> => {
  const encoder = new TextEncoder();

  // Generate a cryptographically secure random 32-byte salt
  const salt = crypto.getRandomValues(new Uint8Array(32));

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );

    const hashBuffer = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: salt,
        iterations: 100000,
        hash: "SHA-256"
      },
      keyMaterial,
      256
    );

  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

  return `${saltHex}:${hashHex}`;
};

/**
 * Verifies a password against a stored PBKDF2 hash.
 * Uses constant-time comparison to prevent timing attacks.
 */
export const verifyPassword = async (password: string, storedHash?: string | null): Promise<boolean> => {
  // Reject any stored value that is not in the expected salt:hash format.
  // This prevents plaintext password comparison if the DB was compromised or null values if user has no password yet.
  if (!storedHash || typeof storedHash !== 'string' || !storedHash.includes(':')) {
    return false;
  }

  const [saltHex, hashHex] = storedHash.split(':');
  const saltMatch = saltHex.match(/.{1,2}/g);

  if (!saltMatch) return false;

  const salt = new Uint8Array(saltMatch.map(byte => parseInt(byte, 16)));
  const encoder = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );

    const hashBuffer = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: salt,
        iterations: 100000,
        hash: "SHA-256"
      },
      keyMaterial,
      256
    );

  // Constant-time comparison ensures that the comparison takes the same amount
  // of time regardless of how many bytes match, preventing timing side-channel attacks.
  const computedBytes = new Uint8Array(hashBuffer);
  const storedBytes = new Uint8Array(
    (hashHex.match(/.{1,2}/g) || []).map(byte => parseInt(byte, 16))
  );

  if (computedBytes.length !== storedBytes.length) return false;

  let diff = 0;
  for (let i = 0; i < computedBytes.length; i++) {
    diff |= computedBytes[i] ^ storedBytes[i];
  }
  return diff === 0;
};

/**
 * Constant-time string comparison utility.
 * Purpose: Safely compares sensitive tokens (like CSRF or OTPs) without leaking 
 * their length or content via timing side-channel attacks.
 */
export const timingSafeEqual = (a: string, b: string): boolean => {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);

  const lenA = bufA.length;
  const lenB = bufB.length;

  let diff = lenA ^ lenB; // If lengths differ, diff > 0, ensuring failure
  const maxLength = Math.max(lenA, lenB);

  for (let i = 0; i < maxLength; i++) {
    const valA = i < lenA ? bufA[i] : 0;
    const valB = i < lenB ? bufB[i] : 0;
    diff |= valA ^ valB;
  }

  return diff === 0;
};

/**
 * Generates an unbiasable, cryptographically secure numeric OTP code (default 6 digits).
 * Uses Web Crypto API's crypto.getRandomValues with rejection sampling to eliminate modulo bias.
 * Safe for Cloudflare Workers edge runtime and modern JavaScript/TypeScript environments.
 *
 * @param digits - The length of the OTP (between 1 and 9 digits, default: 6).
 * @returns A zero-padded numeric string of length `digits`.
 */
export const generateSecureNumericOtp = (digits = 6): string => {
  if (!Number.isInteger(digits) || digits < 1 || digits > 9) {
    throw new RangeError('OTP digits must be an integer between 1 and 9 for 32-bit uniform distribution safety.');
  }

  const range = Math.pow(10, digits);
  // Total outcomes in Uint32 space is 2^32 = 4,294,967,296
  const maxUint32Range = 0x100000000;
  const limit = maxUint32Range - (maxUint32Range % range);

  const buffer = new Uint32Array(1);
  do {
    crypto.getRandomValues(buffer);
  } while (buffer[0] >= limit);

  const num = buffer[0] % range;
  return num.toString().padStart(digits, '0');
};

// ==============================================================
// API Key Cryptography (HMAC-SHA256 Stateless Keys)
// ==============================================================
// These functions generate and verify API keys statelessly.
// The key itself contains its permissions/domain, signed by the Master Secret.
// This means the API can verify keys without hitting the database on every request.

/**
 * Extracts and normalizes the hostname from a URL string to prevent bypasses.
 */
export const normalizeDomain = (domain: string): string => {
  try {
    let normalized = domain.trim().toLowerCase();
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = 'https://' + normalized;
    }
    const url = new URL(normalized);
    let hostname = url.hostname;
    if (hostname.startsWith('www.')) {
      hostname = hostname.substring(4);
    }
    return hostname;
  } catch {
    let cleaned = domain.trim().toLowerCase();
    cleaned = cleaned.replace(/^(https?:\/\/)?(www\.)?/, '');
    cleaned = cleaned.split('/')[0];
    return cleaned;
  }
};

/**
 * Generates an unbiasable cryptographically secure random 64-character alphanumeric string.
 * Uses Web Crypto API's getRandomValues with rejection sampling to eliminate modulo bias.
 * Safe for Cloudflare Workers edge runtime.
 */
export const generateSecureRandom64 = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const charsLen = chars.length; // 62
  const maxByte = 256 - (256 % charsLen); // 248 (bytes >= 248 are discarded to prevent modulo bias)
  let result = '';
  const buffer = new Uint8Array(128); // Process in batches

  while (result.length < 64) {
    crypto.getRandomValues(buffer);
    for (let i = 0; i < buffer.length && result.length < 64; i++) {
      if (buffer[i] < maxByte) {
        result += chars[buffer[i] % charsLen];
      }
    }
  }

  return result;
};

/**
 * Computes the one-way SHA-256 hash of a string.
 * Returns a 64-character lowercase hexadecimal representation.
 */
export const hashSha256 = async (str: string): Promise<string> => {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(str));
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
};

export interface GenerateApiKeyResult {
  fullKey: string;
  keyHash: string;
  shortKey: string;
  websiteId: string;
  type: 'production' | 'test';
  domain: string;
  expiresAt: string | null;
}

/**
 * Generates an OuraDash production API key: oura-pk_{website_id}_{random64}
 * Production keys are bound to a domain and do not expire.
 */
export const generateProductionApiKey = async (
  websiteId: string, 
  domain: string
): Promise<GenerateApiKeyResult> => {
  const normalizedDomain = normalizeDomain(domain);
  const randomSecret = generateSecureRandom64();
  const prefix = 'oura-pk';
  const fullKey = `${prefix}_${websiteId}_${randomSecret}`;
  const keyHash = await hashSha256(fullKey);
  const shortKey = `${prefix}_${websiteId.substring(0, 8)}_${randomSecret.substring(0, 8)}...`;

  return {
    fullKey,
    keyHash,
    shortKey,
    websiteId,
    type: 'production',
    domain: normalizedDomain,
    expiresAt: null
  };
};

/**
 * Generates an OuraDash test API key: oura-tk_{website_id}_{random64}
 * Test keys bypass domain binding and have a maximum expiration duration of 7 days (1 to 7 days).
 */
export const generateTestApiKey = async (
  websiteId: string, 
  expiresInDays = 7
): Promise<GenerateApiKeyResult> => {
  // Strict clamp: min 1 day, max 7 days
  const days = Math.min(7, Math.max(1, expiresInDays));
  const expiresAtDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const expiresAt = expiresAtDate.toISOString();

  const randomSecret = generateSecureRandom64();
  const prefix = 'oura-tk';
  const fullKey = `${prefix}_${websiteId}_${randomSecret}`;
  const keyHash = await hashSha256(fullKey);
  const shortKey = `${prefix}_${websiteId.substring(0, 8)}_${randomSecret.substring(0, 8)}...`;

  return {
    fullKey,
    keyHash,
    shortKey,
    websiteId,
    type: 'test',
    domain: 'test',
    expiresAt
  };
};

// Alias for production key generation
export const generateApiKey = generateProductionApiKey;

/**
 * Parses an incoming API Key into its 3 constituent parts:
 * prefix ('oura-pk' | 'oura-tk'), websiteId, and secretPart (64 chars).
 */
export const parseApiKey = (apiKey: string): { 
  valid: boolean; 
  prefix?: 'oura-pk' | 'oura-tk'; 
  websiteId?: string; 
  secretPart?: string;
  isTestKey?: boolean;
} => {
  if (!apiKey || typeof apiKey !== 'string') {
    return { valid: false };
  }

  const parts = apiKey.trim().split('_');
  if (parts.length !== 3) {
    return { valid: false };
  }

  const [prefix, websiteId, secretPart] = parts;

  if (prefix !== 'oura-pk' && prefix !== 'oura-tk') {
    return { valid: false };
  }

  if (!websiteId || websiteId.length < 3) {
    return { valid: false };
  }

  if (!secretPart || secretPart.length !== 64) {
    return { valid: false };
  }

  return {
    valid: true,
    prefix,
    websiteId,
    secretPart,
    isTestKey: prefix === 'oura-tk'
  };
};

