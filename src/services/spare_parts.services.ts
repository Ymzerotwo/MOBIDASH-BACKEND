/**
 * ==============================================================================
 * MobiDash Platform - Spare Parts Services
 * ==============================================================================
 * 
 * Business logic and database operations for maintenance workshop spare parts.
 * Guarantees strict multi-tenant isolation, safe stock adjustments,
 * single aggregated stats SQL, and real-time code availability verification.
 */

import { D1Database } from '@cloudflare/workers-types';
import {
  SparePartRecord,
  CreateSparePartInput,
  UpdateSparePartInput,
  AdjustSparePartStockInput,
  SparePartFilterQuery,
  SparePartStats,
  PartCodeCheckResult,
  SparePartStatus,
  UserSession,
  PosSparePartFilters,
  PosSparePartItem,
} from '../types';
import { getPaginationOptions, PaginatedResult } from '../utils/pagination';
import { escapeLikePattern } from '../utils/sanitize';
import { logger } from '../utils/logger';

const CATEGORY_ALIASES: Record<string, string[]> = {
  'شاشات': ['شاشات', 'screens'],
  'screens': ['شاشات', 'screens'],
  'بطاريات': ['بطاريات', 'batteries'],
  'batteries': ['بطاريات', 'batteries'],
  'باغات وزجاج': ['باغات وزجاج', 'glass'],
  'glass': ['باغات وزجاج', 'glass'],
  'فلاتات وبوردات شحن': ['فلاتات وبوردات شحن', 'فلاتات شحن', 'charging_ports'],
  'فلاتات شحن': ['فلاتات وبوردات شحن', 'فلاتات شحن', 'charging_ports'],
  'charging_ports': ['فلاتات وبوردات شحن', 'فلاتات شحن', 'charging_ports'],
  'كاميرات وعدسات': ['كاميرات وعدسات', 'كاميرات', 'cameras'],
  'كاميرات': ['كاميرات وعدسات', 'كاميرات', 'cameras'],
  'cameras': ['كاميرات وعدسات', 'كاميرات', 'cameras'],
  'هاوسينج وشاصيه وظهر': ['هاوسينج وشاصيه وظهر', 'housing_frame'],
  'housing_frame': ['هاوسينج وشاصيه وظهر', 'housing_frame'],
  'آيسيهات وبوردة': ['آيسيهات وبوردة', 'ics'],
  'ics': ['آيسيهات وبوردة', 'ics'],
  'سماعات وأجراس': ['سماعات وأجراس', 'speakers'],
  'speakers': ['سماعات وأجراس', 'speakers'],
  'مايكات': ['مايكات', 'microphones'],
  'microphones': ['مايكات', 'microphones'],
  'فلاتات وأزرار': ['فلاتات وأزرار', 'flex_cables'],
  'flex_cables': ['فلاتات وأزرار', 'flex_cables'],
  'حساسات وفيس آي دي': ['حساسات وفيس آي دي', 'sensors'],
  'sensors': ['حساسات وفيس آي دي', 'sensors'],
  'شحن لاسلكي وNFC': ['شحن لاسلكي وNFC', 'wireless_charging'],
  'wireless_charging': ['شحن لاسلكي وNFC', 'wireless_charging'],
  'هوائيات وشبكات': ['هوائيات وشبكات', 'antennas'],
  'antennas': ['هوائيات وشبكات', 'antennas'],
  'أدراج وقارئات الشرائح': ['أدراج وقارئات الشرائح', 'sim_trays'],
  'sim_trays': ['أدراج وقارئات الشرائح', 'sim_trays'],
  'هزازات ومحركات لمس': ['هزازات ومحركات لمس', 'vibrators'],
  'vibrators': ['هزازات ومحركات لمس', 'vibrators'],
  'أجزاء صغيرة ولواصق': ['أجزاء صغيرة ولواصق', 'small_parts'],
  'small_parts': ['أجزاء صغيرة ولواصق', 'small_parts'],
  'أخرى': ['أخرى', 'other'],
  'other': ['أخرى', 'other'],
};

