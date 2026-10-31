-- ==========================================
-- OuraDash Notifications Schema
-- Architecture: Multi-Tenant Edge Platform (Cloudflare D1 / SQLite)
-- ==========================================

PRAGMA foreign_keys = ON;

-- 1. Notifications Table
-- Stores notifications linked directly to member profile (user_profile) instead of global user.
CREATE TABLE IF NOT EXISTS Notifications (
    id TEXT PRIMARY KEY,                       -- Unique identifier (UUIDv4)
    profile_id TEXT NOT NULL,                  -- Foreign key to user_profile (recipient profile of the notification)
    dashboard_id TEXT,                         -- Optional foreign key referencing Dashboards.id for workspace scoping
    type TEXT NOT NULL,                        -- Type of notification (e.g., NEW_COMMENT, NEW_SERVICE_REQUEST, SYSTEM_ALERT)
    target_id TEXT,                            -- Optional ID of the related entity (e.g., comment ID, order ID)
    message_title TEXT,                        -- Short title or localization key for the notification
    message_body TEXT,                         -- Detailed message content or JSON payload
    url TEXT,                                  -- Direct deep-link URL to navigate when the notification is clicked
    is_read INTEGER DEFAULT 0 CHECK (is_read IN (0, 1)), -- 0 = Unread, 1 = Read
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- Timestamp of notification creation
    FOREIGN KEY (profile_id) REFERENCES Users (id) ON DELETE CASCADE,
    FOREIGN KEY (dashboard_id) REFERENCES Dashboards (id) ON DELETE CASCADE
);

-- Optimization indexes for fetching profile notifications chronologically
CREATE INDEX IF NOT EXISTS idx_notifications_profile_created ON Notifications (profile_id, created_at DESC);

-- Optimization indexes for unread notification count badge
CREATE INDEX IF NOT EXISTS idx_notifications_profile_unread ON Notifications (profile_id, is_read);

-- Optimization indexes for dashboard-scoped notifications
CREATE INDEX IF NOT EXISTS idx_notifications_dashboard_id ON Notifications (dashboard_id);