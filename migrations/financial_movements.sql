-- ==============================================================================
-- MobiDash Platform - Database Migration: financial_movements.sql
-- Architecture: Unified Financial & Operational Movements (Cloudflare D1 / SQLite)
-- Purpose: السجل المركزي الشامل لكافة حركات المبيعات (POS)، معاملات السنترال والمحافظ،
--          مقبوضات ومصروفات الخزينة والوردية اليومية، وربطها المباشر بكشف حساب الماكينات
-- متوافق تماماً مع: backend/docs/DATABASE_QUERIES_AND_INDEXING.md
-- ==============================================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------------------------
-- 1. جدول الحركات المالية والتشغيلية الموحد (Unified Financial Movements Table)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS financial_movements (
    -- [id] المعرف الفريد للحركة المالية (UUIDv4 مثل mov-XXXX)
    id                      TEXT PRIMARY KEY NOT NULL,

    -- [dashboard_id] معرف المتجر لعزل المستأجر الصارم (References Dashboards.id)
    dashboard_id            TEXT NOT NULL,

    -- [invoice_number] رقم الفاتورة أو الإيصال المرجعي (مثل INV-2026-0001 أو TX-XXXX)
    invoice_number          TEXT NOT NULL,

    -- [department] القسم أو النشاط التشغيلي التابع له الحركة:
    -- 'accessories' (إكسسوارات)
    -- 'phones' (هواتف وأجهزة)
    -- 'spare_parts' (قطع غيار صيانة)
    -- 'telecom' (ماكينات دفع ومحافظ سنترال)
    -- 'mixed_pos' (سلة كاشير مختلطة تحتوي على أكثر من قسم)
    -- 'repairs' (صيانة وأجور فنيين)
    -- 'general_finance' (مصروفات عامة وعهدة نقدية)
    department              TEXT CHECK(department IN (
                                'accessories', 'phones', 'spare_parts', 
                                'telecom', 'mixed_pos', 'repairs', 'general_finance'
                            )) NOT NULL,

    -- [movement_type] الاتجاه والنوع المحاسبي للحركة:
    -- 'sale' (عملية بيع سلة مشتريات)
    -- 'refund' (مرتجع مبيعات)
    -- 'telecom_service' (خدمة سنترال أو شحن أو فاتورة)
    -- 'expense' (مصروف نثري أو بوفيه أو تشغيلي)
    -- 'cash_in' (توريد كاش للدرج)
    -- 'cash_out' (صرف كاش من الدرج)
    -- 'shift_adjust' (تسوية عهدة أو فارق وردية)
    movement_type           TEXT CHECK(movement_type IN (
                                'sale', 'refund', 'telecom_service', 
                                'expense', 'cash_in', 'cash_out', 'shift_adjust'
                            )) NOT NULL,

    -- [payment_method] طريقة السداد والتحصيل
    payment_method          TEXT CHECK(payment_method IN (
                                'cash', 'card', 'wallet', 'credit', 'split'
                            )) NOT NULL DEFAULT 'cash',

    -- [subtotal] إجمالي القيمة قبل الخصم
    subtotal                REAL NOT NULL DEFAULT 0.0,

    -- [discount] قيمة الخصم المالي الممنوح للعميل
    discount                REAL NOT NULL DEFAULT 0.0,

    -- [total_amount] المبلغ الإجمالي الصافي للحركة
    total_amount            REAL NOT NULL DEFAULT 0.0,

    -- [cost_amount] إجمالي التكلفة الحقيقية للبضاعة المباعة
    cost_amount             REAL NOT NULL DEFAULT 0.0,

    -- [net_profit] صافي الربح المكتسب من الحركة (total_amount - cost_amount)
    net_profit              REAL NOT NULL DEFAULT 0.0,

    -- [paid_amount] المبلغ المسدد فعلياً أثناء العملية
    paid_amount             REAL NOT NULL DEFAULT 0.0,

    -- [remaining_amount] المبلغ المتبقي كدين أو آجل على العميل
    remaining_amount        REAL NOT NULL DEFAULT 0.0,

    -- بيانات العميل والكاشير
    customer_id             TEXT,
    customer_name           TEXT NOT NULL DEFAULT 'عميل نقدي',
    customer_phone          TEXT DEFAULT '-',
    cashier_id              TEXT,
    cashier_name            TEXT NOT NULL,
    shift_id                TEXT,

    -- الربط التبادلي المباشر مع ماكينات الدفع والمحافظ (telecom.sql)
    terminal_id             TEXT,
    telecom_transaction_id  TEXT,

    -- اللقطات التفصيلية الكاملة (JSON Payloads)
    items_json              TEXT, -- مصفوفة الأصناف المباعة كاملة بمواصفاتها وأسعارها وسيريالها
    telecom_details_json    TEXT, -- لقطة تفاصيل عملية السنترال (الرقم، كود الخدمة، العمولة، الحساب)
    split_details_json      TEXT, -- تفاصيل الدفع المقسم (كاش + فيزا)

    notes                   TEXT,
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (dashboard_id) REFERENCES Dashboards(id) ON DELETE CASCADE,
    FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL,
    FOREIGN KEY (terminal_id) REFERENCES telecom_terminals(id) ON DELETE SET NULL,
    FOREIGN KEY (telecom_transaction_id) REFERENCES telecom_transactions(id) ON DELETE SET NULL
);

-- ------------------------------------------------------------------------------
-- 2. الفهارس المتقدمة والمركبة (Left-to-Right Indexing Strategy)
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_fin_mov_dash_created 
    ON financial_movements(dashboard_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fin_mov_dash_dept 
    ON financial_movements(dashboard_id, department, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fin_mov_dash_type 
    ON financial_movements(dashboard_id, movement_type);

CREATE INDEX IF NOT EXISTS idx_fin_mov_dash_shift 
    ON financial_movements(dashboard_id, shift_id);

CREATE INDEX IF NOT EXISTS idx_fin_mov_terminal 
    ON financial_movements(dashboard_id, terminal_id);

CREATE INDEX IF NOT EXISTS idx_fin_mov_telecom_tx 
    ON financial_movements(telecom_transaction_id);

CREATE INDEX IF NOT EXISTS idx_fin_mov_invoice_num 
    ON financial_movements(dashboard_id, invoice_number);
