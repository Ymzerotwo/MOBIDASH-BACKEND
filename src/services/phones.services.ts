/**
 * ==============================================================================
 * MobiDash Platform - Phones & IMEI Inventory Services
 * ==============================================================================
 * 
 * Comprehensive business logic for mobile shop phone inventory,
 * IMEI tracking, legal buyback compliance, reservations with deposit,
 * sales execution with cash drawer integration, and aggregated stats.
 * 
 * Core Guarantees:
 * 1. Strict Tenant Isolation (dashboard_id on every query).
 * 2. Atomic Sales Execution (db.batch wrapping phone status and cash drawer).
 * 3. Conditional Buyback KYC: 14-digit Egyptian National ID & phone validation.
 * 4. Safe Deletion Policy: Only in_stock devices can be deleted; sold phones are preserved.
 * 5. Case-insensitive search using COLLATE NOCASE and safe escapeLikePattern.
 */

import { D1Database } from '@cloudflare/workers-types';
import {
  PhoneRecord,
  CreatePhoneInput,
  UpdatePhoneInput,
  ReservePhoneInput,
  SellPhoneInput,
  PhoneFilterQuery,
  PhoneStats,
  ImeiCheckResult,
  UserSession,
  PosPhoneFilters,
  PosPhoneItem,
} from '../types';
import { getPaginationOptions, PaginatedResult } from '../utils/pagination';
import { escapeLikePattern } from '../utils/sanitize';
import { logger } from '../utils/logger';

