/**
 * ==============================================================================
 * MobiDash Platform - Central Financial & POS Movements Service
 * Location: backend/src/services/finances.services.ts
 * ==============================================================================
 * 
 * Provides unified, atomic financial transaction management for Point of Sale (POS)
 * operations across all departments:
 * 1. Retail Sales (Accessories, Phones, Spare Parts, Mixed Basket)
 * 2. Telecom & Wallet operations (Two-way linked with telecom_transactions)
 * 3. Atomic Multi-Table batch updates (Stock deduction, Phone sold status, Shift cash sync, Credit debt)
 * 4. High-performance aggregated analytics and KPIs
 * 
 * Strictly follows backend/docs/DATABASE_QUERIES_AND_INDEXING.md
 */

import { D1Database } from '@cloudflare/workers-types';
import {
  FinancialMovement,
  PosCheckoutInput,
  PosMovementFilterQuery,
  PosSalesStats,
  MovementDepartment,
  UserSession,
  CreateExpenseInput,
} from '../types';
import { CreateCashInInput } from '../validators/finances.validators';
import { escapeLikePattern } from '../utils/sanitize';
import { logger } from '../utils/logger';

export const FinancesService = {
  /**
   * Generates a clean, unique invoice number for the store.
   * Format: INV-YYYYMMDD-XXXX (e.g. INV-20261030-0012)
   */
  async generateInvoiceNumber(db: D1Database, dashboardId: string): Promise<string> {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');

    const countRow = await db.prepare(`
      SELECT COUNT(*) as count 
      FROM financial_movements 
      WHERE dashboard_id = ? AND DATE(created_at) = DATE('now')
    `).bind(dashboardId).first<{ count: number }>();

    const nextSeq = (Number(countRow?.count || 0) + 1).toString().padStart(4, '0');
    return `INV-${dateStr}-${nextSeq}`;
  },

  /**
   * Executes atomic POS checkout across all cart items and updates inventory,
   * shifts, telecom balances, customer debts, and registers the master movement.
   */
  async checkout(
    db: D1Database,
    dashboardId: string,
    currentUser: UserSession,
    input: PosCheckoutInput
  ): Promise<FinancialMovement> {
    if (!input.items || input.items.length === 0) {
      const err: any = new Error('سلة المبيعات فارغة، لا يمكن إتمام عملية البيع');
      err.slug = 'EMPTY_CART';
      throw err;
    }

    const now = new Date().toISOString();
    const movementId = `mov-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`;
    const invoiceNumber = await this.generateInvoiceNumber(db, dashboardId);
    const activeShiftId = currentUser.active_shift?.shift_id || null;

    // 1. Determine overarching business department
    const normalizedItems = input.items.map((i) => {
      const type = (i.type === 'part' ? 'spare_part' : i.type === 'telecom_service' ? 'telecom' : i.type) as any;
      return { ...i, type };
    });

    const itemTypes = new Set(normalizedItems.map((i) => i.type));
    let department: MovementDepartment = 'mixed_pos';
    if (itemTypes.size === 1) {
      const singleType = Array.from(itemTypes)[0];
      if (singleType === 'accessory') department = 'accessories';
      else if (singleType === 'phone') department = 'phones';
      else if (singleType === 'spare_part') department = 'spare_parts';
      else if (singleType === 'telecom') department = 'telecom';
    }

    // 2. Pre-verify inventory availability & calculate true cost
    let totalCost = 0;
    const statements: any[] = [];
    let linkedTelecomTxId: string | null = null;
    let linkedTerminalId: string | null = null;
    let telecomDetailsSnapshot: any = null;

    for (const item of normalizedItems) {
      const cleanId = String(item.id || '').replace(/^(acc|phone|part)-/, '').replace(/-\d{10,}$/, '');

      if (item.type === 'accessory') {
        const barcodeVal = item.barcode?.trim() || '';
        const acc = await db.prepare(`
          SELECT id, name, stock, cost_price, retail_price 
          FROM accessories 
          WHERE dashboard_id = ? AND (id = ? OR id = ? OR (barcode = ? AND barcode != ''))
        `).bind(dashboardId, cleanId, item.id, barcodeVal).first<{ id: string; name: string; stock: number; cost_price: number; retail_price: number }>();

        if (!acc) {
          const err: any = new Error(`صنف الإكسسوار غير موجود: ${item.title}`);
          err.slug = 'ITEM_NOT_FOUND';
          throw err;
        }

        if (acc.stock < item.quantity) {
          const err: any = new Error(`الكمية المتوفرة في المخزن من (${acc.name}) هي (${acc.stock}) قطعة فقط، والمطلوب (${item.quantity})`);
          err.slug = 'INSUFFICIENT_STOCK';
          throw err;
        }

        const cost = Number(item.cost_price || acc.cost_price || 0) * item.quantity;
        totalCost += cost;

        // Atomic stock decrement statement using real resolved DB id
        statements.push(
          db.prepare(`
            UPDATE accessories 
            SET stock = stock - ?, updated_by = ?, updated_at = ? 
            WHERE dashboard_id = ? AND id = ? AND stock >= ?
          `).bind(item.quantity, currentUser.id, now, dashboardId, acc.id, item.quantity)
        );
      } else if (item.type === 'phone') {
        const imeiVal = item.imei?.trim() || '';
        const phone = await db.prepare(`
          SELECT id, brand, model, imei, purchase_price, status 
          FROM phones 
          WHERE dashboard_id = ? AND (id = ? OR id = ? OR (imei = ? AND imei != ''))
        `).bind(dashboardId, cleanId, item.id, imeiVal).first<{ id: string; brand: string; model: string; imei: string; purchase_price: number; status: string }>();

        if (!phone) {
          const err: any = new Error(`الهاتف المطلوب غير موجود: ${item.title}`);
          err.slug = 'PHONE_NOT_FOUND';
          throw err;
        }

        if (phone.status !== 'in_stock') {
          const err: any = new Error(`الهاتف (${phone.brand} ${phone.model} - IMEI: ${phone.imei}) غير متاح للبيع (حالته: ${phone.status})`);
          err.slug = 'PHONE_NOT_AVAILABLE';
          throw err;
        }

        const cost = Number(phone.purchase_price || item.cost_price || 0);
        totalCost += cost;

        // Atomic phone status update statement using real resolved DB id
        statements.push(
          db.prepare(`
            UPDATE phones 
            SET status = 'sold', sold_price = ?, sold_at = ?, sold_by = ?, 
                buyer_name = ?, buyer_phone = ?, invoice_id = ?, updated_at = ?, updated_by = ? 
            WHERE dashboard_id = ? AND id = ? AND status = 'in_stock'
          `).bind(
            item.price,
            now,
            currentUser.id,
            input.customer_name?.trim() || 'عميل نقدي',
            input.customer_phone?.trim() || '-',
            invoiceNumber,
            now,
            currentUser.id,
            dashboardId,
            phone.id
          )
        );
      } else if (item.type === 'spare_part') {
        const part = await db.prepare(`
          SELECT id, name, stock, cost_price 
          FROM spare_parts 
          WHERE dashboard_id = ? AND (id = ? OR id = ?)
        `).bind(dashboardId, cleanId, item.id).first<{ id: string; name: string; stock: number; cost_price: number }>();

        if (!part) {
          const err: any = new Error(`قطعة الغيار غير موجودة: ${item.title}`);
          err.slug = 'PART_NOT_FOUND';
          throw err;
        }

        if (part.stock < item.quantity) {
          const err: any = new Error(`الكمية المتوفرة من قطعة الغيار (${part.name}) هي (${part.stock}) قطعة فقط`);
          err.slug = 'INSUFFICIENT_STOCK';
          throw err;
        }

        const cost = Number(item.cost_price || part.cost_price || 0) * item.quantity;
        totalCost += cost;

        // Atomic spare part stock decrement statement using real resolved DB id
        statements.push(
          db.prepare(`
            UPDATE spare_parts 
            SET stock = stock - ?, updated_by = ?, updated_at = ? 
            WHERE dashboard_id = ? AND id = ? AND stock >= ?
          `).bind(item.quantity, currentUser.id, now, dashboardId, part.id, item.quantity)
        );
      } else if (item.type === 'telecom') {
        if (item.telecom_details?.terminal_id) {
          const term = await db.prepare(`
            SELECT id, name, balance, has_dual_accounts, cash_out_balance, allow_overdraft, overdraft_limit, status 
            FROM telecom_terminals 
            WHERE dashboard_id = ? AND id = ?
          `).bind(dashboardId, item.telecom_details.terminal_id).first<any>();

          if (!term) {
            const err: any = new Error(`ماكينة أو محفظة السنترال غير موجودة: ${item.title}`);
            err.slug = 'TERMINAL_NOT_FOUND';
            throw err;
          }

          linkedTerminalId = term.id;
          linkedTelecomTxId = `ttx-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`;
          telecomDetailsSnapshot = item.telecom_details;

          const isCashOut = item.telecom_details.type === 'cash_out' || item.telecom_details.sub_account === 'cash_out_balance';
          const balanceColumn = isCashOut && term.has_dual_accounts ? 'cash_out_balance' : 'balance';
          const commission = Number(item.telecom_details.commission || 0);
          const serviceFee = Number(item.telecom_details.service_fee || 0);
          const serviceBaseAmount = Number(
            item.telecom_details.amount !== undefined
              ? item.telecom_details.amount
              : Math.max(0, Number(item.price) - commission)
          );
          const balanceChange = isCashOut ? serviceBaseAmount : -serviceBaseAmount;

          // Check overdraft limit on main balance when disbursing balance
          if (!isCashOut && balanceColumn === 'balance') {
            const projectedBalance = Number(term.balance || 0) + balanceChange;
            if (term.allow_overdraft) {
              const odLimit = Number(term.overdraft_limit || 0);
              if (projectedBalance < -odLimit) {
                const err: any = new Error(
                  `تجاوزت العملية الحد الأقصى للسلفة والائتمان المسموح به لماكينة (${term.name}) وهو ${odLimit} ج.م`
                );
                err.slug = 'OVERDRAFT_LIMIT_EXCEEDED';
                throw err;
              }
            } else {
              if (projectedBalance < 0) {
                const err: any = new Error(
                  `رصيد ماكينة (${term.name}) غير كافٍ، ولا تسمح هذه الماكينة برصيد سالب`
                );
                err.slug = 'INSUFFICIENT_BALANCE';
                throw err;
              }
            }
          }

          // Cost: the digital balance exiting the machine (or cash handed to customer in cash_out)
          const telecomCost = isCashOut ? Math.max(0, serviceBaseAmount - commission) : serviceBaseAmount;
          totalCost += telecomCost;

          // 1. Insert into telecom_transactions (Machine's dedicated detailed ledger)
          statements.push(
            db.prepare(`
              INSERT INTO telecom_transactions (
                id, dashboard_id, terminal_id, sub_account, category, type,
                service_name, service_code, amount, commission, service_fee,
                total_customer_amount, phone_or_ref, customer_name,
                cashier_profile_id, cashier_name, shift_id, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
              linkedTelecomTxId,
              dashboardId,
              term.id,
              isCashOut ? 'cash_out_balance' : 'main_balance',
              item.telecom_details.category || 'telecom',
              item.telecom_details.type || 'bill_payment',
              item.telecom_details.service_name || item.title,
              item.telecom_details.service_code || null,
              serviceBaseAmount,
              commission,
              serviceFee,
              Number(item.price + serviceFee),
              item.telecom_details.phone_or_ref || '-',
              input.customer_name?.trim() || null,
              currentUser.id,
              currentUser.name || 'الكاشير',
              activeShiftId,
              now
            )
          );

          // 2. Atomic terminal balance update statement (deducts only base amount, preserving store commission)
          statements.push(
            db.prepare(`
              UPDATE telecom_terminals 
              SET ${balanceColumn} = ${balanceColumn} + ?, updated_at = ? 
              WHERE dashboard_id = ? AND id = ?
            `).bind(balanceChange, now, dashboardId, term.id)
          );
        }
      }
    }

    // 3. Compute net profit
    const computedSubtotal = Number(input.subtotal ?? input.items.reduce((sum, item) => sum + (Number(item.price) * Number(item.quantity)), 0));
    const computedDiscount = Number(input.discount || 0);
    const computedTotal = Number(input.total ?? Math.max(0, computedSubtotal - computedDiscount));
    const netProfit = Math.max(0, computedTotal - totalCost);
    const paidAmount = Number(input.paid_amount || 0);
    const remainingAmount = Math.max(0, computedTotal - paidAmount);

    // 4. Master movement insert statement into financial_movements
    const movementInsertStmt = db.prepare(`
      INSERT INTO financial_movements (
        id, dashboard_id, invoice_number, department, movement_type, payment_method,
        subtotal, discount, total_amount, cost_amount, net_profit, paid_amount, remaining_amount,
        customer_id, customer_name, customer_phone, cashier_id, cashier_name, shift_id,
        terminal_id, telecom_transaction_id, items_json, telecom_details_json, split_details_json,
        notes, created_at
      ) VALUES (?, ?, ?, ?, 'sale', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      movementId,
      dashboardId,
      invoiceNumber,
      department,
      input.payment_method,
      computedSubtotal,
      computedDiscount,
      computedTotal,
      totalCost,
      netProfit,
      paidAmount,
      remainingAmount,
      input.customer_id?.trim() || null,
      input.customer_name?.trim() || 'عميل نقدي',
      input.customer_phone?.trim() || '-',
      currentUser.id,
      currentUser.name || 'الكاشير المسؤول',
      activeShiftId,
      linkedTerminalId,
      linkedTelecomTxId,
      JSON.stringify(input.items),
      telecomDetailsSnapshot ? JSON.stringify(telecomDetailsSnapshot) : null,
      input.split_details ? JSON.stringify(input.split_details) : null,
      input.notes?.trim() || null,
      now
    );

    // Add master movement as the primary operation
    statements.unshift(movementInsertStmt);

    // 5. If active shift exists, sync cash drawer atomically
    if (activeShiftId) {
      let cashToDrawer = 0;
      if (input.payment_method === 'cash') {
        cashToDrawer = paidAmount;
      } else if (input.payment_method === 'split' && input.split_details?.cash_amount) {
        cashToDrawer = Number(input.split_details.cash_amount);
      }

      if (cashToDrawer > 0) {
        statements.push(
          db.prepare(`
            UPDATE shifts 
            SET expected_cash = expected_cash + ?, updated_at = ? 
            WHERE dashboard_id = ? AND id = ? AND status = 'active'
          `).bind(cashToDrawer, now, dashboardId, activeShiftId)
        );
      }
    }

    // 6. If credit sale with remaining debt, link customer credit ledger
    if (remainingAmount > 0 && input.customer_id) {
      const creditTxId = `ctx-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`;
      statements.push(
        db.prepare(`
          INSERT INTO customer_credit_transactions (
            id, dashboard_id, credit_id, type, amount, balance_after,
            description, cashier_id, cashier_name, shift_id, invoice_id, created_at
          ) VALUES (?, ?, ?, 'debt', ?, 
            (SELECT balance_due + ? FROM customer_credits WHERE id = ? AND dashboard_id = ?),
            ?, ?, ?, ?, ?, ?
          )
        `).bind(
          creditTxId,
          dashboardId,
          input.customer_id,
          remainingAmount,
          remainingAmount,
          input.customer_id,
          dashboardId,
          `فاتورة مبيعات رقم ${invoiceNumber} (متبقي آجل)`,
          currentUser.id,
          currentUser.name || 'الكاشير',
          activeShiftId,
          invoiceNumber,
          now
        )
      );

      statements.push(
        db.prepare(`
          UPDATE customer_credits 
          SET balance_due = balance_due + ?, total_debt = total_debt + ?, 
              last_transaction_date = ?, updated_at = ? 
          WHERE dashboard_id = ? AND id = ?
        `).bind(remainingAmount, remainingAmount, now, now, dashboardId, input.customer_id)
      );
    }

    // 7. Execute all statements as one atomic batch (Single subrequest)
    await db.batch(statements);

    logger.info(
      'finances-service',
      `[FinancesService] POS Checkout complete: ${invoiceNumber} (${input.items.length} items) Total: ${input.total} EGP (Profit: ${netProfit}) by ${currentUser.name}`
    );

    return {
      id: movementId,
      dashboard_id: dashboardId,
      invoice_number: invoiceNumber,
      department,
      movement_type: 'sale',
      payment_method: input.payment_method,
      subtotal: Number(input.subtotal),
      discount: Number(input.discount || 0),
      total_amount: Number(input.total),
      cost_amount: totalCost,
      net_profit: netProfit,
      paid_amount: paidAmount,
      remaining_amount: remainingAmount,
      customer_id: input.customer_id || null,
      customer_name: input.customer_name?.trim() || 'عميل نقدي',
      customer_phone: input.customer_phone?.trim() || '-',
      cashier_id: currentUser.id,
      cashier_name: currentUser.name || 'الكاشير المسؤول',
      shift_id: activeShiftId,
      terminal_id: linkedTerminalId,
      telecom_transaction_id: linkedTelecomTxId,
      items_json: JSON.stringify(input.items),
      telecom_details_json: telecomDetailsSnapshot ? JSON.stringify(telecomDetailsSnapshot) : null,
      split_details_json: input.split_details ? JSON.stringify(input.split_details) : null,
      notes: input.notes?.trim() || null,
      created_at: now,
    };
  },

  /**
   * Retrieves paginated list of financial movements with search and multi-criteria filters.
   */
  async getMovements(
    db: D1Database,
    dashboardId: string,
    query: PosMovementFilterQuery
  ): Promise<{ data: FinancialMovement[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const offset = (page - 1) * limit;

    const whereClauses: string[] = ['dashboard_id = ?'];
    const params: any[] = [dashboardId];

    if (query.department && query.department !== 'all') {
      whereClauses.push('department = ?');
      params.push(query.department);
    }

    if (query.movement_type && query.movement_type !== 'all') {
      whereClauses.push('movement_type = ?');
      params.push(query.movement_type);
    }

    if (query.payment_method && query.payment_method !== 'all') {
      whereClauses.push('payment_method = ?');
      params.push(query.payment_method);
    }

    if (query.shift_id) {
      whereClauses.push('shift_id = ?');
      params.push(query.shift_id);
    }

    if (query.start_date) {
      whereClauses.push('DATE(created_at) >= DATE(?)');
      params.push(query.start_date);
    }

    if (query.end_date) {
      whereClauses.push('DATE(created_at) <= DATE(?)');
      params.push(query.end_date);
    }

    if (query.search && query.search.trim()) {
      const term = `%${escapeLikePattern(query.search.trim())}%`;
      whereClauses.push(`(
        invoice_number LIKE ? ESCAPE '\\' OR 
        customer_name LIKE ? ESCAPE '\\' OR 
        customer_phone LIKE ? ESCAPE '\\' OR 
        cashier_name LIKE ? ESCAPE '\\'
      )`);
      params.push(term, term, term, term);
    }

    const whereSQL = whereClauses.join(' AND ');

    // 1. Total count query
    const countRow = await db.prepare(`SELECT COUNT(*) as total FROM financial_movements WHERE ${whereSQL}`).bind(...params).first<{ total: number }>();
    const total = Number(countRow?.total || 0);

    // 2. Data rows query
    const dataSQL = `
      SELECT * FROM financial_movements 
      WHERE ${whereSQL} 
      ORDER BY created_at DESC 
      LIMIT ? OFFSET ?
    `;
    const { results } = await db.prepare(dataSQL).bind(...params, limit, offset).all<FinancialMovement>();

    return {
      data: results || [],
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  },

  /**
   * Retrieves high-performance aggregated sales and profit KPIs for today or custom date range.
   */
  async getSalesStats(
    db: D1Database,
    dashboardId: string,
    startDate?: string,
    endDate?: string
  ): Promise<PosSalesStats> {
    const whereClauses: string[] = ['dashboard_id = ?'];
    const params: any[] = [dashboardId];

    if (startDate && endDate) {
      whereClauses.push('DATE(created_at) >= ? AND DATE(created_at) <= ?');
      params.push(startDate, endDate);
    } else if (startDate) {
      whereClauses.push('DATE(created_at) >= ?');
      params.push(startDate);
    } else if (endDate) {
      whereClauses.push('DATE(created_at) <= ?');
      params.push(endDate);
    } else {
      whereClauses.push("DATE(created_at) = DATE('now')");
    }

    const whereStr = whereClauses.join(' AND ');

    const statsQuery = `
      SELECT
        COALESCE(SUM(CASE WHEN movement_type IN ('sale', 'telecom_service') THEN total_amount ELSE 0 END), 0) as today_sales_revenue,
        COALESCE(SUM(CASE WHEN movement_type IN ('sale', 'telecom_service') THEN net_profit ELSE 0 END), 0) as today_net_profit,
        COALESCE(SUM(CASE WHEN movement_type IN ('sale', 'telecom_service') THEN 1 ELSE 0 END), 0) as today_transactions_count,
        COALESCE(SUM(
          CASE 
            WHEN movement_type IN ('sale', 'telecom_service') AND payment_method = 'cash' THEN paid_amount 
            WHEN movement_type IN ('sale', 'telecom_service') AND payment_method = 'split' THEN COALESCE(CAST(json_extract(split_details_json, '$.cash_amount') AS REAL), 0)
            ELSE 0 
          END
        ), 0) as today_cash_collected,
        COALESCE(SUM(
          CASE 
            WHEN movement_type IN ('sale', 'telecom_service') AND payment_method IN ('card', 'wallet') THEN paid_amount 
            WHEN movement_type IN ('sale', 'telecom_service') AND payment_method = 'split' THEN COALESCE(CAST(json_extract(split_details_json, '$.electronic_amount') AS REAL), 0)
            ELSE 0 
          END
        ), 0) as today_electronic_collected,
        COALESCE(SUM(
          CASE 
            WHEN payment_method = 'cash' AND movement_type IN ('sale', 'cash_in', 'telecom_service') THEN paid_amount 
            WHEN payment_method = 'split' AND movement_type IN ('sale', 'cash_in', 'telecom_service') THEN COALESCE(CAST(json_extract(split_details_json, '$.cash_amount') AS REAL), 0)
            ELSE 0 
          END
        ), 0) as today_cash_in,
        COALESCE(SUM(CASE WHEN movement_type IN ('expense', 'cash_out', 'refund') THEN paid_amount ELSE 0 END), 0) as today_cash_out,
        COALESCE(SUM(CASE WHEN movement_type = 'expense' THEN total_amount ELSE 0 END), 0) as today_expenses,
        COALESCE(SUM(CASE WHEN movement_type IN ('sale', 'telecom_service') AND department = 'accessories' THEN total_amount ELSE 0 END), 0) as accessories_revenue,
        COALESCE(SUM(CASE WHEN movement_type IN ('sale', 'telecom_service') AND department = 'phones' THEN total_amount ELSE 0 END), 0) as phones_revenue,
        COALESCE(SUM(CASE WHEN movement_type IN ('sale', 'telecom_service') AND department = 'spare_parts' THEN total_amount ELSE 0 END), 0) as spare_parts_revenue,
        COALESCE(SUM(CASE WHEN movement_type IN ('sale', 'telecom_service') AND department = 'telecom' THEN total_amount ELSE 0 END), 0) as telecom_revenue
      FROM financial_movements
      WHERE ${whereStr};
    `;

    const row = await db.prepare(statsQuery).bind(...params).first<any>();

    return {
      today_sales_revenue: Number(row?.today_sales_revenue || 0),
      today_net_profit: Number(row?.today_net_profit || 0),
      today_transactions_count: Number(row?.today_transactions_count || 0),
      today_cash_collected: Number(row?.today_cash_collected || 0),
      today_electronic_collected: Number(row?.today_electronic_collected || 0),
      today_cash_in: Number(row?.today_cash_in || 0),
      today_cash_out: Number(row?.today_cash_out || 0),
      today_expenses: Number(row?.today_expenses || 0),
      departments: {
        accessories_revenue: Number(row?.accessories_revenue || 0),
        phones_revenue: Number(row?.phones_revenue || 0),
        spare_parts_revenue: Number(row?.spare_parts_revenue || 0),
        telecom_revenue: Number(row?.telecom_revenue || 0),
      },
    };
  },

  /**
   * Registers a petty/operational expense atomically into financial_movements
   * and deducts cash directly from the active shift drawer.
   */
  async recordExpense(
    db: D1Database,
    dashboardId: string,
    currentUser: UserSession,
    input: CreateExpenseInput
  ): Promise<FinancialMovement> {
    const now = new Date().toISOString();
    const movementId = `mov-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`;
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    const countRow = await db.prepare(`
      SELECT COUNT(*) as count FROM financial_movements 
      WHERE dashboard_id = ? AND DATE(created_at) = DATE('now')
    `).bind(dashboardId).first<{ count: number }>();
    const nextSeq = (Number(countRow?.count || 0) + 1).toString().padStart(4, '0');
    const voucherNumber = `EXP-${dateStr}-${nextSeq}`;

    const activeShiftId = currentUser.active_shift?.shift_id || null;
    const batchStatements: any[] = [];

    // 1. Insert expense movement
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
        movementId,
        dashboardId,
        voucherNumber,
        'general_finance',
        'expense',
        'cash',
        input.amount,
        0.0,
        input.amount,
        input.amount,
        -input.amount,
        input.amount,
        0.0,
        null,
        'مصروفات تشغيلية',
        '-',
        currentUser.id,
        currentUser.name || 'الكاشير المسؤول',
        activeShiftId,
        null,
        null,
        JSON.stringify([{ category: input.category, description: input.description }]),
        null,
        null,
        input.description.trim(),
        now
      )
    );

    // 2. Decrement expected cash from active shift
    if (activeShiftId) {
      batchStatements.push(
        db.prepare(`
          UPDATE shifts 
          SET expected_cash = expected_cash - ? 
          WHERE id = ? AND dashboard_id = ?
        `).bind(input.amount, activeShiftId, dashboardId)
      );
    }

    await db.batch(batchStatements);

    return {
      id: movementId,
      dashboard_id: dashboardId,
      invoice_number: voucherNumber,
      department: 'general_finance',
      movement_type: 'expense',
      payment_method: 'cash',
      subtotal: input.amount,
      discount: 0,
      total_amount: input.amount,
      cost_amount: input.amount,
      net_profit: -input.amount,
      paid_amount: input.amount,
      remaining_amount: 0,
      customer_id: null,
      customer_name: 'مصروفات تشغيلية',
      customer_phone: '-',
      cashier_id: currentUser.id,
      cashier_name: currentUser.name || 'الكاشير المسؤول',
      shift_id: activeShiftId,
      terminal_id: null,
      telecom_transaction_id: null,
      items_json: JSON.stringify([{ category: input.category, description: input.description }]),
      telecom_details_json: null,
      split_details_json: null,
      notes: input.description.trim(),
      created_at: now,
    };
  },

  /**
   * Registers a cash deposit (Cash In) atomically into financial_movements
   * and increments cash directly in the active shift drawer.
   */
  async recordCashIn(
    db: D1Database,
    dashboardId: string,
    currentUser: UserSession,
    input: CreateCashInInput
  ): Promise<FinancialMovement> {
    const now = new Date().toISOString();
    const movementId = `mov-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`;
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    const countRow = await db.prepare(`
      SELECT COUNT(*) as count FROM financial_movements 
      WHERE dashboard_id = ? AND DATE(created_at) = DATE('now')
    `).bind(dashboardId).first<{ count: number }>();
    const nextSeq = (Number(countRow?.count || 0) + 1).toString().padStart(4, '0');
    const voucherNumber = `CIN-${dateStr}-${nextSeq}`;

    const activeShiftId = currentUser.active_shift?.shift_id || null;
    const batchStatements: any[] = [];

    // 1. Insert cash_in movement into financial_movements
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
        movementId,
        dashboardId,
        voucherNumber,
        'general_finance',
        'cash_in',
        'cash',
        input.amount,
        0.0,
        input.amount,
        0.0,
        0.0, // net profit is 0 (it's capital/liquidity deposit, not sales net profit)
        input.amount,
        0.0,
        null,
        input.source.trim(), // Source / from whom (e.g. "إيداع من المالك")
        '-',
        currentUser.id,
        currentUser.name || 'الكاشير المسؤول',
        activeShiftId,
        null,
        null,
        JSON.stringify([{ source: input.source.trim(), reason: input.reason.trim() }]),
        null,
        null,
        input.reason.trim(),
        now
      )
    );

    // 2. Increment expected cash in active shift (drawer cash)
    if (activeShiftId) {
      batchStatements.push(
        db.prepare(`
          UPDATE shifts 
          SET expected_cash = expected_cash + ? 
          WHERE id = ? AND dashboard_id = ?
        `).bind(input.amount, activeShiftId, dashboardId)
      );
    }

    await db.batch(batchStatements);

    return {
      id: movementId,
      dashboard_id: dashboardId,
      invoice_number: voucherNumber,
      department: 'general_finance',
      movement_type: 'cash_in',
      payment_method: 'cash',
      subtotal: input.amount,
      discount: 0,
      total_amount: input.amount,
      cost_amount: 0,
      net_profit: 0,
      paid_amount: input.amount,
      remaining_amount: 0,
      customer_id: null,
      customer_name: input.source.trim(),
      customer_phone: '-',
      cashier_id: currentUser.id,
      cashier_name: currentUser.name || 'الكاشير المسؤول',
      shift_id: activeShiftId,
      terminal_id: null,
      telecom_transaction_id: null,
      items_json: JSON.stringify([{ source: input.source.trim(), reason: input.reason.trim() }]),
      telecom_details_json: null,
      split_details_json: null,
      notes: input.reason.trim(),
      created_at: now,
    };
  },
};
