# Two-Factor Authentication (2FA) via Email - Implementation Plan

> [!NOTE]
> **خطة تاريخية — لا تفترض أنها تصف الوضع الحالي.** تحقق من التنفيذ الفعلي في `src/` قبل الاعتماد عليها.
> المرجع المعتمد: [`engineering/UNIFIED_METHODOLOGY.md`](./engineering/UNIFIED_METHODOLOGY.md) · [`project/PROJECT_PROFILE.md`](./project/PROJECT_PROFILE.md).
**Platform:** OuraDash Enterprise  
**Architecture:** Cloudflare Workers Edge (Hono + D1 + KV) & Next.js 15 (App Router)  
**Status:** Architecture Specification & Engineering Roadmap  
**Target:** Production Readiness  

---

## 1. Executive Summary & Objective (الملخص التنفيذي والهدف)

The objective is to implement a secure, enterprise-grade **Two-Factor Authentication (2FA / Two-Step Verification) via Email** for OuraDash.

When a user with 2FA enabled signs in with their credentials (email/username and password), the platform will **not** immediately grant a full session cookie. Instead, it will:
1. Validate primary credentials (password hash).
2. Generate an ephemeral, cryptographically bound `two_factor_token` stored in Cloudflare KV.
3. Generate an unbiased, secure 6-digit numeric OTP code using Web Crypto (`generateSecureNumericOtp(6)`).
4. Store the OTP in D1 `VerificationCodes` (type: `'2fa'`, TTL: 5 minutes).
5. Dispatch a dedicated, professional security alert email in English with the OTP, device details, IP address, and timestamp.
6. Seamlessly direct the user to a **dedicated, standalone Two-Factor Authentication page** in the frontend (`/two-factor-auth`) built with the identical OuraDash glassmorphism design system.
7. Upon code verification via the new backend endpoint, issue the active `UserSessions` record, set the HTTP-only secure session cookie, rotate CSRF, and grant dashboard access.

---

## 2. Threat Modeling & Security Principles (نموذج التهديدات وهندسة الأمان)

### 2.1 Pre-Auth Binding Token (`two_factor_token`)
- **The Vulnerability Avoided:** If `verify-2fa` only accepted `email` and `code`, an attacker who knows a target user's email could attempt to brute-force 6-digit OTP codes against the 2FA endpoint without ever knowing the user's password.
- **The Solution:** The backend generates an ephemeral `two_factor_token` (e.g., `2fa_sec_` + UUIDv4) upon successful password validation.
  - The token is stored in Cloudflare KV: `2fa_session:<two_factor_token>` with a **5-minute TTL**.
  - Payload stored in KV:
    ```json
    {
      "user_id": "usr_uuid",
      "email": "user@example.com",
      "ip_address": "198.51.100.1",
      "user_agent": "Mozilla/5.0 ...",
      "attempts_left": 5,
      "created_at": 1729156000
    }
    ```
  - The 2FA verification endpoint **strictly requires** this `two_factor_token`. Without proof of correct primary credentials, 2FA verification cannot be initiated.

### 2.2 Rate Limiting & Anti-Brute Force Protection
- **Max 5 Verification Attempts:** Each `two_factor_token` allows up to 5 code validation attempts. Upon the 5th failure, the token is destroyed, requiring a fresh login from scratch.
- **Strict Cooldown for Resend:** Resending 2FA code is throttled by a 60-second cooldown timer enforced both client-side and server-side.
- **Max 3 Resends Per Login Session:** Prevents email inbox flooding.
- **Single-Use Invalidation:** As soon as the correct code is entered, the OTP code in `VerificationCodes` and the `two_factor_token` in KV are immediately deleted.

### 2.3 Phishing & Account Compromise Awareness
- The 2FA email template is delivered in professional English and contains contextual security metadata:
  - Client IP Address
  - Approximate Location (via Cloudflare headers `cf-ipcity`, `cf-ipcountry`)
  - Browser and Operating System descriptor
  - Clear emergency call-to-action: *"If you did not request this login, your password may be compromised. Please change your password immediately."*

---

## 3. Database Schema Migration (تعديلات قاعدة البيانات)

### Migration File: `backend/migrations/0015_add_two_factor_auth.sql`

```sql
-- ==============================================================================
-- OuraDash Platform Migration: 0015_add_two_factor_auth.sql
-- Purpose: Two-Factor Authentication (2FA) State & Timestamps
-- ==============================================================================

-- 1. Add 2FA configuration columns to Users table
ALTER TABLE Users ADD COLUMN is_two_factor_enabled INTEGER DEFAULT 0;
ALTER TABLE Users ADD COLUMN two_factor_confirmed_at DATETIME;

-- 2. Index for fast filtering of 2FA-enabled accounts
CREATE INDEX IF NOT EXISTS idx_users_2fa_enabled ON Users (is_two_factor_enabled);
```

