-- ==============================================================================
-- MobiDash Platform - Database Migration: telecom.sql
-- Architecture: Mobile Shop Telecom, Electronic Payments & Wallets (Cloudflare D1 / SQLite)
-- Purpose: إدارة ومتابعة أرصدة ماكينات الدفع الإلكتروني (فوري، أمان، مصاري...)،
--          ومحافظ الكاش (فودافون كاش، إنستاباي، وي، أورانج، إتصالات)،
--          وكافة معاملات الفواتير، المرافق، شحن الرصيد، الأقساط، التعليم، والاشتراكات
-- متوافق تماماً مع: backend/docs/DATABASE_QUERIES_AND_INDEXING.md
-- ==============================================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------------------------
-- 1. جدول ماكينات الدفع، المحافظ الإلكترونية، والحسابات البنكية (Terminals & Accounts)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS telecom_terminals (
    -- [id] المعرف الفريد للماكينة أو المحفظة (مثال: term-fawry-1, wallet-voda-010)
    id                  TEXT PRIMARY KEY NOT NULL,

    -- [dashboard_id] معرف المتجر لعزل المستأجر الصارم (References Dashboards.id)
    dashboard_id        TEXT NOT NULL,

    -- [name] الاسم التجاري المعرف بالمحل (مثال: ماكينة فوري الكاشير 1، محفظة فودافون كاش كاشير)
    name                TEXT NOT NULL,

    -- [provider] مزود الخدمة أو الشركة المشغلة:
    -- 'fawry' (فوري), 'aman' (أمان), 'masary' (مصاري), 'momken' (ممكن), 'khales' (خالص)
    -- 'vodafone' (فودافون كاش), 'etisalat' (إتصالات كاش), 'orange' (أورانج كاش), 'we' (وي باي)
    -- 'instapay' (إنستاباي), 'bank' (حساب بنكي مباشر), 'other' (أخرى)
    provider            TEXT CHECK(provider IN (
                            'fawry', 'aman', 'masary', 'momken', 'khales', 
                            'vodafone', 'etisalat', 'orange', 'we', 
                            'instapay', 'bank', 'other'
                        )) NOT NULL,

    -- [category] تصنيف القناة:
    -- 'pos' (ماكينة دفع مادية كفوري وأمان ومصاري)
    -- 'wallet' (محفظة هاتف نقدي كفودافون كاش ووي باي)
    -- 'bank' (حساب بنكي أو إنستاباي)
    category            TEXT CHECK(category IN ('pos', 'wallet', 'bank')) NOT NULL DEFAULT 'pos',

    -- [balance] الرصيد المالي الرقمي الحالي المتواجد داخل الماكينة أو المحفظة (الحساب الأساسي للخدمات)
    balance             REAL NOT NULL DEFAULT 0.0,

    -- [has_dual_accounts] هل الماكينة بحسابين مستقلين: 1 = نعم (حساب رئيسي للخدمات + حساب كاش أوت ومشتريات كفوري وأمان)، 0 = حساب واحد بسيط
    has_dual_accounts   INTEGER NOT NULL DEFAULT 0,

    -- [cash_out_balance] رصيد حساب الكاش أوت والمشتريات المستقل (المعزول مصرفياً لعمليات صرف كاش الفيزا والمحافظ)
    cash_out_balance    REAL NOT NULL DEFAULT 0.0,

    -- [allow_overdraft] هل تسمح الشركة برصيد سالب (سلفة على النوتة): 1 = مسموح، 0 = غير مسموح
    allow_overdraft     INTEGER NOT NULL DEFAULT 0,

    -- [overdraft_limit] الحد الأقصى للسلفة المسموح بها بالسالب من الشركة (مثلاً: 5000 ج.م)
    overdraft_limit     REAL NOT NULL DEFAULT 0.0,

    -- [min_threshold] حد الأمان للأرصدة؛ عند انخفاض الرصيد عنه يظهر تنبيه للكاشير بضرورة تغذية الماكينة
    min_threshold       REAL NOT NULL DEFAULT 1000.0,

    -- [account_number] رقم شريحة المحفظة أو رقم تعريف التاجر/الماكينة للرجوع إليه عند الشحن
    account_number      TEXT,

    -- [status] حالة الماكينة التشغيلية: 'active' (نشطة)، 'low_balance' (رصيد منخفض)، 'maintenance' (صيانة)، 'suspended' (موقوفة)
    status              TEXT CHECK(status IN ('active', 'low_balance', 'maintenance', 'suspended')) NOT NULL DEFAULT 'active',

    -- [notes] ملاحظات أو إرشادات تشغيلية
    notes               TEXT,

    -- [created_at] وقت تسجيل الماكينة
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,

    -- [updated_at] تاريخ ووقت آخر تسوية رصيد
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (dashboard_id) REFERENCES Dashboards(id) ON DELETE CASCADE
);

