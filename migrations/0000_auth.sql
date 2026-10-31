-- ==============================================================================
-- MobiDash Platform - Database Migration: 0000_auth.sql
-- Architecture: Unified Single-Account Mobile Shop Management Platform (Cloudflare D1 / SQLite)
-- Purpose: Clean Authentication & Security Core
--   1. Dashboards: Store / Branch control panel with store credentials (phone + password_hash).
--   2. Users: Unified single account table for Owner and Staff (Role strictly 'owner' or 'user').
--   3. shifts: Cashier shifts and cash tracking.
--   4. Sessions: Single active session per device with active shift context.
-- ==============================================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------------------------
-- 1. DASHBOARDS TABLE (لوحة التحكم والمتجر وبيانات الاعتماد للدخول)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Dashboards (
    id                          TEXT PRIMARY KEY,                  -- معرف المتجر الفريد (UUIDv4)
    name                        TEXT NOT NULL,                     -- اسم المحل / الفرع
    slug                        TEXT UNIQUE NOT NULL,              -- المعرف النصي الفريد للمحل
    phone                       TEXT UNIQUE NOT NULL,              -- رقم هاتف المحل لتسجيل الدخول
    email                       TEXT,                              -- البريد الإلكتروني للمحل
    password_hash               TEXT NOT NULL,                     -- كلمة مرور الدخول للوحة التحكم
    tagline                     TEXT,                              -- الشعار والوصف التسويقي
    logo_url                    TEXT,                              -- رابط شعار المحل
    address                     TEXT,                              -- العنوان الفعلي للمحل
    city                        TEXT,                              -- المدينة / المحافظة
    currency                    TEXT DEFAULT 'EGP',                -- العملة التشغيلية المعتمدة
    timezone                    TEXT DEFAULT 'Africa/Cairo',       -- النطاق الزمني
    receipt_header              TEXT,                              -- نص ترويسة الفاتورة
    receipt_footer              TEXT,                              -- تذييل الفاتورة
    receipt_terms               TEXT,                              -- شروط الاستبدال والضمان
    enable_thermal_print        INTEGER DEFAULT 1,                 -- تفعيل الطباعة الحرارية
    thermal_paper_size          TEXT DEFAULT '80mm' CHECK (
        thermal_paper_size IN ('80mm', '58mm')
    ),                                                             -- مقاس ورق الطابعة
    show_tax_invoice            INTEGER DEFAULT 0,                 -- إظهار ضريبة القيمة المضافة
    tax_rate                    REAL DEFAULT 0.0,                  -- نسبة الضريبة
    repair_terms                TEXT,                              -- شروط فحص واستلام أجهزة الصيانة
    default_repair_warranty_days INTEGER DEFAULT 30,               -- مدة ضمان الصيانة بالأيام
    require_imei_for_phones     INTEGER DEFAULT 1,                 -- إلزامية تسجيل IMEI للهواتف
    opening_cash_default        REAL DEFAULT 5000.0,               -- النقدية الافتتاحية المقترحة
    enable_telecom_wallets      INTEGER DEFAULT 1,                 -- تفعيل محافظ الموبايل
    theme                       TEXT DEFAULT 'dark' CHECK (
        theme IN ('dark', 'light', 'system')
    ),                                                             -- مظهر الواجهة
    locale                      TEXT DEFAULT 'ar' CHECK (
        locale IN ('ar', 'en')
    ),                                                             -- لغة الواجهة
    is_default                  INTEGER DEFAULT 1,                 -- المتجر الافتراضي
    status                      TEXT DEFAULT 'active' CHECK (
        status IN ('active', 'suspended', 'archived', 'maintenance')
    ),                                                             -- الحالة التشغيلية
    is_banned                   INTEGER DEFAULT 0,                 -- مؤشر الحظر
    ban_reason                  TEXT,                              -- سبب إيقاف المتجر
    created_at                  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at                  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dashboards_phone ON Dashboards (phone);
CREATE INDEX IF NOT EXISTS idx_dashboards_slug ON Dashboards (slug);
CREATE INDEX IF NOT EXISTS idx_dashboards_status ON Dashboards (status);

-- ------------------------------------------------------------------------------
-- 2. USERS TABLE (جدول الحسابات الموحد - المالك والمستخدمين - Single Account Model)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Users (
    id                  TEXT PRIMARY KEY,                  -- المعرف الفريد للمستخدم (UUIDv4)
    dashboard_id        TEXT NOT NULL,                     -- معرف المتجر التابع له
    name                TEXT NOT NULL,                     -- اسم صاحب الحساب (المالك أو الموظف)
    phone               TEXT,                              -- رقم الهاتف الشخصي
    email               TEXT,                              -- البريد الإلكتروني (اختياري)
    password_hash       TEXT NOT NULL,                     -- كلمة المرور الشخصية للدخول والوردية (بديل الـ PIN)
    role                TEXT NOT NULL CHECK (role IN ('owner', 'user')), -- دوران فقط: owner أو user
    job_title           TEXT,                              -- المسمى الوظيفي الإضافي (المدير، كاشير، فني صيانة...)
    permissions         JSON DEFAULT '{}',                 -- حقل JSON الشامل لصلاحيات الموظف (إذا كان user)
    salary              REAL DEFAULT 0.0,                  -- الراتب الشهري الثابت
    commission_rate     REAL DEFAULT 0.0,                  -- نسبة العمولة الإضافية
    max_discount_rate   REAL DEFAULT 0.0,                  -- أقصى نسبة خصم مئوية مسموحة
    can_open_drawer     INTEGER DEFAULT 1,                 -- صلاحية فتح درج النقدية
    can_view_cost_price INTEGER DEFAULT 0,                 -- إمكانية الاطلاع على أسعار التكلفة
    is_active           INTEGER DEFAULT 1,                 -- حالة التفعيل (1 = نشط، 0 = معطل)
    is_banned           INTEGER DEFAULT 0,                 -- مؤشر الحظر
    banned_at           DATETIME,                          -- توقيت الحظر
    banned_by           TEXT,                              -- معرف من قام بالحظر
    ban_reason          TEXT,                              -- سبب الحظر
    last_login_at       DATETIME,                          -- توقيت آخر تسجيل دخول
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dashboard_id) REFERENCES Dashboards (id) ON DELETE CASCADE,
    FOREIGN KEY (banned_by) REFERENCES Users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_users_dashboard ON Users (dashboard_id);
CREATE INDEX IF NOT EXISTS idx_users_dashboard_role ON Users (dashboard_id, role);
CREATE INDEX IF NOT EXISTS idx_users_dashboard_phone ON Users (dashboard_id, phone);
CREATE INDEX IF NOT EXISTS idx_users_banned ON Users (is_banned);

-- ------------------------------------------------------------------------------
-- 3. SHIFTS TABLE (جدول الورديات والدرج النقدي)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shifts (
    id                  TEXT PRIMARY KEY NOT NULL,         -- معرف الوردية الفريد (UUIDv4)
    dashboard_id        TEXT NOT NULL,                     -- معرف المتجر
    shift_number        INTEGER DEFAULT 1,                 -- رقم الوردية
    cashier_profile_id  TEXT,                              -- معرف المستخدم صاحب الوردية (References Users.id)
    cashier_name        TEXT NOT NULL,                     -- اسم صاحب الوردية
    start_time          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- وقت بدء الوردية
    end_time            DATETIME,                          -- وقت إنهاء الوردية
    opening_cash        REAL NOT NULL DEFAULT 0.0,         -- عهدة بداية الوردية
    expected_cash       REAL NOT NULL DEFAULT 0.0,         -- المبلغ المحسوب
    actual_cash         REAL,                              -- المبلغ الفعلي بعد الجرد
    difference          REAL DEFAULT 0.0,                  -- الفارق (عجز أو زيادة)
    status              TEXT CHECK(status IN ('active', 'closed')) NOT NULL DEFAULT 'active',
    notes               TEXT,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dashboard_id) REFERENCES Dashboards (id) ON DELETE CASCADE,
    FOREIGN KEY (cashier_profile_id) REFERENCES Users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_shifts_active ON shifts (dashboard_id, status);
CREATE INDEX IF NOT EXISTS idx_shifts_cashier ON shifts (cashier_profile_id);

-- ------------------------------------------------------------------------------
-- 4. SESSIONS TABLE (الجلسات النشطة - جلسة واحدة فقط لكل جهاز)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Sessions (
    id                  TEXT PRIMARY KEY,                  -- Session token: "session:uuid"
    dashboard_id        TEXT NOT NULL,                     -- معرف المتجر
    user_id             TEXT NOT NULL,                     -- المستخدم النشط حالياً في الجلسة
    shift_id            TEXT,                              -- الوردية النشطة المفتوحة
    device_fingerprint  TEXT NOT NULL,                     -- بصمة الجهاز لضمان عدم فتح أكثر من جلسة
    ip_address          TEXT,                              -- عنوان IP
    user_agent          TEXT,                              -- متصفح ونظام التشغيل
    active_shift        JSON NOT NULL,                     -- كائن الوردية النشطة والمستخدم وحالة الحظر
    expires_at          DATETIME NOT NULL,                 -- توقيت انتهاء الجلسة
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_active_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dashboard_id) REFERENCES Dashboards (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES Users (id) ON DELETE CASCADE,
    FOREIGN KEY (shift_id) REFERENCES shifts (id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_single_device ON Sessions (device_fingerprint);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON Sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_dashboard ON Sessions (dashboard_id);
