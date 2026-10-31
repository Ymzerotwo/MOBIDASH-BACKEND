-- ==============================================================================
-- MobiDash Platform - Database Migration: finances.sql
-- Architecture: Mobile Shop Financial Management & Cash Drawer (Cloudflare D1 / SQLite)
-- Purpose: إدارة دفتر يومية الخزنة، حركة النقدية بالدرج (Cash Drawer)،
--          والمصروفات النثرية، وأرشفة تقفيل الشيفتات والورديات المحاسبية
-- متوافق تماماً مع: src/database/finances.ts
-- ==============================================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------------------------
-- 1. جدول حركة النقدية اليومية بالدرج والخزنة (Daily Cash Movements & Expenses)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cash_movements (
    -- [id] المعرف الفريد للحركة النقدية (UUIDv4 أو معرف تسلسلي مثل cm-101)
    id                  TEXT PRIMARY KEY NOT NULL,

    -- [dashboard_id] معرف المتجر أو الفرع التابع له الحركة (References Dashboards.id)
    dashboard_id        TEXT NOT NULL,

    -- [type] اتجاه حركة المال: 'in' (وارد إلى الدرج / مقبوضات)، 'out' (منصرف من الدرج / مدفوعات ومصروفات)
    type                TEXT CHECK(type IN ('in', 'out')) NOT NULL,

    -- [category] بند وتصنيف الحركة المحاسبية للدرج:
    -- 'pos_sale' (مبيعات فواتير كاشير)
    -- 'repair_advance' (عربون صيانة مستلم مقدماً)
    -- 'repair_final' (باقي حساب صيانة مستلم عند تسليم الجهاز للعميل)
    -- 'wallet_commission' (عمولات السنترال والمحافظ الإلكترونية)
    -- 'wallet_cash_in' (كاش مستلم للتحويل لمحفظة عميل كاش)
    -- 'wallet_cash_out' (كاش منصرف من الدرج لعميل سحب من محفظته)
    -- 'petty_expense' (مصروف نثري تشغيلي: بوفيه، أدوات نظافة، فواتير كهرباء وإنترنت)
    -- 'card_sale' (بيع كروت شحن مادية)
    -- 'telecom_withdraw' (سحب أرباح أو رصيد من ماكينة سنترال/فوري إلى الدرج)
    -- 'supplier_payment' (سداد دفعة نقدية أو تسوية حساب تاجر جملة)
    -- 'shift_adjustment' (تسوية نقدية يدوية / عهدة إضافية للدرج)
    -- 'other' (حركة متنوعة أخرى)
    category            TEXT CHECK(category IN (
        'pos_sale', 'repair_advance', 'repair_final', 
        'wallet_commission', 'wallet_cash_in', 'wallet_cash_out', 
        'petty_expense', 'card_sale', 'telecom_withdraw', 
        'supplier_payment', 'shift_adjustment', 'other'
    )) NOT NULL,

    -- [amount] قيمة المبلغ النقدي بالجنيه (موجب دائماً ويحدد الاتجاه نوع الحركة type)
    amount              REAL NOT NULL DEFAULT 0.0,

    -- [description] شرح وبيان تفصيلي لسبب الصرف أو التوريد (مثال: شراء شاي وسكر للبوفيه + رول فواتير)
    description         TEXT NOT NULL,

    -- [cashier_profile_id] معرف الملف الشخصي للموظف أو الكاشير الذي أجرى الحركة (References user_profile.id)
    cashier_profile_id  TEXT,

    -- [cashier_name] اسم الكاشير كما يظهر في الفواتير والتقارير المحاسبية (Snapshot)
    cashier_name        TEXT NOT NULL,

    -- [shift_id] معرف الوردية المرتبطة بهذه الحركة إن وجدت (References shifts.id)
    shift_id            TEXT,

    -- [created_at] التاريخ والوقت الدقيق لتسجيل الحركة بالدرج
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (dashboard_id) REFERENCES Dashboards (id) ON DELETE CASCADE,
    FOREIGN KEY (cashier_profile_id) REFERENCES Users (id) ON DELETE SET NULL,
    FOREIGN KEY (shift_id) REFERENCES shifts (id) ON DELETE SET NULL
);