> **Note on VerificationCodes:** The `VerificationCodes` table defined in `0000_auth.sql` already includes `'2fa'` in its `CHECK (type IN ('login_otp', 'invite_verify', 'password_reset', 'email_verify', 'phone_verify', '2fa'))` constraint. No alteration to `VerificationCodes` is necessary.

---

## 4. Backend Endpoints & API Contract (نقاط النهاية للواجهة الخلفية)

```
                    ┌────────────────────────────┐
                    │  POST /api/auth/login      │
                    │  (Validates Credentials)   │
                    └─────────────┬──────────────┘
                                  │
                   ┌──────────────┴──────────────┐
                   │ User has 2FA Enabled?       │
                   └──────┬───────────────┬──────┘
                       No │               │ Yes
                          ▼               ▼
           ┌─────────────────────┐  ┌────────────────────────────────────┐
           │ Issue Session       │  │ 1. Generate Secure 6-digit OTP    │
           │ Set HTTP-Only Cookie│  │ 2. Save in VerificationCodes (2fa) │
           │ Return 200 Success  │  │ 3. Create two_factor_token in KV  │
           └─────────────────────┘  │ 4. Dispatch 2FA Security Email     │
                                    │ 5. Return 200 TWO_FACTOR_REQUIRED  │
                                    └─────────────────┬──────────────────┘
                                                      │
                                                      ▼
                                    ┌────────────────────────────────────┐
                                    │ Redirect to /two-factor-auth       │
                                    └─────────────────┬──────────────────┘
                                                      │
                     ┌────────────────────────────────┴────────────────┐
                     │                                                 │
                     ▼                                                 ▼
     ┌───────────────────────────────┐                 ┌───────────────────────────────┐
     │ POST /api/auth/2fa/verify     │                 │ POST /api/auth/2fa/resend     │
     │ Body: {token, code}           │                 │ Body: {token}                 │
     └───────────────┬───────────────┘                 └───────────────────────────────┘
                     │ (Code Matches?)
                     ▼
     ┌───────────────────────────────┐
     │ 1. Invalidate OTP & Token     │
     │ 2. Create UserSessions Record │
     │ 3. Set Session ID Cookie      │
     │ 4. Rotate CSRF Token          │
     │ 5. Return 200 LOGIN_SUCCESS   │
     └───────────────────────────────┘
```

### 4.1 Modified: `POST /api/auth/login`
- **Controller:** `AuthController.login`
- **Behavior:**
  - If password is valid and `is_email_verified === 1`:
    - Checks `user.is_two_factor_enabled === 1`.
    - If `false`: Proceeds with normal session issuance.
    - If `true`:
      - Generates 6-digit OTP using `generateSecureNumericOtp(6)`.
      - Inserts OTP in `VerificationCodes` (type: `'2fa'`, expires: +5 minutes).
      - Generates `two_factor_token` (UUIDv4) and stores in KV with key `2fa_token:<token>` (TTL: 300s).
      - Sends email `two_factor_code` to `user.email`.
      - Returns:
        ```json
        {
          "status": 200,
          "slug": "TWO_FACTOR_REQUIRED",
          "message": "Two-factor authentication required. Verification code sent.",
          "data": {
            "requires_2fa": true,
            "two_factor_token": "2fa_tok_9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
            "email": "mo••••••@example.com"
          }
        }
        ```

### 4.2 New: `POST /api/auth/2fa/verify`
- **Rate Limiter:** `VERIFY_CODE_LIMITER` (5 attempts / min)
- **Validation Schema:**
  ```ts
  export const verify2faSchema = z.object({
    two_factor_token: z.string().min(1, 'Two-factor session token is required'),
    code: z.string().length(6, 'Verification code must be 6 digits').regex(/^\d{6}$/, 'Code must be numeric'),
  });
  ```
- **Handler:** `AuthController.verify2fa`
- **Execution Steps:**
  1. Lookup `2fa_token:<two_factor_token>` in Cloudflare KV.
  2. If missing or expired: Return 400 `SESSION_EXPIRED` ("Two-factor session expired. Please log in again.").
  3. If `attempts_left <= 0`: Delete KV key, Return 429 `TOO_MANY_ATTEMPTS` ("Too many invalid attempts. Please log in again.").
  4. Query `VerificationCodes` where `user_id = kv.user_id AND target = kv.email AND code = input.code AND type = '2fa' AND expires_at > CURRENT_TIMESTAMP`.
  5. If no match:
     - Decrement `attempts_left` in KV.
     - Return 400 `INVALID_CODE` ("Invalid or expired verification code.", { attempts_left }).
  6. If match:
     - Delete code from `VerificationCodes` and delete KV token.
     - Create session in `UserSessions`.
     - Set secure HTTP-only cookie `session_id`.
     - Rotate CSRF token.
     - Return 200 `LOGIN_SUCCESS` with `{ user }`.

