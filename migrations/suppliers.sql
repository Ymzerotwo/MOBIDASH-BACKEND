-- ==============================================================================
-- MobiDash Platform - Database Migration: suppliers.sql
-- Architecture: Mobile Shop Suppliers, Wholesale Accounts & Ledger (Cloudflare D1 / SQLite)
-- Purpose: متابعة حسابات الموردين وتجار الجملة (هواتف، إكسسوارات، قطع غيار، سنترال)،
--          وتتبع إجمالي المبالغ المستحقة والديون، وفواتير التوريد،
--          وتسجيل دفعات السداد النقدية أو البنكية مع أرقام الإيصالات وربطها بالورديات والدرج
-- متوافق تماماً مع:
--   - frontend/src/database/suppliers.ts
--   - backend/docs/DATABASE_QUERIES_AND_INDEXING.md
-- ==============================================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------------------------
-- 1. جدول الموردين وشركات التوزيع وتجار الجملة (Suppliers & Vendors)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
    -- [id] المعرف الفريد للمورد في قاعدة البيانات (UUIDv4 أو معرف تسلسلي مثل sup-101)
    id                  TEXT PRIMARY KEY NOT NULL,

    -- [dashboard_id] معرف المتجر أو الفرع لعزل المستأجر الصارم (References Dashboards.id)
    dashboard_id        TEXT NOT NULL,

    -- [name] اسم المندوب أو التاجر المسؤول عن الحساب للتواصل المباشر
    name                TEXT NOT NULL,

    -- [company_name] اسم الشركة أو التوكيل أو المحل الموزع (مثال: الأمل لتوزيع الهواتف)
    company_name        TEXT NOT NULL,

    -- [phone] رقم هاتف المورد الأساسي للاتصال والواتساب
    phone               TEXT NOT NULL,

    -- [address] عنوان مقر المورد أو مخزنه للرجوع إليه عند تبديل البضاعة
    address             TEXT,

    -- [category] تخصص التوريد:
    -- 'هواتف' (أجهزة ذكية جديد ومستعمل)
    -- 'إكسسوار' / 'إكسسوارات' (شواحن وجرابات وسماعات)
    -- 'قطع غيار' (شاشات، بطاريات وفلاتات صيانة)
    -- 'سنترال' (كروت شحن ورصيد وماكينات)
    -- 'عام' (توريدات متعددة ومصادر عامة)
    category            TEXT CHECK(category IN ('هواتف', 'إكسسوار', 'إكسسوارات', 'قطع غيار', 'سنترال', 'عام')) NOT NULL,

    -- [balance_due] إجمالي المبلغ المستحق للمورد (ديون علينا للتاجر ويجب سدادها بالجنيه)
    balance_due         REAL NOT NULL DEFAULT 0.0,

    -- [last_supply_date] تاريخ آخر فاتورة توريد استلمها المتجر من هذا المورد
    last_supply_date    DATETIME,

    -- [status] الحالة التشغيلية لحساب المورد: 'active' (نشط)، 'inactive' (معلق)، 'archived' (مؤرشف)
    status              TEXT CHECK(status IN ('active', 'inactive', 'archived')) NOT NULL DEFAULT 'active',

    -- [notes] شروط السداد والاتفاقات المسبقة (مثال: سداد أسبوعي كل خميس، خصم 2% عند السداد النقدي)
    notes               TEXT,

    -- [created_by] معرف المستخدم أو الموظف الذي أنشأ سجل المورد (References Users.id)
    created_by          TEXT,

    -- [updated_by] معرف آخر مستخدم قام بتحديث بيانات المورد (References Users.id)
    updated_by          TEXT,

    -- [created_at] تاريخ وتوقيت إضافة المورد للنظام
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,

    -- [updated_at] تاريخ وتوقيت آخر تعديل على بيانات المورد
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,

    -- القيود والمفاتيح الأجنبية
    FOREIGN KEY (dashboard_id) REFERENCES Dashboards (id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES Users (id) ON DELETE SET NULL,
    FOREIGN KEY (updated_by) REFERENCES Users (id) ON DELETE SET NULL
);

