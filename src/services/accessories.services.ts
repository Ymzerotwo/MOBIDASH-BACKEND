/**
 * ==============================================================================
 * MobiDash Platform - Accessories & Chargers Inventory Services
 * ==============================================================================
 * 
 * Business logic for phone accessories, chargers, cases, screen protectors,
 * barcode scanning/checking, stock audit trails, and atomic inventory movements.
 * 
 * Core Guarantees:
 * 1. Strict Tenant Isolation (dashboard_id = ? on every query).
 * 2. Dedicated Barcode Availability Checker (checkBarcodeAvailability).
 * 3. Atomic Stock Mutations (db.batch() wrapping stock updates and movements).
 * 4. Prepared Statements Only: Zero string interpolation in SQL.
 */

import { D1Database } from '@cloudflare/workers-types';
import {
  Accessory,
  AccessoryStockMovement,
  AccessoryStats,
  BarcodeCheckResult,
  CreateAccessoryInput,
  UpdateAccessoryInput,
  AdjustStockInput,
  AccessoryFilterQuery,
  UserSession,
} from '../types';
import { getPaginationOptions, PaginatedResult } from '../utils/pagination';
import { escapeLikePattern } from '../utils/sanitize';

export const AccessoriesService = {
  /**
   * Dedicated Barcode Checker:
   * Verifies whether a barcode is already used within the store (dashboard_id).
   * Supports excludeId when updating an existing item.
   */
  async checkBarcodeAvailability(
    db: D1Database,
    dashboardId: string,
    barcode: string,
    excludeId?: string
  ): Promise<BarcodeCheckResult> {
    const trimmed = barcode.trim();
    if (!trimmed) {
      return {
        exists: false,
        is_available: true,
        message: 'الباركود متاح للاستخدام',
      };
    }

    const query = excludeId
      ? `SELECT id, name, category, brand, barcode FROM accessories WHERE dashboard_id = ? AND barcode = ? AND id != ? LIMIT 1`
      : `SELECT id, name, category, brand, barcode FROM accessories WHERE dashboard_id = ? AND barcode = ? LIMIT 1`;

    const params = excludeId ? [dashboardId, trimmed, excludeId] : [dashboardId, trimmed];
    const existing = await db.prepare(query).bind(...params).first<{
      id: string;
      name: string;
      category: string;
      brand: string;
      barcode: string;
    }>();

    if (existing) {
      return {
        exists: true,
        is_available: false,
        message: `الباركود مستخدم بالفعل مع صنف آخر: (${existing.name} - ${existing.brand})`,
        existing_accessory: existing,
      };
    }

    return {
      exists: false,
      is_available: true,
      message: 'الباركود متاح ولم يتم استخدامه من قبل في المتجر',
    };
  },

  /**
   * Retrieves single accessory details by Barcode (for POS barcode scanners).
   */
  async getAccessoryByBarcode(
    db: D1Database,
    dashboardId: string,
    barcode: string
  ): Promise<Accessory | null> {
    return await db.prepare(`
      SELECT 
        a.*,
        u_creator.name AS created_by_name,
        u_updater.name AS updated_by_name,
        s.name AS supplier_name
      FROM accessories a
      LEFT JOIN Users u_creator ON a.created_by = u_creator.id
      LEFT JOIN Users u_updater ON a.updated_by = u_updater.id
      LEFT JOIN suppliers s ON a.supplier_id = s.id
      WHERE a.dashboard_id = ? AND a.barcode = ? AND a.status != 'archived'
      LIMIT 1
    `).bind(dashboardId, barcode.trim()).first<Accessory>();
  },

  /**
   * Retrieves single accessory details by ID.
   */
  async getAccessoryById(
    db: D1Database,
    dashboardId: string,
    id: string
  ): Promise<Accessory | null> {
    return await db.prepare(`
      SELECT 
        a.*,
        u_creator.name AS created_by_name,
        u_updater.name AS updated_by_name,
        s.name AS supplier_name
      FROM accessories a
      LEFT JOIN Users u_creator ON a.created_by = u_creator.id
      LEFT JOIN Users u_updater ON a.updated_by = u_updater.id
      LEFT JOIN suppliers s ON a.supplier_id = s.id
      WHERE a.dashboard_id = ? AND a.id = ? 
      LIMIT 1
    `).bind(dashboardId, id).first<Accessory>();
  },

  /**
   * Retrieves aggregated KPI analytics for accessories.
   */
  async getAccessoryStats(
    db: D1Database,
    dashboardId: string,
    category?: string
  ): Promise<AccessoryStats> {
    const whereClauses: string[] = ['dashboard_id = ?', "status != 'archived'"];
    const params: any[] = [dashboardId];

    if (category && category.trim() && category !== 'all') {
      whereClauses.push('category = ?');
      params.push(category.trim());
    }

    const whereSql = whereClauses.join(' AND ');

    const stats = await db.prepare(`
      SELECT 
        COUNT(*) as total_items_count,
        COALESCE(SUM(stock), 0) as total_stock_quantity,
        COALESCE(SUM(stock * cost_price), 0) as total_cost_valuation,
        COALESCE(SUM(stock * retail_price), 0) as total_retail_valuation,
        COUNT(CASE WHEN stock <= min_stock_alert AND stock > 0 THEN 1 END) as low_stock_items_count,
        COUNT(CASE WHEN stock <= 0 THEN 1 END) as out_of_stock_items_count
      FROM accessories 
      WHERE ${whereSql}
    `).bind(...params).first<{
      total_items_count: number;
      total_stock_quantity: number;
      total_cost_valuation: number;
      total_retail_valuation: number;
      low_stock_items_count: number;
      out_of_stock_items_count: number;
    }>();

    return {
      total_items_count: stats?.total_items_count || 0,
      total_stock_quantity: stats?.total_stock_quantity || 0,
      total_cost_valuation: Number(stats?.total_cost_valuation || 0),
      total_retail_valuation: Number(stats?.total_retail_valuation || 0),
      low_stock_items_count: stats?.low_stock_items_count || 0,
      out_of_stock_items_count: stats?.out_of_stock_items_count || 0,
    };
  },

  /**
   * Retrieves a paginated list of accessories with flexible filtering and search.
   */
  async getAccessories(
    db: D1Database,
    dashboardId: string,
    query: AccessoryFilterQuery
  ): Promise<PaginatedResult<Accessory>> {
    const { page, limit } = getPaginationOptions(
      query.page ? String(query.page) : undefined,
      query.limit ? String(query.limit) : undefined,
      20
    );
    const offset = (page - 1) * limit;

    const filterClauses: string[] = ['a.dashboard_id = ?'];
    const params: any[] = [dashboardId];

    // Status filter
    if (query.status && query.status !== 'all') {
      filterClauses.push('a.status = ?');
      params.push(query.status);
    } else {
      filterClauses.push("a.status != 'archived'");
    }

    // Category filter
    if (query.category && query.category !== 'all') {
      filterClauses.push('a.category = ?');
      params.push(query.category);
    }

    // Brand filter
    if (query.brand && query.brand !== 'all') {
      filterClauses.push('a.brand = ?');
      params.push(query.brand);
    }

    // Stock filter (all, low, available, out_of_stock)
    if (query.stock_filter === 'low') {
      filterClauses.push('a.stock <= a.min_stock_alert AND a.stock > 0');
    } else if (query.stock_filter === 'available') {
      filterClauses.push('a.stock > 0');
    } else if (query.stock_filter === 'out_of_stock') {
      filterClauses.push('a.stock <= 0');
    }

    // Search filter (name, barcode, brand, compatibility)
    if (query.search && query.search.trim()) {
      filterClauses.push(
        `(a.name LIKE ? ESCAPE '\\' OR a.barcode LIKE ? ESCAPE '\\' OR a.brand LIKE ? ESCAPE '\\' OR a.compatibility LIKE ? ESCAPE '\\')`
      );
      const pattern = `%${escapeLikePattern(query.search.trim())}%`;
      params.push(pattern, pattern, pattern, pattern);
    }

    const whereClause = filterClauses.join(' AND ');

    // Safe sorting column
    let orderColumn = 'a.created_at';
    if (query.sort_by === 'name') orderColumn = 'a.name';
    if (query.sort_by === 'stock') orderColumn = 'a.stock';
    if (query.sort_by === 'retail_price') orderColumn = 'a.retail_price';
    const orderDirection = query.sort_order === 'asc' ? 'ASC' : 'DESC';

    // Total count query
    const countSql = `SELECT COUNT(*) as total FROM accessories a WHERE ${whereClause}`;
    const countResult = await db.prepare(countSql).bind(...params).first<{ total: number }>();
    const total = countResult?.total || 0;

    // Data query with User and Supplier Names joined
    const dataSql = `
      SELECT 
        a.*,
        u_creator.name AS created_by_name,
        u_updater.name AS updated_by_name,
        s.name AS supplier_name
      FROM accessories a
      LEFT JOIN Users u_creator ON a.created_by = u_creator.id
      LEFT JOIN Users u_updater ON a.updated_by = u_updater.id
      LEFT JOIN suppliers s ON a.supplier_id = s.id
      WHERE ${whereClause} 
      ORDER BY ${orderColumn} ${orderDirection} 
      LIMIT ? OFFSET ?
    `;
    const dataResult = await db.prepare(dataSql).bind(...params, limit, offset).all<Accessory>();
    const data = dataResult.results || [];

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  },

  /**
   * Creates a new accessory. If initial stock > 0, atomically inserts an initial movement record.
   */
  async createAccessory(
    db: D1Database,
    dashboardId: string,
    input: CreateAccessoryInput,
    user: UserSession
  ): Promise<Accessory | { error: string; message: string; status: number }> {
    // 1. Verify barcode availability if supplied
    if (input.barcode && input.barcode.trim()) {
      const barcodeCheck = await this.checkBarcodeAvailability(db, dashboardId, input.barcode.trim());
      if (barcodeCheck.exists) {
        return {
          error: 'BARCODE_ALREADY_EXISTS',
          message: barcodeCheck.message,
          status: 409,
        };
      }
    }

    const id = `acc-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const dateAdded = input.date_added || now.split('T')[0];
    const stock = Number(input.stock || 0);
    const costPrice = Number(input.cost_price || 0);
    const retailPrice = Number(input.retail_price || 0);
    const wholesalePrice = input.wholesale_price !== undefined && input.wholesale_price !== null ? Number(input.wholesale_price) : null;
    const minStockAlert = Number(input.min_stock_alert !== undefined ? input.min_stock_alert : 3);
    const barcode = input.barcode?.trim() || null;
    const userId = user.id;

    const insertAccessoryStmt = db.prepare(`
      INSERT INTO accessories (
        id, dashboard_id, name, category, brand, barcode,
        cost_price, retail_price, wholesale_price, stock,
        min_stock_alert, compatibility, location, date_added,
        status, supplier_id, notes, created_by, updated_by,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      dashboardId,
      input.name.trim(),
      input.category,
      input.brand?.trim() || 'عام',
      barcode,
      costPrice,
      retailPrice,
      wholesalePrice,
      stock,
      minStockAlert,
      input.compatibility || null,
      input.location || null,
      dateAdded,
      input.supplier_id || null,
      input.notes || null,
      userId,
      userId,
      now,
      now
    );

    // If opening stock is greater than 0, record initial stock movement atomically
    if (stock > 0) {
      const movementId = `asm-${crypto.randomUUID()}`;
      const insertMovementStmt = db.prepare(`
        INSERT INTO accessory_stock_movements (
          id, dashboard_id, accessory_id, type, quantity_change,
          previous_stock, new_stock, cost_price, unit_price,
          supplier_id, created_by, notes, created_at
        ) VALUES (?, ?, ?, 'initial', ?, 0, ?, ?, ?, ?, ?, 'رصيد افتتاحي عند إدخال الصنف', ?)
      `).bind(
        movementId,
        dashboardId,
        id,
        stock,
        stock,
        costPrice,
        retailPrice,
        input.supplier_id || null,
        userId,
        now
      );

      await db.batch([insertAccessoryStmt, insertMovementStmt]);
    } else {
      await insertAccessoryStmt.run();
    }

    const created = await this.getAccessoryById(db, dashboardId, id);
    return created!;
  },

  /**
   * Updates an existing accessory.
   */
  async updateAccessory(
    db: D1Database,
    dashboardId: string,
    id: string,
    input: UpdateAccessoryInput,
    user: UserSession
  ): Promise<Accessory | { error: string; message: string; status: number }> {
    const existing = await this.getAccessoryById(db, dashboardId, id);
    if (!existing) {
      return { error: 'ACCESSORY_NOT_FOUND', message: 'صنف الإكسسوار غير موجود', status: 404 };
    }

    // Verify barcode uniqueness if being updated to a new value
    if (input.barcode !== undefined && input.barcode !== null && input.barcode.trim()) {
      const barcodeCheck = await this.checkBarcodeAvailability(db, dashboardId, input.barcode.trim(), id);
      if (barcodeCheck.exists) {
        return {
          error: 'BARCODE_ALREADY_EXISTS',
          message: barcodeCheck.message,
          status: 409,
        };
      }
    }

    const updateFields: string[] = ['updated_at = ?', 'updated_by = ?'];
    const now = new Date().toISOString();
    const params: any[] = [now, user.id];

    if (input.name !== undefined) {
      updateFields.push('name = ?');
      params.push(input.name.trim());
    }
    if (input.category !== undefined) {
      updateFields.push('category = ?');
      params.push(input.category);
    }
    if (input.brand !== undefined) {
      updateFields.push('brand = ?');
      params.push(input.brand.trim());
    }
    if (input.barcode !== undefined) {
      updateFields.push('barcode = ?');
      params.push(input.barcode?.trim() || null);
    }
    if (input.cost_price !== undefined) {
      updateFields.push('cost_price = ?');
      params.push(Number(input.cost_price));
    }
    if (input.retail_price !== undefined) {
      updateFields.push('retail_price = ?');
      params.push(Number(input.retail_price));
    }
    if (input.wholesale_price !== undefined) {
      updateFields.push('wholesale_price = ?');
      params.push(input.wholesale_price !== null ? Number(input.wholesale_price) : null);
    }
    if (input.min_stock_alert !== undefined) {
      updateFields.push('min_stock_alert = ?');
      params.push(Number(input.min_stock_alert));
    }
    if (input.compatibility !== undefined) {
      updateFields.push('compatibility = ?');
      params.push(input.compatibility?.trim() || null);
    }
    if (input.location !== undefined) {
      updateFields.push('location = ?');
      params.push(input.location?.trim() || null);
    }
    if (input.status !== undefined) {
      updateFields.push('status = ?');
      params.push(input.status);
    }
    if (input.supplier_id !== undefined) {
      updateFields.push('supplier_id = ?');
      params.push(input.supplier_id?.trim() || null);
    }
    if (input.notes !== undefined) {
      updateFields.push('notes = ?');
      params.push(input.notes?.trim() || null);
    }

    params.push(dashboardId, id);
    const sql = `UPDATE accessories SET ${updateFields.join(', ')} WHERE dashboard_id = ? AND id = ?`;
    await db.prepare(sql).bind(...params).run();

    return (await this.getAccessoryById(db, dashboardId, id))!;
  },

  /**
   * Adjusts stock quantity atomically with an audit log in accessory_stock_movements.
   */
  async adjustStock(
    db: D1Database,
    dashboardId: string,
    id: string,
    input: AdjustStockInput,
    user: UserSession,
    shiftId?: string | null
  ): Promise<{ accessory: Accessory; movement: AccessoryStockMovement } | { error: string; message: string; status: number }> {
    const accessory = await this.getAccessoryById(db, dashboardId, id);
    if (!accessory) {
      return { error: 'ACCESSORY_NOT_FOUND', message: 'صنف الإكسسوار غير موجود', status: 404 };
    }

    const previousStock = accessory.stock;
    const quantityChange = Number(input.quantity_change);
    const newStock = previousStock + quantityChange;

    if (newStock < 0) {
      return {
        error: 'INSUFFICIENT_STOCK',
        message: `الكمية المتاحة حالياً (${previousStock}) غير كافية لخصم (${Math.abs(quantityChange)}) قطعة`,
        status: 400,
      };
    }

    const movementId = `asm-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const costPrice = input.cost_price !== undefined && input.cost_price !== null ? Number(input.cost_price) : accessory.cost_price;

    const updateStockStmt = db.prepare(`
      UPDATE accessories 
      SET stock = ?, updated_by = ?, updated_at = ? 
      WHERE dashboard_id = ? AND id = ?
    `).bind(newStock, user.id, now, dashboardId, id);

    const insertMovementStmt = db.prepare(`
      INSERT INTO accessory_stock_movements (
        id, dashboard_id, accessory_id, type, quantity_change,
        previous_stock, new_stock, cost_price, unit_price,
        supplier_id, shift_id, created_by, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      movementId,
      dashboardId,
      id,
      input.type,
      quantityChange,
      previousStock,
      newStock,
      costPrice,
      accessory.retail_price,
      input.supplier_id || accessory.supplier_id || null,
      shiftId || null,
      user.id,
      input.notes?.trim() || null,
      now
    );

    await db.batch([updateStockStmt, insertMovementStmt]);

    const updatedAccessory = (await this.getAccessoryById(db, dashboardId, id))!;
    const movement = await db.prepare(`
      SELECT * FROM accessory_stock_movements 
      WHERE dashboard_id = ? AND id = ?
      LIMIT 1
    `).bind(dashboardId, movementId).first<AccessoryStockMovement>();

    return {
      accessory: updatedAccessory,
      movement: movement!,
    };
  },

  /**
   * Deletes or archives an accessory safely.
   */
  async deleteAccessory(
    db: D1Database,
    dashboardId: string,
    id: string,
    force: boolean = false
  ): Promise<{ action: 'archived' | 'deleted'; message: string } | { error: string; message: string; status: number }> {
    const accessory = await this.getAccessoryById(db, dashboardId, id);
    if (!accessory) {
      return { error: 'ACCESSORY_NOT_FOUND', message: 'صنف الإكسسوار غير موجود', status: 404 };
    }

    // Check if there are existing stock movements
    const movementsCount = await db.prepare(`
      SELECT COUNT(*) as total FROM accessory_stock_movements 
      WHERE dashboard_id = ? AND accessory_id = ?
    `).bind(dashboardId, id).first<{ total: number }>();

    const hasHistory = (movementsCount?.total || 0) > 0;

    if (hasHistory && !force) {
      // Soft-archive to preserve inventory audit history
      await db.prepare(`
        UPDATE accessories 
        SET status = 'archived', updated_at = ? 
        WHERE dashboard_id = ? AND id = ?
      `).bind(new Date().toISOString(), dashboardId, id).run();

      return {
        action: 'archived',
        message: 'تم أرشفة صنف الإكسسوار بنجاح لوجود حركات مخزنية سابقة مرتبطة به',
      };
    }

    // Hard-delete if clean or force requested
    await db.prepare(`
      DELETE FROM accessories 
      WHERE dashboard_id = ? AND id = ?
    `).bind(dashboardId, id).run();

    return {
      action: 'deleted',
      message: 'تم حذف صنف الإكسسوار نهائياً بنجاح',
    };
  },

  /**
   * Retrieves paginated stock movements for an accessory.
   */
  async getAccessoryMovements(
    db: D1Database,
    dashboardId: string,
    accessoryId: string,
    pageQuery?: number,
    limitQuery?: number
  ): Promise<PaginatedResult<AccessoryStockMovement> | { error: string; message: string; status: number }> {
    const accessory = await this.getAccessoryById(db, dashboardId, accessoryId);
    if (!accessory) {
      return { error: 'ACCESSORY_NOT_FOUND', message: 'صنف الإكسسوار المطلوب غير موجود', status: 404 };
    }

    const { page, limit } = getPaginationOptions(
      pageQuery ? String(pageQuery) : undefined,
      limitQuery ? String(limitQuery) : undefined,
      20
    );
    const offset = (page - 1) * limit;

    const countResult = await db.prepare(`
      SELECT COUNT(*) as total 
      FROM accessory_stock_movements 
      WHERE dashboard_id = ? AND accessory_id = ?
    `).bind(dashboardId, accessoryId).first<{ total: number }>();
    const total = countResult?.total || 0;

    const dataResult = await db.prepare(`
      SELECT 
        asm.*,
        u.name AS created_by_name,
        s.name AS supplier_name
      FROM accessory_stock_movements asm
      LEFT JOIN Users u ON asm.created_by = u.id
      LEFT JOIN suppliers s ON asm.supplier_id = s.id
      WHERE asm.dashboard_id = ? AND asm.accessory_id = ? 
      ORDER BY asm.created_at DESC 
      LIMIT ? OFFSET ?
    `).bind(dashboardId, accessoryId, limit, offset).all<AccessoryStockMovement>();

    return {
      data: dataResult.results || [],
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  },

  /**
   * Dedicated POS Catalog Fetcher:
   * Retrieves active accessories optimized for fast cashier POS operations.
   * Supports filtering by category (e.g. Chargers, Cases, etc.) and search.
   */
  async getForPos(
    db: D1Database,
    dashboardId: string,
    filters?: { category?: string; search?: string; page?: number; limit?: number }
  ): Promise<{ data: any[]; pagination: any }> {
    const page = Math.max(1, Number(filters?.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(filters?.limit) || 50));
    const offset = (page - 1) * limit;

    let query = `
      SELECT id, name, barcode, category, brand, retail_price, cost_price, stock, compatibility, location
      FROM accessories
      WHERE dashboard_id = ? AND status = 'active'
    `;
    const params: any[] = [dashboardId];

    if (filters?.category && filters.category !== 'all' && filters.category !== 'الكل' && filters.category !== 'كل الإكسسوارات') {
      query += ` AND category = ?`;
      params.push(filters.category);
    }

    if (filters?.search && filters.search.trim()) {
      const escaped = escapeLikePattern(filters.search.trim());
      query += ` AND (name LIKE ? OR barcode LIKE ? OR compatibility LIKE ?)`;
      params.push(`%${escaped}%`, `%${escaped}%`, `%${escaped}%`);
    }

    const countSql = query.replace(
      `SELECT id, name, barcode, category, brand, retail_price, cost_price, stock, compatibility, location`,
      `SELECT COUNT(*) as total`
    );
    const countResult = await db.prepare(countSql).bind(...params).first<{ total: number }>();
    const total = countResult?.total || 0;

    query += ` ORDER BY (CASE WHEN stock > 0 THEN 0 ELSE 1 END), name ASC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const dataResult = await db.prepare(query).bind(...params).all();

    return {
      data: dataResult.results || [],
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  },
};
