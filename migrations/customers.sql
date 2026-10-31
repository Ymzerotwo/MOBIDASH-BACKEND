-- ==============================================================================
-- MobiDash Platform - Database Migration: customers.sql
-- Architecture: Customer Credit Ledger & Installments (Cloudflare D1 / SQLite)
-- Purpose: إدارة حسابات العملاء الآجلة (دفتر النوتة / الشكك)،
--          وسجل حركات التحصيل والمسحوبات، وملفات تقسيط الهواتف المحمولة
--          وسجل الأقساط الشهرية المسددة مع الربط التلقائي بالخزينة والورديات
-- متوافق تماماً مع:
--   - frontend/src/database/customers.ts
--   - backend/docs/DATABASE_QUERIES_AND_INDEXING.md
-- ==============================================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------------------------
-- 1. جدول ديون العملاء (دفتر النوتة / الحسابات الآجلة)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_credits (
    -- [id] المعرف الفريد لحساب العميل في النوتة (مثال: cr-101 أو UUIDv4)
    id                      TEXT PRIMARY KEY NOT NULL,

    -- [dashboard_id] معرف المتجر لعزل المستأجر الصارم (References Dashboards.id)
    dashboard_id            TEXT NOT NULL,

    -- [name] اسم العميل بالكامل
    name                    TEXT NOT NULL,

    -- [phone] رقم هاتف العميل للتواصل والمتابعة الفورية
    phone                   TEXT NOT NULL,

    -- [balance_due] إجمالي المبلغ المستحق على العميل للمحل بالجنيه
    balance_due             REAL NOT NULL DEFAULT 0.0,

    -- [total_debt] إجمالي المسحوبات الآجلة التراكمية منذ فتح الحساب
    total_debt              REAL NOT NULL DEFAULT 0.0,

    -- [total_paid] إجمالي المبالغ المسددة التراكمية
    total_paid              REAL NOT NULL DEFAULT 0.0,

    -- [last_transaction_date] تاريخ آخر عملية سحب أو سداد قام بها العميل
    last_transaction_date   DATETIME,

    -- [status] الحالة التشغيلية للحساب:
    -- 'active' (نشط وعليه دين قائم)
    -- 'cleared' (تم تصفير الدين وسداده بالكامل)
    -- 'archived' (حساب مؤرشف)
    status                  TEXT CHECK(status IN ('active', 'cleared', 'archived')) NOT NULL DEFAULT 'active',

    -- [notes] تفاصيل المديونية أو المشتريات الآجلة
    notes                   TEXT,

    -- [created_by] الموظف الذي فتح الحساب الآجل
    created_by              TEXT,

    -- [updated_by] آخر موظف عدل على الحساب
    updated_by              TEXT,

    -- [created_at] وقت فتح الحساب
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,

    -- [updated_at] وقت آخر تعديل
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP,

    -- القيود والمفاتيح الأجنبية
    FOREIGN KEY (dashboard_id) REFERENCES Dashboards (id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES Users (id) ON DELETE SET NULL,
    FOREIGN KEY (updated_by) REFERENCES Users (id) ON DELETE SET NULL
);

-- فهارس جدول حسابات العملاء الآجلة (طبقاً لقاعدة اليسار لليمين)
CREATE INDEX IF NOT EXISTS idx_cust_credits_dashboard 
    ON customer_credits (dashboard_id);

CREATE INDEX IF NOT EXISTS idx_cust_credits_dashboard_created 
    ON customer_credits (dashboard_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cust_credits_dashboard_phone 
    ON customer_credits (dashboard_id, phone);

CREATE INDEX IF NOT EXISTS idx_cust_credits_dashboard_name 
    ON customer_credits (dashboard_id, name);

CREATE INDEX IF NOT EXISTS idx_cust_credits_dashboard_status 
    ON customer_credits (dashboard_id, status);

-- فهرس جزئي ذكي للعملاء أصحاب المديونيات النشطة لتسريع شاشات التحصيل
CREATE INDEX IF NOT EXISTS idx_cust_credits_active_due 
    ON customer_credits (dashboard_id, balance_due DESC) 
    WHERE balance_due > 0;

-- فهارس المفاتيح الأجنبية
CREATE INDEX IF NOT EXISTS idx_cust_credits_created_by 
    ON customer_credits (created_by) 
    WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cust_credits_updated_by 
    ON customer_credits (updated_by) 
    WHERE updated_by IS NOT NULL;


-- ------------------------------------------------------------------------------
-- 2. جدول حركات وسجل دفتر النوتة (Customer Credit Transactions & Ledger)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_credit_transactions (
    -- [id] المعرف الفريد للحركة المالية في النوتة
    id                  TEXT PRIMARY KEY NOT NULL,

    -- [dashboard_id] معرف المتجر لعزل المستأجر الصارم (References Dashboards.id)
    dashboard_id        TEXT NOT NULL,

    -- [credit_id] معرف حساب العميل التابع له السجل (References customer_credits.id)
    credit_id           TEXT NOT NULL,

    -- [type] نوع الحركة:
    -- 'debt' (سحب آجل جديد يزيد الدين على العميل)
    -- 'payment' (سداد وتحصيل نقدي أو إلكتروني ينقص الدين)
    -- 'discount' (خصم أو تسامح في جزء من المبلغ)
    -- 'adjustment' (تسوية محاسبية بالزيادة أو النقصان)
    type                TEXT CHECK(type IN ('debt', 'payment', 'discount', 'adjustment')) NOT NULL,

    -- [amount] قيمة الحركة بالجنيه
    amount              REAL NOT NULL DEFAULT 0.0,

    -- [balance_before] رصيد الدين قبل تنفيذ الحركة
    balance_before      REAL NOT NULL DEFAULT 0.0,

    -- [balance_after] رصيد الدين بعد تنفيذ الحركة
    balance_after       REAL NOT NULL DEFAULT 0.0,

    -- [payment_method] طريقة التحصيل عند السداد:
    -- 'cash' (نقداً بالدرج)
    -- 'bank' (تحويل بنكي / إنستاباي)
    -- 'wallet' (محفظة إلكترونية كاش)
    -- 'pos_split' (سحب آجل من فاتورة كاشير)
    -- 'other' (أخرى)
    payment_method      TEXT CHECK(payment_method IS NULL OR payment_method IN ('cash', 'bank', 'wallet', 'pos_split', 'other')),

    -- [receipt_number] رقم إيصال التحصيل المسلم للعميل
    receipt_number      TEXT,

    -- [invoice_id] رقم الفاتورة إذا كان السحب جزءاً من فاتورة بيع بالآجل
    invoice_id          TEXT,

    -- [shift_id] معرف وردية الكاشير المرتبطة بالتحصيل (References shifts.id)
    shift_id            TEXT,

    -- [cashier_profile_id] معرف الموظف الذي نفذ الحركة (References Users.id)
    cashier_profile_id  TEXT,

    -- [cashier_name] اسم الموظف Snapshot وقت الحركة
    cashier_name        TEXT,

    -- [cash_movement_id] معرف حركة الخزنة بالدرج إذا تم الإيداع بالدرج (References cash_movements.id)
    cash_movement_id    TEXT,

    -- [notes] بيان الصنف أو تفاصيل السحب والسداد
    notes               TEXT,

    -- [created_at] التاريخ والوقت الدقيق للحركة
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,

    -- القيود والمفاتيح الأجنبية
    FOREIGN KEY (dashboard_id) REFERENCES Dashboards (id) ON DELETE CASCADE,
    FOREIGN KEY (credit_id) REFERENCES customer_credits (id) ON DELETE CASCADE,
    FOREIGN KEY (shift_id) REFERENCES shifts (id) ON DELETE SET NULL,
    FOREIGN KEY (cashier_profile_id) REFERENCES Users (id) ON DELETE SET NULL,
    FOREIGN KEY (cash_movement_id) REFERENCES cash_movements (id) ON DELETE SET NULL
);

-- فهارس جدول حركات النوتة
CREATE INDEX IF NOT EXISTS idx_cust_tx_credit 
    ON customer_credit_transactions (dashboard_id, credit_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cust_tx_dashboard_created 
    ON customer_credit_transactions (dashboard_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cust_tx_type 
    ON customer_credit_transactions (dashboard_id, type);

CREATE INDEX IF NOT EXISTS idx_cust_tx_receipt 
    ON customer_credit_transactions (dashboard_id, receipt_number) 
    WHERE receipt_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cust_tx_invoice 
    ON customer_credit_transactions (dashboard_id, invoice_id) 
    WHERE invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cust_tx_shift 
    ON customer_credit_transactions (dashboard_id, shift_id) 
    WHERE shift_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cust_tx_cashier 
    ON customer_credit_transactions (cashier_profile_id) 
    WHERE cashier_profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cust_tx_cash_movement 
    ON customer_credit_transactions (cash_movement_id) 
    WHERE cash_movement_id IS NOT NULL;


-- ------------------------------------------------------------------------------
-- 3. جدول عقود وملفات تقسيط الهواتف المحمولة (Installment Contracts)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS installments (
    -- [id] المعرف الفريد لملف التقسيط (مثال: inst-101 أو UUIDv4)
    id                      TEXT PRIMARY KEY NOT NULL,

    -- [dashboard_id] معرف المتجر لعزل المستأجر الصارم (References Dashboards.id)
    dashboard_id            TEXT NOT NULL,

    -- [customer_name] اسم العميل المشتري للهاتف بالقسط
    customer_name           TEXT NOT NULL,

    -- [customer_phone] رقم هاتف العميل للتواصل
    customer_phone          TEXT NOT NULL,

    -- [customer_national_id] الرقم القومي للعميل المكون من 14 رقم من واقع البطاقة
    customer_national_id    TEXT,

    -- [guarantor_name] اسم الضامن للعميل
    guarantor_name          TEXT,

    -- [guarantor_phone] رقم هاتف الضامن
    guarantor_phone         TEXT,

    -- [guarantor_national_id] الرقم القومي للضامن
    guarantor_national_id   TEXT,

    -- [device_purchased] نوع وموديل وسيريال IMEI للجهاز المشترى بالقسط
    device_purchased        TEXT NOT NULL,

    -- [phone_id] معرف الهاتف المشترى من مخزن الهواتف إن وجد (References phones.id)
    phone_id                TEXT,

    -- [total_amount] السعر الإجمالي للتقسيط (شاملاً الفوائد المتفق عليها)
    total_amount            REAL NOT NULL DEFAULT 0.0,

    -- [paid_down_payment] قيمة المقدم النقدي المسدد عند التعاقد واستلام الهاتف
    paid_down_payment       REAL NOT NULL DEFAULT 0.0,

    -- [monthly_amount] قيمة القسط الشهري الواجب سداده
    monthly_amount          REAL NOT NULL DEFAULT 0.0,

    -- [total_months] إجمالي عدد شهور فترة التقسيط (مثال: 6، 10، 12، 18 شهر)
    total_months            INTEGER NOT NULL DEFAULT 12,

    -- [remaining_months] عدد الشهور المتبقية للانتهاء من كامل الأقساط
    remaining_months        INTEGER NOT NULL DEFAULT 12,

    -- [paid_months] عدد الشهور التي تم سدادها بالفعل
    paid_months             INTEGER NOT NULL DEFAULT 0,

    -- [total_paid_installments] إجمالي مبالغ الأقساط الشهرية المسددة
    total_paid_installments REAL NOT NULL DEFAULT 0.0,

    -- [next_due_date] تاريخ استحقاق القسط القادم (YYYY-MM-DD)
    next_due_date           TEXT NOT NULL,

    -- [status] حالة ملف التقسيط:
    -- 'active' (نشط والعميل منتظم في السداد)
    -- 'overdue' (متأخر عن السداد وتجاوز تاريخ الاستحقاق)
    -- 'completed' (تم سداد كافة الأقساط بالكامل وإغلاق العقد)
    -- 'cancelled' (ملغي / مفسوخ)
    status                  TEXT CHECK(status IN ('active', 'overdue', 'completed', 'cancelled')) NOT NULL DEFAULT 'active',

    -- [notes] ملاحظات قانونية، عنوان السكن، وأرقام إيصالات الأمانة
    notes                   TEXT,

    -- [created_by] الموظف الذي أنشأ ملف التقسيط
    created_by              TEXT,

    -- [updated_by] آخر موظف حدث بيانات الملف
    updated_by              TEXT,

    -- [created_at] تاريخ بدء التعاقد وتسليم الجهاز
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,

    -- [updated_at] تاريخ آخر سداد أو تعديل
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP,

    -- القيود والمفاتيح الأجنبية
    FOREIGN KEY (dashboard_id) REFERENCES Dashboards (id) ON DELETE CASCADE,
    FOREIGN KEY (phone_id) REFERENCES phones (id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES Users (id) ON DELETE SET NULL,
    FOREIGN KEY (updated_by) REFERENCES Users (id) ON DELETE SET NULL
);

-- فهارس جدول عقود التقسيط
CREATE INDEX IF NOT EXISTS idx_installments_dashboard 
    ON installments (dashboard_id);

CREATE INDEX IF NOT EXISTS idx_installments_dashboard_created 
    ON installments (dashboard_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_installments_dashboard_status 
    ON installments (dashboard_id, status);

CREATE INDEX IF NOT EXISTS idx_installments_dashboard_phone 
    ON installments (dashboard_id, customer_phone);

CREATE INDEX IF NOT EXISTS idx_installments_dashboard_name 
    ON installments (dashboard_id, customer_name);

CREATE INDEX IF NOT EXISTS idx_installments_dashboard_due 
    ON installments (dashboard_id, next_due_date ASC);

-- فهرس جزئي ذكي للأقساط النشطة والمتأخرة لتسريع تنبيهات التحصيل
CREATE INDEX IF NOT EXISTS idx_installments_active_due 
    ON installments (dashboard_id, next_due_date ASC) 
    WHERE status IN ('active', 'overdue');

-- فهارس المفاتيح الأجنبية
CREATE INDEX IF NOT EXISTS idx_installments_phone_fk 
    ON installments (phone_id) 
    WHERE phone_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_installments_created_by 
    ON installments (created_by) 
    WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_installments_updated_by 
    ON installments (updated_by) 
    WHERE updated_by IS NOT NULL;


-- ------------------------------------------------------------------------------
-- 4. جدول سجل تحصيل الأقساط الشهرية (Installment Monthly Payments)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS installment_payments (
    -- [id] المعرف الفريد لعملية سداد القسط
    id                  TEXT PRIMARY KEY NOT NULL,

    -- [dashboard_id] معرف المتجر لعزل المستأجر الصارم (References Dashboards.id)
    dashboard_id        TEXT NOT NULL,

    -- [installment_id] معرف ملف التقسيط المرتبط بالسداد (References installments.id)
    installment_id      TEXT NOT NULL,

    -- [installment_number] ترتيب ورقم القسط المسدد (مثال: القسط رقم 1، 2، 3...)
    installment_number  INTEGER NOT NULL,

    -- [amount] قيمة القسط المسدد بالجنيه
    amount              REAL NOT NULL DEFAULT 0.0,

    -- [payment_method] طريقة التحصيل:
    -- 'cash' (نقداً بالدرج)
    -- 'bank' (تحويل بنكي / إنستاباي)
    -- 'wallet' (محفظة إلكترونية كاش)
    -- 'other' (أخرى)
    payment_method      TEXT CHECK(payment_method IN ('cash', 'bank', 'wallet', 'other')) NOT NULL DEFAULT 'cash',

    -- [receipt_number] رقم إيصال التحصيل المطبوع للعميل
    receipt_number      TEXT,

    -- [shift_id] معرف وردية الكاشير المرتبطة بالتحصيل (References shifts.id)
    shift_id            TEXT,

    -- [cashier_profile_id] معرف الموظف الذي حصل القسط (References Users.id)
    cashier_profile_id  TEXT,

    -- [cashier_name] اسم الموظف وقت السداد
    cashier_name        TEXT,

    -- [cash_movement_id] معرف حركة الخزنة بالدرج المقابلة (References cash_movements.id)
    cash_movement_id    TEXT,

    -- [notes] ملاحظات إضافية على السداد
    notes               TEXT,

    -- [created_at] التاريخ والوقت الدقيق لسداد القسط
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,

    -- القيود والمفاتيح الأجنبية
    FOREIGN KEY (dashboard_id) REFERENCES Dashboards (id) ON DELETE CASCADE,
    FOREIGN KEY (installment_id) REFERENCES installments (id) ON DELETE CASCADE,
    FOREIGN KEY (shift_id) REFERENCES shifts (id) ON DELETE SET NULL,
    FOREIGN KEY (cashier_profile_id) REFERENCES Users (id) ON DELETE SET NULL,
    FOREIGN KEY (cash_movement_id) REFERENCES cash_movements (id) ON DELETE SET NULL
);

-- فهارس جدول سدادات الأقساط
CREATE INDEX IF NOT EXISTS idx_inst_pay_installment 
    ON installment_payments (dashboard_id, installment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inst_pay_dashboard_created 
    ON installment_payments (dashboard_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inst_pay_receipt 
    ON installment_payments (dashboard_id, receipt_number) 
    WHERE receipt_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inst_pay_shift 
    ON installment_payments (dashboard_id, shift_id) 
    WHERE shift_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inst_pay_cashier 
    ON installment_payments (cashier_profile_id) 
    WHERE cashier_profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inst_pay_cash_movement 
    ON installment_payments (cash_movement_id) 
    WHERE cash_movement_id IS NOT NULL;
