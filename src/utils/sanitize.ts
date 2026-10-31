/**
 * OuraDash Sanitize Utility
 * Utility functions for sanitizing user inputs to prevent XSS and SQL injection attacks.
 * It enforces robust escaping mechanisms for HTML and SQL contexts.
 */

const htmlEntities: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapes HTML tag characters and quotes to prevent Cross-Site Scripting (XSS).
 * Purpose: Neutralizes potentially dangerous characters before they can be rendered 
 * in raw HTML contexts or email templates.
 * 
 * @param str The user-supplied string to sanitize
 * @returns Safely escaped string
 */
export const sanitizeHtml = (str: string | null | undefined): string => {
  if (str === null || str === undefined) return '';
  const stringified = String(str);
  return stringified.replace(/[&<>"']/g, (match) => htmlEntities[match] || match);
};

/**
 * Transforms and sanitizes inputs before storing them in the database.
 * Purpose: Can be used within Zod schemas (e.g., z.string().transform(sanitizeForDb)) 
 * to ensure that stored data is stripped of dangerous HTML tags and trailing whitespace.
 * 
 * @param val The string value to sanitize
 * @returns Cleaned string safe for database storage
 */
export const sanitizeForDb = (val: string): string => {
  if (typeof val !== 'string') return '';
  return sanitizeHtml(val.trim());
};

/**
 * Cleans and sanitizes user search query parameters:
 * 1. Strips null bytes (\0) and invisible control characters
 * 2. Strips HTML/XML tags (<...>) and dangerous script attributes
 * 3. Disarms javascript:, data:, and vbscript: protocols
 * 4. Disarms inline event handlers (onerror=, onload=, etc.)
 * 5. Trims leading and trailing whitespace
 * 6. Enforces a strict length limit (default max 100 characters) to prevent memory & ReDoS DoS attacks
 * 
 * @param input The raw search string
 * @param maxLength Maximum allowed length (default 100)
 * @returns Cleaned and sanitized string
 */
export const sanitizeSearchInput = (input: unknown, maxLength: number = 100): string => {
  if (typeof input !== 'string') return '';
  return input
    // Strip null bytes and ASCII control characters (0-31 and 127-159)
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    // Strip HTML/XML tags
    .replace(/<[^>]*>/gi, '')
    // Disarm javascript/vbscript/data protocols
    .replace(/(?:javascript|vbscript|data):/gi, '')
    // Disarm inline event handlers (e.g. onerror=, onload=)
    .replace(/on\w+\s*=/gi, '')
    // Trim whitespace
    .trim()
    // Enforce strict length cap
    .slice(0, maxLength);
};

/**
 * Escapes SQL LIKE special characters (%, _, \) to prevent wildcard injection.
 * Integrates search input sanitization to strip null bytes, control characters,
 * and limit length to prevent query buffer exhaustion.
 * 
 * @param input The search term to escape
 * @param maxLength Maximum allowed length (default 100)
 * @returns Escaped string safe for use in SQL LIKE clauses
 */
export const escapeLikePattern = (input: string, maxLength: number = 100): string => {
  if (typeof input !== 'string') return '';
  const cleaned = sanitizeSearchInput(input, maxLength);
  return cleaned.replace(/[\\%_]/g, (char) => `\\${char}`);
};

