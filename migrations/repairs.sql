-- ==============================================================================
-- MobiDash Platform - Database Migration: repairs.sql
-- Architecture: Mobile Repair Workshop & Ticket Lifecycle (Cloudflare D1 / SQLite)
-- Purpose: تسجيل دورة حياة تذاكر الصيانة بالكامل، الفحص المبدئي (Checklist)،
--          وقفل الشاشة، والعربون، وقطع الغيار المستهلكة، وحسابات الفنيين وضمان الصيانة
-- متوافق تماماً مع:
--   - frontend/src/database/repairs.ts
--   - frontend/src/lib/types.ts (RepairTicket)
-- ==============================================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------------------------
-- 1. جدول تذاكر الصيانة والورشة (Repair Tickets Table)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS repair_tickets (
    -- [id] المعرف الفريد للتذكرة في قاعدة البيانات (UUIDv4 أو rep-XXXX)
    id                      TEXT PRIMARY KEY NOT NULL,

    -- [dashboard_id] معرف المتجر لعزل المستأجر الصارم (References Dashboards.id)
    dashboard_id            TEXT NOT NULL,

    -- [ticket_number] رقم إيصال الصيانة المطبوع والمسلم للعميل (مثل TK-2026-001)
    ticket_number           TEXT UNIQUE NOT NULL,

    -- [customer_name] اسم صاحب الجهاز بالكامل
    customer_name           TEXT NOT NULL,

    -- [customer_phone] رقم هاتف العميل للتواصل وإرسال الإشعارات
    customer_phone          TEXT NOT NULL,

    -- [customer_whatsapp] رقم الواتساب لإرسال إشعارات الجاهزية والتكلفة
    customer_whatsapp       TEXT,

    -- [device_brand] ماركة الجهاز (Apple, Samsung, Xiaomi, Realme...)
    device_brand            TEXT COLLATE NOCASE NOT NULL,

    -- [device_model] موديل الجهاز (iPhone 14 Pro, Galaxy S23...)
    device_model            TEXT COLLATE NOCASE NOT NULL,

    -- [device_color] لون الجهاز الخارجي لتأكيد المطابقة
    device_color            TEXT NOT NULL,

    -- [imei] سيريال IMEI للجهاز لمنع التبديل والتحقق من الهوية
    imei                    TEXT,

    -- [passcode] رمز قفل الشاشة السري لفحص الجهاز بعد الإصلاح
    passcode                TEXT,

    -- [pattern_points] مصفوفة JSON لتمثيل نقاط رسم النمط (0 إلى 8)
    pattern_points          TEXT,

    -- [fault_description] شرح العطل وشكوى العميل بدقة
    fault_description       TEXT NOT NULL,

    -- [checklist_json] الفحص المبدئي للأجهزة (شاشة، لمس، كاميرا، شحن، بصمة...)
    checklist_json          TEXT,

    -- [expected_cost] التكلفة التقديرية المتفق عليها مع العميل
    expected_cost           REAL NOT NULL DEFAULT 0.0,

    -- [advance_paid] العربون المدفوع مقدماً والمودع في الدرج
    advance_paid            REAL NOT NULL DEFAULT 0.0,

    -- [remaining_cost] المبلغ المتبقي تحصيله عند التسليم
    remaining_cost          REAL NOT NULL DEFAULT 0.0,

    -- [parts_used_json] سجل قطع الغيار المستهلكة في تذكرة الصيانة
    parts_used_json         TEXT,

    -- [status] حالة التذكرة في الورشة
    status                  TEXT CHECK(status IN (
        'received', 'diagnosing', 'pending_approval', 
        'waiting_parts', 'in_progress', 'ready', 
        'delivered', 'rejected'
    )) NOT NULL DEFAULT 'received',

    -- [technician_name] اسم فني الصيانة المسؤول عن الجهاز
    technician_name         TEXT,

    -- [technician_id] معرف الفني في جدول المستخدمين إن وجد
    technician_id           TEXT,

    -- [technician_commission] عمولة أو أجر الفني المستحق عن إنجاز التذكرة
    technician_commission   REAL DEFAULT 0.0,

    -- [qc_passed] مؤشر اجتياز فحص الجودة بعد انتهاء الإصلاح (1 نعم، 0 لا)
    qc_passed               INTEGER DEFAULT 0,

    -- [warranty_days] عدد أيام الضمان الممنوحة على الصيانة
    warranty_days           INTEGER NOT NULL DEFAULT 30,

    -- [notes] ملاحظات داخلية سرية بين الفنيين والإدارة
    notes                   TEXT,

    -- [created_at] تاريخ ووقت فتح التذكرة واستلام الجهاز
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,

    -- [ready_at] تاريخ ووقت الانتهاء من الصيانة وتجهيز الجهاز
    ready_at                DATETIME,

    -- [delivered_at] تاريخ ووقت تسليم الجهاز للعميل واستلام الحساب
    delivered_at            DATETIME,

    -- [updated_at] تاريخ ووقت آخر تعديل على التذكرة
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (dashboard_id) REFERENCES Dashboards(id) ON DELETE CASCADE
);

-- ------------------------------------------------------------------------------
-- 2. جدول قطع الغيار المستخدمة في تذاكر الصيانة (Repair Parts Used Table)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS repair_parts_used (
    id                      TEXT PRIMARY KEY NOT NULL,
    dashboard_id            TEXT NOT NULL,
    ticket_id               TEXT NOT NULL,
    spare_part_id           TEXT,
    part_name               TEXT NOT NULL,
    part_code               TEXT,
    cost_price              REAL NOT NULL DEFAULT 0.0,
    selling_price           REAL NOT NULL DEFAULT 0.0,
    quantity                INTEGER NOT NULL DEFAULT 1,
    technician_name         TEXT,
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (dashboard_id) REFERENCES Dashboards(id) ON DELETE CASCADE,
    FOREIGN KEY (ticket_id) REFERENCES repair_tickets(id) ON DELETE CASCADE
);

-- ------------------------------------------------------------------------------
-- فهارس تحسين الاستعلام والبحث السريع (Indexes)
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_repair_tickets_dashboard ON repair_tickets(dashboard_id);
CREATE INDEX IF NOT EXISTS idx_repair_tickets_number ON repair_tickets(ticket_number);
CREATE INDEX IF NOT EXISTS idx_repair_tickets_phone ON repair_tickets(customer_phone);
CREATE INDEX IF NOT EXISTS idx_repair_tickets_status ON repair_tickets(status);
CREATE INDEX IF NOT EXISTS idx_repair_tickets_created_at ON repair_tickets(created_at);
CREATE INDEX IF NOT EXISTS idx_repair_parts_ticket ON repair_parts_used(ticket_id);
CREATE INDEX IF NOT EXISTS idx_repair_parts_dashboard ON repair_parts_used(dashboard_id);
