/**
 * ==============================================================================
 * MobiDash Platform - Phone Installments Services
 * ==============================================================================
 * 
 * Comprehensive business logic for phone installments (أقساط الهواتف المحمولة),
 * contract files, monthly payment collections, overdue tracking, and cash drawer sync.
 * 
 * Core Guarantees:
 * 1. Strict Tenant Isolation (dashboard_id = ? on every query).
 * 2. Atomic Financial Updates (db.batch() wrapping contract state, payment log, and cash movements).
 * 3. Human Mistake Protection: Cannot pay completed contracts (INSTALLMENT_ALREADY_COMPLETED).
 * 4. Auto-Completion: Automatically marks contract as 'completed' when last installment is settled.
 * 5. Automatic Overdue Detection: Checks due dates against real-time clock.
 * 6. Prepared Statements Only: Zero string interpolation in SQL.
 */

import { D1Database } from '@cloudflare/workers-types';
import {
  Installment,
  InstallmentPayment,
  InstallmentStats,
  CreateInstallmentInput,
  UpdateInstallmentInput,
  PayInstallmentInput,
  InstallmentFilterQuery,
  UserSession,
} from '../types';
import { getPaginationOptions, PaginatedResult } from '../utils/pagination';
import { escapeLikePattern } from '../utils/sanitize';

/**
 * Helper to advance date by 1 month for installment scheduling (YYYY-MM-DD)
 */
function advanceDateByOneMonth(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) {
      const fallback = new Date();
      fallback.setMonth(fallback.getMonth() + 1);
      return fallback.toISOString().split('T')[0];
    }
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().split('T')[0];
  } catch {
    const fallback = new Date();
    fallback.setMonth(fallback.getMonth() + 1);
    return fallback.toISOString().split('T')[0];
  }
}

