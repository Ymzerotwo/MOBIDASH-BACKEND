/**
 * ==============================================================================
 * MobiDash Platform - Store & System Settings Service
 * ==============================================================================
 * 
 * Business logic layer for retrieving and updating Store & System Settings
 * stored in the `Dashboards` root tenant table.
 * 
 * Architectural & Security Invariants:
 * 1. Strict Tenant Isolation: All operations are strictly bound by `WHERE id = ?`
 *    using the authenticated tenant's `dashboardId`.
 * 2. Sensitive Field Protection: Never selects or exposes `password_hash`,
 *    `is_banned`, `ban_reason`, `status`, or `is_default`.
 * 3. SQLite Type Impedance Matching:
 *    - Converts integer flags (0 / 1) in SQLite to JavaScript `boolean` on reads.
 *    - Converts JavaScript `boolean` to integer (0 / 1) on writes.
 * 4. Numeric & Nullish Safety:
 *    - Uses nullish coalescing (`??`) to preserve legitimate zero values (`tax_rate: 0`, `opening_cash_default: 0`).
 * 5. Unique Constraint Pre-Checking:
 *    - Validates `phone` uniqueness across other dashboards before execution,
 *      returning a clean 409 Conflict domain error instead of a raw SQLite constraint exception.
 * 6. Dynamic Parameterized Updates:
 *    - Builds SQL queries dynamically using an explicit whitelist of allowed columns
 *      with positional parameter binding `?`, entirely preventing SQL injection and mass assignment.
 */

import { D1Database } from '@cloudflare/workers-types';
import {
  StoreSettings,
  UpdateStoreSettingsInput,
  ThermalPaperSize,
  DashboardTheme,
  DashboardLocale,
} from '../types';

export interface SettingsServiceError {
  error: string;
  message: string;
  status: number;
}

/**
 * Maps a raw SQLite database row from the `Dashboards` table
 * to the strongly-typed `StoreSettings` domain model.
 */