### 4.3 New: `POST /api/auth/2fa/resend`
- **Rate Limiter:** `RESEND_CODE_LIMITER` (1 per 60s)
- **Validation Schema:**
  ```ts
  export const resend2faSchema = z.object({
    two_factor_token: z.string().min(1, 'Two-factor session token is required'),
  });
  ```
- **Handler:** `AuthController.resend2fa`
- **Execution Steps:**
  1. Retrieve KV token.
  2. Check cooldown timestamp. If `< 60s` elapsed: Return 429 `RESEND_COOLDOWN`.
  3. Invalidate previous 2FA codes in `VerificationCodes`.
  4. Generate new OTP via `generateSecureNumericOtp(6)` and save in D1.
  5. Dispatch new 2FA email.
  6. Update KV token cooldown timestamp.
  7. Return 200 `CODE_RESENT`.

### 4.4 Settings / Profile Endpoints (For User Configuration)
- `POST /api/auth/2fa/setup`: Generates initial verification code to confirm user email before activating 2FA.
- `POST /api/auth/2fa/confirm-enable`: Verifies code and sets `is_two_factor_enabled = 1`.
- `POST /api/auth/2fa/disable`: Requires current password confirmation to disable 2FA.

---

## 5. Frontend Architecture: Dedicated 2FA Page (الواجهة الأمامية)

### 5.1 Route Structure
- **Path:** `frontend/dashboard/app/two-factor-auth/page.tsx`
- **Dedicated Route:** Fully accessible at `/two-factor-auth`.
- **State Transfer:**
  - Upon receiving `requires_2fa: true` in `/login`:
    - The `two_factor_token` and `email` are stored in a secure React state / ephemeral `sessionStorage` entry (`oura_2fa_pending`).
    - The user is transitioned via `router.push('/two-factor-auth')`.
    - If user visits `/two-factor-auth` directly without a pending token, they are gracefully redirected back to `/login`.

### 5.2 UI & UX Design System Matching
The page will implement the exact same aesthetic tokens as the frontend register page (`frontend/dashboard/app/register/page.tsx`) and login page (`frontend/dashboard/app/login/page.tsx`):
- **Atmosphere:** Deep dark background with ambient floating blur blobs (`bg-primary-600` and `bg-accent-600`).
- **Control Bar:** Fixed top theme toggle (`Sun`/`Moon`) and language switcher (`Languages`).
- **Main Glass Card:** `max-w-[480px] backdrop-blur-[20px] rounded-2xl sm:rounded-[28px] border border-border-subtle/80`.
- **Hero Icon:** Large glowing shield with lock badge (`ShieldCheck` / `KeyRound`) inside a circular pulse highlight.
- **Typography:**
  - H1: `Two-Factor Authentication` / `التحقق بخطوتين`
  - Subtitle: `Enter the 6-digit security code sent to` `<span dir="ltr">{maskedEmail}</span>`
- **6-Digit Input Row:**
  - 6 independent input boxes (`w-10 h-13 sm:w-12 sm:h-14`) with numeric keyboards (`inputMode="numeric"`).
  - Auto-advance on keystroke, auto-backward on `Backspace`.
  - Full clipboard paste handling (`handlePaste`) with automatic slice and focus distribution.
  - Automatic submission upon 6th digit input.
- **Action Controls:**
  - Primary Submit Button with `Loader2` spinning state.
  - 60-second countdown timer (`resendTimer`).
  - Active resend button (`RotateCcw`).
  - "Back to Login" button (`ArrowLeft` / `ArrowRight` with RTL flip) which clears the pending state and returns cleanly to `/login`.
- **Success State:**
  - Morph to green `CheckCircle2` pop-in animation: *"Identity Verified! Directing to Dashboard..."*

---

## 6. Email Template Specification (قالب البريد الإلكتروني بالإنجليزية)

**Subject:** `OuraDash Security: Your Two-Factor Verification Code is [123456]`

