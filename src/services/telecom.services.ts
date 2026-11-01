/**
 * ==============================================================================
 * MobiDash Platform - Telecom & Digital Wallets Services
 * ==============================================================================
 * 
 * Comprehensive business logic for POS terminals (Fawry, Aman, Masary),
 * mobile wallets (Vodafone Cash, InstaPay, Orange, Etisalat, WE),
 * bill payments, utilities, tuition, microfinance installments,
 * balance top-ups, withdrawals, and cash drawer synchronization.
 * 
 * Core Guarantees:
 * 1. Strict Tenant Isolation (dashboard_id on every query).
 * 2. Atomic Balance Updates (db.batch() wrapping terminal balances, transaction logs, and cash drawer).
 * 3. Overdraft Guard: Terminals with allow_overdraft=1 can reach -overdraft_limit; otherwise rejected.
 * 4. Dual-Account Separation: main_balance (services) vs cash_out_balance (cash withdrawals).
 * 5. Historical Integrity: Soft-deletes to 'suspended' if transactions exist; protects non-zero balances.
 */

import { D1Database } from '@cloudflare/workers-types';
import { 
  TelecomTerminal, 
  TelecomTransaction, 
  CreateTerminalInput, 
  UpdateTerminalInput, 
  TopUpTerminalInput, 
  WithdrawTerminalInput, 
  InternalTransferInput, 
  RecordTelecomTransactionInput, 
  TelecomFilterQuery, 
  TelecomStats,
  UserSession,
  PosTelecomFilters,
  PosTelecomItem,
} from '../types';
import { getPaginationOptions, PaginatedResult } from '../utils/pagination';
import { escapeLikePattern } from '../utils/sanitize';
import { logger } from '../utils/logger';

