/**
 * ==============================================================================
 * MobiDash Platform - Customer Credits & Ledger Services
 * ==============================================================================
 * 
 * Comprehensive business logic for customer credit accounts (دفتر النوتة / الشكك),
 * debt collections, credit limits, transaction ledger statements, and cash drawer sync.
 * 
 * Core Guarantees:
 * 1. Strict Tenant Isolation (dashboard_id = ? on every query).
 * 2. Atomic Financial Updates (db.batch() wrapping credit balance, transactions, and cash movements).
 * 3. Human Mistake Protection: Overpayment rejected (OVERPAYMENT_NOT_ALLOWED).
 * 4. Active Debt Protection: Cannot delete customer with outstanding balance (CUSTOMER_HAS_ACTIVE_DEBT).
 * 5. Historical Audit Trail: Soft-archives (status = 'archived') if ledger history exists.
 * 6. Prepared Statements Only: Zero string interpolation in SQL.
 */

import { D1Database } from '@cloudflare/workers-types';
import {
  CustomerCredit,
  CustomerCreditTransaction,
  CustomerCreditStats,
  CreateCustomerCreditInput,
  UpdateCustomerCreditInput,
  SettleCustomerCreditInput,
  AddCustomerDebtInput,
  CustomerFilterQuery,
  UserSession,
} from '../types';
import { getPaginationOptions, PaginatedResult } from '../utils/pagination';
import { escapeLikePattern } from '../utils/sanitize';

