-- ==============================================================================
-- MobiDash Platform - Database Migration: accessories.sql
-- Architecture: Mobile Shop Accessories, Chargers & Store Essentials (Cloudflare D1 / SQLite)
-- Purpose: إدارة وتتبع أصناف الإكسسوار (جرابات، شواحن، كابلات، سماعات، إسكرينات حماية، باور بانك)
--          مع دعم الباركود السريع لنقاط البيع (POS)، وتحديد أسعار التكلفة والقطاعي والجملة،
--          وتنبيهات النواقص التلقائية، وسجل حركات وتدقيق المخزون (Stock Movements).
-- متوافق تماماً مع:
--   - backend/docs/DATABASE_QUERIES_AND_INDEXING.md
--   - frontend/src/lib/types.ts (AccessoryProduct)
--   - frontend/src/database/accessories.ts
-- ==============================================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------------------------
-- 1. جدول الإكسسوارات ومستلزمات الهواتف (Accessories Inventory Table)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accessories (
    -- [id] المعرف الفريد للصنف في قاعدة البيانات (UUIDv4 أو معرف تسلسلي مثل acc-101)
    id                  TEXT PRIMARY KEY NOT NULL,

    -- [dashboard_id] معرف المتجر أو الفرع لعزل المستأجر الصارم (References Dashboards.id)
    dashboard_id        TEXT NOT NULL,

    -- [name] الاسم التجاري والوصفي للصنف (شاحن أنكر أنكورتيك 20W سريع أصلي)
    -- استخدام COLLATE NOCASE لدعم البحث السريع ومطابقة الأسماء (Sargable Queries)
    name                TEXT COLLATE NOCASE NOT NULL,

    -- [category] القسم الرئيسي للإكسسوار لتنظيم العرض والفرز في شاشات الكاشير والمخزن
    category            TEXT COLLATE NOCASE NOT NULL CHECK(category IN (
                            'شواحن وكيابل', 'جرابات وكفرات', 'حمايات شاشة', 'سماعات وصوتيات',
                            'باور بانك', 'إكسسوارات سيارة', 'عام',
                            'chargers_cables', 'cases_covers', 'screen_protectors',
                            'audio_headphones', 'power_banks', 'car_accessories', 'other'
                        )),

    -- [brand] الماركة التجارية المصنعة (Anker, Joyroom, Baseus, Apple, Samsung, Oraimo, Remax, LDNIO...)
    brand               TEXT COLLATE NOCASE NOT NULL DEFAULT 'عام',

    -- [barcode] رقم الباركود الدولي أو الملصق الداخلي للمحل لقراءة الصنف بلمسة واحدة بقارئ الباركود
    -- ملاحظة: الفهرس الفريد uq_accessories_dashboard_barcode يحمي الفرادة لكل متجر dashboard_id
    barcode             TEXT,

    -- [cost_price] سعر تكلفة شراء القطعة الواحدة بالجملة من التاجر (لحساب صافي الأرباح بدقة)
    cost_price          REAL NOT NULL DEFAULT 0.0 CHECK(cost_price >= 0),

    -- [retail_price] سعر بيع القطعة للزبون العادي (سعر البيع قطاعي)
    retail_price        REAL NOT NULL DEFAULT 0.0 CHECK(retail_price >= 0),

    -- [wholesale_price] سعر البيع المخفض للورش والمحلات الزميلة أو الزبون الذي يشتري كميات
    wholesale_price     REAL CHECK(wholesale_price IS NULL OR wholesale_price >= 0),

    -- [stock] عدد القطع الفعلي المتواجد حالياً على الرف أو بالمخزن، وينقص تلقائياً مع فواتير البيع
    stock               INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),

    -- [min_stock_alert] حد الأمان والنواقص؛ عند وصول المخزون لهذا الرقم يظهر تنبيه بشراء كميات جديدة
    min_stock_alert     INTEGER NOT NULL DEFAULT 3 CHECK(min_stock_alert >= 0),

    -- [compatibility] الهواتف أو المنافذ المتوافقة مع الإكسسوار (مثال: Type-C لجميع هواتف سامسونج وشاومي)
    compatibility       TEXT,

    -- [location] مكان تخزين الصنف بالمتجر (مثال: الرف العلوي 2، فاترينة العرض الرئيسية) لسرعة وصول الكاشير
    location            TEXT,

    -- [date_added] تاريخ تسجيل الصنف لأول مرة بالمحل (YYYY-MM-DD)
    date_added          TEXT NOT NULL,

    -- [status] الحالة التشغيلية للصنف: 'active' (نشط ومتاح للبيع)، 'inactive' (معلق مؤقتاً)، 'archived' (مؤرشف)
    status              TEXT CHECK(status IN ('active', 'inactive', 'archived')) NOT NULL DEFAULT 'active',

    -- [supplier_id] معرف المورد أو تاجر الجملة الذي تم شراء الإكسسوار منه (References suppliers.id)
    supplier_id         TEXT,

    -- [notes] ملاحظات إضافية، شروط استبدال الصنف، أو مواصفات فنية إضافية
    notes               TEXT,

    -- [created_by] معرف المستخدم الذي أنشأ سجل الصنف لأول مرة (References Users.id)
    created_by          TEXT,

    -- [updated_by] معرف آخر مستخدم قام بتعديل سعر أو بيانات الصنف (References Users.id)
    updated_by          TEXT,

    -- [created_at] تاريخ ووقت إنشاء السجل في النظام
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,

    -- [updated_at] تاريخ ووقت آخر تعديل على السعر أو الكمية
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,

    -- قيود المفاتيح الأجنبية لحفظ التكامل المرجعي التام
    FOREIGN KEY (dashboard_id) REFERENCES Dashboards (id) ON DELETE CASCADE,
    FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES Users (id) ON DELETE SET NULL,
    FOREIGN KEY (updated_by) REFERENCES Users (id) ON DELETE SET NULL
);

