-- ==============================================================================
-- MobiDash Platform - Database Migration: spare_parts.sql
-- Architecture: Mobile Shop Maintenance Workshop & Spare Parts Inventory (Cloudflare D1 / SQLite)
-- Purpose: إدارة وجرد قطع الغيار المادية المخزنة بدرج ورشة الصيانة
--          (شاشات، بطاريات، فلاتات شحن، باغات، كاميرات، آيسيهات)،
--          مع تحديد درجة الجودة، وأيام الضمان، وموقع الرف في الورشة،
--          وتنبيهات النواقص التلقائية، وربطها بالموردين وفنيي الصيانة.
-- متوافق تماماً مع:
--   - backend/docs/DATABASE_QUERIES_AND_INDEXING.md
--   - frontend/src/lib/types.ts (SparePart)
--   - frontend/src/database/spareParts.ts
-- ==============================================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------------------------
-- 1. جدول قطع غيار ورشة الصيانة (Maintenance Workshop Spare Parts Table)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spare_parts (
    -- [id] المعرف الفريد لقطعة الغيار (UUIDv4 أو معرف تسلسلي مثل sp-301)
    id                  TEXT PRIMARY KEY NOT NULL,

    -- [dashboard_id] معرف المتجر أو الفرع لعزل المستأجر الصارم (References Dashboards.id)
    dashboard_id        TEXT NOT NULL,

    -- [part_code] كود القطعة السريع أو الباركود الداخلي للورشة (مثال: PRT-SCR-IP13PM)
    part_code           TEXT COLLATE NOCASE,

    -- [name] اسم القطعة بالتفصيل الفني (مثال: شاشة كاملة بالبصمة خلع توكيل، بطارية أصلية 5000mAh)
    name                TEXT COLLATE NOCASE NOT NULL,

    -- [category] تصنيف نوع قطعة الغيار الشامل لكافة مكونات صيانة وهاردوير الهواتف:
    -- 'screens' / 'شاشات': شاشات عرض ولمس كاملة (LCD, OLED, AMOLED, Incell, Soft/Hard OLED)
    -- 'batteries' / 'بطاريات': بطاريات داخلية، خلايا بطارية، وبطاريات معتمدة بسعة مضاعفة
    -- 'glass' / 'باغات وزجاج': باغات زجاجية أمامية لكبس الشاشات بتقنية OCA وتاتشات منفصلة
    -- 'charging_ports' / 'فلاتات وبوردات شحن': بوردات شحن سفلية (Sub-boards)، فلاتات شحن، وسوكتات Type-C/Lightning
    -- 'cameras' / 'كاميرات وعدسات': كاميرات خلفية أساسية، كاميرات سيلفي أمامية، وزجاج عدسات الكاميرا الخارجي
    -- 'housing_frame' / 'هاوسينج وشاصيه وظهر': ظهور زجاجية وبلاستيكية، شاصيه وإطارات معدنية وسطى، فريمات كاملة
    -- 'ics' / 'آيسيهات وبوردة': دوائر متكاملة (آيسي باور PMIC، آيسي شحن U2/Hydra، آيسي صوت، آيسي شبكة وبيسباند، بوردات)
    -- 'speakers' / 'سماعات وأجراس': سماعات أذن للمكالمات (Earpieces)، سماعات الأجراس ومكبرات الصوت (Buzzers / Loudspeakers)
    -- 'microphones' / 'مايكات': مايكات المكالمات والتسجيل الديجيتال والعادية
    -- 'flex_cables' / 'فلاتات وأزرار': فلاتات الربط الرئيسية (Main Flex)، فلاتات أزرار الباور والصوت، فلاتات البصمة
    -- 'sensors' / 'حساسات وفيس آي دي': حساسات التقارب والإضاءة (Proximity/Light)، فلاتات الفيس آي دي والـ Flood Illuminator
    -- 'wireless_charging' / 'شحن لاسلكي وNFC': ملفات الشحن اللاسلكي والماج سيف وNFC
    -- 'antennas' / 'هوائيات وشبكات': كابلات وهوائيات إشارة الشبكة المحورية، هوائيات Wi-Fi / Bluetooth / 5G
    -- 'sim_trays' / 'أدراج وقارئات الشرائح': أدراج شرائح الاتصال الخارجية (SIM Tray) وقارئات الشرائح الداخلية المدمجة
    -- 'vibrators' / 'هزازات ومحركات لمس': محركات الاهتزاز والمحركات اللمسية (Vibration Motors / Taptic Engines)
    -- 'small_parts' / 'أجزاء صغيرة ولواصق': أطقم مسامير، شيلدات وصاجات حماية داخلية، شبك حماية السماعات، ولواصق وتربروف ضد الماء
    -- 'other' / 'أخرى': أي قطع غيار صيانة أو مكونات داخلية أخرى
    category            TEXT CHECK(category IN (
                            'screens', 'batteries', 'glass', 'charging_ports', 'cameras',
                            'housing_frame', 'ics', 'speakers', 'microphones', 'flex_cables',
                            'sensors', 'wireless_charging', 'antennas', 'sim_trays', 'vibrators',
                            'small_parts', 'other',
                            'شاشات', 'بطاريات', 'باغات وزجاج', 'فلاتات وبوردات شحن', 'كاميرات وعدسات',
                            'هاوسينج وشاصيه وظهر', 'آيسيهات وبوردة', 'سماعات وأجراس', 'مايكات', 'فلاتات وأزرار',
                            'حساسات وفيس آي دي', 'شحن لاسلكي وNFC', 'هوائيات وشبكات', 'أدراج وقارئات الشرائح',
                            'هزازات ومحركات لمس', 'أجزاء صغيرة ولواصق', 'أخرى'
                        )) NOT NULL,

    -- [device_model] موديل الموبايل الأساسي المتوافقة معه القطعة (مثال: iPhone 13 Pro Max, Galaxy S23)
    device_model        TEXT COLLATE NOCASE NOT NULL,

    -- [compatible_models] مصفوفة JSON للموديلات الإضافية المتوافقة مع نفس القطعة
    compatible_models   JSON DEFAULT '[]',

    -- [quality] درجة ونوع جودة القطعة المتداولة بسوق الصيانة والتوزيع:
    -- 'original_pull' / 'خلع أصلي': خلع أصلي 100% من أجهزة تفكيك أصلية (Original Disassembly / Used OEM Pull)
    -- 'original_new' / 'أصلي وكالة جديد': قطع أصلية جديدة صادرة من الوكيل أو المصنع المعتمد (Service Pack / Genuine OEM)
    -- 'oem' / 'فرز أول مصنع': تصنيع وكالة فرز أول بمواصفات وخامات المصنع الأصلي (OEM Grade A)
    -- 'refurbished' / 'مجدد باغة': شاشات أو قطع أصلية تم تجديد باغة الزجاج الخارجية لها بتقنية OCA
    -- 'soft_oled' / 'سوفت أوليد': شاشات أوليد مرنة ممتازة مطابقة للأصلية
    -- 'hard_oled' / 'هارد أوليد': شاشات أوليد صلبة بجودة ممتازة
    
    -- 'incell' / 'إن سيل': شاشات LCD تجارية مدمجة التاتش عالية الجودة
    -- 'high_copy' / 'هاي كوبي': قطع تجارية درجة أولى ممتازة
    -- 'copy' / 'تجاري اقتصادي': قطع تجارية اقتصادية
    quality             TEXT CHECK(quality IN (
                            'original_pull', 'original_new', 'oem', 'refurbished',
                            'soft_oled', 'hard_oled', 'incell', 'high_copy', 'copy',
                            'خلع أصلي', 'أصلي وكالة جديد', 'فرز أول مصنع', 'مجدد باغة',
                            'سوفت أوليد', 'هارد أوليد', 'إن سيل', 'هاي كوبي', 'تجاري اقتصادي'
                        )) NOT NULL DEFAULT 'oem',

    -- [cost_price] سعر شراء وتكلفة القطعة من تاجر الجملة أو المستورد
    cost_price          REAL NOT NULL DEFAULT 0.0 CHECK(cost_price >= 0),

    -- [selling_price] سعر بيع وتركيب القطعة للعميل متضمناً تكلفة المصنعية
    selling_price       REAL NOT NULL DEFAULT 0.0 CHECK(selling_price >= 0),

    -- [stock] عدد القطع السليمة المتوفرة حالياً في درج أو دولاب ورشة الصيانة
    stock               INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),

    -- [min_stock_alert] حد النواقص الحرج للتنبيه قبل نفاد القطع من الورشة
    min_stock_alert     INTEGER NOT NULL DEFAULT 2 CHECK(min_stock_alert >= 0),

    -- [warranty_days] عدد أيام الضمان التي يقدمها المحل للعميل بعد التركيب (مثال: 90 يوم)
    warranty_days       INTEGER NOT NULL DEFAULT 30 CHECK(warranty_days >= 0),

    -- [shelf_location] رقم أو رمز الدرج في دولاب الورشة (مثال: درج الشاشات B3) لتوفير وقت الفني
    shelf_location      TEXT,

    -- [supplier_id] معرف مورد قطع الغيار أو المستورد في جدول الموردين (References suppliers.id)
    supplier_id         TEXT,

    -- [status] الحالة التشغيلية للقطعة:
    -- 'available' (متوفرة بالدرج)
    -- 'low_stock' (رصيد منخفض تحت حد الأمان)
    -- 'out_of_stock' (نافدة تماماً 0)
    -- 'archived' (مؤرشفة / غير مستخدمة)
    status              TEXT CHECK(status IN ('available', 'low_stock', 'out_of_stock', 'archived')) NOT NULL DEFAULT 'available',

    -- [notes] إرشادات فنية للفني أثناء التركيب أو ملاحظات الجودة
    notes               TEXT,

    -- [created_by] معرف الموظف أو الفني الذي سجل القطعة (References Users.id)
    created_by          TEXT,

    -- [created_at] توقيت تسجيل القطعة لأول مرة
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,

    -- [updated_by] معرف آخر فني أو مستخدم عدل بيانات أو سعر أو رصيد القطعة (References Users.id)
    updated_by          TEXT,

    -- [updated_at] توقيت آخر تعديل حدث على القطعة
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,

    -- قيود المفاتيح الأجنبية لحفظ التكامل المرجعي
    FOREIGN KEY (dashboard_id) REFERENCES Dashboards (id) ON DELETE CASCADE,
    FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES Users (id) ON DELETE SET NULL,
    FOREIGN KEY (updated_by) REFERENCES Users (id) ON DELETE SET NULL
);