function mapRowToStoreSettings(row: any): StoreSettings {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    phone: String(row.phone),
    email: row.email !== null && row.email !== undefined ? String(row.email) : null,
    tagline: row.tagline !== null && row.tagline !== undefined ? String(row.tagline) : null,
    logo_url: row.logo_url !== null && row.logo_url !== undefined ? String(row.logo_url) : null,
    address: row.address !== null && row.address !== undefined ? String(row.address) : null,
    city: row.city !== null && row.city !== undefined ? String(row.city) : null,
    currency: String(row.currency ?? 'EGP'),
    timezone: String(row.timezone ?? 'Africa/Cairo'),
    receipt_header: row.receipt_header !== null && row.receipt_header !== undefined ? String(row.receipt_header) : null,
    receipt_footer: row.receipt_footer !== null && row.receipt_footer !== undefined ? String(row.receipt_footer) : null,
    receipt_terms: row.receipt_terms !== null && row.receipt_terms !== undefined ? String(row.receipt_terms) : null,
    enable_thermal_print: Boolean(row.enable_thermal_print),
    thermal_paper_size: (row.thermal_paper_size as ThermalPaperSize) || '80mm',
    show_tax_invoice: Boolean(row.show_tax_invoice),
    tax_rate: Number(row.tax_rate ?? 0.0),
    repair_terms: row.repair_terms !== null && row.repair_terms !== undefined ? String(row.repair_terms) : null,
    default_repair_warranty_days: Number(row.default_repair_warranty_days ?? 30),
    require_imei_for_phones: Boolean(row.require_imei_for_phones),
    opening_cash_default: Number(row.opening_cash_default ?? 0.0),
    enable_telecom_wallets: Boolean(row.enable_telecom_wallets),
    theme: (row.theme as DashboardTheme) || 'dark',
    locale: (row.locale as DashboardLocale) || 'ar',
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export const SettingsService = {
  /**
   * Retrieves the current store settings for the specified dashboard ID.
   * Scoped strictly by `WHERE id = ?`.
   * 
   * @param db - Cloudflare D1 Database instance
   * @param dashboardId - UUID of the tenant dashboard
   * @returns StoreSettings domain object or null if dashboard does not exist
   */
  async getSettings(db: D1Database, dashboardId: string): Promise<StoreSettings | null> {
    if (!dashboardId || typeof dashboardId !== 'string' || !dashboardId.trim()) {
      return null;
    }

    const row = await db
      .prepare(`
        SELECT 
          id,
          name,
          slug,
          phone,
          email,
          tagline,
          logo_url,
          address,
          city,
          currency,
          timezone,
          receipt_header,
          receipt_footer,
          receipt_terms,
          enable_thermal_print,
          thermal_paper_size,
          show_tax_invoice,
          tax_rate,
          repair_terms,
          default_repair_warranty_days,
          require_imei_for_phones,
          opening_cash_default,
          enable_telecom_wallets,
          theme,
          locale,
          created_at,
          updated_at
        FROM Dashboards
        WHERE id = ?
        LIMIT 1
      `)
      .bind(dashboardId.trim())
      .first<any>();

    if (!row) {
      return null;
    }

    return mapRowToStoreSettings(row);
  },

  /**
   * Partially updates store settings for the specified dashboard ID.
   * 
   * Pre-conditions & Invariants:
   * - Validates dashboardId and verifies dashboard existence (404 if not found).
   * - Validates phone uniqueness across other dashboards (409 if in use).
   * - Sanitizes/formats incoming data and handles boolean to integer (0/1) conversion.
   * - Constructs parameterized query using column whitelist.
   * - Returns fresh updated StoreSettings or SettingsServiceError.
   * 
   * @param db - Cloudflare D1 Database instance
   * @param dashboardId - UUID of the tenant dashboard
   * @param input - Validated partial update payload
   * @returns Updated StoreSettings or SettingsServiceError
   */
  async updateSettings(
    db: D1Database,
    dashboardId: string,
    input: UpdateStoreSettingsInput
  ): Promise<StoreSettings | SettingsServiceError> {
    if (!dashboardId || typeof dashboardId !== 'string' || !dashboardId.trim()) {
      return {
        error: 'INVALID_DASHBOARD_ID',
        message: 'معرف المتجر غير صالح',
        status: 400,
      };
    }

    const cleanDashboardId = dashboardId.trim();

    // 1. Fetch current settings to verify existence and check phone change
    const current = await this.getSettings(db, cleanDashboardId);
    if (!current) {
      return {
        error: 'SETTINGS_NOT_FOUND',
        message: 'إعدادات المتجر غير موجودة',
        status: 404,
      };
    }

    // 2. Pre-check phone uniqueness across dashboards if phone is updated to a new value
    if (input.phone !== undefined) {
      const cleanPhone = input.phone.trim();
      if (cleanPhone !== current.phone) {
        const duplicate = await db
          .prepare('SELECT id FROM Dashboards WHERE phone = ? AND id != ? LIMIT 1')
          .bind(cleanPhone, cleanDashboardId)
          .first<{ id: string }>();

        if (duplicate) {
          return {
            error: 'PHONE_ALREADY_IN_USE',
            message: 'رقم الهاتف مسجل بالفعل لمتجر آخر',
            status: 409,
          };
        }
      }
    }

    // 3. Build dynamic parameterized UPDATE query
    const updateClauses: string[] = ['updated_at = CURRENT_TIMESTAMP'];
    const params: any[] = [];

    if (input.name !== undefined) {
      updateClauses.push('name = ?');
      params.push(input.name.trim());
    }

    if (input.phone !== undefined) {
      updateClauses.push('phone = ?');
      params.push(input.phone.trim());
    }

    if (input.email !== undefined) {
      updateClauses.push('email = ?');
      params.push(input.email && input.email.trim() ? input.email.trim() : null);
    }

    if (input.tagline !== undefined) {
      updateClauses.push('tagline = ?');
      params.push(input.tagline && input.tagline.trim() ? input.tagline.trim() : null);
    }

    if (input.logo_url !== undefined) {
      updateClauses.push('logo_url = ?');
      params.push(input.logo_url && input.logo_url.trim() ? input.logo_url.trim() : null);
    }

    if (input.address !== undefined) {
      updateClauses.push('address = ?');
      params.push(input.address && input.address.trim() ? input.address.trim() : null);
    }

    if (input.city !== undefined) {
      updateClauses.push('city = ?');
      params.push(input.city && input.city.trim() ? input.city.trim() : null);
    }

    if (input.currency !== undefined) {
      updateClauses.push('currency = ?');
      params.push(input.currency.trim().toUpperCase());
    }

    if (input.timezone !== undefined) {
      updateClauses.push('timezone = ?');
      params.push(input.timezone.trim());
    }

    if (input.receipt_header !== undefined) {
      updateClauses.push('receipt_header = ?');
      params.push(input.receipt_header && input.receipt_header.trim() ? input.receipt_header.trim() : null);
    }

    if (input.receipt_footer !== undefined) {
      updateClauses.push('receipt_footer = ?');
      params.push(input.receipt_footer && input.receipt_footer.trim() ? input.receipt_footer.trim() : null);
    }

    if (input.receipt_terms !== undefined) {
      updateClauses.push('receipt_terms = ?');
      params.push(input.receipt_terms && input.receipt_terms.trim() ? input.receipt_terms.trim() : null);
    }

    if (input.enable_thermal_print !== undefined) {
      updateClauses.push('enable_thermal_print = ?');
      params.push(input.enable_thermal_print ? 1 : 0);
    }

    if (input.thermal_paper_size !== undefined) {
      updateClauses.push('thermal_paper_size = ?');
      params.push(input.thermal_paper_size);
    }

    if (input.show_tax_invoice !== undefined) {
      updateClauses.push('show_tax_invoice = ?');
      params.push(input.show_tax_invoice ? 1 : 0);
    }

    if (input.tax_rate !== undefined) {
      updateClauses.push('tax_rate = ?');
      params.push(Number(input.tax_rate ?? 0.0));
    }

    if (input.repair_terms !== undefined) {
      updateClauses.push('repair_terms = ?');
      params.push(input.repair_terms && input.repair_terms.trim() ? input.repair_terms.trim() : null);
    }

    if (input.default_repair_warranty_days !== undefined) {
      updateClauses.push('default_repair_warranty_days = ?');
      params.push(Number(input.default_repair_warranty_days ?? 30));
    }

    if (input.require_imei_for_phones !== undefined) {
      updateClauses.push('require_imei_for_phones = ?');
      params.push(input.require_imei_for_phones ? 1 : 0);
    }

    if (input.opening_cash_default !== undefined) {
      updateClauses.push('opening_cash_default = ?');
      params.push(Number(input.opening_cash_default ?? 0.0));
    }

    if (input.enable_telecom_wallets !== undefined) {
      updateClauses.push('enable_telecom_wallets = ?');
      params.push(input.enable_telecom_wallets ? 1 : 0);
    }

    if (input.theme !== undefined) {
      updateClauses.push('theme = ?');
      params.push(input.theme);
    }

    if (input.locale !== undefined) {
      updateClauses.push('locale = ?');
      params.push(input.locale);
    }

    // 4. If no settings fields provided, return current settings (no-op)
    if (updateClauses.length === 1) {
      return current;
    }

    // 5. Append dashboardId to params for the WHERE clause
    params.push(cleanDashboardId);

    const sql = `UPDATE Dashboards SET ${updateClauses.join(', ')} WHERE id = ?`;
    await db.prepare(sql).bind(...params).run();

    // 6. Fetch and return fresh settings
    const updated = await this.getSettings(db, cleanDashboardId);
    if (!updated) {
      return {
        error: 'SETTINGS_NOT_FOUND',
        message: 'إعدادات المتجر غير موجودة بعد التحديث',
        status: 404,
      };
    }

    return updated;
  },
};
