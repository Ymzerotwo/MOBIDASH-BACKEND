import { z } from 'zod';
import { sanitizeForDb } from '../utils/sanitize';

/**
 * ==========================================
 *        MobiDash Team Validation Schemas
 * ==========================================
 * 
 * Uses Zod to validate and sanitize incoming data for team management endpoints,
 * fully aligned with user_profile table in 0000_auth.sql.
 */

/** Schema for creating a new team member */
export const createTeamMemberSchema = z.object({
  name: z.string().trim().min(2, { message: 'name_too_short' }).max(100, { message: 'too_long' }).transform(sanitizeForDb),
  phone: z.string().trim().min(8, { message: 'phone_too_short' }).max(30, { message: 'too_long' }),
  password: z.string().min(6, { message: 'password_too_short' }).max(255),
  pin: z.string().optional().nullable(),
  role: z.enum(['owner', 'user', 'cashier', 'manager', 'technician']).default('user'),
  job_title: z.string().trim().max(100).optional().nullable().transform(val => val ? sanitizeForDb(val) : val),
  permissions: z.record(z.string(), z.boolean()).optional().default({}),
  salary: z.number().min(0).optional().default(0),
  commission_rate: z.number().min(0).max(100).optional().default(0),
  can_open_drawer: z.boolean().optional().default(true),
  can_view_cost_price: z.boolean().optional().default(false),
});

/** Schema for updating an existing team member's profile */
export const updateTeamMemberSchema = z.object({
  name: z.string().trim().min(2, { message: 'name_too_short' }).max(100, { message: 'too_long' }).optional().transform(val => val ? sanitizeForDb(val) : val),
  phone: z.string().trim().min(8, { message: 'phone_too_short' }).max(30, { message: 'too_long' }).optional(),
  pin: z.string().trim().min(4, { message: 'pin_too_short' }).max(8, { message: 'pin_too_long' }).regex(/^\d+$/, { message: 'pin_digits_only' }).optional(),
  password: z.string().min(6, { message: 'password_too_short' }).max(255).optional().or(z.literal('')),
  role: z.enum(['owner', 'user', 'cashier', 'manager', 'technician']).optional(),
  job_title: z.string().trim().max(100).optional().nullable().transform(val => val ? sanitizeForDb(val) : val),
  permissions: z.record(z.string(), z.boolean()).optional().nullable(),
  salary: z.number().min(0).optional(),
  commission_rate: z.number().min(0).max(100).optional(),
  can_open_drawer: z.boolean().optional(),
  can_view_cost_price: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

/** Schema for toggling a user's active/ban status */
export const toggleStatusSchema = z.object({
  is_banned: z.boolean().optional(),
  is_active: z.boolean().optional(),
  ban_reason: z.string().max(255).optional(),
});

/** Schema for deleting a team member */
export const deleteTeamMemberSchema = z.object({
  id: z.string().min(1, { message: 'id_required' }),
});

export type CreateTeamMemberInput = z.infer<typeof createTeamMemberSchema>;
export type UpdateTeamMemberInput = z.infer<typeof updateTeamMemberSchema>;
export type ToggleStatusInput = z.infer<typeof toggleStatusSchema>;
export type DeleteTeamMemberInput = z.infer<typeof deleteTeamMemberSchema>;