export const PhonesService = {
  /**
   * جلب إحصائيات وعدادات المخزن والقيم المالية المجمعة (KPIs)
   */
  async getStats(db: D1Database, dashboardId: string): Promise<PhoneStats> {
    const query = `
      SELECT 
        COUNT(*) as total_count,
        COALESCE(SUM(CASE WHEN status = 'in_stock' THEN 1 ELSE 0 END), 0) as in_stock_count,
        COALESCE(SUM(CASE WHEN status = 'in_stock' THEN purchase_price ELSE 0 END), 0) as in_stock_purchase_value,
        COALESCE(SUM(CASE WHEN status = 'in_stock' THEN selling_price ELSE 0 END), 0) as in_stock_selling_value,
        COALESCE(SUM(CASE WHEN status = 'in_stock' AND condition = 'new' THEN 1 ELSE 0 END), 0) as new_count,
        COALESCE(SUM(CASE WHEN status = 'in_stock' AND condition = 'new' THEN selling_price ELSE 0 END), 0) as new_value,
        COALESCE(SUM(CASE WHEN status = 'in_stock' AND condition IN ('used', 'used_like_new') THEN 1 ELSE 0 END), 0) as used_count,
        COALESCE(SUM(CASE WHEN status = 'in_stock' AND condition IN ('used', 'used_like_new') THEN selling_price ELSE 0 END), 0) as used_value,
        COALESCE(SUM(CASE WHEN status = 'reserved' THEN 1 ELSE 0 END), 0) as reserved_count,
        COALESCE(SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END), 0) as sold_count,
        COALESCE(SUM(CASE WHEN status = 'sold' THEN COALESCE(sold_price, selling_price) ELSE 0 END), 0) as sold_revenue,
        COALESCE(SUM(CASE WHEN status = 'sold' THEN (COALESCE(sold_price, selling_price) - purchase_price) ELSE 0 END), 0) as sold_profit
      FROM phones
      WHERE dashboard_id = ?;
    `;

    const row = await db.prepare(query).bind(dashboardId).first<any>();

    return {
      total_count: Number(row?.total_count || 0),
      in_stock_count: Number(row?.in_stock_count || 0),
      in_stock_purchase_value: Number(row?.in_stock_purchase_value || 0),
      in_stock_selling_value: Number(row?.in_stock_selling_value || 0),
      new_count: Number(row?.new_count || 0),
      new_value: Number(row?.new_value || 0),
      used_count: Number(row?.used_count || 0),
      used_value: Number(row?.used_value || 0),
      reserved_count: Number(row?.reserved_count || 0),
      sold_count: Number(row?.sold_count || 0),
      sold_revenue: Number(row?.sold_revenue || 0),
      sold_profit: Number(row?.sold_profit || 0),
    };
  },

  /**
   * جلب قائمة الهواتف مع دعم التبويبات والبحث والتصفية والترقيم
   */
  async getPhones(
    db: D1Database,
    dashboardId: string,
    query: PhoneFilterQuery
  ): Promise<PaginatedResult<PhoneRecord>> {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 20)));
    const offset = (page - 1) * limit;

    const whereClauses: string[] = ['p.dashboard_id = ?'];
    const params: any[] = [dashboardId];

    // فلتر التبويب (Tabs) المتطابق مع واجهة المستخدم
    if (query.tab) {
      if (query.tab === 'in_stock') {
        whereClauses.push("p.status = 'in_stock'");
      } else if (query.tab === 'new') {
        whereClauses.push("p.status = 'in_stock' AND p.condition = 'new'");
      } else if (query.tab === 'used') {
        whereClauses.push("p.status = 'in_stock' AND p.condition IN ('used_like_new', 'used')");
      } else if (query.tab === 'reserved') {
        whereClauses.push("p.status = 'reserved'");
      } else if (query.tab === 'sold') {
        whereClauses.push("p.status = 'sold'");
      }
    }

    // فلتر الحالة الفردية إذا لم تُحدد بالتبويب
    if (query.status && query.status !== 'all' && !query.tab) {
      whereClauses.push('p.status = ?');
      params.push(query.status);
    }

    // فلتر حالة الجهاز الفردية
    if (query.condition && query.condition !== 'all' && !query.tab) {
      whereClauses.push('p.condition = ?');
      params.push(query.condition);
    }

    // فلتر الماركة
    if (query.brand && query.brand.trim() && query.brand !== 'all') {
      whereClauses.push('p.brand = ?');
      params.push(query.brand.trim());
    }

    // فلتر المورد
    if (query.supplier_id && query.supplier_id.trim()) {
      whereClauses.push('p.supplier_id = ?');
      params.push(query.supplier_id.trim());
    }

    // فلتر نطاق الأسعار
    if (query.min_price !== undefined && query.min_price !== null) {
      whereClauses.push('p.selling_price >= ?');
      params.push(query.min_price);
    }
    if (query.max_price !== undefined && query.max_price !== null) {
      whereClauses.push('p.selling_price <= ?');
      params.push(query.max_price);
    }

    // البحث النصي الموحد الآمن (ماركة، موديل، IMEI 1 أو 2، بائع، مشتري)
    if (query.search && query.search.trim()) {
      const term = `%${escapeLikePattern(query.search.trim())}%`;
      whereClauses.push(`(
        p.brand LIKE ? ESCAPE '\\' OR 
        p.model LIKE ? ESCAPE '\\' OR 
        p.color LIKE ? ESCAPE '\\' OR 
        p.imei LIKE ? ESCAPE '\\' OR 
        p.imei2 LIKE ? ESCAPE '\\' OR 
        p.seller_name LIKE ? ESCAPE '\\' OR 
        p.seller_national_id LIKE ? ESCAPE '\\' OR 
        p.seller_phone LIKE ? ESCAPE '\\' OR 
        p.buyer_name LIKE ? ESCAPE '\\' OR 
        p.buyer_phone LIKE ? ESCAPE '\\'
      )`);
      for (let i = 0; i < 10; i++) {
        params.push(term);
      }
    }

    const whereSQL = whereClauses.join(' AND ');

    // استعلام العدد الإجمالي للترقيم
    const countSQL = `SELECT COUNT(*) as total FROM phones p WHERE ${whereSQL};`;
    const countRow = await db.prepare(countSQL).bind(...params).first<{ total: number }>();
    const total = Number(countRow?.total || 0);

    // ترتيب السجلات
    let orderCol = 'p.date_added';
    if (query.sort_by === 'created_at') orderCol = 'p.created_at';
    else if (query.sort_by === 'selling_price') orderCol = 'p.selling_price';
    else if (query.sort_by === 'purchase_price') orderCol = 'p.purchase_price';

    const orderDir = query.sort_order?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const dataSQL = `
      SELECT 
        p.*,
        u_creator.name AS created_by_name,
        u_purchaser.name AS purchased_by_name,
        u_seller.name AS sold_by_name,
        u_reserver.name AS reserved_by_name,
        u_updater.name AS updated_by_name,
        s.name AS supplier_name
      FROM phones p
      LEFT JOIN Users u_creator ON p.created_by = u_creator.id
      LEFT JOIN Users u_purchaser ON p.purchased_by = u_purchaser.id
      LEFT JOIN Users u_seller ON p.sold_by = u_seller.id
      LEFT JOIN Users u_reserver ON p.reserved_by = u_reserver.id
      LEFT JOIN Users u_updater ON p.updated_by = u_updater.id
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      WHERE ${whereSQL}
      ORDER BY ${orderCol} ${orderDir}, p.created_at DESC
      LIMIT ? OFFSET ?;
    `;

    const dataParams = [...params, limit, offset];
    const { results } = await db.prepare(dataSQL).bind(...dataParams).all<PhoneRecord>();

    return {
      data: (results || []) as PhoneRecord[],
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  },

  /**
   * جلب تفاصيل جهاز محدد بواسطة المعرف
   */
  async getPhoneById(db: D1Database, dashboardId: string, id: string): Promise<PhoneRecord | null> {
    const query = `
      SELECT 
        p.*,
        u_creator.name AS created_by_name,
        u_purchaser.name AS purchased_by_name,
        u_seller.name AS sold_by_name,
        u_reserver.name AS reserved_by_name,
        u_updater.name AS updated_by_name,
        s.name AS supplier_name
      FROM phones p
      LEFT JOIN Users u_creator ON p.created_by = u_creator.id
      LEFT JOIN Users u_purchaser ON p.purchased_by = u_purchaser.id
      LEFT JOIN Users u_seller ON p.sold_by = u_seller.id
      LEFT JOIN Users u_reserver ON p.reserved_by = u_reserver.id
      LEFT JOIN Users u_updater ON p.updated_by = u_updater.id
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      WHERE p.dashboard_id = ? AND p.id = ? 
      LIMIT 1;
    `;
    const record = await db.prepare(query).bind(dashboardId, id).first<PhoneRecord>();
    return record || null;
  },

  /**
   * جلب وفحص هاتف بواسطة رقم السيريال IMEI (1 أو 2)
   */
  async getPhoneByImei(db: D1Database, dashboardId: string, imei: string): Promise<PhoneRecord | null> {
    const query = `
      SELECT 
        p.*,
        u_creator.name AS created_by_name,
        u_purchaser.name AS purchased_by_name,
        u_seller.name AS sold_by_name,
        u_reserver.name AS reserved_by_name,
        u_updater.name AS updated_by_name,
        s.name AS supplier_name
      FROM phones p
      LEFT JOIN Users u_creator ON p.created_by = u_creator.id
      LEFT JOIN Users u_purchaser ON p.purchased_by = u_purchaser.id
      LEFT JOIN Users u_seller ON p.sold_by = u_seller.id
      LEFT JOIN Users u_reserver ON p.reserved_by = u_reserver.id
      LEFT JOIN Users u_updater ON p.updated_by = u_updater.id
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      WHERE p.dashboard_id = ? AND (p.imei = ? OR (p.imei2 IS NOT NULL AND p.imei2 = ?)) 
      LIMIT 1;
    `;
    const record = await db.prepare(query).bind(dashboardId, imei, imei).first<PhoneRecord>();
    return record || null;
  },

  /**
   * الفحص اللحظي المخصص لتوفر وعدم تكرار رقم السيريال (IMEI Availability Checker)
   * مهمته الوحيدة: التأكد مما إذا كان السيريال مستخدماً مسبقاً أم متاحاً، مع استثناء المعرف عند التعديل
   */
  async checkImeiAvailability(
    db: D1Database,
    dashboardId: string,
    imei: string,
    excludeId?: string
  ): Promise<ImeiCheckResult> {
    const trimmed = imei.trim();
    if (!trimmed) {
      return {
        exists: false,
        is_available: false,
        message: 'يرجى إدخال رقم السيريال (IMEI)',
        existing_phone: null,
      };
    }

    // 1. فحص هل السيريال مسجل داخل متجر العميل الحالي
    const storeQuery = excludeId
      ? `SELECT id, brand, model, color, status, condition, imei FROM phones WHERE dashboard_id = ? AND (imei = ? OR (imei2 IS NOT NULL AND imei2 = ?)) AND id != ? LIMIT 1;`
      : `SELECT id, brand, model, color, status, condition, imei FROM phones WHERE dashboard_id = ? AND (imei = ? OR (imei2 IS NOT NULL AND imei2 = ?)) LIMIT 1;`;

    const storeParams = excludeId ? [dashboardId, trimmed, trimmed, excludeId] : [dashboardId, trimmed, trimmed];
    const existingInStore = await db.prepare(storeQuery).bind(...storeParams).first<{
      id: string;
      brand: string;
      model: string;
      color: string;
      status: any;
      condition: any;
      imei: string;
    }>();

    if (existingInStore) {
      const statusLabel =
        existingInStore.status === 'in_stock'
          ? 'متوفر بالمخزن'
          : existingInStore.status === 'reserved'
          ? 'محجوز بعربون'
          : 'تم بيعه مسبقاً';

      return {
        exists: true,
        is_available: false,
        message: `رقم السيريال مسجل بالفعل في مخزنك لجهاز (${existingInStore.brand} ${existingInStore.model} - ${existingInStore.color || ''}) [الحالة: ${statusLabel}]`,
        existing_phone: existingInStore,
      };
    }

    // 2. فحص هل السيريال مسجل عالمياً في النظام (نظراً لأن عمود imei يحمل قيد UNIQUE في قاعدة البيانات)
    const globalQuery = excludeId
      ? `SELECT id, brand, model FROM phones WHERE (imei = ? OR (imei2 IS NOT NULL AND imei2 = ?)) AND id != ? LIMIT 1;`
      : `SELECT id, brand, model FROM phones WHERE (imei = ? OR (imei2 IS NOT NULL AND imei2 = ?)) LIMIT 1;`;

    const globalParams = excludeId ? [trimmed, trimmed, excludeId] : [trimmed, trimmed];
    const existingGlobally = await db.prepare(globalQuery).bind(...globalParams).first<{
      id: string;
      brand: string;
      model: string;
    }>();

    if (existingGlobally) {
      return {
        exists: true,
        is_available: false,
        message: `رقم السيريال (${trimmed}) مسجل مسبقاً في النظام لجهاز آخر`,
        existing_phone: null,
      };
    }

    return {
      exists: false,
      is_available: true,
      message: 'رقم السيريال متاح للاستخدام',
      existing_phone: null,
    };
  },

  /**
   * تسجيل وإدخال هاتف جديد في المخزن مع التحقق الشرطي والربط المالي بالخزينة
   */
  async createPhone(
    db: D1Database,
    dashboardId: string,
    currentUser: UserSession,
    input: CreatePhoneInput
  ): Promise<PhoneRecord> {
    // 1. التحقق من عدم تكرار سيريال الـ IMEI في النظام بالكامل
    const existing = await db
      .prepare('SELECT id FROM phones WHERE imei = ? OR (imei2 IS NOT NULL AND imei2 = ?) LIMIT 1;')
      .bind(input.imei, input.imei)
      .first<{ id: string }>();

    if (existing) {
      const error: any = new Error('رقم السيريال (IMEI 1) مسجل مسبقاً في النظام لجهاز آخر');
      error.slug = 'IMEI_ALREADY_EXISTS';
      throw error;
    }

    if (input.imei2 && input.imei2.trim()) {
      const existing2 = await db
        .prepare('SELECT id FROM phones WHERE imei = ? OR imei2 = ? LIMIT 1;')
        .bind(input.imei2, input.imei2)
        .first<{ id: string }>();

      if (existing2) {
        const error: any = new Error('رقم السيريال الثاني (IMEI 2) مسجل مسبقاً في النظام');
        error.slug = 'IMEI_ALREADY_EXISTS';
        throw error;
      }
    }

    // 2. التحقق من وجود المورد إذا كان الجهاز جديداً
    if (input.condition === 'new' && input.supplier_id) {
      const sup = await db
        .prepare('SELECT id FROM suppliers WHERE dashboard_id = ? AND id = ? LIMIT 1;')
        .bind(dashboardId, input.supplier_id)
        .first<{ id: string }>();

      if (!sup) {
        const error: any = new Error('المورد المحدد غير مسجل في النظام');
        error.slug = 'SUPPLIER_NOT_FOUND';
        throw error;
      }
    }

    const id = `ph-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const dateAdded = input.date_added || now.split('T')[0];
    const minPrice = input.min_price !== undefined ? Number(input.min_price) : Number(input.selling_price);
    const hasBox = input.condition === 'new' ? 1 : input.has_box ? 1 : 0;
    const hasCharger = input.condition === 'new' ? 1 : input.has_charger ? 1 : 0;

    const insertPhoneStmt = db.prepare(`
      INSERT INTO phones (
        id, dashboard_id, brand, model, color, storage, ram, battery_capacity,
        screen_size, network, processor, condition, battery_health, imei, imei2,
        purchase_price, selling_price, min_price, warranty_period, status,
        supplier_id, purchased_by, purchased_at, seller_name, seller_national_id,
        seller_phone, seller_id_front_url, seller_id_back_url, contract_image_url,
        has_box, has_charger, notes, date_added, created_by, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, 'in_stock',
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?
      );
    `).bind(
      id,
      dashboardId,
      input.brand,
      input.model,
      input.color,
      input.storage,
      input.ram || null,
      input.battery_capacity || null,
      input.screen_size || null,
      input.network || '4G',
      input.processor || null,
      input.condition,
      input.battery_health !== undefined ? input.battery_health : null,
      input.imei,
      input.imei2 || null,
      Number(input.purchase_price),
      Number(input.selling_price),
      minPrice,
      input.warranty_period || null,
      input.supplier_id || null,
      currentUser.id,
      now,
      input.seller_name || null,
      input.seller_national_id || null,
      input.seller_phone || null,
      input.seller_id_front_url || null,
      input.seller_id_back_url || null,
      input.contract_image_url || null,
      hasBox,
      hasCharger,
      input.notes || null,
      dateAdded,
      currentUser.id,
      now,
      now
    );

    // 3. إذا تم اختيار سداد تكلفة شراء الجهاز من درج النقدية
    if (input.pay_from_drawer && Number(input.purchase_price) > 0) {
      const movementId = `cm-${crypto.randomUUID()}`;
      const desc = `شراء جهاز ${input.condition === 'new' ? 'جديد متبرشم' : 'مستعمل'} (${input.brand} ${input.model} - IMEI: ${input.imei})`;

      const insertCashStmt = db.prepare(`
        INSERT INTO cash_movements (
          id, dashboard_id, type, category, amount, description,
          cashier_profile_id, cashier_name, shift_id, created_at
        ) VALUES (?, ?, 'out', 'petty_expense', ?, ?, ?, ?, ?, ?);
      `).bind(
        movementId,
        dashboardId,
        Number(input.purchase_price),
        desc,
        currentUser.id,
        currentUser.name || 'الموظف المسؤول',
        currentUser.active_shift?.shift_id || null,
        now
      );

      await db.batch([insertPhoneStmt, insertCashStmt]);
    } else {
      await insertPhoneStmt.run();
    }

    const created = await this.getPhoneById(db, dashboardId, id);
    if (!created) {
      throw new Error('فشل في استرداد بيانات الجهاز بعد التسجيل');
    }

    logger.info('phones-service', `[PhonesService] Phone created: ${created.brand} ${created.model} (IMEI: ${created.imei}) by ${currentUser.name}`);
    return created;
  },

  /**
   * تحديث بيانات هاتف مسجل بالمخزن
   */
  async updatePhone(
    db: D1Database,
    dashboardId: string,
    currentUser: UserSession,
    id: string,
    input: UpdatePhoneInput
  ): Promise<PhoneRecord> {
    const existing = await this.getPhoneById(db, dashboardId, id);
    if (!existing) {
      const error: any = new Error('لم يتم العثور على الجهاز المطلوب');
      error.slug = 'PHONE_NOT_FOUND';
      throw error;
    }

    // فحص تعديل الـ IMEI
    if (input.imei && input.imei !== existing.imei) {
      if (existing.status === 'sold') {
        const error: any = new Error('لا يمكن تعديل سيريال IMEI لجهاز تم بيعه وفواتيره مسجلة');
        error.slug = 'PHONE_ALREADY_SOLD';
        throw error;
      }

      const dup = await db
        .prepare('SELECT id FROM phones WHERE (imei = ? OR imei2 = ?) AND id != ? LIMIT 1;')
        .bind(input.imei, input.imei, id)
        .first<{ id: string }>();

      if (dup) {
        const error: any = new Error('رقم IMEI المدخل مسجل مسبقاً لجهاز آخر');
        error.slug = 'IMEI_ALREADY_EXISTS';
        throw error;
      }
    }

    const setClauses: string[] = ['updated_at = CURRENT_TIMESTAMP', 'updated_by = ?'];
    const params: any[] = [currentUser.id];

    if (input.brand !== undefined) { setClauses.push('brand = ?'); params.push(input.brand); }
    if (input.model !== undefined) { setClauses.push('model = ?'); params.push(input.model); }
    if (input.color !== undefined) { setClauses.push('color = ?'); params.push(input.color); }
    if (input.storage !== undefined) { setClauses.push('storage = ?'); params.push(input.storage); }
    if (input.ram !== undefined) { setClauses.push('ram = ?'); params.push(input.ram); }
    if (input.battery_capacity !== undefined) { setClauses.push('battery_capacity = ?'); params.push(input.battery_capacity); }
    if (input.screen_size !== undefined) { setClauses.push('screen_size = ?'); params.push(input.screen_size); }
    if (input.network !== undefined) { setClauses.push('network = ?'); params.push(input.network); }
    if (input.processor !== undefined) { setClauses.push('processor = ?'); params.push(input.processor); }
    if (input.condition !== undefined) { setClauses.push('condition = ?'); params.push(input.condition); }
    if (input.battery_health !== undefined) { setClauses.push('battery_health = ?'); params.push(input.battery_health); }
    if (input.imei !== undefined) { setClauses.push('imei = ?'); params.push(input.imei); }
    if (input.imei2 !== undefined) { setClauses.push('imei2 = ?'); params.push(input.imei2 || null); }
    if (input.purchase_price !== undefined) { setClauses.push('purchase_price = ?'); params.push(Number(input.purchase_price)); }
    if (input.selling_price !== undefined) { setClauses.push('selling_price = ?'); params.push(Number(input.selling_price)); }
    if (input.min_price !== undefined) { setClauses.push('min_price = ?'); params.push(Number(input.min_price)); }
    if (input.warranty_period !== undefined) { setClauses.push('warranty_period = ?'); params.push(input.warranty_period); }
    if (input.supplier_id !== undefined) { setClauses.push('supplier_id = ?'); params.push(input.supplier_id || null); }
    if (input.seller_name !== undefined) { setClauses.push('seller_name = ?'); params.push(input.seller_name); }
    if (input.seller_national_id !== undefined) { setClauses.push('seller_national_id = ?'); params.push(input.seller_national_id); }
    if (input.seller_phone !== undefined) { setClauses.push('seller_phone = ?'); params.push(input.seller_phone); }
    if (input.seller_id_front_url !== undefined) { setClauses.push('seller_id_front_url = ?'); params.push(input.seller_id_front_url || null); }
    if (input.seller_id_back_url !== undefined) { setClauses.push('seller_id_back_url = ?'); params.push(input.seller_id_back_url || null); }
    if (input.contract_image_url !== undefined) { setClauses.push('contract_image_url = ?'); params.push(input.contract_image_url || null); }
    if (input.has_box !== undefined) { setClauses.push('has_box = ?'); params.push(input.has_box ? 1 : 0); }
    if (input.has_charger !== undefined) { setClauses.push('has_charger = ?'); params.push(input.has_charger ? 1 : 0); }
    if (input.notes !== undefined) { setClauses.push('notes = ?'); params.push(input.notes); }

    const updateSQL = `
      UPDATE phones SET ${setClauses.join(', ')}
      WHERE dashboard_id = ? AND id = ?;
    `;
    params.push(dashboardId, id);

    await db.prepare(updateSQL).bind(...params).run();

    const updated = await this.getPhoneById(db, dashboardId, id);
    return updated!;
  },

  /**
   * حذف آمن لهاتف من المخزن (متاح فقط للأجهزة المتوفرة التي لم يتم بيعها)
   */
  async deletePhone(db: D1Database, dashboardId: string, id: string): Promise<boolean> {
    const existing = await this.getPhoneById(db, dashboardId, id);
    if (!existing) {
      const error: any = new Error('لم يتم العثور على الهاتف المطلوب لحذفه');
      error.slug = 'PHONE_NOT_FOUND';
      throw error;
    }

    if (existing.status === 'sold' || existing.invoice_id) {
      const error: any = new Error('لا يمكن حذف جهاز تم بيعه أو مرتبط بفاتورة مبيعات، لحفظ السجل المحاسبي والجنائي للمحل');
      error.slug = 'PHONE_ALREADY_SOLD';
      throw error;
    }

    const res = await db
      .prepare('DELETE FROM phones WHERE dashboard_id = ? AND id = ?;')
      .bind(dashboardId, id)
      .run();

    return (res.meta.changes || 0) > 0;
  },

  /**
   * حجز هاتف بعربون لعميل وتوثيق استلام النقدية بالدرج
   */
  async reservePhone(
    db: D1Database,
    dashboardId: string,
    currentUser: UserSession,
    id: string,
    input: ReservePhoneInput
  ): Promise<PhoneRecord> {
    const phone = await this.getPhoneById(db, dashboardId, id);
    if (!phone) {
      const error: any = new Error('الجهاز المطلوب غير موجود');
      error.slug = 'PHONE_NOT_FOUND';
      throw error;
    }

    if (phone.status === 'sold') {
      const error: any = new Error('هذا الجهاز تم بيعه بالفعل ولا يمكن حجزه');
      error.slug = 'PHONE_ALREADY_SOLD';
      throw error;
    }

    if (phone.status === 'reserved') {
      const error: any = new Error('هذا الجهاز محجوز بالفعل لعميل آخر');
      error.slug = 'PHONE_ALREADY_RESERVED';
      throw error;
    }

    const now = new Date().toISOString();
    const deposit = Number(input.deposit_amount || 0);
    const reservationNotes = [
      phone.notes || '',
      `[حجز بعربون: ${deposit} ج.م للعميل: ${input.customer_name} (${input.customer_phone}) - بتاريخ ${now.split('T')[0]}]`,
      input.notes ? `ملاحظات: ${input.notes}` : '',
    ].filter(Boolean).join('\n');

    const updatePhoneStmt = db.prepare(`
      UPDATE phones SET
        status = 'reserved',
        reserved_at = ?,
        reserved_by = ?,
        buyer_name = ?,
        buyer_phone = ?,
        notes = ?,
        updated_at = ?,
        updated_by = ?
      WHERE dashboard_id = ? AND id = ?;
    `).bind(
      now,
      currentUser.id,
      input.customer_name,
      input.customer_phone,
      reservationNotes,
      now,
      currentUser.id,
      dashboardId,
      id
    );

    // إذا وُجد عربون نقدي وتم اختيار توريده للدرج
    if (deposit > 0 && input.collect_cash_to_drawer !== false) {
      const movementId = `cm-${crypto.randomUUID()}`;
      const desc = `عربون حجز هاتف (${phone.brand} ${phone.model} - العميل: ${input.customer_name})`;

      const insertCashStmt = db.prepare(`
        INSERT INTO cash_movements (
          id, dashboard_id, type, category, amount, description,
          cashier_profile_id, cashier_name, shift_id, created_at
        ) VALUES (?, ?, 'in', 'repair_advance', ?, ?, ?, ?, ?, ?);
      `).bind(
        movementId,
        dashboardId,
        deposit,
        desc,
        currentUser.id,
        currentUser.name || 'الموظف المسؤول',
        currentUser.active_shift?.shift_id || null,
        now
      );

      await db.batch([updatePhoneStmt, insertCashStmt]);
    } else {
      await updatePhoneStmt.run();
    }

    const updated = await this.getPhoneById(db, dashboardId, id);
    logger.info('phones-service', `[PhonesService] Phone reserved: ${phone.brand} ${phone.model} for ${input.customer_name} (Deposit: ${deposit})`);
    return updated!;
  },

  /**
   * إلغاء حجز هاتف وإعادته للأجهزة المتاحة بالمخزن (in_stock)
   */
  async cancelReservation(
    db: D1Database,
    dashboardId: string,
    currentUser: UserSession,
    id: string
  ): Promise<PhoneRecord> {
    const phone = await this.getPhoneById(db, dashboardId, id);
    if (!phone) {
      const error: any = new Error('الجهاز غير موجود');
      error.slug = 'PHONE_NOT_FOUND';
      throw error;
    }

    if (phone.status !== 'reserved') {
      const error: any = new Error('هذا الجهاز غير محجوز حالياً');
      error.slug = 'PHONE_NOT_RESERVED';
      throw error;
    }

    const now = new Date().toISOString();
    const cancelNote = `${phone.notes || ''}\n[تم إلغاء الحجز وإعادة الجهاز للمخزن بتاريخ ${now.split('T')[0]}]`;

    await db.prepare(`
      UPDATE phones SET
        status = 'in_stock',
        reserved_at = NULL,
        reserved_by = NULL,
        notes = ?,
        updated_at = ?,
        updated_by = ?
      WHERE dashboard_id = ? AND id = ?;
    `).bind(
      cancelNote,
      now,
      currentUser.id,
      dashboardId,
      id
    ).run();

    const updated = await this.getPhoneById(db, dashboardId, id);
    logger.info('phones-service', `[PhonesService] Reservation cancelled for phone: ${phone.brand} ${phone.model}`);
    return updated!;
  },

  /**
   * تنفيذ بيع هاتف وإصدار الفاتورة وتغذية درج النقدية في معاملة ذرية موحدة
   */
  async sellPhone(
    db: D1Database,
    dashboardId: string,
    currentUser: UserSession,
    id: string,
    input: SellPhoneInput
  ): Promise<PhoneRecord> {
    const phone = await this.getPhoneById(db, dashboardId, id);
    if (!phone) {
      const error: any = new Error('لم يتم العثور على الهاتف المراد بيعه');
      error.slug = 'PHONE_NOT_FOUND';
      throw error;
    }

    if (phone.status === 'sold') {
      const error: any = new Error('هذا الجهاز تم بيعه مسبقاً ولا يمكن بيعه مجدداً');
      error.slug = 'PHONE_ALREADY_SOLD';
      throw error;
    }

    const soldPrice = Number(input.sold_price);
    const minPrice = Number(phone.min_price || phone.selling_price || 0);

    // التحقق من الحد الأدنى للبيع
    if (soldPrice < minPrice) {
      const error: any = new Error(
        `سعر البيع المطلوب (${soldPrice} ج.م) أقل من الحد الأدنى المسموح به لهذا الجهاز (${minPrice} ج.م)`
      );
      error.slug = 'PRICE_BELOW_MINIMUM';
      throw error;
    }

    const now = new Date().toISOString();
    const invoiceId = input.invoice_id || `INV-${Date.now().toString().slice(-6)}`;
    const buyerName = input.buyer_name || phone.buyer_name || 'عميل نقدي';
    const buyerPhone = input.buyer_phone || phone.buyer_phone || null;

    const updatePhoneStmt = db.prepare(`
      UPDATE phones SET
        status = 'sold',
        sold_price = ?,
        sold_by = ?,
        sold_at = ?,
        buyer_name = ?,
        buyer_phone = ?,
        invoice_id = ?,
        updated_at = ?,
        updated_by = ?
      WHERE dashboard_id = ? AND id = ?;
    `).bind(
      soldPrice,
      currentUser.id,
      now,
      buyerName,
      buyerPhone,
      invoiceId,
      now,
      currentUser.id,
      dashboardId,
      id
    );

    // إذا كان السداد نقداً في درج الكاشير
    if (!input.payment_method || input.payment_method === 'cash') {
      const movementId = `cm-${crypto.randomUUID()}`;
      const desc = `بيع هاتف (${phone.brand} ${phone.model} - IMEI: ${phone.imei} - فاتورة: ${invoiceId})`;

      const insertCashStmt = db.prepare(`
        INSERT INTO cash_movements (
          id, dashboard_id, type, category, amount, description,
          cashier_profile_id, cashier_name, shift_id, created_at
        ) VALUES (?, ?, 'in', 'pos_sale', ?, ?, ?, ?, ?, ?);
      `).bind(
        movementId,
        dashboardId,
        soldPrice,
        desc,
        currentUser.id,
        currentUser.name || 'الموظف المسؤول',
        currentUser.active_shift?.shift_id || null,
        now
      );

      await db.batch([updatePhoneStmt, insertCashStmt]);
    } else {
      await updatePhoneStmt.run();
    }

    const soldRecord = await this.getPhoneById(db, dashboardId, id);
    logger.info(
      'phones-service',
      `[PhonesService] Phone sold: ${phone.brand} ${phone.model} for ${soldPrice} EGP to ${buyerName} (Invoice: ${invoiceId})`
    );
    return soldRecord!;
  },

  /**
   * جلب الهواتف المتاحة للبيع الفوري في نقطة البيع (POS)
   * يعزل البيانات حسب dashboard_id ويجلب فقط الهواتف بحالة 'in_stock'
   */
  async getForPos(
    db: D1Database,
    dashboardId: string,
    filters?: PosPhoneFilters
  ): Promise<{ data: PosPhoneItem[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
    const page = Math.max(1, Number(filters?.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(filters?.limit) || 50));
    const offset = (page - 1) * limit;

    const whereClauses: string[] = ["dashboard_id = ?", "status = 'in_stock'"];
    const params: any[] = [dashboardId];

    if (filters?.brand && filters.brand !== 'all' && filters.brand !== 'الكل') {
      whereClauses.push('brand = ?');
      params.push(filters.brand.trim());
    }

    if (filters?.condition) {
      whereClauses.push('condition = ?');
      params.push(filters.condition);
    }

    if (filters?.search && filters.search.trim()) {
      const term = `%${escapeLikePattern(filters.search.trim())}%`;
      whereClauses.push(`(
        brand LIKE ? ESCAPE '\\' OR 
        model LIKE ? ESCAPE '\\' OR 
        color LIKE ? ESCAPE '\\' OR 
        imei LIKE ? ESCAPE '\\' OR 
        imei2 LIKE ? ESCAPE '\\'
      )`);
      for (let i = 0; i < 5; i++) {
        params.push(term);
      }
    }

    const whereSQL = whereClauses.join(' AND ');

    const countSQL = `SELECT COUNT(*) as total FROM phones WHERE ${whereSQL};`;
    const countRow = await db.prepare(countSQL).bind(...params).first<{ total: number }>();
    const total = Number(countRow?.total || 0);

    const dataSQL = `
      SELECT 
        id, brand, model, color, storage, imei, imei2,
        condition, selling_price, purchase_price,
        battery_health, battery_capacity, has_box, has_charger, status
      FROM phones
      WHERE ${whereSQL}
      ORDER BY brand ASC, model ASC, created_at DESC
      LIMIT ? OFFSET ?;
    `;

    const dataParams = [...params, limit, offset];
    const { results } = await db.prepare(dataSQL).bind(...dataParams).all<any>();

    const items: PosPhoneItem[] = (results || []).map((row) => ({
      id: row.id,
      brand: row.brand,
      model: row.model,
      color: row.color,
      storage: row.storage,
      imei: row.imei,
      imei2: row.imei2 || null,
      condition: row.condition,
      selling_price: Number(row.selling_price || 0),
      purchase_price: Number(row.purchase_price || 0),
      battery_health: row.battery_health !== null && row.battery_health !== undefined ? Number(row.battery_health) : null,
      battery_capacity: row.battery_capacity !== null && row.battery_capacity !== undefined ? Number(row.battery_capacity) : null,
      has_box: Boolean(row.has_box),
      has_charger: Boolean(row.has_charger),
      status: row.status,
    }));

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
