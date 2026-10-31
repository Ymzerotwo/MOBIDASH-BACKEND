# Two-Factor Authentication (2FA) Profile Settings - Implementation Plan

> [!NOTE]
> **خطة تاريخية — لا تفترض أنها تصف الوضع الحالي.** تحقق من التنفيذ الفعلي في `src/` قبل الاعتماد عليها.
> المرجع المعتمد: [`engineering/UNIFIED_METHODOLOGY.md`](./engineering/UNIFIED_METHODOLOGY.md) · [`project/PROJECT_PROFILE.md`](./project/PROJECT_PROFILE.md).
**Platform:** OuraDash Enterprise  
**Architecture:** Cloudflare Workers Edge (Hono + D1 + KV) & Next.js 15 (App Router)  
**Status:** Feature Engineering Plan  
**Target:** Production Readiness  

---

## 1. Executive Summary & Objective (الملخص التنفيذي والهدف)

The goal is to allow authenticated users to manage **Two-Factor Authentication (2FA via Email)** directly from their **Profile Settings** modal (`ProfileFormDialog`).

Currently, the database migration (`0015_add_two_factor_auth.sql`) and login flow already respect `Users.is_two_factor_enabled`. Now, users will have an intuitive, highly secure interface to:
1. **View 2FA Status:** See whether 2FA is currently active or inactive with a dedicated status badge.
2. **Enable 2FA (Secure Setup):**
   - User toggles the switch to ON.
   - The system dispatches a 6-digit verification code to the user's authenticated email address.
   - User inputs the code to confirm email deliverability.
   - 2FA is activated: `is_two_factor_enabled = 1`, `two_factor_confirmed_at = CURRENT_TIMESTAMP`.
3. **Disable 2FA (Re-Authentication Safeguard):**
   - User toggles the switch to OFF.
   - To prevent unauthorized tampering (e.g., from an unlocked workstation), the user must enter their **current password**.
   - Upon verification, 2FA is deactivated: `is_two_factor_enabled = 0`.

---

## 2. Threat Modeling & Security Principles (نموذج التهديدات وهندسة الأمان)

### 2.1 Why Email Verification is Required to Enable
- **The Risk:** If a user can enable 2FA with a single click without confirming they can receive OTP codes, any misconfiguration or routing issue with their email address would permanently lock them out upon next sign-in.
- **The Mitigation:** Requiring a 6-digit confirmation code (`type = '2fa_setup'`) guarantees that the user currently receives emails before the account enters 2FA-enforced mode.

### 2.2 Why Password Confirmation is Required to Disable
- **The Risk:** An attacker with temporary physical access to an unlocked computer could navigate to Profile Settings and turn off 2FA in one second, downgrading the account security.
- **The Mitigation:** Disabling 2FA strictly requires `password` re-authentication verified against `Users.password_hash` using PBKDF2 Web Crypto.

### 2.3 Single-Use Code Invalidation & Rate Limiting
- Setup OTP codes expire in **10 minutes**.
- Cooldown of **60 seconds** between setup code requests.
- Max **5 attempts** before invalidating the setup code.

---

## 3. Backend Architecture (الواجهة الخلفية)

### 3.1 Update `GET /api/profile`
- Update `ProfileService.getProfile` SQL query to include `is_two_factor_enabled`:
  ```sql
  SELECT 
    id, full_name, email, phone_number, photo_url, role,
    is_email_verified, is_phone_verified, is_two_factor_enabled,
    is_banned, created_at, updated_at
  FROM Users WHERE id = ?
  ```
- Return `is_two_factor_enabled: Boolean(user.is_two_factor_enabled === 1)` in user object.

### 3.2 New Endpoints in `profile.routes.ts` & `profile.controller.ts`

| Endpoint | Method | Rate Limiter | Auth Required | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `/api/profile/2fa/setup` | `POST` | `LOGIN_RECOVERY_LIMITER` | Yes | Sends a 6-digit confirmation OTP to the user's email. |
| `/api/profile/2fa/enable` | `POST` | `VERIFY_CODE_LIMITER` | Yes | Verifies setup OTP and sets `is_two_factor_enabled = 1`. |
| `/api/profile/2fa/disable` | `POST` | `LOGIN_RECOVERY_LIMITER` | Yes | Verifies current password and sets `is_two_factor_enabled = 0`. |

### 3.3 Validators in `profile.validators.ts`
```typescript
export const enable2faSchema = z.object({
  code: z.string().trim().length(6, { message: 'invalid_code' }).regex(/^\d{6}$/, { message: 'invalid_code' }),
});

export const disable2faSchema = z.object({
  password: z.string().min(1, { message: 'password_required' }),
});
```

### 3.4 Email Template for 2FA Setup
In `AuthService.dispatchEmail` or `ProfileService`:
- Dispatches `'two_factor_setup'` template:
  - Subject: `OuraDash Security - Confirm Enabling Two-Factor Authentication [123456]`
  - Body: Notice that user requested enabling 2FA, with 6-digit code, 10-minute expiry, and security advisory.

---

## 4. Frontend Architecture (الواجهة الأمامية)