export const SparePartsService = {
  /**
   * جلب إحصائيات وعدادات وقيمة مخزون قطع الغيار المجمعة
   * استعلام SQL وحيد فائق السرعة مع دعم التصفية بالتصنيف
   */
  async getStats(db: D1Database, dashboardId: string, category?: string): Promise<SparePartStats> {
    let whereClause = `WHERE dashboard_id = ? AND status != 'archived'`;
    const params: any[] = [dashboardId];

    if (category && category.trim() && category !== 'all') {
      const trimmed = category.trim();
      const aliases = CATEGORY_ALIASES[trimmed] || [trimmed];
      const placeholders = aliases.map(() => '?').join(', ');
      whereClause += ` AND category IN (${placeholders})`;
      params.push(...aliases);
    }

    const query = `
      SELECT
        COUNT(*) as total_types,
        COALESCE(SUM(stock), 0) as total_quantity,
        COALESCE(SUM(stock * cost_price), 0) as total_cost_value,
        COALESCE(SUM(stock * selling_price), 0) as total_selling_value,
        COALESCE(SUM(CASE WHEN stock <= min_stock_alert THEN 1 ELSE 0 END), 0) as low_stock_count,
        COALESCE(SUM(CASE WHEN stock = 0 THEN 1 ELSE 0 END), 0) as out_of_stock_count
      FROM spare_parts
      ${whereClause};
    `;

    const row = await db.prepare(query).bind(...params).first<{
      total_types: number;
      total_quantity: number;
      total_cost_value: number;
      total_selling_value: number;
      low_stock_count: number;
      out_of_stock_count: number;
    }>();

    return {
      total_types: Number(row?.total_types || 0),
      total_quantity: Number(row?.total_quantity || 0),
      total_cost_value: Number(row?.total_cost_value || 0),
      total_selling_value: Number(row?.total_selling_value || 0),
      low_stock_count: Number(row?.low_stock_count || 0),
      out_of_stock_count: Number(row?.out_of_stock_count || 0),
    };
  },

  /**
   * الفحص اللحظي لتوفر كود أو باركود القطعة وعدم تكراره في المتجر
   */
  async checkPartCodeAvailability(
    db: D1Database,
    dashboardId: string,
    code: string,
    excludeId?: string
  ): Promise<PartCodeCheckResult> {
    const trimmed = code.trim();
    if (!trimmed) {
      return {
        exists: false,
        is_available: true,
        message: 'كود القطعة متاح للاستخدام',
        existing_part: null,
      };
    }

    const query = excludeId
      ? `SELECT id, name, category, device_model, part_code FROM spare_parts WHERE dashboard_id = ? AND part_code = ? COLLATE NOCASE AND id != ? LIMIT 1;`
      : `SELECT id, name, category, device_model, part_code FROM spare_parts WHERE dashboard_id = ? AND part_code = ? COLLATE NOCASE LIMIT 1;`;

    const params = excludeId ? [dashboardId, trimmed, excludeId] : [dashboardId, trimmed];
    const existing = await db.prepare(query).bind(...params).first<{
      id: string;
      name: string;
      category: any;
      device_model: string;
      part_code: string;
    }>();

    if (existing) {
      return {
        exists: true,
        is_available: false,
        message: `كود القطعة (${trimmed}) مسجل بالفعل لصنف آخر: (${existing.name} - ${existing.device_model})`,
        existing_part: existing,
      };
    }

    return {
      exists: false,
      is_available: true,
      message: 'كود القطعة متاح للاستخدام',
      existing_part: null,
    };
  },

  /**
   * جلب قائمة قطع الغيار مع البحث والتصفية والتصفح
   */
  async getSpareParts(
    db: D1Database,
    dashboardId: string,
    filter: SparePartFilterQuery
  ): Promise<PaginatedResult<SparePartRecord>> {
    const page = Math.max(1, Number(filter.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filter.limit) || 20));
    const offset = (page - 1) * limit;

    const conditions: string[] = ['sp.dashboard_id = ?'];
    const params: any[] = [dashboardId];

    // استثناء القطع المؤرشفة ما لم يُطلب صراحة
    conditions.push("sp.status != 'archived'");

    // بحث بالاسم أو الكود أو الموديل
    if (filter.search && filter.search.trim()) {
      const escaped = escapeLikePattern(filter.search.trim());
      conditions.push('(sp.name LIKE ? ESCAPE "\\" OR sp.device_model LIKE ? ESCAPE "\\" OR sp.part_code LIKE ? ESCAPE "\\")');
      params.push(`%${escaped}%`, `%${escaped}%`, `%${escaped}%`);
    }

    // فلترة بالتصنيف
    if (filter.category && filter.category.trim() && filter.category !== 'all') {
      const trimmedCat = filter.category.trim();
      const aliases = CATEGORY_ALIASES[trimmedCat] || [trimmedCat];
      const placeholders = aliases.map(() => '?').join(', ');
      conditions.push(`sp.category IN (${placeholders})`);
      params.push(...aliases);
    }

    // فلترة بالجودة
    if (filter.quality && filter.quality.trim() && filter.quality !== 'all') {
      conditions.push('sp.quality = ?');
      params.push(filter.quality.trim());
    }

    // فلترة بموديل الجهاز
    if (filter.device_model && filter.device_model.trim() && filter.device_model !== 'all') {
      const escaped = escapeLikePattern(filter.device_model.trim());
      conditions.push('(sp.device_model LIKE ? ESCAPE "\\" OR sp.compatible_models LIKE ? ESCAPE "\\")');
      params.push(`%${escaped}%`, `%${escaped}%`);
    }

    // فلترة بالمورد
    if (filter.supplier_id && filter.supplier_id.trim() && filter.supplier_id !== 'all') {
      conditions.push('sp.supplier_id = ?');
      params.push(filter.supplier_id.trim());
    }

    // فلترة بحالة الرصيد
    if (filter.stock_status && filter.stock_status !== 'all') {
      if (filter.stock_status === 'low_stock') {
        conditions.push('sp.stock <= sp.min_stock_alert');
      } else if (filter.stock_status === 'out_of_stock') {
        conditions.push('sp.stock = 0');
      } else if (filter.stock_status === 'available') {
        conditions.push('sp.stock > sp.min_stock_alert');
      }
    }

    const whereClause = conditions.join(' AND ');

    // عد السجلات الإجمالي
    const countSql = `SELECT COUNT(*) as total FROM spare_parts sp WHERE ${whereClause};`;
    const countRow = await db.prepare(countSql).bind(...params).first<{ total: number }>();
    const total = Number(countRow?.total || 0);

    // ترتيب السجلات
    const allowedSortFields = ['created_at', 'name', 'stock', 'selling_price', 'cost_price'];
    const sortBy = allowedSortFields.includes(filter.sort_by || '') ? `sp.${filter.sort_by}` : 'sp.created_at';
    const sortOrder = filter.sort_order === 'asc' ? 'ASC' : 'DESC';

    // جلب السجلات مقسمة صفحات
    const dataSql = `
      SELECT 
        sp.*,
        u_creator.name AS created_by_name,
        u_updater.name AS updated_by_name,
        s.name AS supplier_name
      FROM spare_parts sp
      LEFT JOIN Users u_creator ON sp.created_by = u_creator.id
      LEFT JOIN Users u_updater ON sp.updated_by = u_updater.id
      LEFT JOIN suppliers s ON sp.supplier_id = s.id
      WHERE ${whereClause}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT ? OFFSET ?;
    `;
    const dataParams = [...params, limit, offset];
    const { results } = await db.prepare(dataSql).bind(...dataParams).all<SparePartRecord>();

    return {
      data: results || [],
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  },

  /**
   * جلب قطع الغيار المتوافقة مع موديل هاتف محدد لورشة الصيانة
   */
  async getCompatibleParts(
    db: D1Database,
    dashboardId: string,
    deviceModel: string
  ): Promise<SparePartRecord[]> {
    const escaped = escapeLikePattern(deviceModel.trim());
    const query = `
      SELECT * FROM spare_parts
      WHERE dashboard_id = ? AND status != 'archived'
        AND (device_model LIKE ? ESCAPE "\\" OR compatible_models LIKE ? ESCAPE "\\")
      ORDER BY category ASC, name ASC;
    `;
    const { results } = await db.prepare(query).bind(dashboardId, `%${escaped}%`, `%${escaped}%`).all<SparePartRecord>();
    return results || [];
  },

  /**
   * جلب تفاصيل قطعة غيار محددة بواسطة المعرف
   */
  async getSparePartById(
    db: D1Database,
    dashboardId: string,
    id: string
  ): Promise<SparePartRecord | null> {
    const query = `
      SELECT 
        sp.*,
        u_creator.name AS created_by_name,
        u_updater.name AS updated_by_name,
        s.name AS supplier_name
      FROM spare_parts sp
      LEFT JOIN Users u_creator ON sp.created_by = u_creator.id
      LEFT JOIN Users u_updater ON sp.updated_by = u_updater.id
      LEFT JOIN suppliers s ON sp.supplier_id = s.id
      WHERE sp.dashboard_id = ? AND sp.id = ? 
      LIMIT 1;
    `;
    const row = await db.prepare(query).bind(dashboardId, id).first<SparePartRecord>();
    return row || null;
  },

  /**
   * تسجيل وإضافة قطعة غيار جديدة
   */
  async createSparePart(
    db: D1Database,
    dashboardId: string,
    currentUser: UserSession,
    input: CreateSparePartInput
  ): Promise<SparePartRecord> {
    // 1. التحقق من كود القطعة في حال إدخاله
    if (input.part_code && input.part_code.trim()) {
      const codeCheck = await this.checkPartCodeAvailability(db, dashboardId, input.part_code.trim());
      if (!codeCheck.is_available) {
        const err: any = new Error(codeCheck.message);
        err.slug = 'PART_CODE_ALREADY_EXISTS';
        throw err;
      }
    }

    // 2. توليد معرف القطعة
    const id = `sp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const stock = Number(input.stock || 0);
    const minAlert = Number(input.min_stock_alert ?? 2);

    // حساب الحالة التشغيلية تلقائياً
    const status: SparePartStatus =
      stock === 0 ? 'out_of_stock' : stock <= minAlert ? 'low_stock' : 'available';

    const compatibleModelsJson = input.compatible_models && Array.isArray(input.compatible_models)
      ? JSON.stringify(input.compatible_models)
      : '[]';

    const sql = `
      INSERT INTO spare_parts (
        id, dashboard_id, part_code, name, category, device_model, compatible_models,
        quality, cost_price, selling_price, stock, min_stock_alert, warranty_days,
        shelf_location, supplier_id, status, notes, created_by, created_at, updated_by, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `;

    await db.prepare(sql).bind(
      id,
      dashboardId,
      input.part_code ? input.part_code.trim() : null,
      input.name.trim(),
      input.category,
      input.device_model.trim(),
      compatibleModelsJson,
      input.quality,
      Number(input.cost_price || 0),
      Number(input.selling_price || 0),
      stock,
      minAlert,
      Number(input.warranty_days ?? 30),
      input.shelf_location ? input.shelf_location.trim() : null,
      input.supplier_id || null,
      status,
      input.notes ? input.notes.trim() : null,
      currentUser.id,
      now,
      currentUser.id,
      now
    ).run();

    const created = await this.getSparePartById(db, dashboardId, id);
    if (!created) {
      throw new Error('فشل في جلب قطعة الغيار بعد التسجيل');
    }

    logger.info('spare-parts-service', `Spare part created: ${id} (${input.name}) by ${currentUser.name}`);
    return created;
  },

  /**
   * تعديل بيانات وسعر ورصيد قطعة غيار قائمة
   */
  async updateSparePart(
    db: D1Database,
    dashboardId: string,
    currentUser: UserSession,
    id: string,
    input: UpdateSparePartInput
  ): Promise<SparePartRecord> {
    const existing = await this.getSparePartById(db, dashboardId, id);
    if (!existing) {
      const err: any = new Error('قطعة الغيار غير موجودة');
      err.slug = 'SPARE_PART_NOT_FOUND';
      throw err;
    }

    // التحقق من كود القطعة في حال تم تعديله
    if (input.part_code && input.part_code.trim() && input.part_code.trim() !== existing.part_code) {
      const codeCheck = await this.checkPartCodeAvailability(db, dashboardId, input.part_code.trim(), id);
      if (!codeCheck.is_available) {
        const err: any = new Error(codeCheck.message);
        err.slug = 'PART_CODE_ALREADY_EXISTS';
        throw err;
      }
    }

    const updatedStock = input.stock !== undefined ? Number(input.stock) : existing.stock;
    const updatedMinAlert = input.min_stock_alert !== undefined ? Number(input.min_stock_alert) : existing.min_stock_alert;

    // حساب الحالة التشغيلية
    let updatedStatus: SparePartStatus = existing.status;
    if (input.status) {
      updatedStatus = input.status;
    } else {
      updatedStatus =
        updatedStock === 0 ? 'out_of_stock' : updatedStock <= updatedMinAlert ? 'low_stock' : 'available';
    }

    const compatibleModelsJson =
      input.compatible_models !== undefined
        ? JSON.stringify(input.compatible_models || [])
        : existing.compatible_models;

    const now = new Date().toISOString();

    const sql = `
      UPDATE spare_parts SET
        name = COALESCE(?, name),
        part_code = CASE WHEN ? IS NOT NULL THEN ? ELSE part_code END,
        category = COALESCE(?, category),
        device_model = COALESCE(?, device_model),
        compatible_models = COALESCE(?, compatible_models),
        quality = COALESCE(?, quality),
        cost_price = COALESCE(?, cost_price),
        selling_price = COALESCE(?, selling_price),
        stock = COALESCE(?, stock),
        min_stock_alert = COALESCE(?, min_stock_alert),
        warranty_days = COALESCE(?, warranty_days),
        shelf_location = CASE WHEN ? IS NOT NULL THEN ? ELSE shelf_location END,
        supplier_id = CASE WHEN ? IS NOT NULL THEN ? ELSE supplier_id END,
        status = ?,
        notes = CASE WHEN ? IS NOT NULL THEN ? ELSE notes END,
        updated_by = ?,
        updated_at = ?
      WHERE dashboard_id = ? AND id = ?;
    `;

    await db.prepare(sql).bind(
      input.name ? input.name.trim() : null,
      input.part_code !== undefined ? 1 : null,
      input.part_code ? input.part_code.trim() : null,
      input.category || null,
      input.device_model ? input.device_model.trim() : null,
      compatibleModelsJson,
      input.quality || null,
      input.cost_price !== undefined ? Number(input.cost_price) : null,
      input.selling_price !== undefined ? Number(input.selling_price) : null,
      input.stock !== undefined ? updatedStock : null,
      input.min_stock_alert !== undefined ? updatedMinAlert : null,
      input.warranty_days !== undefined ? Number(input.warranty_days) : null,
      input.shelf_location !== undefined ? 1 : null,
      input.shelf_location ? input.shelf_location.trim() : null,
      input.supplier_id !== undefined ? 1 : null,
      input.supplier_id || null,
      updatedStatus,
      input.notes !== undefined ? 1 : null,
      input.notes ? input.notes.trim() : null,
      currentUser.id,
      now,
      dashboardId,
      id
    ).run();

    const updated = await this.getSparePartById(db, dashboardId, id);
    if (!updated) {
      throw new Error('فشل في جلب قطعة الغيار بعد التعديل');
    }

    logger.info('spare-parts-service', `Spare part updated: ${id} by ${currentUser.name}`);
    return updated;
  },

  /**
   * تسوية وتعديل رصيد الدرج يدوياً (تلف أثناء الصيانة، مشتريات، عجز/زيادة)
   */
  async adjustStock(
    db: D1Database,
    dashboardId: string,
    currentUser: UserSession,
    id: string,
    input: AdjustSparePartStockInput
  ): Promise<SparePartRecord> {
    const existing = await this.getSparePartById(db, dashboardId, id);
    if (!existing) {
      const err: any = new Error('قطعة الغيار غير موجودة');
      err.slug = 'SPARE_PART_NOT_FOUND';
      throw err;
    }

    const newStock = existing.stock + Number(input.quantity_change);
    if (newStock < 0) {
      const err: any = new Error(`لا يمكن إنقاص الرصيد إلى ما دون الصفر (الرصيد الحالي: ${existing.stock})`);
      err.slug = 'STOCK_CANNOT_BE_NEGATIVE';
      throw err;
    }

    const newStatus: SparePartStatus =
      newStock === 0 ? 'out_of_stock' : newStock <= existing.min_stock_alert ? 'low_stock' : 'available';

    const now = new Date().toISOString();

    await db.prepare(`
      UPDATE spare_parts SET
        stock = ?,
        status = ?,
        updated_by = ?,
        updated_at = ?
      WHERE dashboard_id = ? AND id = ?;
    `).bind(newStock, newStatus, currentUser.id, now, dashboardId, id).run();

    const updated = await this.getSparePartById(db, dashboardId, id);
    if (!updated) {
      throw new Error('فشل في جلب قطعة الغيار بعد تسوية الرصيد');
    }

    logger.info(
      'spare-parts-service',
      `Stock adjusted for spare part ${id}: change=${input.quantity_change}, newStock=${newStock}, type=${input.type}`
    );
    return updated;
  },

  /**
   * حذف آمن لقطعة الغيار أو تحويلها لحالة الأرشفة
   */
  async deleteSparePart(
    db: D1Database,
    dashboardId: string,
    currentUser: UserSession,
    id: string,
    forceDelete: boolean = false
  ): Promise<{ id: string; archived: boolean; message: string }> {
    const existing = await this.getSparePartById(db, dashboardId, id);
    if (!existing) {
      const err: any = new Error('قطعة الغيار غير موجودة');
      err.slug = 'SPARE_PART_NOT_FOUND';
      throw err;
    }

    // إذا كانت القطعة تحتوي على رصيد مادي بالدرج ولم يتم طلب الحذف الإجباري، نؤرشفها للحفاظ على الجرد
    if (existing.stock > 0 && !forceDelete) {
      await db.prepare(`
        UPDATE spare_parts SET
          status = 'archived',
          updated_by = ?,
          updated_at = ?
        WHERE dashboard_id = ? AND id = ?;
      `).bind(currentUser.id, new Date().toISOString(), dashboardId, id).run();

      logger.info('spare-parts-service', `Spare part archived due to positive stock: ${id}`);
      return {
        id,
        archived: true,
        message: `تم تحويل قطعة الغيار (${existing.name}) إلى حالة الأرشفة لوجود رصيد متبقي بالدرج (${existing.stock} قطعة)`,
      };
    }

    // الحذف النهائي من قاعدة البيانات
    await db.prepare(`DELETE FROM spare_parts WHERE dashboard_id = ? AND id = ?;`).bind(dashboardId, id).run();

    logger.info('spare-parts-service', `Spare part permanently deleted: ${id} by ${currentUser.name}`);
    return {
      id,
      archived: false,
      message: `تم حذف قطعة الغيار (${existing.name}) نهائياً من قاعدة البيانات بنجاح`,
    };
  },

  /**
   * جلب قطع الغيار المتاحة للصيانة والبيع المباشر في نقطة البيع (POS)
   * يعزل البيانات حسب dashboard_id ويجلب فقط القطع النشطة التي بها رصيد مخزني stock > 0
   */
  async getForPos(
    db: D1Database,
    dashboardId: string,
    filters?: PosSparePartFilters
  ): Promise<{ data: PosSparePartItem[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
    const page = Math.max(1, Number(filters?.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(filters?.limit) || 50));
    const offset = (page - 1) * limit;

    const conditions: string[] = [
      "dashboard_id = ?",
      "status != 'archived'",
      "stock > 0"
    ];
    const params: any[] = [dashboardId];

    if (filters?.category && filters.category !== 'all' && filters.category !== 'الكل' && filters.category !== 'كل قطع الغيار') {
      const trimmedCat = filters.category.trim();
      const aliases = CATEGORY_ALIASES[trimmedCat] || [trimmedCat];
      const placeholders = aliases.map(() => '?').join(', ');
      conditions.push(`category IN (${placeholders})`);
      params.push(...aliases);
    }

    if (filters?.search && filters.search.trim()) {
      const escaped = escapeLikePattern(filters.search.trim());
      conditions.push('(name LIKE ? ESCAPE "\\" OR device_model LIKE ? ESCAPE "\\" OR part_code LIKE ? ESCAPE "\\" OR compatible_models LIKE ? ESCAPE "\\")');
      params.push(`%${escaped}%`, `%${escaped}%`, `%${escaped}%`, `%${escaped}%`);
    }

    const whereClause = conditions.join(' AND ');

    const countSql = `SELECT COUNT(*) as total FROM spare_parts WHERE ${whereClause};`;
    const countRow = await db.prepare(countSql).bind(...params).first<{ total: number }>();
    const total = Number(countRow?.total || 0);

    const dataSql = `
      SELECT id, name, part_code, category, quality, selling_price, cost_price, stock, compatible_models
      FROM spare_parts
      WHERE ${whereClause}
      ORDER BY name ASC, stock DESC
      LIMIT ? OFFSET ?;
    `;
    const dataParams = [...params, limit, offset];
    const { results } = await db.prepare(dataSql).bind(...dataParams).all<any>();

    const items: PosSparePartItem[] = (results || []).map((row) => {
      let compatibleModels: string[] = [];
      if (typeof row.compatible_models === 'string') {
        try {
          const parsed = JSON.parse(row.compatible_models);
          if (Array.isArray(parsed)) compatibleModels = parsed;
          else compatibleModels = [row.compatible_models];
        } catch {
          compatibleModels = row.compatible_models.split(',').map((s: string) => s.trim()).filter(Boolean);
        }
      } else if (Array.isArray(row.compatible_models)) {
        compatibleModels = row.compatible_models;
      }

      return {
        id: row.id,
        name: row.name,
        part_code: row.part_code || null,
        category: row.category,
        quality: row.quality,
        selling_price: Number(row.selling_price || 0),
        cost_price: Number(row.cost_price || 0),
        stock: Number(row.stock || 0),
        compatible_models: compatibleModels,
      };
    });

    return {
      data: items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  },
};