-- ------------------------------------------------------------------------------
-- 2. جدول سجل حركات وتدقيق مخزون الإكسسوارات (Accessory Stock Movements Ledger)
-- يضمن تتبع كل قطعة تدخل أو تخرج من المحل ومنع العجز المخزني وسرقة البضاعة
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accessory_stock_movements (
    -- [id] المعرف الفريد لحركة المخزون (UUIDv4 أو معرف تسلسلي مثل asm-101)
    id                  TEXT PRIMARY KEY NOT NULL,

    -- [dashboard_id] معرف المتجر أو الفرع (References Dashboards.id)
    dashboard_id        TEXT NOT NULL,

    -- [accessory_id] معرف الإكسسوار المرتبط بهذه الحركة (References accessories.id)
    accessory_id        TEXT NOT NULL,

    -- [type] نوع الحركة المخزنية:
    -- 'initial' (رصيد افتتاحي عند إدخال الصنف أول مرة)
    -- 'purchase' (فاتورة شراء وتوريد كميات جديدة من مورد)
    -- 'pos_sale' (خصم كمية مباعة عبر فاتورة الكاشير)
    -- 'return' (مرتجع مبيعات مستلم من عميل)
    -- 'adjustment' (تسوية يدوية بعد جرد فعلي للمحل)
    -- 'damage' (تالف / كسر / غير صالح للاستخدام)
    -- 'transfer' (تحويل بين الفروع)
    type                TEXT CHECK(type IN (
                            'initial', 'purchase', 'pos_sale', 
                            'return', 'adjustment', 'damage', 'transfer'
                        )) NOT NULL,

    -- [quantity_change] مقدار التغير في الكمية (+10 عند الشراء، -1 عند البيع بالكاشير، -2 عند التالف)
    quantity_change     INTEGER NOT NULL,

    -- [previous_stock] رصيد الصنف بالمخزن قبل تنفيذ هذه الحركة
    previous_stock      INTEGER NOT NULL,

    -- [new_stock] رصيد الصنف الجديد بالمخزن بعد تطبيق هذه الحركة
    new_stock           INTEGER NOT NULL,

    -- [cost_price] سعر تكلفة القطعة الواحدة وقت حدوث الحركة
    cost_price          REAL CHECK(cost_price IS NULL OR cost_price >= 0),

    -- [unit_price] سعر البيع للقطعة الواحدة (إذا كانت الحركة مبيعات POS)
    unit_price          REAL CHECK(unit_price IS NULL OR unit_price >= 0),

    -- [invoice_id] رقم أو معرف فاتورة المبيعات الصادرة عند بيع الصنف (اختياري)
    invoice_id          TEXT,

    -- [supplier_id] معرف تاجر الجملة أو المورد (في حالة حركات الشراء والتوريد)
    supplier_id         TEXT,

    -- [shift_id] معرف وردية الكاشير النشطة وقت تسجيل الحركة
    shift_id            TEXT,

    -- [created_by] معرف الموظف أو الكاشير المسؤول عن تسجيل الحركة (References Users.id)
    created_by          TEXT,

    -- [notes] سبب الحركة أو ملاحظات الجرد (مثال: عجز جرد شهري، شاحن محروق تم إتلافه)
    notes               TEXT,

    -- [created_at] توقيت تسجيل الحركة بدقة
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,

    -- قيود المفاتيح الأجنبية
    FOREIGN KEY (dashboard_id) REFERENCES Dashboards (id) ON DELETE CASCADE,
    FOREIGN KEY (accessory_id) REFERENCES accessories (id) ON DELETE CASCADE,
    FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES Users (id) ON DELETE SET NULL
);