-- ------------------------------------------------------------------------------
-- فهارس جدول الموردين (طبقاً لمعايير الفهرسة الصارمة وقاعدة اليسار لليمين)
-- ------------------------------------------------------------------------------

-- فهرس معرّف المتجر الأساسي لعزل المستأجر
CREATE INDEX IF NOT EXISTS idx_suppliers_dashboard 
    ON suppliers (dashboard_id);

-- فهرس مركب لجلب الموردين مرتبين تنازلياً بأحدث تاريخ إضافة
CREATE INDEX IF NOT EXISTS idx_suppliers_dashboard_created 
    ON suppliers (dashboard_id, created_at DESC);

-- فهرس مركب للبحث السريع والتصفية باسم الشركة أو المحل الموزع
CREATE INDEX IF NOT EXISTS idx_suppliers_dashboard_company 
    ON suppliers (dashboard_id, company_name);

-- فهرس مركب للبحث برقم الهاتف للتواصل الفوري ومطابقة البيانات
CREATE INDEX IF NOT EXISTS idx_suppliers_dashboard_phone 
    ON suppliers (dashboard_id, phone);

-- فهرس مركب لتصفية الموردين حسب تخصص التوريد (هواتف / إكسسوارات / قطع غيار)
CREATE INDEX IF NOT EXISTS idx_suppliers_dashboard_category 
    ON suppliers (dashboard_id, category);

-- فهرس مركب للحالة التشغيلية مع معرّف المتجر
CREATE INDEX IF NOT EXISTS idx_suppliers_dashboard_status 
    ON suppliers (dashboard_id, status);

-- فهرس جزئي ذكي (Partial Index) للموردين الذين لهم مبالغ مستحقة فقط لتسريع تقارير المديونيات
CREATE INDEX IF NOT EXISTS idx_suppliers_active_due 
    ON suppliers (dashboard_id, balance_due DESC) 
    WHERE balance_due > 0;

-- فهارس المفاتيح الأجنبية لضمان كفاءة أداء محرك SQLite
CREATE INDEX IF NOT EXISTS idx_suppliers_created_by 
    ON suppliers (created_by) 
    WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_suppliers_updated_by 
    ON suppliers (updated_by) 
    WHERE updated_by IS NOT NULL;


