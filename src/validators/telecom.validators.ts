import { z } from 'zod';
import { sanitizeForDb, sanitizeSearchInput } from '../utils/sanitize';

/**
 * ==============================================================================
 * MobiDash Telecom Validation Schemas
 * ==============================================================================
 * 
 * Strict validation and sanitization for POS terminals, digital wallets,
 * cash-in/cash-out, service bills, and internal transfers.
 * Fully aligned with migrations/telecom.sql and backend/src/types.ts
 */

const PROVIDERS = [
  'fawry', 'aman', 'masary', 'momken', 'khales',
  'vodafone', 'etisalat', 'orange', 'we',
  'instapay', 'bank', 'other'
] as const;

const TERMINAL_CATEGORIES = ['pos', 'wallet', 'bank'] as const;
const TERMINAL_STATUSES = ['active', 'low_balance', 'maintenance', 'suspended'] as const;
const SUB_ACCOUNTS = ['main_balance', 'cash_out_balance'] as const;
const SERVICE_CATEGORIES = [
  'utilities', 'telecom', 'wallet_transfer',
  'installments', 'education', 'insurance_social',
  'entertainment', 'government', 'internal_ops'
] as const;
const TRANSACTION_TYPES = ['cash_in', 'cash_out', 'bill_payment', 'airtime'] as const;
const SOURCES_OF_FUNDS = ['cash_drawer', 'bank', 'distributor', 'other'] as const;
const DESTINATIONS = ['cash_drawer', 'bank', 'other'] as const;

/** Schema for registering a new electronic payment terminal or wallet */
export const createTerminalSchema = z.object({
  name: z.string()
    .trim()
    .min(2, { message: 'name_too_short' })
    .max(100, { message: 'too_long' })
    .transform(sanitizeForDb),
  provider: z.enum(PROVIDERS, { message: 'invalid_provider' }),
  category: z.enum(TERMINAL_CATEGORIES).default('pos'),
  balance: z.number().default(0),
  has_dual_accounts: z.boolean().optional().default(false),
  cash_out_balance: z.number().min(0, { message: 'balance_cannot_be_negative' }).optional().default(0),
  allow_overdraft: z.boolean().optional().default(false),
  overdraft_limit: z.number().min(0, { message: 'overdraft_limit_min_zero' }).optional().default(0),
  min_threshold: z.number().min(0, { message: 'threshold_min_zero' }).optional().default(1000),
  account_number: z.string()
    .trim()
    .max(100)
    .optional()
    .nullable()
    .transform(val => val ? sanitizeForDb(val) : null),
  notes: z.string()
    .trim()
    .max(500)
    .optional()
    .nullable()
    .transform(val => val ? sanitizeForDb(val) : null),
});

/** Schema for updating an existing terminal or wallet */
export const updateTerminalSchema = z.object({
  name: z.string()
    .trim()
    .min(2, { message: 'name_too_short' })
    .max(100, { message: 'too_long' })
    .optional()
    .transform(val => val ? sanitizeForDb(val) : undefined),
  provider: z.enum(PROVIDERS).optional(),
  category: z.enum(TERMINAL_CATEGORIES).optional(),
  has_dual_accounts: z.boolean().optional(),
  allow_overdraft: z.boolean().optional(),
  overdraft_limit: z.number().min(0).optional(),
  min_threshold: z.number().min(0).optional(),
  account_number: z.string()
    .trim()
    .max(100)
    .optional()
    .nullable()
    .transform(val => val ? sanitizeForDb(val) : null),
  status: z.enum(TERMINAL_STATUSES).optional(),
  notes: z.string()
    .trim()
    .max(500)
    .optional()
    .nullable()
    .transform(val => val ? sanitizeForDb(val) : null),
});

/** Schema for topping up / depositing into a terminal or wallet */
export const topUpTerminalSchema = z.object({
  amount: z.number().positive({ message: 'amount_must_be_positive' }),
  sub_account: z.enum(SUB_ACCOUNTS).optional().default('main_balance'),
  source_of_funds: z.enum(SOURCES_OF_FUNDS, { message: 'invalid_source_of_funds' }),
  notes: z.string()
    .trim()
    .max(500)
    .optional()
    .nullable()
    .transform(val => val ? sanitizeForDb(val) : null),
});

/** Schema for withdrawing funds / cashing out from a terminal */
export const withdrawTerminalSchema = z.object({
  amount: z.number().positive({ message: 'amount_must_be_positive' }),
  sub_account: z.enum(SUB_ACCOUNTS).optional().default('main_balance'),
  destination: z.enum(DESTINATIONS).default('cash_drawer'),
  notes: z.string()
    .trim()
    .max(500)
    .optional()
    .nullable()
    .transform(val => val ? sanitizeForDb(val) : null),
});

/** Schema for transferring balance between two internal terminals */
export const internalTransferSchema = z.object({
  source_terminal_id: z.string().min(1, { message: 'source_terminal_required' }),
  source_sub_account: z.enum(SUB_ACCOUNTS).optional().default('main_balance'),
  target_terminal_id: z.string().min(1, { message: 'target_terminal_required' }),
  target_sub_account: z.enum(SUB_ACCOUNTS).optional().default('main_balance'),
  amount: z.number().positive({ message: 'amount_must_be_positive' }),
  notes: z.string()
    .trim()
    .max(500)
    .optional()
    .nullable()
    .transform(val => val ? sanitizeForDb(val) : null),
});

/** Schema for executing a customer service transaction (bill payment, airtime, cash-in, cash-out) */
export const recordTransactionSchema = z.object({
  terminal_id: z.string().min(1, { message: 'terminal_id_required' }),
  sub_account: z.enum(SUB_ACCOUNTS).optional().default('main_balance'),
  category: z.enum(SERVICE_CATEGORIES, { message: 'invalid_service_category' }),
  type: z.enum(TRANSACTION_TYPES, { message: 'invalid_transaction_type' }),
  service_name: z.string()
    .trim()
    .min(2, { message: 'service_name_required' })
    .max(150)
    .transform(sanitizeForDb),
  service_code: z.string()
    .trim()
    .max(50)
    .optional()
    .nullable()
    .transform(val => val ? sanitizeForDb(val) : null),
  amount: z.number().positive({ message: 'amount_must_be_positive' }),
  commission: z.number().min(0).optional().default(0),
  service_fee: z.number().min(0).optional().default(0),
  total_customer_amount: z.number().min(0).optional(),
  phone_or_ref: z.string()
    .trim()
    .min(2, { message: 'phone_or_ref_required' })
    .max(100)
    .transform(sanitizeForDb),
  customer_name: z.string()
    .trim()
    .max(100)
    .optional()
    .nullable()
    .transform(val => val ? sanitizeForDb(val) : null),
  notes: z.string()
    .trim()
    .max(500)
    .optional()
    .nullable()
    .transform(val => val ? sanitizeForDb(val) : null),
});

/** Query filter schema for telecom transactions and terminals */
export const telecomFilterSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  search: z.string().max(100).optional().transform(val => val ? sanitizeSearchInput(val, 100) : undefined),
  provider: z.string().trim().max(50).optional(),
  category: z.string().trim().max(50).optional(),
  status: z.string().trim().max(50).optional(),
  terminal_id: z.string().trim().max(100).optional(),
  type: z.string().trim().max(50).optional(),
  start_date: z.string().trim().max(50).optional(),
  end_date: z.string().trim().max(50).optional(),
});
