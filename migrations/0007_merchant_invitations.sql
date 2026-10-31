-- ==============================================================================
-- MobiDash Platform - Database Migration: 0007_merchant_invitations.sql
-- Architecture: Single-Use Merchant Invitation Codes for New Store Owners
-- Engine: Cloudflare D1 (SQLite)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS merchant_invitations (
    id                      TEXT PRIMARY KEY,                  -- معرف فريد UUIDv4
    code                    TEXT NOT NULL UNIQUE,              -- كود الدعوة (مثلاً: MOBI-7K9X-2026)
    status                  TEXT CHECK(status IN ('active', 'used', 'revoked', 'expired')) NOT NULL DEFAULT 'active',
    note                    TEXT,                              -- ملاحظة (اسم التاجر أو المحل المستهدف)
    expires_at              DATETIME,                          -- تاريخ انتهاء الصلاحية (اختياري)
    used_at                 DATETIME,                          -- توقيت الاستخدام الفعلي
    used_by_user_id         TEXT,                              -- معرف حساب المالك المنشأ
    used_by_dashboard_id    TEXT,                              -- معرف المتجر المنشأ
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (used_by_user_id) REFERENCES Users (id) ON DELETE SET NULL,
    FOREIGN KEY (used_by_dashboard_id) REFERENCES Dashboards (id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_merchant_invites_code ON merchant_invitations (code);
CREATE INDEX IF NOT EXISTS idx_merchant_invites_status ON merchant_invitations (status);