-- Operational indexes for cash_movements
CREATE INDEX IF NOT EXISTS idx_cash_movements_dashboard_created ON cash_movements (dashboard_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_movements_type ON cash_movements (dashboard_id, type);
CREATE INDEX IF NOT EXISTS idx_cash_movements_category ON cash_movements (dashboard_id, category);
CREATE INDEX IF NOT EXISTS idx_cash_movements_cashier ON cash_movements (cashier_profile_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_shift ON cash_movements (shift_id);


-- ------------------------------------------------------------------------------
-- 2. جدول أرشيف وتقفيل الورديات النقدية (Cashier Shift Reconciliation Table)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shifts (
    -- [id] المعرف الفريد للوردية (UUIDv4 أو معرف تسلسلي مثل sh-101)
    id                  TEXT PRIMARY KEY NOT NULL,

    -- [dashboard_id] معرف الفرع / المتجر (References Dashboards.id)
    dashboard_id        TEXT NOT NULL,

    -- [shift_number] رقم الوردية التسلسلي في المتجر (1, 2, 3...)
    shift_number        INTEGER NOT NULL,

    -- [cashier_profile_id] معرف الموظف أو الكاشير المسؤول عن استلام الدرج (References user_profile.id)
    cashier_profile_id  TEXT,

    -- [cashier_name] اسم الكاشير المسؤول عن استلام الدرج في هذه الوردية
    cashier_name        TEXT NOT NULL,

    -- [start_time] وقت وتاريخ بدء الوردية واستلام الدرج
    start_time          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- [end_time] وقت وتاريخ إنهاء وتقفيل الوردية وتسليم النقدية
    end_time            DATETIME,

    -- [opening_cash] العهدة الافتتاحية (الفكة) المتروكة في الدرج عند بدء الوردية
    opening_cash        REAL NOT NULL DEFAULT 0.0,

    -- [expected_cash] المبلغ المحسوب تلقائياً بالنظام والمفترض تواجده في الدرج بناءً على الوارد والمنصرف
    expected_cash       REAL NOT NULL DEFAULT 0.0,

    -- [actual_cash] النقدية الفعلية بعد العد اليدوي من الكاشير (Blind Count)
    actual_cash         REAL,

    -- [difference] الفارق المحاسبي: (actual_cash - expected_cash)؛ إذا كان سالباً فهو عجز، وإذا كان موجباً فهو زيادة
    difference          REAL DEFAULT 0.0,

    -- [status] حالة الوردية: 'active' (مفتوحة حالياً)، 'closed' (تم تقفيلها وتسليمها)
    status              TEXT CHECK(status IN ('active', 'closed')) NOT NULL DEFAULT 'active',

    -- [notes] ملاحظات وتبريرات الكاشير أو المشرف عن أسباب العجز أو الزيادة
    notes               TEXT,

    -- [created_at] توقيت فتح الوردية
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,

    -- [updated_at] توقيت آخر تحديث أو إغلاق الوردية
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (dashboard_id) REFERENCES Dashboards (id) ON DELETE CASCADE,
    FOREIGN KEY (cashier_profile_id) REFERENCES Users (id) ON DELETE SET NULL
);

-- Operational indexes for shifts
CREATE INDEX IF NOT EXISTS idx_shifts_dashboard_status ON shifts (dashboard_id, status);
CREATE INDEX IF NOT EXISTS idx_shifts_cashier ON shifts (cashier_profile_id);
CREATE INDEX IF NOT EXISTS idx_shifts_start_time ON shifts (dashboard_id, start_time DESC);