**HTML Structure:**
```html
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 540px; margin: 0 auto; background: #0f172a; color: #f8fafc; border-radius: 16px; border: 1px solid #1e293b; padding: 40px;">
  <div style="text-align: center; margin-bottom: 28px;">
    <h2 style="color: #6366f1; margin: 0 0 6px 0; font-size: 24px; font-weight: 800;">OuraDash Security</h2>
    <p style="color: #94a3b8; font-size: 14px; margin: 0;">Two-Factor Authentication Required</p>
  </div>

  <p style="font-size: 15px; color: #cbd5e1; line-height: 1.6;">
    Hello {{fullName}},<br><br>
    We detected a sign-in attempt to your OuraDash account. Please use the following 6-digit security code to complete your verification:
  </p>

  <div style="text-align: center; margin: 32px 0;">
    <span style="display: inline-block; font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #ffffff; background: #1e1b4b; border: 2px solid #4f46e5; border-radius: 12px; padding: 14px 28px; font-family: monospace;">
      {{otpCode}}
    </span>
  </div>

  <div style="background: #1e293b; border-radius: 10px; padding: 16px; margin: 24px 0; font-size: 13px; color: #94a3b8;">
    <p style="margin: 0 0 6px 0;"><strong>Sign-in Details:</strong></p>
    <ul style="margin: 0; padding-left: 20px; line-height: 1.6;">
      <li><strong>Time:</strong> {{timestampUtc}} UTC</li>
      <li><strong>IP Address:</strong> {{ipAddress}}</li>
      <li><strong>Approximate Location:</strong> {{location}}</li>
      <li><strong>Device:</strong> {{userAgent}}</li>
    </ul>
  </div>

  <p style="font-size: 13px; color: #ef4444; line-height: 1.5; margin-top: 24px;">
    <strong>Security Alert:</strong> If you did not initiate this login attempt, your password may have been exposed. Please change your password immediately or contact our security team.
  </p>
</div>
```

---

## 7. Step-by-Step Execution Plan (خطة التنفيذ البرمجية مرحلة بمرحلة)

### Phase 1: Database & Backend Core
1. **Migration `0015_add_two_factor_auth.sql`:**
   - Add `is_two_factor_enabled` (INTEGER DEFAULT 0) and `two_factor_confirmed_at` to `Users`.
   - Apply migration to D1.
2. **Backend Validators (`backend/src/validators/auth.validators.ts`):**
   - Define `verify2faSchema` (`two_factor_token`, `code`).
   - Define `resend2faSchema` (`two_factor_token`).
3. **Email Dispatcher (`AuthService.dispatchEmail`):**
   - Add `two_factor_code` email template in English with IP, device, and location tags.
4. **Auth Services Updates (`backend/src/services/auth.services.ts`):**
   - Update `AuthService.login`: Check `is_two_factor_enabled`. If true, issue `two_factor_token` in KV, generate OTP, send email, and return `{ requires_2fa: true, two_factor_token, email }`.
   - Add `AuthService.verify2fa`: Validate KV token, verify D1 OTP, delete token/code, create session, return user.
   - Add `AuthService.resend2fa`: Verify KV token, enforce 60s cooldown, re-issue OTP, send email.
5. **Auth Controller & Routes (`auth.controller.ts` & `auth.routes.ts`):**
   - Implement `AuthController.verify2fa` and `AuthController.resend2fa`.
   - Wire up routes with `VERIFY_CODE_LIMITER` and `RESEND_CODE_LIMITER`.

### Phase 2: Frontend Client & Hook Integration
1. **Service Layer (`frontend/dashboard/lib/services/auth.service.ts`):**
   - Add `AuthService.verify2fa({ two_factor_token, code })`.
   - Add `AuthService.resend2fa(two_factor_token)`.
2. **Translation Dictionaries (`lang/ar/two_factor.json` & `lang/en/two_factor.json` or within `login.json`):**
   - Add all 2FA titles, descriptions, button labels, countdowns, and error messages.
3. **Custom Hook (`frontend/dashboard/lib/hooks/useAuth.ts`):**
   - Add `useVerify2fa()` mutation.
   - Add `useResend2fa()` mutation.
   - Add `useTwoFactorForm()` managing token, digits array, resend timer, and error handling.
   - Update `useLoginForm`: On `requires_2fa: true`, persist token in session and push router to `/two-factor-auth`.

### Phase 3: Dedicated Page Construction
1. **Create Page (`frontend/dashboard/app/two-factor-auth/page.tsx`):**
   - Implement the complete standalone Next.js App Router page.
   - Full glassmorphism card, glowing shield lock icon, 6 OTP inputs, error banner, resend timer, submit button, and back button.
2. **Testing & End-to-End Validation:**
   - Automated unit tests for 2FA token generation and verification.
   - Integration tests for rate limiting, invalid code attempts, session expiration, and resend cooldown.
   - Browser test of full login -> 2FA transition -> OTP input -> Dashboard entry.