### 4.1 State Management (`auth.store.ts`)
- Update `AuthUser` interface:
  ```typescript
  export interface AuthUser {
    ...
    is_two_factor_enabled: boolean;
  }
  ```
- In `hydrate()`:
  ```typescript
  is_two_factor_enabled: Boolean(rawUser.is_two_factor_enabled === 1 || rawUser.is_two_factor_enabled === true),
  ```

### 4.2 API Service (`profile.service.ts`)
Add methods:
```typescript
async setup2fa(): Promise<void> {
  await apiClient.post('/profile/2fa/setup');
},
async enable2fa(code: string): Promise<void> {
  await apiClient.post('/profile/2fa/enable', { code });
},
async disable2fa(password: string): Promise<void> {
  await apiClient.post('/profile/2fa/disable', { password });
}
```

### 4.3 Custom Hook (`useProfile.ts`)
- `useSetup2fa`: Dispatches code and triggers setup modal.
- `useEnable2fa`: Verifies code, updates auth store state, and displays success notification.
- `useDisable2fa`: Verifies password, updates auth store state, and displays success notification.

### 4.4 UI Integration (`ProfileFormDialog.tsx`)
In the **Security (الأمان)** section:
- Insert a dedicated Glassmorphic Card:
  - **Left side:** `ShieldCheck` icon with gradient ring, title `التحقق بخطوتين (2FA)`, description, and status pill (`مفعل` in emerald / `معطل` in zinc).
  - **Right side:** `<Switch checked={isTwoFactorEnabled} onCheckedChange={handleToggle2fa} />`.
- **Modals:**
  1. **Enable Modal (Confirm OTP):**
     - Pops up when user turns switch ON.
     - Displays: *"We sent a 6-digit security code to your email (user@example.com). Enter it to activate 2FA."*
     - 6-digit OTP input boxes (auto-focus, paste support).
     - 60s resend timer.
     - Submit button.
  2. **Disable Modal (Confirm Password):**
     - Pops up when user turns switch OFF.
     - Displays: *"To disable Two-Factor Authentication, please enter your current account password."*
     - Password input with Eye/EyeOff toggle.
     - Confirm button.

### 4.5 Internationalization (i18n)
Add comprehensive translation keys to `lang/ar/profile.json` and `lang/en/profile.json`:
- `two_factor.title`: "التحقق بخطوتين" / "Two-Factor Authentication"
- `two_factor.description`: "إضافة طبقة أمان إضافية لحسابك عن طريق إرسال رمز تحقق إلى بريدك الإلكتروني عند كل تسجيل دخول." / "Add an extra layer of security to your account by requiring an email security code on sign-in."
- `two_factor.status_enabled`: "مفعل" / "Enabled"
- `two_factor.status_disabled`: "معطل" / "Disabled"
- `two_factor.enable_modal_title`: "تأكيد تفعيل التحقق بخطوتين" / "Confirm Enabling 2FA"
- `two_factor.enable_modal_desc`: "أدخل رمز الأمان المكون من 6 أرقام المرسل إلى بريدك الإلكتروني لتأكيد التفعيل." / "Enter the 6-digit security code sent to your email to confirm activation."
- `two_factor.disable_modal_title`: "تعطيل التحقق بخطوتين" / "Disable 2FA"
- `two_factor.disable_modal_desc`: "لتعطيل التحقق بخطوتين، يرجى إدخال كلمة المرور الحالية لحسابك للتأكيد." / "To disable 2FA, please enter your current account password to confirm."
- `two_factor.confirm_btn`: "تأكيد وتفعيل" / "Confirm & Enable"
- `two_factor.disable_btn`: "تأكيد التعطيل" / "Confirm Disable"
- `two_factor.enabled_success`: "تم تفعيل التحقق بخطوتين بنجاح!" / "Two-factor authentication enabled successfully!"
- `two_factor.disabled_success`: "تم تعطيل التحقق بخطوتين بنجاح." / "Two-factor authentication disabled successfully."

---

## 5. Implementation Roadmap (خطة التنفيذ خطوة بخطوة)

1. **Step 1: Backend Profile Service & Query Update**
   - Update `ProfileService.getProfile` to select and return `is_two_factor_enabled`.
   - Implement `ProfileService.setup2fa`, `ProfileService.enable2fa`, and `ProfileService.disable2fa`.
2. **Step 2: Backend Routes & Controller**
   - Add routes in `profile.routes.ts`: `/2fa/setup`, `/2fa/enable`, `/2fa/disable`.
   - Implement controllers in `profile.controller.ts`.
   - Add input validators in `profile.validators.ts`.
3. **Step 3: Frontend Store & Services**
   - Add `is_two_factor_enabled` to `AuthUser` in `auth.store.ts`.
   - Add 2FA API methods in `profile.service.ts`.
   - Add React Query hooks in `useProfile.ts`.
4. **Step 4: Localization & UI Component**
   - Add Arabic & English keys in `profile.json`.
   - Add the 2FA Switch Card and confirmation dialogs in `ProfileFormDialog.tsx`.
5. **Step 5: Typechecking & Verification**
   - Run `tsc --noEmit` across `backend` and `frontend/dashboard`.
   - Verify toggle ON (with OTP) and toggle OFF (with password) flow.