export const InstallmentsService = {
  /**
   * Retrieves a paginated list of installment contracts with search, status filters, and sorting.
   */
  async getInstallments(
    db: D1Database,
    dashboardId: string,
    query: InstallmentFilterQuery
  ): Promise<PaginatedResult<Installment>> {
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
      if (query.status === 'overdue') {
        filterClauses.push("(status = 'overdue' OR (status = 'active' AND date(next_due_date) < date('now')))");
      } else {
        filterClauses.push('status = ?');
        params.push(query.status);
      }
    }

    // Search filter (customer_name, customer_phone, device_purchased, customer_national_id)
    if (query.search && query.search.trim()) {
      filterClauses.push(
        `(customer_name LIKE ? ESCAPE '\\' OR customer_phone LIKE ? ESCAPE '\\' OR device_purchased LIKE ? ESCAPE '\\' OR customer_national_id LIKE ? ESCAPE '\\')`
      );
      const pattern = `%${escapeLikePattern(query.search.trim())}%`;
      params.push(pattern, pattern, pattern, pattern);
    }

    const whereClause = filterClauses.length > 0 ? `WHERE ${filterClauses.join(' AND ')}` : '';

    // Total Count
    const countResult = await db.prepare(`
      SELECT COUNT(*) as total 
      FROM installments 
      ${whereClause}
    `).bind(...params).first<{ total: number }>();

    const total = countResult?.total || 0;
    const totalPages = Math.ceil(total / limit);

    // Sorting
    const allowedSortFields: Record<string, string> = {
      created_at: 'created_at',
      customer_name: 'customer_name',
      next_due_date: 'next_due_date',
      total_amount: 'total_amount',
    };
    const sortCol = (query.sort_by && allowedSortFields[query.sort_by]) || 'created_at';
    const sortOrder = query.sort_order?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // Data query
    const data = await db.prepare(`
      SELECT * 
      FROM installments 
      ${whereClause} 
      ORDER BY ${sortCol} ${sortOrder} 
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all<Installment>();

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
   * Calculates real-time statistics for all installment contracts and financings.
   */
  async getInstallmentStats(
    db: D1Database,
    dashboardId: string
  ): Promise<InstallmentStats> {
    const statsResult = await db.prepare(`
      SELECT 
        COUNT(*) as total_contracts,
        COALESCE(SUM(CASE WHEN status = 'active' AND date(next_due_date) >= date('now') THEN 1 ELSE 0 END), 0) as active_contracts,
        COALESCE(SUM(CASE WHEN status = 'overdue' OR (status = 'active' AND date(next_due_date) < date('now')) THEN 1 ELSE 0 END), 0) as overdue_contracts,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) as completed_contracts,
        COALESCE(SUM(total_amount), 0) as total_financed_amount,
        COALESCE(SUM(paid_down_payment), 0) as total_down_payments,
        COALESCE(SUM(total_paid_installments), 0) as total_collected_installments,
        COALESCE(SUM(total_amount - paid_down_payment - total_paid_installments), 0) as total_remaining_amount
      FROM installments 
      WHERE dashboard_id = ?
    `).bind(dashboardId).first<{
      total_contracts: number;
      active_contracts: number;
      overdue_contracts: number;
      completed_contracts: number;
      total_financed_amount: number;
      total_down_payments: number;
      total_collected_installments: number;
      total_remaining_amount: number;
    }>();

    return {
      total_contracts: statsResult?.total_contracts || 0,
      active_contracts: statsResult?.active_contracts || 0,
      overdue_contracts: statsResult?.overdue_contracts || 0,
      completed_contracts: statsResult?.completed_contracts || 0,
      total_financed_amount: statsResult?.total_financed_amount || 0,
      total_down_payments: statsResult?.total_down_payments || 0,
      total_collected_installments: statsResult?.total_collected_installments || 0,
      total_remaining_amount: statsResult?.total_remaining_amount || 0,
    };
  },

  /**
   * Retrieves a single installment contract by ID.
   */
  async getInstallmentById(
    db: D1Database,
    dashboardId: string,
    id: string
  ): Promise<Installment | null> {
    return await db.prepare(`
      SELECT * 
      FROM installments 
      WHERE dashboard_id = ? AND id = ? 
      LIMIT 1
    `).bind(dashboardId, id).first<Installment>();
  },

  /**
   * Creates a new installment contract for a customer buying a phone.
   * If a down payment is collected in cash, integrates atomically with cash drawer.
   */
  async createInstallment(
    db: D1Database,
    dashboardId: string,
    input: CreateInstallmentInput,
    user: UserSession,
    activeShift?: any
  ): Promise<Installment> {
    const id = `inst-${crypto.randomUUID()}`;
    const totalMonths = Number(input.total_months) || 12;
    const downPayment = Number(input.paid_down_payment) || 0;
    const now = new Date().toISOString();
    const shiftId = activeShift?.shift_id || null;
    const cashierId = user.id;
    const cashierName = user.name || 'كاشير';

    const statements: any[] = [];

    // 1. If down payment > 0, log positive cash drawer movement
    let cashMovementId: string | null = null;
    if (downPayment > 0) {
      cashMovementId = `cm-${crypto.randomUUID()}`;
      const description = `مقدم تقسيط جهاز: ${input.device_purchased} للعميل: ${input.customer_name}`;
      statements.push(
        db.prepare(`
          INSERT INTO cash_movements (
            id, dashboard_id, type, category, amount, description,
            cashier_profile_id, cashier_name, shift_id, created_at
          ) VALUES (?, ?, 'in', 'installment_down_payment', ?, ?, ?, ?, ?, ?)
        `).bind(
          cashMovementId,
          dashboardId,
          downPayment,
          description,
          cashierId,
          cashierName,
          shiftId,
          now
        )
      );
    }

    // 2. Insert installment contract
    statements.push(
      db.prepare(`
        INSERT INTO installments (
          id, dashboard_id, customer_name, customer_phone,
          customer_national_id, guarantor_name, guarantor_phone,
          guarantor_national_id, device_purchased, phone_id,
          total_amount, paid_down_payment, monthly_amount,
          total_months, remaining_months, paid_months,
          total_paid_installments, next_due_date, status,
          notes, created_by, updated_by, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, 0,
          0.0, ?, 'active',
          ?, ?, ?, ?, ?
        )
      `).bind(
        id,
        dashboardId,
        input.customer_name,
        input.customer_phone,
        input.customer_national_id || null,
        input.guarantor_name || null,
        input.guarantor_phone || null,
        input.guarantor_national_id || null,
        input.device_purchased,
        input.phone_id || null,
        Number(input.total_amount),
        downPayment,
        Number(input.monthly_amount),
        totalMonths,
        totalMonths,
        input.next_due_date,
        input.notes || null,
        cashierId,
        cashierId,
        now,
        now
      )
    );

    await db.batch(statements);

    const created = await this.getInstallmentById(db, dashboardId, id);
    return created!;
  },

  /**
   * Updates existing installment contract details (guarantor, notes, status, due date, etc.).
   */
  async updateInstallment(
    db: D1Database,
    dashboardId: string,
    id: string,
    input: UpdateInstallmentInput,
    user: UserSession
  ): Promise<Installment | { error: string; message: string; status: number }> {
    const existing = await this.getInstallmentById(db, dashboardId, id);
    if (!existing) {
      return { error: 'INSTALLMENT_NOT_FOUND', message: 'عقد التقسيط المطلوب غير موجود', status: 404 };
    }

    const updates: string[] = ['updated_by = ?', 'updated_at = CURRENT_TIMESTAMP'];
    const params: any[] = [user.id];

    if (input.customer_name !== undefined) {
      updates.push('customer_name = ?');
      params.push(input.customer_name);
    }
    if (input.customer_phone !== undefined) {
      updates.push('customer_phone = ?');
      params.push(input.customer_phone);
    }
    if (input.customer_national_id !== undefined) {
      updates.push('customer_national_id = ?');
      params.push(input.customer_national_id);
    }
    if (input.guarantor_name !== undefined) {
      updates.push('guarantor_name = ?');
      params.push(input.guarantor_name);
    }
    if (input.guarantor_phone !== undefined) {
      updates.push('guarantor_phone = ?');
      params.push(input.guarantor_phone);
    }
    if (input.guarantor_national_id !== undefined) {
      updates.push('guarantor_national_id = ?');
      params.push(input.guarantor_national_id);
    }
    if (input.device_purchased !== undefined) {
      updates.push('device_purchased = ?');
      params.push(input.device_purchased);
    }
    if (input.phone_id !== undefined) {
      updates.push('phone_id = ?');
      params.push(input.phone_id);
    }
    if (input.monthly_amount !== undefined) {
      updates.push('monthly_amount = ?');
      params.push(input.monthly_amount);
    }
    if (input.next_due_date !== undefined) {
      updates.push('next_due_date = ?');
      params.push(input.next_due_date);
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
      UPDATE installments 
      SET ${updates.join(', ')} 
      WHERE dashboard_id = ? AND id = ?
    `).bind(...params).run();

    const updated = await this.getInstallmentById(db, dashboardId, id);
    return updated!;
  },

  /**
   * Collects a monthly installment payment.
   * Auto-advances next due date, decrements remaining months, increments paid count.
   * Transitions status to 'completed' when all months are paid.
   * Atomically integrates with cash drawer when payment_method === 'cash'.
   */
  async payInstallment(
    db: D1Database,
    dashboardId: string,
    id: string,
    input: PayInstallmentInput,
    user: UserSession,
    activeShift?: any
  ): Promise<
    | {
        payment: InstallmentPayment;
        installment: Installment;
        is_completed: boolean;
      }
    | { error: string; message: string; status: number }
  > {
    const installment = await this.getInstallmentById(db, dashboardId, id);
    if (!installment) {
      return { error: 'INSTALLMENT_NOT_FOUND', message: 'عقد التقسيط المطلوب غير موجود', status: 404 };
    }

    // Protection against paying completed contracts
    if (installment.status === 'completed' || installment.remaining_months <= 0) {
      return {
        error: 'INSTALLMENT_ALREADY_COMPLETED',
        message: 'عقد التقسيط مسدد بالكامل بالفعل ولا توجد أقساط متبقية للتحصيل',
        status: 400,
      };
    }

    const amount = Number(input.amount) || installment.monthly_amount;
    if (amount <= 0) {
      return { error: 'INVALID_AMOUNT', message: 'يجب أن يكون مبلغ القسط أكبر من الصفر', status: 400 };
    }

    const payId = `ipay-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const shiftId = activeShift?.shift_id || null;
    const cashierId = user.id;
    const cashierName = user.name || 'كاشير';

    const newPaidMonths = installment.paid_months + 1;
    const newRemainingMonths = Math.max(0, installment.remaining_months - 1);
    const newTotalPaid = installment.total_paid_installments + amount;
    const isCompleted =
      newRemainingMonths === 0 ||
      installment.paid_down_payment + newTotalPaid >= installment.total_amount;
    const newStatus = isCompleted ? 'completed' : 'active';
    const nextDueDate = advanceDateByOneMonth(installment.next_due_date);

    let cashMovementId: string | null = null;
    const statements: any[] = [];

    // 1. If cash, add cash drawer movement
    const paymentMethod = input.payment_method || 'cash';
    if (paymentMethod === 'cash') {
      cashMovementId = `cm-${crypto.randomUUID()}`;
      const description = `تحصيل قسط جهاز: ${installment.device_purchased} (قسط ${newPaidMonths}/${installment.total_months}) من: ${installment.customer_name}`;
      statements.push(
        db.prepare(`
          INSERT INTO cash_movements (
            id, dashboard_id, type, category, amount, description,
            cashier_profile_id, cashier_name, shift_id, created_at
          ) VALUES (?, ?, 'in', 'installment_payment', ?, ?, ?, ?, ?, ?)
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

    // 2. Update installment contract record
    statements.push(
      db.prepare(`
        UPDATE installments 
        SET remaining_months = ?, 
            paid_months = ?, 
            total_paid_installments = ?, 
            next_due_date = ?, 
            status = ?, 
            updated_by = ?, 
            updated_at = ? 
        WHERE dashboard_id = ? AND id = ?
      `).bind(
        newRemainingMonths,
        newPaidMonths,
        newTotalPaid,
        nextDueDate,
        newStatus,
        cashierId,
        now,
        dashboardId,
        id
      )
    );

    // 3. Insert payment ledger record
    statements.push(
      db.prepare(`
        INSERT INTO installment_payments (
          id, dashboard_id, installment_id, installment_number,
          amount, payment_method, receipt_number, shift_id,
          cashier_profile_id, cashier_name, cash_movement_id,
          notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        payId,
        dashboardId,
        id,
        newPaidMonths,
        amount,
        paymentMethod,
        input.receipt_number || null,
        shiftId,
        cashierId,
        cashierName,
        cashMovementId,
        input.notes || null,
        now
      )
    );

    // Atomic execution
    await db.batch(statements);

    const payment = await db.prepare(`
      SELECT * FROM installment_payments 
      WHERE dashboard_id = ? AND id = ? 
      LIMIT 1
    `).bind(dashboardId, payId).first<InstallmentPayment>();

    const updatedInstallment = await this.getInstallmentById(db, dashboardId, id);

    return {
      payment: payment!,
      installment: updatedInstallment!,
      is_completed: isCompleted,
    };
  },

  /**
   * Deletes or cancels an installment contract.
   */
  async deleteInstallment(
    db: D1Database,
    dashboardId: string,
    id: string,
    force: boolean = false
  ): Promise<
    | { success: true; action: 'deleted' | 'cancelled'; message: string }
    | { error: string; message: string; status: number }
  > {
    const existing = await this.getInstallmentById(db, dashboardId, id);
    if (!existing) {
      return { error: 'INSTALLMENT_NOT_FOUND', message: 'عقد التقسيط المطلوب غير موجود', status: 404 };
    }

    // If payments were collected and not forced, cancel rather than delete to preserve records
    if (existing.paid_months > 0 && !force) {
      await db.prepare(`
        UPDATE installments 
        SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP 
        WHERE dashboard_id = ? AND id = ?
      `).bind(dashboardId, id).run();

      return {
        success: true,
        action: 'cancelled',
        message: 'تم إلغاء عقد التقسيط بنجاح والاحتفاظ بسجل الدفعات السابقة',
      };
    }

    // Hard delete
    await db.prepare(`
      DELETE FROM installments 
      WHERE dashboard_id = ? AND id = ?
    `).bind(dashboardId, id).run();

    return {
      success: true,
      action: 'deleted',
      message: 'تم حذف ملف التقسيط نهائياً بنجاح',
    };
  },

  /**
   * Retrieves paginated payment history for a specific installment contract.
   */
  async getInstallmentPayments(
    db: D1Database,
    dashboardId: string,
    installmentId: string,
    query: { page?: number; limit?: number }
  ): Promise<PaginatedResult<InstallmentPayment>> {
    const { page, limit } = getPaginationOptions(
      query.page ? String(query.page) : undefined,
      query.limit ? String(query.limit) : undefined,
      20
    );
    const offset = (page - 1) * limit;

    const whereClause = 'WHERE dashboard_id = ? AND installment_id = ?';
    const params = [dashboardId, installmentId];

    // Total Count
    const countResult = await db.prepare(`
      SELECT COUNT(*) as total 
      FROM installment_payments 
      ${whereClause}
    `).bind(...params).first<{ total: number }>();

    const total = countResult?.total || 0;
    const totalPages = Math.ceil(total / limit);

    // Data query
    const data = await db.prepare(`
      SELECT * 
      FROM installment_payments 
      ${whereClause} 
      ORDER BY installment_number ASC, created_at ASC 
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all<InstallmentPayment>();

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
