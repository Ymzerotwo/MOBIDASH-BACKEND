import { z } from 'zod';
import { sanitizeForDb } from '../utils/sanitize';

/**
 * ==============================================================================
 * MobiDash Platform - POS Checkout & Movement Query Validators
 * Location: backend/src/validators/pos_checkout.validators.ts
 * ==============================================================================
 */

export const posCartItemSchema = z.object({
  id: z.string().trim().min(1, 'معرف الصنف مطلوب'),
  type: z.enum(['accessory', 'phone', 'spare_part', 'part', 'telecom', 'telecom_service', 'custom']),
  title: z.string().trim().min(1, 'اسم الصنف مطلوب'),
  quantity: z.coerce.number().int().min(1, 'الكمية يجب أن تكون 1 على الأقل'),
  price: z.coerce.number().min(0, 'سعر البيع لا يمكن أن يكون سالباً'),
  cost_price: z.coerce.number().min(0).optional().default(0),
  costPrice: z.coerce.number().min(0).optional(),
  total_price: z.coerce.number().min(0).optional(),
  barcode: z.string().trim().optional().nullable(),
  imei: z.string().trim().optional().nullable(),
  terminal_id: z.string().trim().optional().nullable(),
  telecom_action: z.string().trim().optional().nullable(),
  telecom_amount: z.coerce.number().min(0).optional().nullable(),
  customer_phone: z.string().trim().optional().nullable(),
  agent_commission: z.coerce.number().min(0).optional().default(0),
  service_fee: z.coerce.number().min(0).optional().default(0),
  telecom_details: z
    .object({
      terminal_id: z.string().trim().min(1),
      sub_account: z.enum(['main_balance', 'cash_out_balance']).default('main_balance'),
      category: z.string().trim().default('telecom'),
      type: z.string().trim().default('bill_payment'),
      service_name: z.string().trim(),
      service_code: z.string().trim().optional().nullable(),
      phone_or_ref: z.string().trim(),
      commission: z.coerce.number().min(0).optional().default(0),
      service_fee: z.coerce.number().min(0).optional().default(0),
    })
    .optional()
    .nullable(),
});

export const posCheckoutSchema = z.object({
  items: z.array(posCartItemSchema).min(1, 'يجب أن تحتوي سلة المبيعات على صنف واحد على الأقل'),
  subtotal: z.coerce.number().min(0, 'المجموع الفرعي غير صالح').optional(),
  discount: z.coerce.number().min(0, 'الخصم لا يمكن أن يكون سالباً').optional().default(0),
  total: z.coerce.number().min(0, 'المبلغ الإجمالي غير صالح').optional(),
  paid_amount: z.coerce.number().min(0, 'المبلغ المدفوع غير صالح'),
  payment_method: z.enum(['cash', 'card', 'wallet', 'credit', 'split']).default('cash'),
  split_details: z
    .object({
      cash_amount: z.coerce.number().min(0).default(0),
      electronic_amount: z.coerce.number().min(0).default(0),
      card_amount: z.coerce.number().min(0).default(0),
      wallet_amount: z.coerce.number().min(0).default(0),
      electronic_method: z.enum(['card', 'wallet']).optional(),
      card_terminal_id: z.string().optional().nullable(),
      wallet_terminal_id: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
  customer_id: z.string().trim().optional().nullable(),
  customer_name: z.string().trim().max(100).optional().default('عميل نقدي'),
  customer_phone: z.string().trim().max(25).optional().default('-'),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const posMovementsQuerySchema = z.object({
  department: z.string().trim().optional(),
  movement_type: z.string().trim().optional(),
  payment_method: z.string().trim().optional(),
  shift_id: z.string().trim().optional(),
  start_date: z.string().trim().optional(),
  end_date: z.string().trim().optional(),
  search: z.string().trim().max(100).transform((val) => (val ? sanitizeForDb(val) : val)).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type PosCheckoutPayload = z.infer<typeof posCheckoutSchema>;
export type PosMovementsQueryPayload = z.infer<typeof posMovementsQuerySchema>;
