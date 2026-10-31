-- ==============================================================================
-- MobiDash Platform - Database Migration: phones.sql
-- Architecture: Mobile Shop Inventory & IMEI Tracking (Cloudflare D1 / SQLite)
-- Purpose: إدارة وحصر مخزن الهواتف الذكية وسيريالات الـ IMEI وعقود التنازل القانونية
--          مع التتبع والتدقيق الكامل لعمليات الشراء والبيع والإنشاء والتعديل (Audit Trail)
-- متوافق تماماً مع:
--   - backend/docs/DATABASE_QUERIES_AND_INDEXING.md
--   - frontend/src/lib/types.ts (PhoneProduct)
--   - frontend/src/database/phones.ts
-- ==============================================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------------------------
-- 1. جدول الهواتف والمخزن الذكي (Phones Inventory & Serial Tracking Table)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS phones (
    -- [id] المعرف الفريد للجهاز في قاعدة البيانات (UUIDv4 أو معرف تسلسلي مثل ph-101)
    id                      TEXT PRIMARY KEY NOT NULL,

    -- [dashboard_id] معرف المتجر أو الفرع لعزل المستأجر الصارم (References Dashboards.id)
    dashboard_id            TEXT NOT NULL,

    -- --------------------------------------------------------------------------
    -- المواصفات الفنية والعتاد الأساسي للجهاز (Hardware & Specifications)
    -- استخدام COLLATE NOCASE لدعم مطابقة واستعلامات البحث بدون دوال (Sargable Queries)
    -- --------------------------------------------------------------------------
    -- [brand] اسم الشركة المصنعة للهاتف (Apple, Samsung, Xiaomi, Realme, Oppo...)
    brand                   TEXT COLLATE NOCASE NOT NULL,

    -- [model] اسم وموديل الجهاز بالكامل (iPhone 15 Pro Max, Galaxy S24 Ultra...)
    model                   TEXT COLLATE NOCASE NOT NULL,

    -- [color] اللون التجاري الرسمي للجهاز (تيتانيوم طبيعي، أسود فلكي، كحلي...)
    color                   TEXT COLLATE NOCASE NOT NULL,

    -- [storage] سعة الذاكرة التخزينية الداخلية (128GB, 256GB, 512GB, 1TB)
    storage                 TEXT COLLATE NOCASE NOT NULL,

    -- [ram] حجم الذاكرة العشوائية RAM (4GB, 8GB, 12GB, 16GB)
    ram                     TEXT,

    -- [battery_capacity] سعة البطارية بالميللي أمبير mAh (مثال: 5000 mAh)
    battery_capacity        INTEGER CHECK(battery_capacity IS NULL OR battery_capacity > 0),

    -- [screen_size] مقاس الشاشة بالبوصة (مثال: 6.7")
    screen_size             TEXT,

    -- [network] أجيال الشبكات المدعومة بالجهاز ('3G', '4G', '5G')
    network                 TEXT DEFAULT '4G' CHECK(network IN ('3G', '4G', '5G')),

    -- [processor] نوع واسم المعالج (مثال: A17 Pro, Snapdragon 8 Gen 3)
    processor               TEXT,

    -- [condition] الحالة المادية للجهاز: 'new' (متبرشم)، 'used_like_new' (كسر زيرو)، 'used' (مستعمل)
    condition               TEXT CHECK(condition IN ('new', 'used_like_new', 'used')) NOT NULL DEFAULT 'new',

    -- [battery_health] نسبة كفاءة وصحة البطارية للأجهزة المستعملة (0 - 100%)
    battery_health          INTEGER CHECK(battery_health IS NULL OR (battery_health >= 0 AND battery_health <= 100)),

    -- --------------------------------------------------------------------------
    -- هوية الجهاز وسيريالات الـ IMEI لمنع السرقات ومطابقة الهوية القانونية
    -- --------------------------------------------------------------------------
    -- [imei] رقم السيريال الدولي للشريحة الأولى (15 رقم فريد - يمنع تكراره إطلاقاً بالنظام)
    -- ملاحظة: محرك SQLite ينشئ فهرس B-Tree فريد تلقائياً لهذا العمود (sqlite_autoindex_phones_1)
    imei                    TEXT UNIQUE NOT NULL,

    -- [imei2] رقم السيريال الدولي للشريحة الثانية للأجهزة ثنائية الشريحة (Dual-SIM)
    imei2                   TEXT,

    -- --------------------------------------------------------------------------
    -- التسعير والضمان والمورد وعمليات الشراء (Pricing, Warranty, Supplier & Purchase)
    -- --------------------------------------------------------------------------
    -- [purchase_price] سعر شراء الجهاز أو التكلفة التي دفعها المحل (لحساب صافي الربح الدقيق)
    purchase_price          REAL NOT NULL DEFAULT 0.0 CHECK(purchase_price >= 0),

    -- [selling_price] سعر البيع المطلوب للجمهور المعروض على الرف أو الفاتورة
    selling_price           REAL NOT NULL DEFAULT 0.0 CHECK(selling_price >= 0),

    -- [min_price] الحد الأدنى لسعر البيع المسموح للكاشير النزول إليه عند الفصال مع العميل
    min_price               REAL NOT NULL DEFAULT 0.0 CHECK(min_price >= 0),

    -- [warranty_period] مدة ونوع الضمان (سنة ضمان محلي، شهر تجربة وضمان للمستعمل...)
    warranty_period         TEXT,

    -- [status] حالة الجهاز بالمخزن: 'in_stock' (متوفر بالدرج)، 'sold' (تم بيعه)، 'reserved' (محجوز بعربون)
    status                  TEXT CHECK(status IN ('in_stock', 'sold', 'reserved')) NOT NULL DEFAULT 'in_stock',

    -- [supplier_id] معرف المورد الذي تم شراء الجهاز منه لمتابعة كشف الحساب (References suppliers.id)
    supplier_id             TEXT,

    -- [purchased_by] معرف الموظف أو الكاشير الذي قام بشراء أو استلام الجهاز (References Users.id)
    purchased_by            TEXT,

    -- [purchased_at] تاريخ ووقت شراء أو استلام الجهاز في المحل بدقة
    purchased_at            DATETIME,

    -- --------------------------------------------------------------------------
    -- بيانات عقد التنازل وشراء المستعمل لحماية المتجر من المسروقات والمباحث
    -- --------------------------------------------------------------------------
    -- [seller_name] اسم العميل البائع بالكامل من واقع بطاقة الرقم القومي
    seller_name             TEXT,

    -- [seller_national_id] الرقم القومي للبائع المكون من 14 رقماً للتحقق الأمني
    seller_national_id      TEXT,

    -- [seller_phone] رقم هاتف العميل البائع للرجوع إليه عند أي فحص أمني
    seller_phone            TEXT,

    -- [seller_id_front_url] رابط صورة وجه بطاقة الرقم القومي للبائع على التخزين السحابي
    seller_id_front_url     TEXT,

    -- [seller_id_back_url] رابط صورة ظهر بطاقة الرقم القومي للبائع
    seller_id_back_url      TEXT,

    -- [contract_image_url] رابط صورة عقد المبايعة والتنازل الورقي الموقع والمبصوم
    contract_image_url      TEXT,

    -- [has_box] هل العلبة والكرتونة الأصلية متوفرة مع الجهاز (1 = نعم، 0 = لا)
    has_box                 INTEGER NOT NULL DEFAULT 0 CHECK(has_box IN (0, 1)),

    -- [has_charger] هل الشاحن والوصلة الأصلية متوفرة مع الجهاز (1 = نعم، 0 = لا)
    has_charger             INTEGER NOT NULL DEFAULT 0 CHECK(has_charger IN (0, 1)),

    -- --------------------------------------------------------------------------
    -- بيانات الحجز بعربون (Reservation Details)
    -- --------------------------------------------------------------------------
    -- [reserved_at] تاريخ ووقت حجز الهاتف بعربون
    reserved_at             DATETIME,

    -- [reserved_by] معرف الموظف الذي قام بحجز الجهاز للعميل (References Users.id)
    reserved_by             TEXT,

    -- --------------------------------------------------------------------------
    -- بيانات الفاتورة والمشتري وتوثيق البيع (Sales Invoice, Buyer & Sold Details)
    -- --------------------------------------------------------------------------
    -- [invoice_id] رقم ومعرف فاتورة المبيعات الصادرة عند بيع الجهاز
    invoice_id              TEXT,

    -- [sold_price] السعر الفعلي الذي تم بيع الجهاز به بعد الخصم
    sold_price              REAL CHECK(sold_price IS NULL OR sold_price >= 0),

    -- [sold_by] معرف الموظف أو الكاشير الذي قام ببيع الجهاز وإصدار الفاتورة (References Users.id)
    sold_by                 TEXT,

    -- [sold_at] توقيت وتاريخ بيع الجهاز الفعلي
    sold_at                 DATETIME,

    -- [buyer_name] اسم المشتري المسجل في فاتورة البيع
    buyer_name              TEXT,

    -- [buyer_phone] رقم هاتف المشتري لتقديم خدمات الضمان والمتابعة وخدمة العملاء
    buyer_phone             TEXT,

    -- --------------------------------------------------------------------------
    -- سجلات النظام والتدقيق والـ Log (Audit Trail, Creation & Modification Logs)
    -- --------------------------------------------------------------------------
    -- [notes] أي ملاحظات فنية، خدوش فحص البودي، أو ملحقات خاصة بالجهاز
    notes                   TEXT,

    -- [date_added] تاريخ استلام الجهاز وإدخاله لمخزن المحل (YYYY-MM-DD)
    date_added              TEXT NOT NULL,

    -- [created_by] معرف الموظف الذي أنشأ سجل الجهاز في النظام لأول مرة (References Users.id)
    created_by              TEXT,

    -- [created_at] توقيت إنشاء السجل في النظام
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,

    -- [updated_by] معرف آخر موظف قام بتعديل بيانات الجهاز (References Users.id)
    updated_by              TEXT,

    -- [updated_at] توقيت آخر تعديل حدث على بيانات الجهاز
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP,

    -- ربط المفاتيح الأجنبية مع جدول المتاجر والمستخدمين والموردين
    FOREIGN KEY (dashboard_id) REFERENCES Dashboards (id) ON DELETE CASCADE,
    FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES Users (id) ON DELETE SET NULL,
    FOREIGN KEY (updated_by) REFERENCES Users (id) ON DELETE SET NULL,
    FOREIGN KEY (purchased_by) REFERENCES Users (id) ON DELETE SET NULL,
    FOREIGN KEY (sold_by) REFERENCES Users (id) ON DELETE SET NULL,
    FOREIGN KEY (reserved_by) REFERENCES Users (id) ON DELETE SET NULL
);

-- ------------------------------------------------------------------------------
-- 2. فهارس الاستعلام والبحث والتدقيق (High-Performance & Audit Indexes)
-- متوافقة مع قاعدة اليسار إلى اليمين (المساواة أولاً ثم الترتيب) وحظر تضخيم الكتابة
-- ------------------------------------------------------------------------------

-- 1. فهرس ترتيب السجلات زمنياً لعزل المستأجر (قاعدة اليسار لليمين: المساواة ثم الترتيب)
CREATE INDEX IF NOT EXISTS idx_phones_dashboard_created 
    ON phones(dashboard_id, created_at DESC);

-- 2. الفهرس الجزئي الذكي لجلب الأجهزة المتاحة حالياً بالمخزن فقط (In-Stock Catalog)
-- يوفر مساحة الذاكرة ويجعل استعلامات شاشات البيع والـ POS فائقة السرعة
CREATE INDEX IF NOT EXISTS idx_phones_available 
    ON phones(dashboard_id, date_added DESC) 
    WHERE status = 'in_stock';

-- 3. فهرس مركب للبحث والفلترة الفورية حسب الماركة والموديل والحالة
CREATE INDEX IF NOT EXISTS idx_phones_brand_model 
    ON phones(dashboard_id, status, brand, model);

-- 4. فهرس جزئي لسيريال الشريحة الثانية (IMEI 2) للأجهزة ثنائية الشريحة فقط
CREATE INDEX IF NOT EXISTS idx_phones_imei2 
    ON phones(imei2) 
    WHERE imei2 IS NOT NULL;

-- 5. فهارس التحقق الأمني والفحص الجنائي (عقود التنازل والتحقق من سوابق البيع والمباحث)
CREATE INDEX IF NOT EXISTS idx_phones_seller_nid 
    ON phones(seller_national_id) 
    WHERE seller_national_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_phones_seller_phone 
    ON phones(seller_phone) 
    WHERE seller_phone IS NOT NULL;

-- 6. فهرس جزئي لربط الأجهزة المباعة بفواتيرها المحاسبية
CREATE INDEX IF NOT EXISTS idx_phones_invoice_id 
    ON phones(invoice_id) 
    WHERE invoice_id IS NOT NULL;

-- 7. فهرس تقارير المبيعات والأرباح للأجهزة المباعة (Partial Index)
CREATE INDEX IF NOT EXISTS idx_phones_sold_at 
    ON phones(dashboard_id, sold_at DESC) 
    WHERE status = 'sold';

-- ------------------------------------------------------------------------------
-- 8. فهارس المفاتيح الأجنبية (Foreign Key Indexing)
-- تضع عمود المفتاح الأجنبي أولاً لحماية محرك SQLite من الـ Full Table Scan عند حذف/تعديل السجلات الأب
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_phones_fk_supplier 
    ON phones(supplier_id) 
    WHERE supplier_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_phones_fk_purchased_by 
    ON phones(purchased_by) 
    WHERE purchased_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_phones_fk_sold_by 
    ON phones(sold_by) 
    WHERE sold_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_phones_fk_reserved_by 
    ON phones(reserved_by) 
    WHERE reserved_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_phones_fk_created_by 
    ON phones(created_by) 
    WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_phones_fk_updated_by 
    ON phones(updated_by) 
    WHERE updated_by IS NOT NULL;
