-- ==============================================================================
-- MobiDash Platform - Database Migration: invoices.sql
-- Architecture: Point of Sale (POS) & Customer Invoices (Cloudflare D1 / SQLite)
-- Purpose: تسجيل فواتير البيع الصادرة من الكاشير (POS)، ودعم طرق الدفع المتعددة
--          (كاش، فيزا، محافظ، آجل)، وبنود الفاتورة وحساب الأرباح والخصومات
-- متوافق تماماً مع:
--   - frontend/src/database/invoices.ts
--   - frontend/src/lib/types.ts (Invoice, CartItem)
-- ==============================================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------------------------
-- 1. جدول الفواتير الرئيسية (Invoices Table)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
    -- [id] المعرف الفريد للفاتورة في قاعدة البيانات (UUIDv4 أو inv-XXXX)
    id                      TEXT PRIMARY KEY NOT NULL,

    -- [dashboard_id] معرف المتجر لعزل المستأجر الصارم (References Dashboards.id)
    dashboard_id            TEXT NOT NULL,

    -- [invoice_number] رقم الفاتورة التسلسلي المطبوع والظاهر للعميل (مثل INV-2026-001)
    invoice_number          TEXT UNIQUE NOT NULL,

    -- [customer_name] اسم العميل المشتري
    customer_name           TEXT NOT NULL DEFAULT 'عميل نقدي',

    -- [customer_phone] رقم هاتف العميل لمتابعة الضمان أو سجل الديون
    customer_phone          TEXT DEFAULT '-',

    -- [customer_id] معرف العميل في دفتر الآجل إذا كانت الفاتورة مرتبطة بحساب عميل
    customer_id             TEXT,

    -- [subtotal] إجمالي أسعار المنتجات بالفاتورة قبل تطبيق الخصم
    subtotal                REAL NOT NULL DEFAULT 0.0,

    -- [discount] قيمة الخصم المالي الممنوح للزبون بالجنيه
    discount                REAL NOT NULL DEFAULT 0.0,

    -- [total] صافي المبلغ الإجمالي المطلوب تحصيله (subtotal - discount)
    total                   REAL NOT NULL DEFAULT 0.0,

    -- [payment_method] طريقة السداد
    payment_method          TEXT CHECK(payment_method IN (
        'cash', 'card', 'wallet', 'credit', 'split'
    )) NOT NULL DEFAULT 'cash',

    -- [paid_amount] المبلغ الفعلي الذي سدده العميل أثناء الشراء
    paid_amount             REAL NOT NULL DEFAULT 0.0,

    -- [remaining_amount] المبلغ المتبقي على العميل ويسجل كدين في دفتر الآجل
    remaining_amount        REAL NOT NULL DEFAULT 0.0,

    -- [split_details_json] تفاصيل الدفع المقسم (مثال: كاش + فيزا)
    split_details_json      TEXT,

    -- [cashier_name] اسم الكاشير أو الموظف المسؤول الذي أصدر الفاتورة
    cashier_name            TEXT NOT NULL,

    -- [cashier_id] معرف الكاشير في جدول المستخدمين
    cashier_id              TEXT,

    -- [shift_id] معرف الوردية التي صدرت فيها الفاتورة
    shift_id                TEXT,

    -- [warranty_notes] شروط وبنود الضمان المطبوعة في تذييل الفاتورة
    warranty_notes          TEXT,

    -- [status] حالة الفاتورة
    status                  TEXT CHECK(status IN (
        'completed', 'returned_partial', 'returned_full'
    )) NOT NULL DEFAULT 'completed',

    -- [created_at] التاريخ والوقت الدقيق لإنهاء الفاتورة وطباعتها
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,

    -- [updated_at] تاريخ ووقت آخر تعديل
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (dashboard_id) REFERENCES Dashboards(id) ON DELETE CASCADE
);

-- ------------------------------------------------------------------------------
-- 2. جدول بنود وأصناف الفاتورة التفصيلية (Invoice Items Table)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_items (
    id                      TEXT PRIMARY KEY NOT NULL,
    dashboard_id            TEXT NOT NULL,
    invoice_id              TEXT NOT NULL,
    type                    TEXT CHECK(type IN (
        'phone', 'accessory', 'spare_part', 'telecom', 'custom'
    )) NOT NULL,
    product_id              TEXT,
    title                   TEXT NOT NULL,
    barcode                 TEXT,
    imei                    TEXT,
    quantity                INTEGER NOT NULL DEFAULT 1,
    price                   REAL NOT NULL DEFAULT 0.0,
    cost_price              REAL NOT NULL DEFAULT 0.0,
    total_price             REAL NOT NULL DEFAULT 0.0,
    telecom_details_json    TEXT,
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (dashboard_id) REFERENCES Dashboards(id) ON DELETE CASCADE,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

-- ------------------------------------------------------------------------------
-- فهارس تحسين الاستعلام والبحث السريع (Indexes)
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_invoices_dashboard ON invoices(dashboard_id);
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_name);
CREATE INDEX IF NOT EXISTS idx_invoices_phone ON invoices(customer_phone);
CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices(created_at);
CREATE INDEX IF NOT EXISTS idx_invoices_shift ON invoices(shift_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_dashboard ON invoice_items(dashboard_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_imei ON invoice_items(imei);
CREATE INDEX IF NOT EXISTS idx_invoice_items_barcode ON invoice_items(barcode);