-- ------------------------------------------------------------------------------
-- 2. جدول حركات كشف حساب المورد (Supplier Transactions & Ledger)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supplier_transactions (
    -- [id] المعرف الفريد للحركة المالية (UUIDv4 أو معرف تسلسلي مثل stx-101)
    id                  TEXT PRIMARY KEY NOT NULL,

    -- [dashboard_id] معرف المتجر أو الفرع لعزل المستأجر الصارم (References Dashboards.id)
    dashboard_id        TEXT NOT NULL,

    -- [supplier_id] معرف المورد التابع له الحساب (مفتاح أجنبي يربط بجدول suppliers)
    supplier_id         TEXT NOT NULL,

    -- [type] نوع الحركة المالية:
    -- 'supply_bill' (فاتورة توريد بضاعة جديدة تزيد الدين علينا)
    -- 'payment' (سداد دفعة نقدية أو بنكية للمورد تنقص الدين)
    -- 'return' (مرتجع بضاعة معيبة أو تالفة يخفض الدين علينا)
    -- 'adjustment' (تسوية رصيد حساب بالزيادة أو النقصان)
    type                TEXT CHECK(type IN ('supply_bill', 'payment', 'return', 'adjustment')) NOT NULL,

    -- [amount] قيمة الفاتورة أو الدفعة أو التسوية بالجنيه (موجب دائماً ويحدد الاتجاه نوع الحركة)
    amount              REAL NOT NULL DEFAULT 0.0,

    -- [payment_source] مصدر السداد عند الدفع:
    -- 'cash_drawer' (خصم نقدي مباشر من درج الكاشير)
    -- 'bank' (تحويل بنكي / إنستاباي / بطاقة بنكية)
    -- 'other' (وسيلة دفع أخرى أو تسوية خارجية)
    payment_source      TEXT CHECK(payment_source IS NULL OR payment_source IN ('cash_drawer', 'bank', 'other')),

    -- [receipt_number] رقم إيصال الاستلام، الشيك، أو رقم الحوالة المسلمة للمندوب
    receipt_number      TEXT,

    -- [notes] شرح وتفاصيل البضاعة المستلمة أو بيان التحويل
    notes               TEXT,

    -- --------------------------------------------------------------------------
    -- بيانات التكامل المالي والوردية والتدقيق (Shift Context & Financial Audit)
    -- --------------------------------------------------------------------------
    -- [shift_id] معرف الوردية المرتبطة بالحركة إذا تمت أثناء وردية مفتوحة (References shifts.id)
    shift_id            TEXT,

    -- [cashier_profile_id] معرف ملف المستخدم/الكاشير الذي أجرى الحركة (References Users.id)
    cashier_profile_id  TEXT,

    -- [cashier_name] اسم الموظف أو الكاشير المسؤول (Snapshot في وقت الحركة)
    cashier_name        TEXT,

    -- [cash_movement_id] معرّف حركة الخزنة المقابلة بالدرج إن كانت نقدية (References cash_movements.id)
    cash_movement_id    TEXT,

    -- [created_at] التاريخ والوقت الدقيق لتسجيل الحركة
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,

    -- القيود والمفاتيح الأجنبية مع سياسات الحذف
    FOREIGN KEY (dashboard_id) REFERENCES Dashboards (id) ON DELETE CASCADE,
    FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE CASCADE,
    FOREIGN KEY (shift_id) REFERENCES shifts (id) ON DELETE SET NULL,
    FOREIGN KEY (cashier_profile_id) REFERENCES Users (id) ON DELETE SET NULL,
    FOREIGN KEY (cash_movement_id) REFERENCES cash_movements (id) ON DELETE SET NULL
);

-- ------------------------------------------------------------------------------
-- فهارس حركات كشف حساب المورد (Transactions Indexes)
-- ------------------------------------------------------------------------------

-- فهرس مركب رئيسي لجلب كشف حساب مورد محدد مرتباً زمنياً (Supplier Ledger View)
CREATE INDEX IF NOT EXISTS idx_supplier_tx_supplier 
    ON supplier_transactions (dashboard_id, supplier_id, created_at DESC);

-- فهرس مركب لعرض أحدث المعاملات لجميع الموردين على مستوى المتجر
CREATE INDEX IF NOT EXISTS idx_supplier_tx_dashboard_created 
    ON supplier_transactions (dashboard_id, created_at DESC);

-- فهرس مركب لتصفية المعاملات حسب النوع (فواتير توريد vs سدادات)
CREATE INDEX IF NOT EXISTS idx_supplier_tx_type 
    ON supplier_transactions (dashboard_id, type);

-- فهرس جزئي للبحث برقم الإيصال أو مرجع السداد
CREATE INDEX IF NOT EXISTS idx_supplier_tx_receipt 
    ON supplier_transactions (dashboard_id, receipt_number) 
    WHERE receipt_number IS NOT NULL;

-- فهارس المفاتيح الأجنبية لمنع فحص كامل الجدول في SQLite عند حذف أو تعديل الورديات أو الكاشيرات
CREATE INDEX IF NOT EXISTS idx_supplier_tx_shift 
    ON supplier_transactions (dashboard_id, shift_id) 
    WHERE shift_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_tx_cashier 
    ON supplier_transactions (cashier_profile_id) 
    WHERE cashier_profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_tx_cash_movement 
    ON supplier_transactions (cash_movement_id) 
    WHERE cash_movement_id IS NOT NULL;