export const TelecomService = {
  /**
   * Registers a new electronic payment terminal or mobile wallet.
   */
  async createTerminal(
    db: D1Database, 
    dashboardId: string, 
    input: CreateTerminalInput
  ): Promise<TelecomTerminal> {
    const id = `term-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const balance = Number(input.balance || 0);
    const hasDualAccounts = input.has_dual_accounts ? 1 : 0;
    const cashOutBalance = Number(input.cash_out_balance || 0);
    const allowOverdraft = input.allow_overdraft ? 1 : 0;
    const overdraftLimit = Number(input.overdraft_limit || 0);
    const minThreshold = Number(input.min_threshold ?? 1000);

    // Initial status evaluation
    let status: string = 'active';
    if (balance < minThreshold) {
      status = 'low_balance';
    }

    await db.prepare(`
      INSERT INTO telecom_terminals (
        id, dashboard_id, name, provider, category,
        balance, has_dual_accounts, cash_out_balance,
        allow_overdraft, overdraft_limit, min_threshold,
        account_number, status, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      dashboardId,
      input.name,
      input.provider,
      input.category,
      balance,
      hasDualAccounts,
      cashOutBalance,
      allowOverdraft,
      overdraftLimit,
      minThreshold,
      input.account_number || null,
      status,
      input.notes || null,
      now,
      now
    ).run();

    return {
      id,
      dashboard_id: dashboardId,
      name: input.name,
      provider: input.provider,
      category: input.category,
      balance,
      has_dual_accounts: hasDualAccounts,
      cash_out_balance: cashOutBalance,
      allow_overdraft: allowOverdraft,
      overdraft_limit: overdraftLimit,
      min_threshold: minThreshold,
      account_number: input.account_number || null,
      status: status as any,
      notes: input.notes || null,
      created_at: now,
      updated_at: now
    };
  },

  /**
   * Retrieves a paginated and filtered list of terminals and wallets.
   */
  async getTerminals(
    db: D1Database, 
    dashboardId: string, 
    query: TelecomFilterQuery
  ): Promise<PaginatedResult<TelecomTerminal>> {
    const pagination = getPaginationOptions(
      query.page ? String(query.page) : undefined, 
      query.limit ? String(query.limit) : undefined, 
      25
    );

    let whereClauses: string[] = ['dashboard_id = ?'];
    let params: any[] = [dashboardId];

    if (query.search && query.search.trim()) {
      whereClauses.push(`(name LIKE ? ESCAPE '\\' OR account_number LIKE ? ESCAPE '\\')`);
      const pattern = `%${escapeLikePattern(query.search.trim())}%`;
      params.push(pattern, pattern);
    }

    if (query.provider && query.provider !== 'all') {
      whereClauses.push('provider = ?');
      params.push(query.provider);
    }

    if (query.category && query.category !== 'all') {
      whereClauses.push('category = ?');
      params.push(query.category);
    }

    if (query.status && query.status !== 'all') {
      whereClauses.push('status = ?');
      params.push(query.status);
    }

    const whereStr = `WHERE ${whereClauses.join(' AND ')}`;

    // Total count query
    const countRow = await db.prepare(
      `SELECT COUNT(*) as total FROM telecom_terminals ${whereStr}`
    ).bind(...params).first<{ total: number }>();
    const total = countRow?.total || 0;

    // Data query
    const offset = (pagination.page - 1) * pagination.limit;
    const dataQuery = `
      SELECT * FROM telecom_terminals 
      ${whereStr} 
      ORDER BY updated_at DESC, created_at DESC 
      LIMIT ? OFFSET ?
    `;
    const rows = await db.prepare(dataQuery).bind(...params, pagination.limit, offset).all<any>();

    const terminals: TelecomTerminal[] = (rows.results || []).map((row) => ({
      id: row.id,
      dashboard_id: row.dashboard_id,
      name: row.name,
      provider: row.provider,
      category: row.category,
      balance: Number(row.balance),
      has_dual_accounts: Number(row.has_dual_accounts),
      cash_out_balance: Number(row.cash_out_balance),
      allow_overdraft: Number(row.allow_overdraft),
      overdraft_limit: Number(row.overdraft_limit),
      min_threshold: Number(row.min_threshold),
      account_number: row.account_number,
      status: row.status,
      notes: row.notes,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));

    return {
      data: terminals,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit) || 1
      }
    };
  },

  /**
   * Retrieves single terminal details by ID.
   */
  async getTerminalById(
    db: D1Database, 
    dashboardId: string, 
    id: string
  ): Promise<TelecomTerminal | null> {
    const row = await db.prepare(`
      SELECT * FROM telecom_terminals 
      WHERE id = ? AND dashboard_id = ?
    `).bind(id, dashboardId).first<any>();

    if (!row) return null;

    return {
      id: row.id,
      dashboard_id: row.dashboard_id,
      name: row.name,
      provider: row.provider,
      category: row.category,
      balance: Number(row.balance),
      has_dual_accounts: Number(row.has_dual_accounts),
      cash_out_balance: Number(row.cash_out_balance),
      allow_overdraft: Number(row.allow_overdraft),
      overdraft_limit: Number(row.overdraft_limit),
      min_threshold: Number(row.min_threshold),
      account_number: row.account_number,
      status: row.status,
      notes: row.notes,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  },

  /**
   * Updates an existing terminal's details, parameters, and status.
   */
  async updateTerminal(
    db: D1Database, 
    dashboardId: string, 
    id: string, 
    input: UpdateTerminalInput
  ): Promise<{ error?: string; status?: number; message?: string; terminal?: TelecomTerminal }> {
    const existing = await this.getTerminalById(db, dashboardId, id);
    if (!existing) {
      return { error: 'TERMINAL_NOT_FOUND', status: 404, message: 'الماكينة أو المحفظة غير موجودة' };
    }

    const updates: string[] = [];
    const params: any[] = [];
    const now = new Date().toISOString();

    if (input.name !== undefined) {
      updates.push('name = ?');
      params.push(input.name);
    }
    if (input.provider !== undefined) {
      updates.push('provider = ?');
      params.push(input.provider);
    }
    if (input.category !== undefined) {
      updates.push('category = ?');
      params.push(input.category);
    }
    if (input.has_dual_accounts !== undefined) {
      updates.push('has_dual_accounts = ?');
      params.push(input.has_dual_accounts ? 1 : 0);
    }
    if (input.allow_overdraft !== undefined) {
      updates.push('allow_overdraft = ?');
      params.push(input.allow_overdraft ? 1 : 0);
    }
    if (input.overdraft_limit !== undefined) {
      updates.push('overdraft_limit = ?');
      params.push(input.overdraft_limit);
    }
    if (input.min_threshold !== undefined) {
      updates.push('min_threshold = ?');
      params.push(input.min_threshold);
    }
    if (input.account_number !== undefined) {
      updates.push('account_number = ?');
      params.push(input.account_number);
    }
    if (input.status !== undefined) {
      updates.push('status = ?');
      params.push(input.status);
    }
    if (input.notes !== undefined) {
      updates.push('notes = ?');
      params.push(input.notes);
    }

    if (updates.length === 0) {
      return { terminal: existing };
    }

    updates.push('updated_at = ?');
    params.push(now);

    params.push(id, dashboardId);
    await db.prepare(`
      UPDATE telecom_terminals 
      SET ${updates.join(', ')} 
      WHERE id = ? AND dashboard_id = ?
    `).bind(...params).run();

    const updated = await this.getTerminalById(db, dashboardId, id);
    return { terminal: updated! };
  },

  /**
   * Safely deletes or suspends a terminal.
   * Protects non-zero balance and archives historical records.
   */
  async deleteTerminal(
    db: D1Database, 
    dashboardId: string, 
    id: string
  ): Promise<{ error?: string; status?: number; message: string; suspended?: boolean; deleted?: boolean }> {
    const existing = await this.getTerminalById(db, dashboardId, id);
    if (!existing) {
      return { error: 'TERMINAL_NOT_FOUND', status: 404, message: 'الماكينة غير موجودة' };
    }

    // Safety check: Cannot delete or archive if balance != 0 or overdraft debt exists
    if (existing.balance !== 0 || existing.cash_out_balance !== 0) {
      return { 
        error: 'TERMINAL_HAS_BALANCE', 
        status: 400, 
        message: 'لا يمكن حذف أو إيقاف الماكينة طالما يوجد بها رصيد متبقي أو مديونية، يرجى تصفير الرصيد أولاً' 
      };
    }

    // Check historical transactions
    const txCountRow = await db.prepare(`
      SELECT COUNT(*) as count FROM telecom_transactions 
      WHERE dashboard_id = ? AND terminal_id = ?
    `).bind(dashboardId, id).first<{ count: number }>();

    const txCount = txCountRow?.count || 0;

    if (txCount > 0) {
      // Soft-delete to 'suspended' to preserve ledger history and foreign keys
      const now = new Date().toISOString();
      await db.prepare(`
        UPDATE telecom_terminals 
        SET status = 'suspended', updated_at = ? 
        WHERE id = ? AND dashboard_id = ?
      `).bind(now, id, dashboardId).run();

      return { 
        message: 'تم إيقاف الماكينة وأرشفتها بنجاح للحفاظ على سجل المعاملات المالية السابقة', 
        suspended: true 
      };
    }

    // No historical transactions: hard delete safely
    await db.prepare(`
      DELETE FROM telecom_terminals 
      WHERE id = ? AND dashboard_id = ?
    `).bind(id, dashboardId).run();

    return { 
      message: 'تم حذف الماكينة نهائياً بنجاح', 
      deleted: true 
    };
  },

  /**
   * Deposits / Tops up balance into a terminal or mobile wallet.
   * Atomically logs telecom transaction and updates cash drawer if funds came from drawer.
   */
  async topUpTerminal(
    db: D1Database, 
    dashboardId: string, 
    user: UserSession, 
    terminalId: string, 
    input: TopUpTerminalInput
  ): Promise<{ error?: string; status?: number; message?: string; transaction?: TelecomTransaction; new_balance?: number }> {
    const terminal = await this.getTerminalById(db, dashboardId, terminalId);
    if (!terminal) {
      return { error: 'TERMINAL_NOT_FOUND', status: 404, message: 'الماكينة غير موجودة' };
    }

    if (terminal.status === 'suspended') {
      return { error: 'TERMINAL_SUSPENDED', status: 400, message: 'لا يمكن تغذية ماكينة موقوفة عن العمل' };
    }

    const subAccount = (input.sub_account === 'cash_out_balance' && terminal.has_dual_accounts) 
      ? 'cash_out_balance' 
      : 'main_balance';

    const now = new Date().toISOString();
    const txId = `ttx-${crypto.randomUUID()}`;
    const cashierId = user.id;
    const cashierName = user.name;
    const shiftId = user.active_shift?.shift_id || null;

    let newBalance = terminal.balance;
    let newCashOutBalance = terminal.cash_out_balance;

    if (subAccount === 'cash_out_balance') {
      newCashOutBalance += input.amount;
    } else {
      newBalance += input.amount;
    }

    // Determine status update for main_balance
    let newStatus = terminal.status;
    if (subAccount === 'main_balance' && terminal.status !== 'maintenance') {
      newStatus = (newBalance >= terminal.min_threshold) ? 'active' : 'low_balance';
    }

    const batchStatements: any[] = [];

    // 1. Terminal Balance Update
    batchStatements.push(
      db.prepare(`
        UPDATE telecom_terminals 
        SET balance = ?, cash_out_balance = ?, status = ?, updated_at = ?
        WHERE id = ? AND dashboard_id = ?
      `).bind(newBalance, newCashOutBalance, newStatus, now, terminalId, dashboardId)
    );

    // 2. Telecom Transaction Record
    batchStatements.push(
      db.prepare(`
        INSERT INTO telecom_transactions (
          id, dashboard_id, terminal_id, sub_account,
          category, type, service_name, service_code,
          amount, commission, service_fee, total_customer_amount,
          phone_or_ref, customer_name, cashier_profile_id, cashier_name,
          shift_id, source_of_funds, target_terminal_id, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        txId,
        dashboardId,
        terminalId,
        subAccount,
        'internal_ops',
        'top_up',
        `تغذية رصيد ${terminal.name}`,
        null,
        input.amount,
        0.0,
        0.0,
        0.0,
        terminal.account_number || terminal.name,
        null,
        cashierId,
        cashierName,
        shiftId,
        input.source_of_funds,
        null,
        input.notes || null,
        now
      )
    );

    // 3. Cash Drawer Impact: if funded from cash_drawer, register cash outflow in movements and update shift
    if (input.source_of_funds === 'cash_drawer') {
      const movementId = `cm-${crypto.randomUUID()}`;
      batchStatements.push(
        db.prepare(`
          INSERT INTO cash_movements (
            id, dashboard_id, type, category, amount,
            description, cashier_profile_id, cashier_name, shift_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          movementId,
          dashboardId,
          'out',
          'shift_adjustment',
          input.amount,
          `تغذية رصيد ماكينة/محفظة: ${terminal.name}`,
          cashierId,
          cashierName,
          shiftId,
          now
        )
      );

      // Central financial_movements ledger entry
      const finMovementId = `mov-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`;
      const today = new Date();
      const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
      const voucherNumber = `TOP-${dateStr}-${crypto.randomUUID().substring(0, 4).toUpperCase()}`;

      batchStatements.push(
        db.prepare(`
          INSERT INTO financial_movements (
            id, dashboard_id, invoice_number, department, movement_type, payment_method,
            subtotal, discount, total_amount, cost_amount, net_profit, paid_amount, remaining_amount,
            customer_id, customer_name, customer_phone, cashier_id, cashier_name,
            shift_id, terminal_id, telecom_transaction_id, items_json, telecom_details_json,
            split_details_json, notes, created_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?
          )
        `).bind(
          finMovementId,
          dashboardId,
          voucherNumber,
          'telecom',
          'cash_out',
          'cash',
          input.amount,
          0.0,
          input.amount,
          0.0,
          0.0,
          input.amount,
          0.0,
          null,
          'تغذية رصيد ماكينة من الدرج',
          '-',
          cashierId,
          cashierName,
          shiftId,
          terminalId,
          txId,
          JSON.stringify([{ terminal_name: terminal.name, amount: input.amount, source: 'cash_drawer' }]),
          JSON.stringify({ terminal_id: terminalId, action: 'top_up', account: subAccount }),
          null,
          input.notes || `تغذية رصيد ${terminal.name} من درج الكاشير`,
          now
        )
      );

      if (shiftId) {
        batchStatements.push(
          db.prepare(`
            UPDATE shifts 
            SET expected_cash = expected_cash - ?, updated_at = ? 
            WHERE id = ? AND dashboard_id = ? AND status = 'active'
          `).bind(input.amount, now, shiftId, dashboardId)
        );
      }
    }

    await db.batch(batchStatements);

    const transaction: TelecomTransaction = {
      id: txId,
      dashboard_id: dashboardId,
      terminal_id: terminalId,
      sub_account: subAccount,
      category: 'internal_ops',
      type: 'top_up',
      service_name: `تغذية رصيد ${terminal.name}`,
      service_code: null,
      amount: input.amount,
      commission: 0,
      service_fee: 0,
      total_customer_amount: 0,
      phone_or_ref: terminal.account_number || terminal.name,
      customer_name: null,
      cashier_profile_id: cashierId,
      cashier_name: cashierName,
      shift_id: shiftId,
      source_of_funds: input.source_of_funds,
      target_terminal_id: null,
      notes: input.notes || null,
      created_at: now
    };

    return { 
      message: 'تم شحن وتغذية الرصيد بنجاح', 
      transaction, 
      new_balance: (subAccount === 'cash_out_balance') ? newCashOutBalance : newBalance 
    };
  },

  /**
   * Withdraws balance / profits from a terminal or wallet.
   * Validates overdraft rules and deposits cash into cash drawer if destination is 'cash_drawer'.
   */
  async withdrawTerminal(
    db: D1Database, 
    dashboardId: string, 
    user: UserSession, 
    terminalId: string, 
    input: WithdrawTerminalInput
  ): Promise<{ error?: string; status?: number; message?: string; transaction?: TelecomTransaction; new_balance?: number }> {
    const terminal = await this.getTerminalById(db, dashboardId, terminalId);
    if (!terminal) {
      return { error: 'TERMINAL_NOT_FOUND', status: 404, message: 'الماكينة غير موجودة' };
    }

    if (terminal.status === 'suspended') {
      return { error: 'TERMINAL_SUSPENDED', status: 400, message: 'لا يمكن السحب من ماكينة موقوفة' };
    }

    const subAccount = (input.sub_account === 'cash_out_balance' && terminal.has_dual_accounts) 
      ? 'cash_out_balance' 
      : 'main_balance';

    let currentBalance = (subAccount === 'cash_out_balance') 
      ? terminal.cash_out_balance 
      : terminal.balance;

    const projectedBalance = currentBalance - input.amount;

    // Overdraft & Balance Validation
    if (subAccount === 'cash_out_balance') {
      if (projectedBalance < 0) {
        return { error: 'INSUFFICIENT_BALANCE', status: 400, message: 'رصيد حساب الكاش أوت غير كافٍ للسحب' };
      }
    } else {
      if (terminal.allow_overdraft) {
        if (projectedBalance < -terminal.overdraft_limit) {
          return { 
            error: 'OVERDRAFT_LIMIT_EXCEEDED', 
            status: 400, 
            message: `تجاوزت العملية الحد الأقصى للسلفة المسموح بها (${terminal.overdraft_limit} ج.م)` 
          };
        }
      } else {
        if (projectedBalance < 0) {
          return { error: 'INSUFFICIENT_BALANCE', status: 400, message: 'رصيد الماكينة غير كافٍ لإتمام السحب' };
        }
      }
    }

    const now = new Date().toISOString();
    const txId = `ttx-${crypto.randomUUID()}`;
    const cashierId = user.id;
    const cashierName = user.name;
    const shiftId = user.active_shift?.shift_id || null;

    let newBalance = terminal.balance;
    let newCashOutBalance = terminal.cash_out_balance;

    if (subAccount === 'cash_out_balance') {
      newCashOutBalance = projectedBalance;
    } else {
      newBalance = projectedBalance;
    }

    // Status evaluation
    let newStatus = terminal.status;
    if (subAccount === 'main_balance' && terminal.status !== 'maintenance') {
      newStatus = (newBalance < terminal.min_threshold) ? 'low_balance' : 'active';
    }

    const batchStatements: any[] = [];

    // 1. Terminal Balance Update
    batchStatements.push(
      db.prepare(`
        UPDATE telecom_terminals 
        SET balance = ?, cash_out_balance = ?, status = ?, updated_at = ?
        WHERE id = ? AND dashboard_id = ?
      `).bind(newBalance, newCashOutBalance, newStatus, now, terminalId, dashboardId)
    );

    // 2. Telecom Transaction Record
    batchStatements.push(
      db.prepare(`
        INSERT INTO telecom_transactions (
          id, dashboard_id, terminal_id, sub_account,
          category, type, service_name, service_code,
          amount, commission, service_fee, total_customer_amount,
          phone_or_ref, customer_name, cashier_profile_id, cashier_name,
          shift_id, source_of_funds, target_terminal_id, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        txId,
        dashboardId,
        terminalId,
        subAccount,
        'internal_ops',
        'withdraw',
        `سحب رصيد/أرباح من ${terminal.name}`,
        null,
        input.amount,
        0.0,
        0.0,
        0.0,
        terminal.account_number || terminal.name,
        null,
        cashierId,
        cashierName,
        shiftId,
        null,
        null,
        input.notes || null,
        now
      )
    );

    // 3. Cash Drawer Impact: if destination is cash_drawer, register cash inflow in master ledger and update shifts
    if (input.destination === 'cash_drawer') {
      const finMovementId = `mov-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`;
      const today = new Date();
      const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
      const voucherNumber = `LIQ-${dateStr}-${crypto.randomUUID().substring(0, 4).toUpperCase()}`;

      batchStatements.push(
        db.prepare(`
          INSERT INTO financial_movements (
            id, dashboard_id, invoice_number, department, movement_type, payment_method,
            subtotal, discount, total_amount, cost_amount, net_profit, paid_amount, remaining_amount,
            customer_id, customer_name, customer_phone, cashier_id, cashier_name,
            shift_id, terminal_id, telecom_transaction_id, items_json, telecom_details_json,
            split_details_json, notes, created_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?
          )
        `).bind(
          finMovementId,
          dashboardId,
          voucherNumber,
          'telecom',
          'cash_in',
          'cash',
          input.amount,
          0.0,
          input.amount,
          0.0,
          0.0,
          input.amount,
          0.0,
          null,
          'توريد نقدية من ماكينة',
          '-',
          cashierId,
          cashierName,
          shiftId,
          terminalId,
          txId,
          JSON.stringify([{ terminal_name: terminal.name, amount: input.amount, destination: 'cash_drawer' }]),
          JSON.stringify({ terminal_id: terminalId, action: 'withdraw', account: subAccount }),
          null,
          input.notes || `تسييل نقدية من ${terminal.name} إلى درج الكاشير`,
          now
        )
      );

      if (shiftId) {
        batchStatements.push(
          db.prepare(`
            UPDATE shifts 
            SET expected_cash = expected_cash + ? 
            WHERE id = ? AND dashboard_id = ?
          `).bind(input.amount, shiftId, dashboardId)
        );
      }
    }

    await db.batch(batchStatements);

    const transaction: TelecomTransaction = {
      id: txId,
      dashboard_id: dashboardId,
      terminal_id: terminalId,
      sub_account: subAccount,
      category: 'internal_ops',
      type: 'withdraw',
      service_name: `سحب رصيد/أرباح من ${terminal.name}`,
      service_code: null,
      amount: input.amount,
      commission: 0,
      service_fee: 0,
      total_customer_amount: 0,
      phone_or_ref: terminal.account_number || terminal.name,
      customer_name: null,
      cashier_profile_id: cashierId,
      cashier_name: cashierName,
      shift_id: shiftId,
      source_of_funds: null,
      target_terminal_id: null,
      notes: input.notes || null,
      created_at: now
    };

    return { 
      message: 'تم سحب الرصيد بنجاح', 
      transaction, 
      new_balance: (subAccount === 'cash_out_balance') ? newCashOutBalance : newBalance 
    };
  },

  /**
   * Transfers balance between two internal terminals or accounts within the shop.
   */
  async internalTransfer(
    db: D1Database, 
    dashboardId: string, 
    user: UserSession, 
    input: InternalTransferInput
  ): Promise<{ error?: string; status?: number; message?: string; transaction?: TelecomTransaction }> {
    if (input.source_terminal_id === input.target_terminal_id && 
        input.source_sub_account === input.target_sub_account) {
      return { 
        error: 'INVALID_TRANSFER_TARGET', 
        status: 400, 
        message: 'لا يمكن التحويل لنفس الماكينة ونفس الحساب' 
      };
    }

    const sourceTerminal = await this.getTerminalById(db, dashboardId, input.source_terminal_id);
    const targetTerminal = await this.getTerminalById(db, dashboardId, input.target_terminal_id);

    if (!sourceTerminal || !targetTerminal) {
      return { error: 'TERMINAL_NOT_FOUND', status: 404, message: 'إحدى ماكينات التحويل غير موجودة' };
    }

    if (sourceTerminal.status === 'suspended' || targetTerminal.status === 'suspended') {
      return { error: 'TERMINAL_SUSPENDED', status: 400, message: 'لا يمكن التحويل من أو إلى ماكينة موقوفة' };
    }

    const srcSub = (input.source_sub_account === 'cash_out_balance' && sourceTerminal.has_dual_accounts)
      ? 'cash_out_balance'
      : 'main_balance';

    const tgtSub = (input.target_sub_account === 'cash_out_balance' && targetTerminal.has_dual_accounts)
      ? 'cash_out_balance'
      : 'main_balance';

    const srcCurrentBalance = (srcSub === 'cash_out_balance') 
      ? sourceTerminal.cash_out_balance 
      : sourceTerminal.balance;

    const srcProjected = srcCurrentBalance - input.amount;

    // Overdraft check on source
    if (srcSub === 'cash_out_balance') {
      if (srcProjected < 0) {
        return { error: 'INSUFFICIENT_BALANCE', status: 400, message: 'رصيد الحساب المصدر غير كافٍ' };
      }
    } else {
      if (sourceTerminal.allow_overdraft) {
        if (srcProjected < -sourceTerminal.overdraft_limit) {
          return { 
            error: 'OVERDRAFT_LIMIT_EXCEEDED', 
            status: 400, 
            message: `تجاوزت العملية الحد الأقصى للسلفة المسموح بها في ${sourceTerminal.name}` 
          };
        }
      } else {
        if (srcProjected < 0) {
          return { error: 'INSUFFICIENT_BALANCE', status: 400, message: 'رصيد الماكينة المصدر غير كافٍ' };
        }
      }
    }

    const now = new Date().toISOString();
    const txId = `ttx-${crypto.randomUUID()}`;
    const cashierId = user.id;
    const cashierName = user.name;
    const shiftId = user.active_shift?.shift_id || null;

    // Source updates
    let srcNewBal = sourceTerminal.balance;
    let srcNewCashOut = sourceTerminal.cash_out_balance;
    if (srcSub === 'cash_out_balance') {
      srcNewCashOut = srcProjected;
    } else {
      srcNewBal = srcProjected;
    }
    let srcNewStatus = sourceTerminal.status;
    if (srcSub === 'main_balance' && sourceTerminal.status !== 'maintenance') {
      srcNewStatus = (srcNewBal < sourceTerminal.min_threshold) ? 'low_balance' : 'active';
    }

    // Target updates
    let tgtNewBal = targetTerminal.balance;
    let tgtNewCashOut = targetTerminal.cash_out_balance;
    if (tgtSub === 'cash_out_balance') {
      tgtNewCashOut += input.amount;
    } else {
      tgtNewBal += input.amount;
    }
    let tgtNewStatus = targetTerminal.status;
    if (tgtSub === 'main_balance' && targetTerminal.status !== 'maintenance') {
      tgtNewStatus = (tgtNewBal >= targetTerminal.min_threshold) ? 'active' : 'low_balance';
    }

    const batchStatements: any[] = [
      // Update Source
      db.prepare(`
        UPDATE telecom_terminals 
        SET balance = ?, cash_out_balance = ?, status = ?, updated_at = ?
        WHERE id = ? AND dashboard_id = ?
      `).bind(srcNewBal, srcNewCashOut, srcNewStatus, now, sourceTerminal.id, dashboardId),

      // Update Target
      db.prepare(`
        UPDATE telecom_terminals 
        SET balance = ?, cash_out_balance = ?, status = ?, updated_at = ?
        WHERE id = ? AND dashboard_id = ?
      `).bind(tgtNewBal, tgtNewCashOut, tgtNewStatus, now, targetTerminal.id, dashboardId),

      // Log Transaction
      db.prepare(`
        INSERT INTO telecom_transactions (
          id, dashboard_id, terminal_id, sub_account,
          category, type, service_name, service_code,
          amount, commission, service_fee, total_customer_amount,
          phone_or_ref, customer_name, cashier_profile_id, cashier_name,
          shift_id, source_of_funds, target_terminal_id, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        txId,
        dashboardId,
        sourceTerminal.id,
        srcSub,
        'internal_ops',
        'internal_transfer',
        `تحويل رصيد داخلي من ${sourceTerminal.name} إلى ${targetTerminal.name}`,
        null,
        input.amount,
        0.0,
        0.0,
        0.0,
        targetTerminal.account_number || targetTerminal.name,
        null,
        cashierId,
        cashierName,
        shiftId,
        null,
        targetTerminal.id,
        input.notes || null,
        now
      )
    ];

    await db.batch(batchStatements);

    const transaction: TelecomTransaction = {
      id: txId,
      dashboard_id: dashboardId,
      terminal_id: sourceTerminal.id,
      sub_account: srcSub,
      category: 'internal_ops',
      type: 'internal_transfer',
      service_name: `تحويل رصيد داخلي من ${sourceTerminal.name} إلى ${targetTerminal.name}`,
      service_code: null,
      amount: input.amount,
      commission: 0,
      service_fee: 0,
      total_customer_amount: 0,
      phone_or_ref: targetTerminal.account_number || targetTerminal.name,
      customer_name: null,
      cashier_profile_id: cashierId,
      cashier_name: cashierName,
      shift_id: shiftId,
      source_of_funds: null,
      target_terminal_id: targetTerminal.id,
      notes: input.notes || null,
      created_at: now
    };

    return { message: 'تم التحويل بين الماكينات بنجاح', transaction };
  },

  /**
   * Executes and records a customer-facing electronic service transaction.
   * Handles utilities, mobile recharges, bill payments, cash-in, and cash-out.
   * Atomically updates terminal balance, logs the transaction, and registers cash drawer movements.
   */
  async recordTransaction(
    db: D1Database, 
    dashboardId: string, 
    user: UserSession, 
    input: RecordTelecomTransactionInput
  ): Promise<{ error?: string; status?: number; message?: string; transaction?: TelecomTransaction; terminal?: TelecomTerminal }> {
    const terminal = await this.getTerminalById(db, dashboardId, input.terminal_id);
    if (!terminal) {
      return { error: 'TERMINAL_NOT_FOUND', status: 404, message: 'الماكينة المحددة غير موجودة' };
    }

    if (terminal.status === 'suspended') {
      return { error: 'TERMINAL_SUSPENDED', status: 400, message: 'الماكينة موقوفة عن العمل حالياً' };
    }

    if (terminal.status === 'maintenance') {
      return { error: 'TERMINAL_MAINTENANCE', status: 400, message: 'الماكينة تحت الصيانة حالياً' };
    }

    const subAccount = (input.sub_account === 'cash_out_balance' && terminal.has_dual_accounts)
      ? 'cash_out_balance'
      : 'main_balance';

    const commission = Number(input.commission || 0);
    const serviceFee = Number(input.service_fee || 0);
    const totalCustomerAmount = Number(
      input.total_customer_amount !== undefined 
        ? input.total_customer_amount 
        : (input.amount + serviceFee)
    );

    let newBalance = terminal.balance;
    let newCashOutBalance = terminal.cash_out_balance;

    // Financial balance mechanics depending on transaction type:
    // 1. cash_in / bill_payment / airtime:
    //    Digital money leaves the terminal -> terminal balance DECREASES.
    //    Physical cash enters the drawer -> cash drawer INCREASES.
    // 2. cash_out:
    //    Customer sends digital money into the terminal/wallet -> terminal balance INCREASES.
    //    Physical cash leaves drawer to customer -> cash drawer DECREASES.

    if (input.type === 'cash_out') {
      if (subAccount === 'cash_out_balance') {
        newCashOutBalance += input.amount;
      } else {
        newBalance += input.amount;
      }
    } else {
      // Deduction from machine (cash_in, bill_payment, airtime)
      const currentSubBalance = (subAccount === 'cash_out_balance') 
        ? newCashOutBalance 
        : newBalance;
      const projected = currentSubBalance - input.amount;

      if (subAccount === 'cash_out_balance') {
        if (projected < 0) {
          return { error: 'INSUFFICIENT_BALANCE', status: 400, message: 'رصيد حساب الكاش أوت غير كافٍ' };
        }
        newCashOutBalance = projected;
      } else {
        if (terminal.allow_overdraft) {
          if (projected < -terminal.overdraft_limit) {
            return { 
              error: 'OVERDRAFT_LIMIT_EXCEEDED', 
              status: 400, 
              message: `تجاوزت المعاملة الحد الأقصى للسلفة المسموح بها للماكينة (${terminal.overdraft_limit} ج.م)` 
            };
          }
        } else {
          if (projected < 0) {
            return { error: 'INSUFFICIENT_BALANCE', status: 400, message: 'رصيد الماكينة غير كافٍ لتنفيذ هذه العملية' };
          }
        }
        newBalance = projected;
      }
    }

    // Status recalculation for main_balance
    let newStatus = terminal.status;
    if (subAccount === 'main_balance') {
      newStatus = (newBalance < terminal.min_threshold) ? 'low_balance' : 'active';
    }

    const now = new Date().toISOString();
    const txId = `ttx-${crypto.randomUUID()}`;
    const cashierId = user.id;
    const cashierName = user.name;
    const shiftId = user.active_shift?.shift_id || null;

    const batchStatements: any[] = [];

    // 1. Terminal Balance Update
    batchStatements.push(
      db.prepare(`
        UPDATE telecom_terminals 
        SET balance = ?, cash_out_balance = ?, status = ?, updated_at = ?
        WHERE id = ? AND dashboard_id = ?
      `).bind(newBalance, newCashOutBalance, newStatus, now, terminal.id, dashboardId)
    );

    // 2. Telecom Transaction Record
    batchStatements.push(
      db.prepare(`
        INSERT INTO telecom_transactions (
          id, dashboard_id, terminal_id, sub_account,
          category, type, service_name, service_code,
          amount, commission, service_fee, total_customer_amount,
          phone_or_ref, customer_name, cashier_profile_id, cashier_name,
          shift_id, source_of_funds, target_terminal_id, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        txId,
        dashboardId,
        terminal.id,
        subAccount,
        input.category,
        input.type,
        input.service_name,
        input.service_code || null,
        input.amount,
        commission,
        serviceFee,
        totalCustomerAmount,
        input.phone_or_ref,
        input.customer_name || null,
        cashierId,
        cashierName,
        shiftId,
        null,
        null,
        input.notes || null,
        now
      )
    );

    // 3. Cash Drawer & Central Ledger (financial_movements & shifts) Synchronization
    const movementId = `cm-${crypto.randomUUID()}`;
    const finMovementId = `mov-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`;
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    const voucherNumber = `TX-${dateStr}-${crypto.randomUUID().substring(0, 4).toUpperCase()}`;

    if (input.type === 'cash_out') {
      // Cash given to customer from drawer (amount minus commission kept as profit)
      const netDrawerCash = Math.max(0, input.amount - commission);

      batchStatements.push(
        db.prepare(`
          INSERT INTO cash_movements (
            id, dashboard_id, type, category, amount,
            description, cashier_profile_id, cashier_name, shift_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          movementId,
          dashboardId,
          'out',
          'wallet_cash_out',
          netDrawerCash,
          `صرف كاش سحب محفظة/فيزا: ${input.service_name} (${input.phone_or_ref})`,
          cashierId,
          cashierName,
          shiftId,
          now
        )
      );

      // Central financial movements master ledger entry
      batchStatements.push(
        db.prepare(`
          INSERT INTO financial_movements (
            id, dashboard_id, invoice_number, department, movement_type, payment_method,
            subtotal, discount, total_amount, cost_amount, net_profit, paid_amount, remaining_amount,
            customer_id, customer_name, customer_phone, cashier_id, cashier_name,
            shift_id, terminal_id, telecom_transaction_id, items_json, telecom_details_json,
            split_details_json, notes, created_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?
          )
        `).bind(
          finMovementId,
          dashboardId,
          voucherNumber,
          'telecom',
          'telecom_service',
          'cash',
          input.amount,
          0.0,
          input.amount,
          netDrawerCash,
          commission,
          netDrawerCash,
          0.0,
          null,
          input.customer_name?.trim() || 'عميل نقدي',
          input.phone_or_ref,
          cashierId,
          cashierName,
          shiftId,
          terminal.id,
          txId,
          JSON.stringify([{ title: input.service_name, price: input.amount, quantity: 1, type: 'telecom_service' }]),
          JSON.stringify({ terminal_id: terminal.id, terminal_name: terminal.name, provider: terminal.provider, phone_or_ref: input.phone_or_ref, type: input.type, category: input.category, commission, service_fee: serviceFee }),
          null,
          input.notes || `صرف كاش سحب محفظة: ${input.service_name} (${input.phone_or_ref})`,
          now
        )
      );

      // Sync active shift drawer cash atomically
      if (shiftId) {
        batchStatements.push(
          db.prepare(`
            UPDATE shifts 
            SET expected_cash = expected_cash - ?, updated_at = ? 
            WHERE id = ? AND dashboard_id = ? AND status = 'active'
          `).bind(netDrawerCash, now, shiftId, dashboardId)
        );
      }
    } else {
      // cash_in, bill_payment, or airtime: Cash received from customer enters drawer
      const categoryLabel = input.type === 'cash_in' ? 'wallet_cash_in' : 'pos_sale';
      const descLabel = input.type === 'cash_in'
        ? `استلام كاش إيداع محفظة: ${input.service_name} (${input.phone_or_ref})`
        : `سداد خدمة/فاتورة سنترال: ${input.service_name} (${input.phone_or_ref})`;

      batchStatements.push(
        db.prepare(`
          INSERT INTO cash_movements (
            id, dashboard_id, type, category, amount,
            description, cashier_profile_id, cashier_name, shift_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          movementId,
          dashboardId,
          'in',
          categoryLabel,
          totalCustomerAmount,
          descLabel,
          cashierId,
          cashierName,
          shiftId,
          now
        )
      );

      // Central financial movements master ledger entry
      batchStatements.push(
        db.prepare(`
          INSERT INTO financial_movements (
            id, dashboard_id, invoice_number, department, movement_type, payment_method,
            subtotal, discount, total_amount, cost_amount, net_profit, paid_amount, remaining_amount,
            customer_id, customer_name, customer_phone, cashier_id, cashier_name,
            shift_id, terminal_id, telecom_transaction_id, items_json, telecom_details_json,
            split_details_json, notes, created_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?
          )
        `).bind(
          finMovementId,
          dashboardId,
          voucherNumber,
          'telecom',
          'telecom_service',
          'cash',
          input.amount,
          0.0,
          totalCustomerAmount,
          input.amount,
          commission,
          totalCustomerAmount,
          0.0,
          null,
          input.customer_name?.trim() || 'عميل نقدي',
          input.phone_or_ref,
          cashierId,
          cashierName,
          shiftId,
          terminal.id,
          txId,
          JSON.stringify([{ title: input.service_name, price: totalCustomerAmount, quantity: 1, type: 'telecom_service' }]),
          JSON.stringify({ terminal_id: terminal.id, terminal_name: terminal.name, provider: terminal.provider, phone_or_ref: input.phone_or_ref, type: input.type, category: input.category, commission, service_fee: serviceFee }),
          null,
          input.notes || descLabel,
          now
        )
      );

      // Sync active shift drawer cash atomically
      if (shiftId) {
        batchStatements.push(
          db.prepare(`
            UPDATE shifts 
            SET expected_cash = expected_cash + ?, updated_at = ? 
            WHERE id = ? AND dashboard_id = ? AND status = 'active'
          `).bind(totalCustomerAmount, now, shiftId, dashboardId)
        );
      }
    }

    // Execute atomic batch
    await db.batch(batchStatements);

    const transaction: TelecomTransaction = {
      id: txId,
      dashboard_id: dashboardId,
      terminal_id: terminal.id,
      sub_account: subAccount,
      category: input.category,
      type: input.type,
      service_name: input.service_name,
      service_code: input.service_code || null,
      amount: input.amount,
      commission,
      service_fee: serviceFee,
      total_customer_amount: totalCustomerAmount,
      phone_or_ref: input.phone_or_ref,
      customer_name: input.customer_name || null,
      cashier_profile_id: cashierId,
      cashier_name: cashierName,
      shift_id: shiftId,
      source_of_funds: null,
      target_terminal_id: null,
      notes: input.notes || null,
      created_at: now
    };

    const updatedTerminal: TelecomTerminal = {
      ...terminal,
      balance: newBalance,
      cash_out_balance: newCashOutBalance,
      status: newStatus as any,
      updated_at: now
    };

    return { 
      message: 'تم تنفيذ المعاملة وتسجيلها بنجاح', 
      transaction, 
      terminal: updatedTerminal 
    };
  },

  /**
   * Retrieves a paginated and filtered list of transactions.
   */
  async getTransactions(
    db: D1Database, 
    dashboardId: string, 
    query: TelecomFilterQuery
  ): Promise<PaginatedResult<TelecomTransaction>> {
    const pagination = getPaginationOptions(
      query.page ? String(query.page) : undefined, 
      query.limit ? String(query.limit) : undefined, 
      25
    );

    let whereClauses: string[] = ['dashboard_id = ?'];
    let params: any[] = [dashboardId];

    if (query.terminal_id && query.terminal_id !== 'all') {
      whereClauses.push('terminal_id = ?');
      params.push(query.terminal_id);
    }

    if (query.category && query.category !== 'all') {
      whereClauses.push('category = ?');
      params.push(query.category);
    }

    if (query.type && query.type !== 'all') {
      whereClauses.push('type = ?');
      params.push(query.type);
    }

    if (query.search && query.search.trim()) {
      whereClauses.push(`(
        phone_or_ref LIKE ? ESCAPE '\\' OR 
        customer_name LIKE ? ESCAPE '\\' OR 
        service_name LIKE ? ESCAPE '\\' OR 
        service_code LIKE ? ESCAPE '\\'
      )`);
      const pattern = `%${escapeLikePattern(query.search.trim())}%`;
      params.push(pattern, pattern, pattern, pattern);
    }

    if (query.start_date) {
      whereClauses.push('created_at >= ?');
      params.push(query.start_date);
    }

    if (query.end_date) {
      whereClauses.push('created_at <= ?');
      params.push(query.end_date);
    }

    const whereStr = `WHERE ${whereClauses.join(' AND ')}`;

    // Total count
    const countRow = await db.prepare(
      `SELECT COUNT(*) as total FROM telecom_transactions ${whereStr}`
    ).bind(...params).first<{ total: number }>();
    const total = countRow?.total || 0;

    // Data query
    const offset = (pagination.page - 1) * pagination.limit;
    const rows = await db.prepare(`
      SELECT * FROM telecom_transactions 
      ${whereStr} 
      ORDER BY created_at DESC 
      LIMIT ? OFFSET ?
    `).bind(...params, pagination.limit, offset).all<any>();

    const transactions: TelecomTransaction[] = (rows.results || []).map((row) => ({
      id: row.id,
      dashboard_id: row.dashboard_id,
      terminal_id: row.terminal_id,
      sub_account: row.sub_account,
      category: row.category,
      type: row.type,
      service_name: row.service_name,
      service_code: row.service_code,
      amount: Number(row.amount),
      commission: Number(row.commission),
      service_fee: Number(row.service_fee),
      total_customer_amount: Number(row.total_customer_amount),
      phone_or_ref: row.phone_or_ref,
      customer_name: row.customer_name,
      cashier_profile_id: row.cashier_profile_id,
      cashier_name: row.cashier_name,
      shift_id: row.shift_id,
      source_of_funds: row.source_of_funds,
      target_terminal_id: row.target_terminal_id,
      notes: row.notes,
      created_at: row.created_at
    }));

    return {
      data: transactions,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit) || 1
      }
    };
  },

  /**
   * Retrieves aggregated KPI analytics and stats for telecom operations.
   */
  async getTelecomStats(
    db: D1Database, 
    dashboardId: string
  ): Promise<TelecomStats> {
    // 1. Terminal balance & count metrics
    const terminalMetrics = await db.prepare(`
      SELECT 
        COALESCE(SUM(balance), 0) as total_digital_balance,
        COALESCE(SUM(cash_out_balance), 0) as total_cash_out_balance,
        COUNT(*) as total_terminals_count,
        COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) as active_terminals_count,
        COALESCE(SUM(CASE WHEN status = 'low_balance' THEN 1 ELSE 0 END), 0) as low_balance_terminals_count
      FROM telecom_terminals
      WHERE dashboard_id = ? AND status != 'suspended'
    `).bind(dashboardId).first<any>();

    // 2. Today's transaction volume, commission profits, and counts
    const todayMetrics = await db.prepare(`
      SELECT 
        COUNT(*) as today_transactions_count,
        COALESCE(SUM(CASE WHEN type IN ('cash_in', 'cash_out', 'bill_payment', 'airtime') THEN amount ELSE 0 END), 0) as today_transactions_volume,
        COALESCE(SUM(commission), 0) as today_commission_profit,
        COALESCE(SUM(CASE WHEN type = 'cash_in' THEN amount ELSE 0 END), 0) as today_cash_in_volume,
        COALESCE(SUM(CASE WHEN type = 'cash_out' THEN amount ELSE 0 END), 0) as today_cash_out_volume
      FROM telecom_transactions
      WHERE dashboard_id = ? AND DATE(created_at) = DATE('now')
    `).bind(dashboardId).first<any>();

    return {
      total_digital_balance: Number(terminalMetrics?.total_digital_balance || 0),
      total_cash_out_balance: Number(terminalMetrics?.total_cash_out_balance || 0),
      total_terminals_count: Number(terminalMetrics?.total_terminals_count || 0),
      active_terminals_count: Number(terminalMetrics?.active_terminals_count || 0),
      low_balance_terminals_count: Number(terminalMetrics?.low_balance_terminals_count || 0),
      today_transactions_count: Number(todayMetrics?.today_transactions_count || 0),
      today_transactions_volume: Number(todayMetrics?.today_transactions_volume || 0),
      today_commission_profit: Number(todayMetrics?.today_commission_profit || 0),
      today_cash_in_volume: Number(todayMetrics?.today_cash_in_volume || 0),
      today_cash_out_volume: Number(todayMetrics?.today_cash_out_volume || 0)
    };
  },

  /**
   * جلب ماكينات الدفع الإلكتروني والمحافظ المفعلة لنقطة البيع (POS)
   * يعزل البيانات حسب dashboard_id ويجلب الماكينات النشطة مع أرصدتها اللحظية
   */
  async getForPos(
    db: D1Database,
    dashboardId: string,
    filters?: PosTelecomFilters
  ): Promise<PosTelecomItem[]> {
    const whereClauses: string[] = ["dashboard_id = ?", "status IN ('active', 'low_balance')"];
    const params: any[] = [dashboardId];

    if (filters?.provider && filters.provider !== 'all' && filters.provider !== 'الكل') {
      whereClauses.push('provider = ?');
      params.push(filters.provider.trim());
    }

    if (filters?.type && filters.type !== 'all' && filters.type !== 'الكل') {
      whereClauses.push('category = ?');
      params.push(filters.type.trim());
    }

    if (filters?.search && filters.search.trim()) {
      const term = `%${escapeLikePattern(filters.search.trim())}%`;
      whereClauses.push(`(name LIKE ? ESCAPE '\\' OR account_number LIKE ? ESCAPE '\\' OR provider LIKE ? ESCAPE '\\')`);
      params.push(term, term, term);
    }

    const whereSQL = whereClauses.join(' AND ');

    const sql = `
      SELECT id, name, provider, category, balance, cash_out_balance, account_number, has_dual_accounts, allow_overdraft, overdraft_limit, min_threshold, status
      FROM telecom_terminals
      WHERE ${whereSQL}
      ORDER BY category ASC, name ASC;
    `;

    const { results } = await db.prepare(sql).bind(...params).all<any>();

    return (results || []).map((row) => ({
      id: row.id,
      name: row.name,
      provider: row.provider,
      category: row.category,
      type: row.category,
      balance: Number(row.balance || 0),
      cash_out_balance: Number(row.cash_out_balance || 0),
      account_number: row.account_number || null,
      terminal_code: row.category === 'pos' ? (row.account_number || null) : null,
      sim_number: row.category === 'wallet' ? (row.account_number || null) : null,
      is_dual_account: Boolean(row.has_dual_accounts),
      allow_negative: Boolean(row.allow_overdraft),
      allow_overdraft: Boolean(row.allow_overdraft),
      overdraft_limit: Number(row.overdraft_limit || 0),
      min_threshold: Number(row.min_threshold ?? 50),
      status: row.status,
    }));
  }
};