-- فهارس جدول الماكينات والمحافظ (تطبيق قاعدة اليسار إلى اليمين وحظر الفهارس المنفردة منخفضة التنوع)
CREATE INDEX IF NOT EXISTS idx_telecom_terminals_dashboard_status 
    ON telecom_terminals(dashboard_id, status);

CREATE INDEX IF NOT EXISTS idx_telecom_terminals_dashboard_provider 
    ON telecom_terminals(dashboard_id, provider);

CREATE INDEX IF NOT EXISTS idx_telecom_terminals_dashboard_category 
    ON telecom_terminals(dashboard_id, category);


-- ------------------------------------------------------------------------------
-- 2. جدول المعاملات، الفواتير، والتحويلات الموحد (Telecom & Electronic Transactions)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS telecom_transactions (
    -- [id] المعرف الفريد للمعاملة (UUIDv4)
    id                      TEXT PRIMARY KEY NOT NULL,

    -- [dashboard_id] معرف المتجر لعزل المستأجر الصارم (References Dashboards.id)
    dashboard_id            TEXT NOT NULL,

    -- [terminal_id] الماكينة أو المحفظة التي نُفذت من خلالها العملية (References telecom_terminals.id)
    terminal_id             TEXT,

    -- [sub_account] الحساب المتأثر داخل الماكينة: 'main_balance' (الحساب الرئيسي للخدمات) أو 'cash_out_balance' (حساب المشتريات والكاش أوت)
    sub_account             TEXT CHECK(sub_account IN ('main_balance', 'cash_out_balance')) NOT NULL DEFAULT 'main_balance',

    -- [category] التصنيف الرئيسي لنوع الخدمة:
    -- 'utilities' (مرافق عامة: كهرباء، مياه، غاز)
    -- 'telecom' (اتصالات وإنترنت: شحن رصيد، كروت فكة، فواتير نت وموبايل)
    -- 'wallet_transfer' (محافظ إلكترونية وإنستاباي: سحب وإيداع نقدي)
    -- 'installments' (أقساط وقروض متناهية الصغر: تساهيل، أمان، حالا، فاليو، فرصة، ريفي...)
    -- 'education' (تعليم وجامعات: مصاريف مدارس، جامعات حكومية وأهلية)
    -- 'insurance_social' (تأمينات اجتماعية، اشتراكات نقابات مهنية)
    -- 'entertainment' (قنوات مشفرة بي إن، منصات رقمية، ألعاب ببجي وبلايستيشن، نوادي)
    -- 'government' (مرور ومخالفات ورخص، إسكان وتمويل عقاري، تبرعات)
    -- 'internal_ops' (عمليات داخلية للمحل: تغذية ماكينة، سحب أرباح للدرج، تحويل بين الماكينات)
    category                TEXT CHECK(category IN (
                                'utilities', 'telecom', 'wallet_transfer', 
                                'installments', 'education', 'insurance_social', 
                                'entertainment', 'government', 'internal_ops'
                            )) NOT NULL,

    -- [type] الاتجاه المالي للحركة:
    -- 'cash_in' (استلام كاش بالدرج للتحويل للعميل)
    -- 'cash_out' (صرف كاش من الدرج للعميل مقابل تحويل إلكتروني للمحل)
    -- 'bill_payment' (سداد فاتورة أو قسط أو مصاريف واستلام كاش من العميل)
    -- 'airtime' (شحن رصيد هوائي أو كروت فكة إلكترونية)
    -- 'top_up' (تغذية رصيد الماكينة من الدرج أو البنك أو المندوب)
    -- 'withdraw' (سحب أرباح أو رصيد من الماكينة إلى درج النقدية بالمحل)
    -- 'internal_transfer' (تحويل رصيد داخلي بين ماكينة/محفظة وأخرى بالمحل)
    type                    TEXT CHECK(type IN (
                                'cash_in', 'cash_out', 'bill_payment', 
                                'airtime', 'top_up', 'withdraw', 'internal_transfer'
                            )) NOT NULL,

    -- [service_name] اسم الخدمة التفصيلي (مثال: كهرباء جنوب القاهرة - كارت ذكي NFC، أقساط تساهيل، شحن شدات ببجي، مصاريف جامعة حلوان)
    service_name            TEXT NOT NULL,

    -- [service_code] كود الخدمة المرجعي في فوري/أمان لتسهيل البحث السريع (مثال: 7125 لتساهيل)
    service_code            TEXT,

    -- [amount] قيمة المعاملة الأساسية بالجنيه
    amount                  REAL NOT NULL DEFAULT 0.0,

    -- [commission] قيمة العمولة الصافية التي ربحها المحل من هذه المعاملة وتدخل في حساب الأرباح
    commission              REAL NOT NULL DEFAULT 0.0,

    -- [service_fee] رسوم الخدمة الإضافية المفروضة من الشركة على العميل إن وجدت
    service_fee             REAL NOT NULL DEFAULT 0.0,

    -- [total_customer_amount] إجمالي المبلغ الفعلي المستلم من العميل أو المنصرف له نقداً
    total_customer_amount   REAL NOT NULL DEFAULT 0.0,

    -- [phone_or_ref] رقم هاتف العميل أو رقم العداد أو رقم الإيصال المرجعي لتأكيد وتتبع العملية
    phone_or_ref            TEXT NOT NULL,

    -- [customer_name] اسم العميل (اختياري للرجوع إليه عند الشكاوى)
    customer_name           TEXT,

    -- [cashier_profile_id] معرف ملف الموظف الذي نفذ العملية (References user_profile.id)
    cashier_profile_id      TEXT,

    -- [cashier_name] اسم الكاشير كما يظهر في الفواتير والتقارير (Snapshot)
    cashier_name            TEXT NOT NULL,

    -- [shift_id] معرف الوردية المرتبطة بهذه الحركة لضبط يومية الخزنة (References shifts.id)
    shift_id                TEXT,

    -- [source_of_funds] مصدر التمويل (عند عمليات التغذية): 'cash_drawer' (من الدرج)، 'bank' (من البنك)، 'distributor' (من المندوب)، 'other'
    source_of_funds         TEXT CHECK(source_of_funds IS NULL OR source_of_funds IN ('cash_drawer', 'bank', 'distributor', 'other')),

    -- [target_terminal_id] الماكينة أو المحفظة المحول إليها (في حالة التحويل الداخلي بين الماكينات internal_transfer)
    target_terminal_id      TEXT,

    -- [notes] ملاحظات إضافية حول العملية
    notes                   TEXT,

    -- [created_at] التاريخ والوقت الدقيق لتنفيذ المعاملة
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (dashboard_id) REFERENCES Dashboards(id) ON DELETE CASCADE,
    FOREIGN KEY (terminal_id) REFERENCES telecom_terminals(id) ON DELETE SET NULL,
    FOREIGN KEY (target_terminal_id) REFERENCES telecom_terminals(id) ON DELETE SET NULL,
    FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL,
    FOREIGN KEY (cashier_profile_id) REFERENCES Users(id) ON DELETE SET NULL
);

-- فهارس جدول المعاملات (تطبيق الفهرسة المركبة وقاعدة اليسار لليمين وفهرسة المفاتيح الأجنبية)
CREATE INDEX IF NOT EXISTS idx_telecom_tx_dashboard_created_at 
    ON telecom_transactions(dashboard_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_telecom_tx_dashboard_terminal 
    ON telecom_transactions(dashboard_id, terminal_id);

CREATE INDEX IF NOT EXISTS idx_telecom_tx_dashboard_shift 
    ON telecom_transactions(dashboard_id, shift_id);

CREATE INDEX IF NOT EXISTS idx_telecom_tx_dashboard_category 
    ON telecom_transactions(dashboard_id, category);

CREATE INDEX IF NOT EXISTS idx_telecom_tx_dashboard_type 
    ON telecom_transactions(dashboard_id, type);

CREATE INDEX IF NOT EXISTS idx_telecom_tx_dashboard_phone_ref 
    ON telecom_transactions(dashboard_id, phone_or_ref);

