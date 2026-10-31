/**
 * ==============================================================================
 * MobiDash Platform - Suppliers & Vendor Accounts Services
 * ==============================================================================
 * 
 * Comprehensive business logic for suppliers, wholesale distributors,
 * vendor debt tracking, ledger statements, and atomic cash drawer payments.
 * 
 * Core Guarantees:
 * 1. Strict Tenant Isolation (dashboard_id = ? on every query).
 * 2. Atomic Financial Updates (db.batch() wrapping supplier balance, transaction log, and cash movements).
 * 3. Historical Data Integrity: Soft-archives (status = 'archived') if ledger history exists.
 * 4. Prepared Statements Only: Zero string interpolation in SQL.
 */

import { D1Database } from '@cloudflare/workers-types';
import {
  Supplier,
  SupplierTransaction,
  CreateSupplierInput,
  UpdateSupplierInput,
  PaySupplierInput,
  SupplierFilterQuery,
  SupplierStats,
  UserSession,
} from '../types';
import { getPaginationOptions, PaginatedResult } from '../utils/pagination';
import { escapeLikePattern } from '../utils/sanitize';

export const SuppliersService = {
  /**
   * Retrieves a paginated list of suppliers with flexible filtering and search.
   */
  async getSuppliers(
    db: D1Database,
    dashboardId: string,
    query: SupplierFilterQuery
  ): Promise<PaginatedResult<Supplier>> {
    const { page, limit } = getPaginationOptions(
      query.page ? String(query.page) : undefined,
      query.limit ? String(query.limit) : undefined,
      20
    );
    const offset = (page - 1) * limit;

    const filterClauses: string[] = ['dashboard_id = ?'];
    const params: any[] = [dashboardId];

    // Status filter
    if (query.status && query.status !== 'all') {
      filterClauses.push('status = ?');
      params.push(query.status);
    } else {
      // By default, exclude archived suppliers unless explicitly requested
      filterClauses.push("status != 'archived'");
    }

    // Category filter
    if (query.category && query.category !== 'all') {
      if (query.category === 'إكسسوارات' || query.category === 'إكسسوار') {
        filterClauses.push("(category = 'إكسسوار' OR category = 'إكسسوارات')");
      } else {
        filterClauses.push('category = ?');
        params.push(query.category);
      }
    }

    // Balance filter (due vs cleared)
    if (query.balance_filter === 'due') {
      filterClauses.push('balance_due > 0');
    } else if (query.balance_filter === 'cleared') {
      filterClauses.push('balance_due <= 0');
    }

    // Search filter (company_name, name, phone)
    if (query.search && query.search.trim()) {
      filterClauses.push(
        `(company_name LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\')`
      );
      const pattern = `%${escapeLikePattern(query.search.trim())}%`;
      params.push(pattern, pattern, pattern);
    }

    const whereClause = filterClauses.join(' AND ');

    // Safe sorting column
    let orderColumn = 'created_at';
    if (query.sort_by === 'company_name') orderColumn = 'company_name';
    if (query.sort_by === 'balance_due') orderColumn = 'balance_due';
    const orderDirection = query.sort_order === 'asc' ? 'ASC' : 'DESC';

    // Total count query
    const countSql = `SELECT COUNT(*) as total FROM suppliers WHERE ${whereClause}`;
    const countResult = await db.prepare(countSql).bind(...params).first<{ total: number }>();
    const total = countResult?.total || 0;

    // Data query
    const dataSql = `
      SELECT * FROM suppliers 
      WHERE ${whereClause} 
      ORDER BY ${orderColumn} ${orderDirection} 
      LIMIT ? OFFSET ?
    `;
    const dataResult = await db.prepare(dataSql).bind(...params, limit, offset).all<Supplier>();
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
   * Retrieves single supplier details by ID.
   */
  async getSupplierById(
    db: D1Database,
    dashboardId: string,
    id: string
  ): Promise<Supplier | null> {
    return await db.prepare(`
      SELECT * FROM suppliers 
      WHERE dashboard_id = ? AND id = ? 
      LIMIT 1
    `).bind(dashboardId, id).first<Supplier>();
  },

  /**
   * Retrieves aggregated KPI metrics for all suppliers.
   */
  async getSupplierStats(
    db: D1Database,
    dashboardId: string
  ): Promise<SupplierStats> {
    const stats = await db.prepare(`
      SELECT 
        COUNT(*) as total_suppliers_count,
        COALESCE(SUM(balance_due), 0) as total_balance_due,
        COUNT(CASE WHEN balance_due > 0 THEN 1 END) as due_suppliers_count,
        COUNT(CASE WHEN balance_due <= 0 THEN 1 END) as cleared_suppliers_count,
        COUNT(CASE WHEN category IN ('هواتف', 'إكسسوار', 'إكسسوارات') THEN 1 END) as devices_suppliers_count,
        COUNT(CASE WHEN category = 'قطع غيار' THEN 1 END) as spare_parts_suppliers_count
      FROM suppliers 
      WHERE dashboard_id = ? AND status != 'archived'
    `).bind(dashboardId).first<{
      total_suppliers_count: number;
      total_balance_due: number;
      due_suppliers_count: number;
      cleared_suppliers_count: number;
      devices_suppliers_count: number;
      spare_parts_suppliers_count: number;
    }>();

    return {
      total_suppliers_count: stats?.total_suppliers_count || 0,
      total_balance_due: Number(stats?.total_balance_due || 0),
      due_suppliers_count: stats?.due_suppliers_count || 0,
      cleared_suppliers_count: stats?.cleared_suppliers_count || 0,
      devices_suppliers_count: stats?.devices_suppliers_count || 0,
      spare_parts_suppliers_count: stats?.spare_parts_suppliers_count || 0,
    };
  },

  /**
   * Creates a new supplier. If opening balance is specified, creates the opening balance ledger entry.
   */
  async createSupplier(
    db: D1Database,
    dashboardId: string,
    input: CreateSupplierInput,
    user: UserSession
  ): Promise<Supplier> {
    const id = `sup-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const balanceDue = Number(input.balance_due || 0);
    const userId = user.id;

    const insertSupplierStmt = db.prepare(`
      INSERT INTO suppliers (
        id, dashboard_id, name, company_name, phone, address,
        category, balance_due, last_supply_date, status, notes,
        created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
    `).bind(
      id,
      dashboardId,
      input.name,
      input.company_name,
      input.phone,
      input.address || null,
      input.category,
      balanceDue,
      balanceDue > 0 ? now : null,
      input.notes || null,
      userId,
      userId,
      now,
      now
    );

    if (balanceDue > 0) {
      // Create initial opening balance transaction in ledger
      const txId = `stx-${crypto.randomUUID()}`;
      const insertTxStmt = db.prepare(`
        INSERT INTO supplier_transactions (
          id, dashboard_id, supplier_id, type, amount,
          payment_source, receipt_number, notes, created_at
        ) VALUES (?, ?, ?, 'supply_bill', ?, NULL, NULL, 'رصيد افتتاحي عند إنشاء حساب المورد', ?)
      `).bind(txId, dashboardId, id, balanceDue, now);

      await db.batch([insertSupplierStmt, insertTxStmt]);
    } else {
      await insertSupplierStmt.run();
    }

    const created = await this.getSupplierById(db, dashboardId, id);
    if (!created) {
      throw new Error('FAILED_TO_CREATE_SUPPLIER');
    }
    return created;
  },

  /**
   * Updates an existing supplier's details.
   */
  async updateSupplier(
    db: D1Database,
    dashboardId: string,
    id: string,
    input: UpdateSupplierInput,
    user: UserSession
  ): Promise<Supplier | { error: string; message: string; status: number }> {
    const existing = await this.getSupplierById(db, dashboardId, id);
    if (!existing) {
      return { error: 'SUPPLIER_NOT_FOUND', message: 'المورد المطلوب غير موجود', status: 404 };
    }

    const updates: string[] = ['updated_by = ?', 'updated_at = CURRENT_TIMESTAMP'];
    const params: any[] = [user.id];

    if (input.name !== undefined) {
      updates.push('name = ?');
      params.push(input.name);
    }
    if (input.company_name !== undefined) {
      updates.push('company_name = ?');
      params.push(input.company_name);
    }
    if (input.phone !== undefined) {
      updates.push('phone = ?');
      params.push(input.phone);
    }
    if (input.category !== undefined) {
      updates.push('category = ?');
      params.push(input.category);
    }
    if (input.address !== undefined) {
      updates.push('address = ?');
      params.push(input.address);
    }
    if (input.status !== undefined) {
      updates.push('status = ?');
      params.push(input.status);
    }
    if (input.notes !== undefined) {
      updates.push('notes = ?');
      params.push(input.notes);
    }

    params.push(dashboardId, id);

    await db.prepare(`
      UPDATE suppliers 
      SET ${updates.join(', ')} 
      WHERE dashboard_id = ? AND id = ?
    `).bind(...params).run();

    const updated = await this.getSupplierById(db, dashboardId, id);
    return updated!;
  },

  /**
   * Deletes or archives a supplier based on financial history.
   */
  async deleteSupplier(
    db: D1Database,
    dashboardId: string,
    id: string,
    force: boolean = false
  ): Promise<
    | { success: true; action: 'deleted' | 'archived'; message: string }
    | { error: string; message: string; status: number }
  > {
    const existing = await this.getSupplierById(db, dashboardId, id);
    if (!existing) {
      return { error: 'SUPPLIER_NOT_FOUND', message: 'المورد المطلوب غير موجود', status: 404 };
    }

    // Check if supplier has transaction history
    const txCountResult = await db.prepare(`
      SELECT COUNT(*) as count 
      FROM supplier_transactions 
      WHERE dashboard_id = ? AND supplier_id = ?
    `).bind(dashboardId, id).first<{ count: number }>();
    const txCount = txCountResult?.count || 0;

    if ((txCount > 0 || existing.balance_due > 0) && !force) {
      // Soft-delete: archive to preserve historical bookkeeping and balance trail
      await db.prepare(`
        UPDATE suppliers 
        SET status = 'archived', updated_at = CURRENT_TIMESTAMP 
        WHERE dashboard_id = ? AND id = ?
      `).bind(dashboardId, id).run();

      return {
        success: true,
        action: 'archived',
        message: 'تم أرشفة حساب المورد بنجاح لحماية سجل الفواتير والدفعات المحاسبية',
      };
    }

    // Hard delete when no transactions exist or when force=true
    await db.prepare(`
      DELETE FROM suppliers 
      WHERE dashboard_id = ? AND id = ?
    `).bind(dashboardId, id).run();

    return {
      success: true,
      action: 'deleted',
      message: 'تم حذف المورد نهائياً من النظام بنجاح',
    };
  },

  /**
   * Records a supplier debt payment atomically, updating balance and cash drawer sync.
   */
  async paySupplier(
    db: D1Database,
    dashboardId: string,
    supplierId: string,
    input: PaySupplierInput,
    user: UserSession,
    activeShift?: any
  ): Promise<
    | { transaction: SupplierTransaction; new_balance: number; supplier_name: string }
    | { error: string; message: string; status: number }
  > {
    const supplier = await this.getSupplierById(db, dashboardId, supplierId);
    if (!supplier) {
      return { error: 'SUPPLIER_NOT_FOUND', message: 'المورد المطلوب غير موجود', status: 404 };
    }

    const amount = Number(input.amount);
    if (amount <= 0) {
      return { error: 'INVALID_AMOUNT', message: 'يجب أن يكون مبلغ الدفعة أكبر من الصفر', status: 400 };
    }

    const txId = `stx-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const shiftId = activeShift?.shift_id || null;
    const cashierId = user.id;
    const cashierName = user.name || 'كاشير';

    let cashMovementId: string | null = null;
    const statements: any[] = [];

    // 1. If paid from cash drawer, create cash drawer withdrawal movement
    if (input.payment_source === 'cash_drawer') {
      cashMovementId = `cm-${crypto.randomUUID()}`;
      const description = `سداد دفعة للمورد: ${supplier.company_name} (${supplier.name})`;
      statements.push(
        db.prepare(`
          INSERT INTO cash_movements (
            id, dashboard_id, type, category, amount, description,
            cashier_profile_id, cashier_name, shift_id, created_at
          ) VALUES (?, ?, 'out', 'supplier_payment', ?, ?, ?, ?, ?, ?)
        `).bind(
          cashMovementId,
          dashboardId,
          amount,
          description,
          cashierId,
          cashierName,
          shiftId,
          now
        )
      );
    }

    // 2. Atomic reduction of supplier debt
    statements.push(
      db.prepare(`
        UPDATE suppliers 
        SET balance_due = balance_due - ?, updated_at = ? 
        WHERE dashboard_id = ? AND id = ?
      `).bind(amount, now, dashboardId, supplierId)
    );

    // 3. Record transaction in supplier ledger
    statements.push(
      db.prepare(`
        INSERT INTO supplier_transactions (
          id, dashboard_id, supplier_id, type, amount,
          payment_source, receipt_number, notes, shift_id,
          cashier_profile_id, cashier_name, cash_movement_id, created_at
        ) VALUES (?, ?, ?, 'payment', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        txId,
        dashboardId,
        supplierId,
        amount,
        input.payment_source,
        input.receipt_number || null,
        input.notes || null,
        shiftId,
        cashierId,
        cashierName,
        cashMovementId,
        now
      )
    );

    // Execute atomic batch
    await db.batch(statements);

    // Fetch updated balance and transaction
    const updatedSupplier = await this.getSupplierById(db, dashboardId, supplierId);
    const transaction = await db.prepare(`
      SELECT * FROM supplier_transactions 
      WHERE dashboard_id = ? AND id = ? 
      LIMIT 1
    `).bind(dashboardId, txId).first<SupplierTransaction>();

    return {
      transaction: transaction!,
      new_balance: updatedSupplier?.balance_due ?? (supplier.balance_due - amount),
      supplier_name: supplier.company_name,
    };
  },

  /**
   * Retrieves paginated transaction history / statement for a specific supplier.
   */
  async getSupplierTransactions(
    db: D1Database,
    dashboardId: string,
    supplierId: string,
    pageQuery?: number,
    limitQuery?: number
  ): Promise<PaginatedResult<SupplierTransaction> | { error: string; message: string; status: number }> {
    const supplier = await this.getSupplierById(db, dashboardId, supplierId);
    if (!supplier) {
      return { error: 'SUPPLIER_NOT_FOUND', message: 'المورد المطلوب غير موجود', status: 404 };
    }

    const { page, limit } = getPaginationOptions(
      pageQuery ? String(pageQuery) : undefined,
      limitQuery ? String(limitQuery) : undefined,
      20
    );
    const offset = (page - 1) * limit;

    const countResult = await db.prepare(`
      SELECT COUNT(*) as total 
      FROM supplier_transactions 
      WHERE dashboard_id = ? AND supplier_id = ?
    `).bind(dashboardId, supplierId).first<{ total: number }>();
    const total = countResult?.total || 0;

    const dataResult = await db.prepare(`
      SELECT * FROM supplier_transactions 
      WHERE dashboard_id = ? AND supplier_id = ? 
      ORDER BY created_at DESC 
      LIMIT ? OFFSET ?
    `).bind(dashboardId, supplierId, limit, offset).all<SupplierTransaction>();
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
};