-- ------------------------------------------------------------------------------
-- 2. فهارس الاستعلام والبحث السريع والورشة (High-Performance Workshop Indexes)
-- متوافقة مع قاعدة اليسار إلى اليمين (المساواة أولاً ثم الترتيب) وحظر الفهارس المكررة
-- ------------------------------------------------------------------------------

-- 1. فهرس ترتيب السجلات زمنياً لعزل المستأجر الصارم (Left-to-Right Rule)
CREATE INDEX IF NOT EXISTS idx_spare_parts_dashboard_created 
    ON spare_parts(dashboard_id, created_at DESC);

-- 2. فهرس البحث الفوري عن قطع الغيار المتاحة لموديل هاتف محدد
CREATE INDEX IF NOT EXISTS idx_spare_parts_model 
    ON spare_parts(dashboard_id, device_model);

-- 3. فهرس تصفية وفرز قطع الغيار حسب تصنيف نوع القطعة (شاشات، بطاريات...)
CREATE INDEX IF NOT EXISTS idx_spare_parts_category 
    ON spare_parts(dashboard_id, category);

-- 4. فهرس جزئي للبحث بالباركود أو الكود السريع للقطعة
CREATE INDEX IF NOT EXISTS idx_spare_parts_part_code 
    ON spare_parts(dashboard_id, part_code) 
    WHERE part_code IS NOT NULL;

-- 5. فهرس جزئي ذكي لتنبيهات النواقص الحرجة لدرج الورشة (Partial Low-Stock Index)
-- يوفر مساحة الذاكرة ويسرع فحص النواقص لشراء طلبيات جديدة دون فحص كامل الجدول
CREATE INDEX IF NOT EXISTS idx_spare_parts_low_stock 
    ON spare_parts(dashboard_id, stock) 
    WHERE stock <= min_stock_alert;

-- ------------------------------------------------------------------------------
-- 6. فهارس المفاتيح الأجنبية (Foreign Key Performance Indexes)
-- تضع عمود المفتاح الأجنبي أولاً لحماية SQLite من الـ Full Table Scan عند حذف/تعديل السجلات الأب
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_spare_parts_fk_supplier 
    ON spare_parts(supplier_id) 
    WHERE supplier_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_spare_parts_fk_created_by 
    ON spare_parts(created_by) 
    WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_spare_parts_fk_updated_by 
    ON spare_parts(updated_by) 
    WHERE updated_by IS NOT NULL;