-- ------------------------------------------------------------------------------
-- 3. فهارس جدول الإكسسوارات (High-Performance B-Tree & Partial Indexes)
-- متوافقة مع قاعدة اليسار إلى اليمين (المساواة أولاً ثم الترتيب) والمعايير الهندسية الصارمة
-- ------------------------------------------------------------------------------

-- 1. فهرس معرّف المتجر الأساسي لعزل المستأجر الصارم
CREATE INDEX IF NOT EXISTS idx_accessories_dashboard 
    ON accessories (dashboard_id);

-- 2. فهرس مركب لجلب أحدث الإكسسوارات مرتبة زمنياً تنازلياً (Left-to-Right: dashboard_id = ? ORDER BY created_at DESC)
CREATE INDEX IF NOT EXISTS idx_accessories_dashboard_created 
    ON accessories (dashboard_id, created_at DESC);

-- 3. فهرس فريد جزئي للباركود لكل متجر (Multi-Tenant Unique Barcode)
-- يمنع تكرار نفس الباركود داخل المحل الواحد ويسمح بتكرار نفس الباركود بين المتاجر المختلفة أو تركه فارغاً
CREATE UNIQUE INDEX IF NOT EXISTS uq_accessories_dashboard_barcode 
    ON accessories (dashboard_id, barcode) 
    WHERE barcode IS NOT NULL AND barcode != '';

-- 4. فهرس مركب للفلترة الفورية حسب قسم وتصنيف الإكسسوار
CREATE INDEX IF NOT EXISTS idx_accessories_dashboard_category 
    ON accessories (dashboard_id, category);

-- 5. فهرس مركب للفلترة حسب الماركة التجارية المصنعة
CREATE INDEX IF NOT EXISTS idx_accessories_dashboard_brand 
    ON accessories (dashboard_id, brand);

-- 6. فهرس مركب للحالة التشغيلية مع معرّف المتجر
CREATE INDEX IF NOT EXISTS idx_accessories_dashboard_status 
    ON accessories (dashboard_id, status);

-- 7. فهرس جزئي ذكي للأصناف المتاحة والنشطة بالمخزن (In-Stock POS Catalog)
-- فائق السرعة لشاشات نقطة البيع (POS) وقارئات الباركود؛ لا يفهرس الأصناف النافذة أو المؤرشفة
CREATE INDEX IF NOT EXISTS idx_accessories_available 
    ON accessories (dashboard_id, category, brand) 
    WHERE status = 'active' AND stock > 0;

-- 8. فهرس جزئي ذكي لتنبيهات النواقص الحرجة (Partial Low-Stock Index)
-- يسرع استعلام جلب النواقص دون مسح كامل الجدول (Full Table Scan)
CREATE INDEX IF NOT EXISTS idx_accessories_low_stock 
    ON accessories (dashboard_id, stock) 
    WHERE status = 'active' AND stock <= min_stock_alert;

-- ------------------------------------------------------------------------------
-- 4. فهارس المفاتيح الأجنبية لجدول الإكسسوارات (Foreign Key Performance Indexes)
-- تحمي محرك SQLite من الـ Full Table Scan عند حذف أو تعديل سجلات الجداول الأب
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_accessories_fk_supplier 
    ON accessories (supplier_id) 
    WHERE supplier_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_accessories_fk_created_by 
    ON accessories (created_by) 
    WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_accessories_fk_updated_by 
    ON accessories (updated_by) 
    WHERE updated_by IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 5. فهارس جدول حركات المخزون (Stock Movements Indexes)
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_acc_movements_dashboard 
    ON accessory_stock_movements (dashboard_id);

CREATE INDEX IF NOT EXISTS idx_acc_movements_accessory 
    ON accessory_stock_movements (accessory_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_acc_movements_created 
    ON accessory_stock_movements (dashboard_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_acc_movements_dashboard_type 
    ON accessory_stock_movements (dashboard_id, type);

CREATE INDEX IF NOT EXISTS idx_acc_movements_fk_supplier 
    ON accessory_stock_movements (supplier_id) 
    WHERE supplier_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_acc_movements_fk_created_by 
    ON accessory_stock_movements (created_by) 
    WHERE created_by IS NOT NULL;
