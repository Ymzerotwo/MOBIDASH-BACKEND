import { z } from 'zod';
import { sanitizeForDb } from '../utils/sanitize';

/**
 * ==============================================================================
 * MobiDash Platform - POS Catalog Query Validators
 * Location: backend/src/validators/pos.validators.ts
 * ==============================================================================
 * 
 * Strict input validation for Point of Sale catalog queries across all departments:
 * - Accessories
 * - Phones
 * - Spare Parts
 * - Telecom & Wallets
 */

export const posAccessoriesQuerySchema = z.object({
  category: z.string().trim().max(100).optional(),
  search: z.string().trim().max(100).transform((val) => (val ? sanitizeForDb(val) : val)).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const posPhonesQuerySchema = z.object({
  brand: z.string().trim().max(50).optional(),
  condition: z.enum(['new', 'used_like_new', 'used']).optional(),
  search: z.string().trim().max(100).transform((val) => (val ? sanitizeForDb(val) : val)).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const posSparePartsQuerySchema = z.object({
  category: z.string().trim().max(100).optional(),
  search: z.string().trim().max(100).transform((val) => (val ? sanitizeForDb(val) : val)).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const posTelecomQuerySchema = z.object({
  provider: z.string().trim().max(50).optional(),
  type: z.string().trim().max(50).optional(),
  search: z.string().trim().max(100).transform((val) => (val ? sanitizeForDb(val) : val)).optional(),
});

export type PosAccessoriesQueryInput = z.infer<typeof posAccessoriesQuerySchema>;
export type PosPhonesQueryInput = z.infer<typeof posPhonesQuerySchema>;
export type PosSparePartsQueryInput = z.infer<typeof posSparePartsQuerySchema>;
export type PosTelecomQueryInput = z.infer<typeof posTelecomQuerySchema>;