export const CustomersService = {
  /**
   * Retrieves a paginated list of customer credits with search, debt filters, and sorting.
   */
  async getCustomerCredits(
    db: D1Database,
    dashboardId: string,
    query: CustomerFilterQuery
  ): Promise<PaginatedResult<CustomerCredit>> {
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
      // By default, exclude archived records unless explicitly requested
      filterClauses.push("status != 'archived'");
    }

    // Balance filter (due vs cleared)
    if (query.status_filter === 'due') {
      filterClauses.push('balance_due > 0');
    } else if (query.status_filter === 'cleared') {
      filterClauses.push('balance_due <= 0');
    }

    // Search filter (name, phone)
    if (query.search && query.search.trim()) {
      filterClauses.push(
        `(name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\')`
      );
      const pattern = `%${escapeLikePattern(query.search.trim())}%`;
      params.push(pattern, pattern);
    }

    const whereClause = filterClauses.length > 0 ? `WHERE ${filterClauses.join(' AND ')}` : '';

    // Total Count
    const countResult = await db.prepare(`
      SELECT COUNT(*) as total 
      FROM customer_credits 
      ${whereClause}
    `).bind(...params).first<{ total: number }>();

    const total = countResult?.total || 0;
    const totalPages = Math.ceil(total / limit);

    // Sorting
    const allowedSortFields: Record<string, string> = {
      created_at: 'created_at',
      name: 'name',
      balance_due: 'balance_due',
      last_transaction_date: 'last_transaction_date',
    };
    const sortCol = (query.sort_by && allowedSortFields[query.sort_by]) || 'created_at';
    const sortOrder = query.sort_order?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // Data query
    const data = await db.prepare(`
      SELECT * 
      FROM customer_credits 
      ${whereClause} 
      ORDER BY ${sortCol} ${sortOrder} 
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all<CustomerCredit>();

    return {
      data: data.results || [],
      pagination: {
        total,
        page,
        limit,
        totalPages,
      },
    };
  },

  /**
   * Calculates real-time statistics for customer ledger and total debts.
   */
  async getCustomerCreditStats(
    db: D1Database,
    dashboardId: string
  ): Promise<CustomerCreditStats> {
    const statsResult = await db.prepare(`
      SELECT 
        COUNT(*) as total_customers,
        COALESCE(SUM(balance_due), 0) as total_due_balance,
        COALESCE(SUM(CASE WHEN balance_due > 0 THEN 1 ELSE 0 END), 0) as due_customers_count,
        COALESCE(SUM(CASE WHEN balance_due <= 0 THEN 1 ELSE 0 END), 0) as cleared_customers_count,
        COALESCE(SUM(total_debt), 0) as total_accumulated_debt,
        COALESCE(SUM(total_paid), 0) as total_settled_amount
      FROM customer_credits 
      WHERE dashboard_id = ? AND status != 'archived'
    `).bind(dashboardId).first<{
      total_customers: number;
      total_due_balance: number;
      due_customers_count: number;
      cleared_customers_count: number;
      total_accumulated_debt: number;
      total_settled_amount: number;
    }>();

    return {
      total_customers: statsResult?.total_customers || 0,
      total_due_balance: statsResult?.total_due_balance || 0,
      due_customers_count: statsResult?.due_customers_count || 0,
      cleared_customers_count: statsResult?.cleared_customers_count || 0,
      total_accumulated_debt: statsResult?.total_accumulated_debt || 0,
      total_settled_amount: statsResult?.total_settled_amount || 0,
    };
  },

  /**
   * Retrieves a single customer credit record by ID.
   */
  async getCustomerCreditById(
    db: D1Database,
    dashboardId: string,
    id: string
  ): Promise<CustomerCredit | null> {
    return await db.prepare(`
      SELECT * 
      FROM customer_credits 
      WHERE dashboard_id = ? AND id = ? 
      LIMIT 1
    `).bind(dashboardId, id).first<CustomerCredit>();
  },

  /**
   * Registers a new customer credit ledger account.
   * If an initial balance is specified, atomically logs the initial debt transaction.
   */
  async createCustomerCredit(
    db: D1Database,
    dashboardId: string,
    input: CreateCustomerCreditInput,
    user: UserSession,
    activeShift?: any
  ): Promise<CustomerCredit> {
    const id = `cr-${crypto.randomUUID()}`;
    const initialBalance = Number(input.balance_due) || 0;
    const now = new Date().toISOString();
    const status = initialBalance > 0 ? 'active' : 'cleared';

    const statements: any[] = [];

    // 1. Insert customer credit record
    statements.push(
      db.prepare(`
        INSERT INTO customer_credits (
          id, dashboard_id, name, phone, balance_due,
          total_debt, total_paid, last_transaction_date,
          status, notes, created_by, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0.0, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id,
        dashboardId,
        input.name,
        input.phone,
        initialBalance,
        initialBalance,
        initialBalance > 0 ? now : null,
        status,
        input.notes || null,
        user.id,
        user.id,
        now,
        now
      )
    );

    // 2. If opening balance > 0, log an initial 'debt' transaction for audit trail
    if (initialBalance > 0) {
      const txId = `ctx-${crypto.randomUUID()}`;
      statements.push(
        db.prepare(`
          INSERT INTO customer_credit_transactions (
            id, dashboard_id, credit_id, type, amount,
            balance_before, balance_after, payment_method,
            receipt_number, invoice_id, shift_id,
            cashier_profile_id, cashier_name, cash_movement_id,
            notes, created_at
          ) VALUES (?, ?, ?, 'debt', ?, 0.0, ?, NULL, NULL, NULL, ?, ?, ?, NULL, ?, ?)
        `).bind(
          txId,
          dashboardId,
          id,
          initialBalance,
          initialBalance,
          activeShift?.shift_id || null,
          user.id,
          user.name || 'كاشير',
          input.notes || 'رصيد افتتاحي عند فتح حساب النوتة',
          now
        )
      );
    }

    await db.batch(statements);

    const created = await this.getCustomerCreditById(db, dashboardId, id);
    return created!;
  },

  /**
   * Updates customer profile details (name, phone, notes, status).
   */
  async updateCustomerCredit(
    db: D1Database,
    dashboardId: string,
    id: string,
    input: UpdateCustomerCreditInput,
    user: UserSession
  ): Promise<CustomerCredit | { error: string; message: string; status: number }> {
    const existing = await this.getCustomerCreditById(db, dashboardId, id);
    if (!existing) {
      return { error: 'CUSTOMER_NOT_FOUND', message: 'حساب العميل المطلوب غير موجود', status: 404 };
    }

    const updates: string[] = ['updated_by = ?', 'updated_at = CURRENT_TIMESTAMP'];
    const params: any[] = [user.id];

    if (input.name !== undefined) {
      updates.push('name = ?');
      params.push(input.name);
    }
    if (input.phone !== undefined) {
      updates.push('phone = ?');
      params.push(input.phone);
    }
    if (input.notes !== undefined) {
      updates.push('notes = ?');
      params.push(input.notes);
    }
    if (input.status !== undefined) {
      updates.push('status = ?');
      params.push(input.status);
    }

    params.push(dashboardId, id);

    await db.prepare(`
      UPDATE customer_credits 
      SET ${updates.join(', ')} 
      WHERE dashboard_id = ? AND id = ?
    `).bind(...params).run();

    const updated = await this.getCustomerCreditById(db, dashboardId, id);
    return updated!;
  },

  /**
   * Settles / collects debt from customer (partial or full payment).
   * Prevents overpayment (OVERPAYMENT_NOT_ALLOWED).
   * Transitions status to 'cleared' when balance reaches 0.
   * Atomically integrates with cash drawer (cash_movements) when payment_method === 'cash'.
   */
  async settleCustomerCredit(
    db: D1Database,
    dashboardId: string,
    id: string,
    input: SettleCustomerCreditInput,
    user: UserSession,
    activeShift?: any
  ): Promise<
    | { transaction: CustomerCreditTransaction; new_balance: number; customer_name: string }
    | { error: string; message: string; status: number }
  > {
    const customer = await this.getCustomerCreditById(db, dashboardId, id);
    if (!customer) {
      return { error: 'CUSTOMER_NOT_FOUND', message: 'حساب العميل المطلوب غير موجود', status: 404 };
    }

    const amount = Number(input.amount);
    if (amount <= 0) {
      return { error: 'INVALID_AMOUNT', message: 'يجب أن يكون مبلغ التحصيل أكبر من الصفر', status: 400 };
    }

    // Protection against overpayment / cashier typo
    if (amount > customer.balance_due) {
      return {
        error: 'OVERPAYMENT_NOT_ALLOWED',
        message: `مبلغ التحصيل (${amount} ج.م) يتجاوز رصيد الدين الحالي (${customer.balance_due} ج.م)`,
        status: 400,
      };
    }

    const txId = `ctx-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const shiftId = activeShift?.shift_id || null;
    const cashierId = user.id;
    const cashierName = user.name || 'كاشير';

    const newBalance = Math.max(0, customer.balance_due - amount);
    const newTotalPaid = customer.total_paid + amount;
    const newStatus = newBalance === 0 ? 'cleared' : 'active';

    let cashMovementId: string | null = null;
    const statements: any[] = [];

    // 1. If collected in cash, record positive drawer cash movement (type: 'in')
    if (input.payment_method === 'cash') {
      cashMovementId = `cm-${crypto.randomUUID()}`;
      const description = `تحصيل دين نوتة من العميل: ${customer.name}`;
      statements.push(
        db.prepare(`
          INSERT INTO cash_movements (
            id, dashboard_id, type, category, amount, description,
            cashier_profile_id, cashier_name, shift_id, created_at
          ) VALUES (?, ?, 'in', 'customer_debt_collection', ?, ?, ?, ?, ?, ?)
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

    // 2. Atomic update to customer credit balance and totals
    statements.push(
      db.prepare(`
        UPDATE customer_credits 
        SET balance_due = ?, 
            total_paid = ?, 
            status = ?, 
            last_transaction_date = ?, 
            updated_by = ?, 
            updated_at = ? 
        WHERE dashboard_id = ? AND id = ?
      `).bind(
        newBalance,
        newTotalPaid,
        newStatus,
        now,
        cashierId,
        now,
        dashboardId,
        id
      )
    );

    // 3. Record transaction in customer credit ledger
    statements.push(
      db.prepare(`
        INSERT INTO customer_credit_transactions (
          id, dashboard_id, credit_id, type, amount,
          balance_before, balance_after, payment_method,
          receipt_number, invoice_id, shift_id,
          cashier_profile_id, cashier_name, cash_movement_id,
          notes, created_at
        ) VALUES (?, ?, ?, 'payment', ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
      `).bind(
        txId,
        dashboardId,
        id,
        amount,
        customer.balance_due,
        newBalance,
        input.payment_method || 'cash',
        input.receipt_number || null,
        shiftId,
        cashierId,
        cashierName,
        cashMovementId,
        input.notes || null,
        now
      )
    );

    // Execute atomic transaction
    await db.batch(statements);

    const transaction = await db.prepare(`
      SELECT * FROM customer_credit_transactions 
      WHERE dashboard_id = ? AND id = ? 
      LIMIT 1
    `).bind(dashboardId, txId).first<CustomerCreditTransaction>();

    return {
      transaction: transaction!,
      new_balance: newBalance,
      customer_name: customer.name,
    };
  },

  /**
   * Adds new debt / credit pull to a customer account (سحب بضاعة على النوتة).
   */
  async addCustomerDebt(
    db: D1Database,
    dashboardId: string,
    id: string,
    input: AddCustomerDebtInput,
    user: UserSession,
    activeShift?: any
  ): Promise<
    | { transaction: CustomerCreditTransaction; new_balance: number; customer_name: string }
    | { error: string; message: string; status: number }
  > {
    const customer = await this.getCustomerCreditById(db, dashboardId, id);
    if (!customer) {
      return { error: 'CUSTOMER_NOT_FOUND', message: 'حساب العميل المطلوب غير موجود', status: 404 };
    }

    const amount = Number(input.amount);
    if (amount <= 0) {
      return { error: 'INVALID_AMOUNT', message: 'يجب أن يكون مبلغ السحب أكبر من الصفر', status: 400 };
    }

    const txId = `ctx-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const shiftId = activeShift?.shift_id || null;
    const cashierId = user.id;
    const cashierName = user.name || 'كاشير';

    const newBalance = customer.balance_due + amount;
    const newTotalDebt = customer.total_debt + amount;

    const statements: any[] = [];

    // 1. Atomic update to customer credit balance and totals
    statements.push(
      db.prepare(`
        UPDATE customer_credits 
        SET balance_due = ?, 
            total_debt = ?, 
            status = 'active', 
            last_transaction_date = ?, 
            updated_by = ?, 
            updated_at = ? 
        WHERE dashboard_id = ? AND id = ?
      `).bind(
        newBalance,
        newTotalDebt,
        now,
        cashierId,
        now,
        dashboardId,
        id
      )
    );

    // 2. Record debt transaction in customer credit ledger
    statements.push(
      db.prepare(`
        INSERT INTO customer_credit_transactions (
          id, dashboard_id, credit_id, type, amount,
          balance_before, balance_after, payment_method,
          receipt_number, invoice_id, shift_id,
          cashier_profile_id, cashier_name, cash_movement_id,
          notes, created_at
        ) VALUES (?, ?, ?, 'debt', ?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, ?, ?)
      `).bind(
        txId,
        dashboardId,
        id,
        amount,
        customer.balance_due,
        newBalance,
        input.invoice_id || null,
        shiftId,
        cashierId,
        cashierName,
        input.notes || null,
        now
      )
    );

    // Execute atomic transaction
    await db.batch(statements);

    const transaction = await db.prepare(`
      SELECT * FROM customer_credit_transactions 
      WHERE dashboard_id = ? AND id = ? 
      LIMIT 1
    `).bind(dashboardId, txId).first<CustomerCreditTransaction>();

    return {
      transaction: transaction!,
      new_balance: newBalance,
      customer_name: customer.name,
    };
  },

  /**
   * Deletes or archives a customer credit account based on debt and history.
   * Prohibits deletion if balance_due > 0.
   */
  async deleteCustomerCredit(
    db: D1Database,
    dashboardId: string,
    id: string,
    force: boolean = false
  ): Promise<
    | { success: true; action: 'deleted' | 'archived'; message: string }
    | { error: string; message: string; status: number }
  > {
    const existing = await this.getCustomerCreditById(db, dashboardId, id);
    if (!existing) {
      return { error: 'CUSTOMER_NOT_FOUND', message: 'حساب العميل المطلوب غير موجود', status: 404 };
    }

    // Protection: Never delete a customer who owes money!
    if (existing.balance_due > 0) {
      return {
        error: 'CUSTOMER_HAS_ACTIVE_DEBT',
        message: `لا يمكن حذف العميل نظراً لوجود مديونية قائمة (${existing.balance_due} ج.م). يجب تسديد أو تصفير الحساب أولاً.`,
        status: 400,
      };
    }

    // Check if transactions exist
    const txCountResult = await db.prepare(`
      SELECT COUNT(*) as count 
      FROM customer_credit_transactions 
      WHERE dashboard_id = ? AND credit_id = ?
    `).bind(dashboardId, id).first<{ count: number }>();
    const txCount = txCountResult?.count || 0;

    if (txCount > 0 && !force) {
      // Soft-archive to preserve accounting history
      await db.prepare(`
        UPDATE customer_credits 
        SET status = 'archived', updated_at = CURRENT_TIMESTAMP 
        WHERE dashboard_id = ? AND id = ?
      `).bind(dashboardId, id).run();

      return {
        success: true,
        action: 'archived',
        message: 'تم أرشفة حساب العميل بنجاح لحماية سجل الدفعات والمعاملات المحاسبية السابقة',
      };
    }

    // Hard delete when no transaction history exists or force=true
    await db.prepare(`
      DELETE FROM customer_credits 
      WHERE dashboard_id = ? AND id = ?
    `).bind(dashboardId, id).run();

    return {
      success: true,
      action: 'deleted',
      message: 'تم حذف حساب العميل نهائياً من دفتر النوتة بنجاح',
    };
  },

  /**
   * Retrieves paginated transaction history / statement of account for a customer.
   */
  async getCustomerTransactions(
    db: D1Database,
    dashboardId: string,
    creditId: string,
    query: { page?: number; limit?: number; type?: string }
  ): Promise<PaginatedResult<CustomerCreditTransaction>> {
    const { page, limit } = getPaginationOptions(
      query.page ? String(query.page) : undefined,
      query.limit ? String(query.limit) : undefined,
      20
    );
    const offset = (page - 1) * limit;

    const filterClauses: string[] = ['dashboard_id = ?', 'credit_id = ?'];
    const params: any[] = [dashboardId, creditId];

    if (query.type && query.type !== 'all') {
      filterClauses.push('type = ?');
      params.push(query.type);
    }

    const whereClause = `WHERE ${filterClauses.join(' AND ')}`;

    // Total Count
    const countResult = await db.prepare(`
      SELECT COUNT(*) as total 
      FROM customer_credit_transactions 
      ${whereClause}
    `).bind(...params).first<{ total: number }>();

    const total = countResult?.total || 0;
    const totalPages = Math.ceil(total / limit);

    // Data query
    const data = await db.prepare(`
      SELECT * 
      FROM customer_credit_transactions 
      ${whereClause} 
      ORDER BY created_at DESC 
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all<CustomerCreditTransaction>();

    return {
      data: data.results || [],
      pagination: {
        total,
        page,
        limit,
        totalPages,
      },
    };
  },
};
