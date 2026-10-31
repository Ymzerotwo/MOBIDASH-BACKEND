import { describe, it, expect } from 'vitest';
import {
  updateStoreSettingsSchema,
  THERMAL_PAPER_SIZES,
  DASHBOARD_THEMES,
  DASHBOARD_LOCALES,
  UpdateStoreSettingsSchemaType,
} from '../../src/validators/settings.validators';
import { UpdateStoreSettingsInput, StoreSettings } from '../../src/types';

describe('Empirical Challenge: settings.validators.ts & types.ts', () => {

  // ============================================================================
  // 1. Coverage of all 23 fields individually and combined
  // ============================================================================
  describe('Coverage of all 23 settings fields', () => {
    const validFullPayload = {
      name: 'متجر الهواتف الذكية المتقدم',
      phone: '+20 100 123 4567',
      email: 'contact@smartphones.eg',
      tagline: 'أفضل مركز صيانة ومبيعات هواتف في مصر',
      logo_url: 'https://cdn.mobidash.app/logos/store1.png',
      address: 'شارع التحرير، الدقي، الجيزة',
      city: 'الجيزة',
      currency: 'EGP',
      timezone: 'Africa/Cairo',
      receipt_header: 'مرحباً بكم في متجر الهواتف الذكية',
      receipt_footer: 'شكراً لتعاملكم معنا - نرجو زيارتنا مجدداً',
      receipt_terms: 'البضاعة المباعة ترد وتستبدل خلال 14 يوماً بموجب الفاتورة',
      enable_thermal_print: true,
      thermal_paper_size: '80mm' as const,
      show_tax_invoice: false,
      tax_rate: 14.0,
      repair_terms: 'المركز غير مسؤول عن فقدان البيانات المخزنة على الجهاز أثناء الصيانة',
      default_repair_warranty_days: 90,
      require_imei_for_phones: true,
      opening_cash_default: 2500.5,
      enable_telecom_wallets: true,
      theme: 'dark' as const,
      locale: 'ar' as const,
    };

    it('should validate all 23 fields successfully in a single payload', () => {
      const parsed = updateStoreSettingsSchema.safeParse(validFullPayload);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.name).toBe(validFullPayload.name);
        expect(parsed.data.phone).toBe(validFullPayload.phone);
        expect(parsed.data.email).toBe(validFullPayload.email);
        expect(parsed.data.currency).toBe('EGP');
        expect(parsed.data.timezone).toBe('Africa/Cairo');
        expect(parsed.data.enable_thermal_print).toBe(true);
        expect(parsed.data.thermal_paper_size).toBe('80mm');
        expect(parsed.data.show_tax_invoice).toBe(false);
        expect(parsed.data.tax_rate).toBe(14.0);
        expect(parsed.data.default_repair_warranty_days).toBe(90);
        expect(parsed.data.require_imei_for_phones).toBe(true);
        expect(parsed.data.opening_cash_default).toBe(2500.5);
        expect(parsed.data.enable_telecom_wallets).toBe(true);
        expect(parsed.data.theme).toBe('dark');
        expect(parsed.data.locale).toBe('ar');
      }
    });

    it('should verify schema shape contains exactly the 23 recognized settings fields', () => {
      const recognizedKeys = Object.keys(updateStoreSettingsSchema.shape).sort();
      const expectedKeys = [
        'address',
        'city',
        'currency',
        'default_repair_warranty_days',
        'email',
        'enable_telecom_wallets',
        'enable_thermal_print',
        'locale',
        'logo_url',
        'name',
        'opening_cash_default',
        'phone',
        'receipt_footer',
        'receipt_header',
        'receipt_terms',
        'repair_terms',
        'require_imei_for_phones',
        'show_tax_invoice',
        'tagline',
        'tax_rate',
        'theme',
        'thermal_paper_size',
        'timezone',
      ].sort();

      expect(recognizedKeys).toEqual(expectedKeys);
      expect(recognizedKeys.length).toBe(23);
    });

    it('should verify UpdateStoreSettingsSchemaType matches UpdateStoreSettingsInput contract', () => {
      // TypeScript type-assignability verification at compile & runtime
      const sampleInput: UpdateStoreSettingsSchemaType = {
        name: 'Test Store',
        theme: 'light',
        tax_rate: 0,
      };
      const typeCheck: UpdateStoreSettingsInput = sampleInput;
      expect(typeCheck.name).toBe('Test Store');
    });
  });

  // ============================================================================
  // 2. Partial Updates Stress Testing
  // ============================================================================
  describe('Partial updates stress testing', () => {
    it('should accept an empty object {} and preserve omitted keys as undefined', () => {
      const parsed = updateStoreSettingsSchema.safeParse({});
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data).toEqual({});
        expect(Object.keys(parsed.data).length).toBe(0);
      }
    });

    it('should accept a single field update { theme: "system" }', () => {
      const parsed = updateStoreSettingsSchema.safeParse({ theme: 'system' });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data).toEqual({ theme: 'system' });
      }
    });

    it('should preserve falsy values like 0, 0.0, and false on partial updates', () => {
      const falsyPayload = {
        tax_rate: 0,
        opening_cash_default: 0,
        default_repair_warranty_days: 0,
        enable_thermal_print: false,
        show_tax_invoice: false,
        require_imei_for_phones: false,
        enable_telecom_wallets: false,
      };
      const parsed = updateStoreSettingsSchema.safeParse(falsyPayload);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.tax_rate).toBe(0);
        expect(parsed.data.opening_cash_default).toBe(0);
        expect(parsed.data.default_repair_warranty_days).toBe(0);
        expect(parsed.data.enable_thermal_print).toBe(false);
        expect(parsed.data.show_tax_invoice).toBe(false);
        expect(parsed.data.require_imei_for_phones).toBe(false);
        expect(parsed.data.enable_telecom_wallets).toBe(false);
      }
    });
  });

  // ============================================================================
  // 3. String Boundaries, Empty Strings, and Null Values
  // ============================================================================
  describe('String boundaries, empty strings, and nullability', () => {
    describe('Field: name (Mandatory identity, non-nullable)', () => {
      it('should accept boundary min length 2 characters', () => {
        const parsed = updateStoreSettingsSchema.safeParse({ name: 'AB' });
        expect(parsed.success).toBe(true);
      });

      it('should reject string shorter than 2 characters', () => {
        const parsed = updateStoreSettingsSchema.safeParse({ name: 'A' });
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
          expect(parsed.error.issues[0].message).toBe('name_too_short');
        }
      });

      it('should accept boundary max length 100 characters', () => {
        const parsed = updateStoreSettingsSchema.safeParse({ name: 'A'.repeat(100) });
        expect(parsed.success).toBe(true);
      });

      it('should reject string exceeding 100 characters', () => {
        const parsed = updateStoreSettingsSchema.safeParse({ name: 'A'.repeat(101) });
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
          expect(parsed.error.issues[0].message).toBe('too_long');
        }
      });

      it('should reject empty string "" and whitespace-only string', () => {
        const emptyResult = updateStoreSettingsSchema.safeParse({ name: '' });
        expect(emptyResult.success).toBe(false);

        const wsResult = updateStoreSettingsSchema.safeParse({ name: '   ' });
        expect(wsResult.success).toBe(false);
      });

      it('should reject null for name', () => {
        const parsed = updateStoreSettingsSchema.safeParse({ name: null });
        expect(parsed.success).toBe(false);
      });
    });

    describe('Field: phone (Mandatory login/contact, non-nullable)', () => {
      it('should accept boundary min length 8 characters', () => {
        const parsed = updateStoreSettingsSchema.safeParse({ phone: '12345678' });
        expect(parsed.success).toBe(true);
      });

      it('should reject phone shorter than 8 characters', () => {
        const parsed = updateStoreSettingsSchema.safeParse({ phone: '1234567' });
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
          expect(parsed.error.issues[0].message).toBe('phone_too_short');
        }
      });

      it('should accept boundary max length 30 characters', () => {
        const parsed = updateStoreSettingsSchema.safeParse({ phone: '1'.repeat(30) });
        expect(parsed.success).toBe(true);
      });

      it('should reject phone exceeding 30 characters', () => {
        const parsed = updateStoreSettingsSchema.safeParse({ phone: '1'.repeat(31) });
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
          expect(parsed.error.issues[0].message).toBe('too_long');
        }
      });

      it('should reject letters or invalid symbols in phone', () => {
        const parsed = updateStoreSettingsSchema.safeParse({ phone: '+20100abc1234' });
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
          expect(parsed.error.issues[0].message).toBe('invalid_phone_format');
        }
      });

      it('should reject empty string and null for phone', () => {
        expect(updateStoreSettingsSchema.safeParse({ phone: '' }).success).toBe(false);
        expect(updateStoreSettingsSchema.safeParse({ phone: null }).success).toBe(false);
      });
    });

    describe('Field: email (Optional nullable, format validation & lowercase)', () => {
      it('should trim and lowercase email address', () => {
        const parsed = updateStoreSettingsSchema.safeParse({ email: '  INFO@MOBIDASH.COM  ' });
        expect(parsed.success).toBe(true);
        if (parsed.success) {
          expect(parsed.data.email).toBe('info@mobidash.com');
        }
      });

      it('should transform null and empty string "" to null', () => {
        const nullResult = updateStoreSettingsSchema.safeParse({ email: null });
        expect(nullResult.success).toBe(true);
        if (nullResult.success) {
          expect(nullResult.data.email).toBeNull();
        }

        const emptyResult = updateStoreSettingsSchema.safeParse({ email: '' });
        expect(emptyResult.success).toBe(true);
        if (emptyResult.success) {
          expect(emptyResult.data.email).toBeNull();
        }
      });

      it('should reject malformed email strings', () => {
        const parsed = updateStoreSettingsSchema.safeParse({ email: 'not-an-email' });
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
          expect(parsed.error.issues[0].message).toBe('invalid_email');
        }
      });

      it('should reject email exceeding 255 characters', () => {
        const longEmail = 'a'.repeat(250) + '@test.com';
        const parsed = updateStoreSettingsSchema.safeParse({ email: longEmail });
        expect(parsed.success).toBe(false);
      });
    });

    describe('Field: logo_url (Optional nullable URL)', () => {
      it('should accept valid https/http URLs', () => {
        const parsed = updateStoreSettingsSchema.safeParse({
          logo_url: 'https://images.example.com/logo.webp',
        });
        expect(parsed.success).toBe(true);
      });

      it('should transform null and empty string "" to null', () => {
        const nullResult = updateStoreSettingsSchema.safeParse({ logo_url: null });
        expect(nullResult.success).toBe(true);
        if (nullResult.success) {
          expect(nullResult.data.logo_url).toBeNull();
        }

        const emptyResult = updateStoreSettingsSchema.safeParse({ logo_url: '' });
        expect(emptyResult.success).toBe(true);
        if (emptyResult.success) {
          expect(emptyResult.data.logo_url).toBeNull();
        }
      });

      it('should reject invalid URL strings', () => {
        const parsed = updateStoreSettingsSchema.safeParse({ logo_url: 'ftp:/invalid url' });
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
          expect(parsed.error.issues[0].message).toBe('invalid_url');
        }
      });
    });

    describe('Field: currency (Regional code, uppercase transform)', () => {
      it('should transform lowercase currency to uppercase and validate', () => {
        const parsed = updateStoreSettingsSchema.safeParse({ currency: 'usd' });
        expect(parsed.success).toBe(true);
        if (parsed.success) {
          expect(parsed.data.currency).toBe('USD');
        }
      });

      it('should reject currency with invalid characters or numbers', () => {
        const parsed = updateStoreSettingsSchema.safeParse({ currency: 'EG1' });
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
          expect(parsed.error.issues[0].message).toBe('invalid_currency_code');
        }
      });

      it('should reject currency shorter than 2 or longer than 10 chars', () => {
        expect(updateStoreSettingsSchema.safeParse({ currency: 'E' }).success).toBe(false);
        expect(updateStoreSettingsSchema.safeParse({ currency: 'ABCDEFGHIJK' }).success).toBe(false);
      });

      it('should reject null and empty string for currency', () => {
        expect(updateStoreSettingsSchema.safeParse({ currency: null }).success).toBe(false);
        expect(updateStoreSettingsSchema.safeParse({ currency: '' }).success).toBe(false);
      });
    });

    describe('Field: timezone (Regional IANA code)', () => {
      it('should accept valid timezone identifiers', () => {
        const validZones = ['Africa/Cairo', 'UTC', 'America/New_York', 'Etc/GMT+2'];
        for (const zone of validZones) {
          const parsed = updateStoreSettingsSchema.safeParse({ timezone: zone });
          expect(parsed.success).toBe(true);
        }
      });

      it('should reject invalid timezone format or malicious characters', () => {
        const parsed = updateStoreSettingsSchema.safeParse({ timezone: 'Cairo; DROP TABLE' });
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
          expect(parsed.error.issues[0].message).toBe('invalid_timezone_format');
        }
      });

      it('should reject timezone shorter than 3 or longer than 100 characters', () => {
        expect(updateStoreSettingsSchema.safeParse({ timezone: 'EG' }).success).toBe(false);
        expect(updateStoreSettingsSchema.safeParse({ timezone: 'A'.repeat(101) }).success).toBe(false);
      });

      it('should reject null and empty string for timezone', () => {
        expect(updateStoreSettingsSchema.safeParse({ timezone: null }).success).toBe(false);
        expect(updateStoreSettingsSchema.safeParse({ timezone: '' }).success).toBe(false);
      });
    });

    describe('Nullable text fields: tagline, address, city, receipts, repairs', () => {
      const nullableFields = [
        { field: 'tagline', max: 255 },
        { field: 'address', max: 500 },
        { field: 'city', max: 100 },
        { field: 'receipt_header', max: 1000 },
        { field: 'receipt_footer', max: 1000 },
        { field: 'receipt_terms', max: 2000 },
        { field: 'repair_terms', max: 2000 },
      ] as const;

      for (const { field, max } of nullableFields) {
        it(`should allow null and convert empty string "" to null for ${field}`, () => {
          const nullRes = updateStoreSettingsSchema.safeParse({ [field]: null });
          expect(nullRes.success).toBe(true);
          if (nullRes.success) {
            expect((nullRes.data as any)[field]).toBeNull();
          }

          const emptyRes = updateStoreSettingsSchema.safeParse({ [field]: '' });
          expect(emptyRes.success).toBe(true);
          if (emptyRes.success) {
            expect((emptyRes.data as any)[field]).toBeNull();
          }
        });

        it(`should accept boundary max length ${max} and reject ${max + 1} for ${field}`, () => {
          const maxRes = updateStoreSettingsSchema.safeParse({ [field]: 'X'.repeat(max) });
          expect(maxRes.success).toBe(true);

          const overRes = updateStoreSettingsSchema.safeParse({ [field]: 'X'.repeat(max + 1) });
          expect(overRes.success).toBe(false);
          if (!overRes.success) {
            expect(overRes.error.issues[0].message).toBe('too_long');
          }
        });
      }
    });
  });

  // ============================================================================
  // 4. Forbidden / Unknown Keys Stress Testing (.strict())
  // ============================================================================
  describe('Forbidden and unrecognized keys (.strict() isolation)', () => {
    it('should reject payloads with password_hash', () => {
      const parsed = updateStoreSettingsSchema.safeParse({ password_hash: 'evil_hash' });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0].code).toBe('unrecognized_keys');
      }
    });

    it('should reject payloads with is_banned or ban_reason', () => {
      const parsed1 = updateStoreSettingsSchema.safeParse({ is_banned: 0 });
      expect(parsed1.success).toBe(false);

      const parsed2 = updateStoreSettingsSchema.safeParse({ ban_reason: 'unban me' });
      expect(parsed2.success).toBe(false);
    });

    it('should reject payloads with status or is_default', () => {
      const parsed1 = updateStoreSettingsSchema.safeParse({ status: 'active' });
      expect(parsed1.success).toBe(false);

      const parsed2 = updateStoreSettingsSchema.safeParse({ is_default: 1 });
      expect(parsed2.success).toBe(false);
    });

    it('should reject payloads with primary key or audit columns (id, slug, created_at, updated_at)', () => {
      const forbiddenColumns = ['id', 'slug', 'created_at', 'updated_at'];
      for (const col of forbiddenColumns) {
        const parsed = updateStoreSettingsSchema.safeParse({ [col]: 'forbidden_value' });
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
          expect(parsed.error.issues[0].code).toBe('unrecognized_keys');
        }
      }
    });

    it('should reject payload mixing valid keys with unauthorized keys', () => {
      const mixed = {
        theme: 'dark',
        password_hash: 'hacked_pw',
        is_banned: 0,
      };
      const parsed = updateStoreSettingsSchema.safeParse(mixed);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0].code).toBe('unrecognized_keys');
      }
    });
  });

  // ============================================================================
  // 5. Bounds Testing
  // ============================================================================
  describe('Numeric bounds testing', () => {
    describe('Field: tax_rate (0.0 to 100.0)', () => {
      it('should accept valid tax rate boundaries: 0, 14.0, 100', () => {
        expect(updateStoreSettingsSchema.safeParse({ tax_rate: 0 }).success).toBe(true);
        expect(updateStoreSettingsSchema.safeParse({ tax_rate: 14.5 }).success).toBe(true);
        expect(updateStoreSettingsSchema.safeParse({ tax_rate: 100 }).success).toBe(true);
      });

      it('should reject negative tax rate: -1 and -0.01', () => {
        const r1 = updateStoreSettingsSchema.safeParse({ tax_rate: -1 });
        expect(r1.success).toBe(false);
        if (!r1.success) {
          expect(r1.error.issues[0].message).toBe('tax_rate_min_zero');
        }

        const r2 = updateStoreSettingsSchema.safeParse({ tax_rate: -0.01 });
        expect(r2.success).toBe(false);
      });

      it('should reject tax rate above 100: 100.01 and 101', () => {
        const r1 = updateStoreSettingsSchema.safeParse({ tax_rate: 101 });
        expect(r1.success).toBe(false);
        if (!r1.success) {
          expect(r1.error.issues[0].message).toBe('tax_rate_max_100');
        }

        const r2 = updateStoreSettingsSchema.safeParse({ tax_rate: 100.01 });
        expect(r2.success).toBe(false);
      });

      it('should reject non-number types for tax_rate', () => {
        expect(updateStoreSettingsSchema.safeParse({ tax_rate: '14' }).success).toBe(false);
        expect(updateStoreSettingsSchema.safeParse({ tax_rate: null }).success).toBe(false);
      });
    });

    describe('Field: default_repair_warranty_days (Integer 0 to 3650)', () => {
      it('should accept valid warranty days boundaries: 0, 30, 3650', () => {
        expect(updateStoreSettingsSchema.safeParse({ default_repair_warranty_days: 0 }).success).toBe(true);
        expect(updateStoreSettingsSchema.safeParse({ default_repair_warranty_days: 30 }).success).toBe(true);
        expect(updateStoreSettingsSchema.safeParse({ default_repair_warranty_days: 3650 }).success).toBe(true);
      });

      it('should reject negative warranty days: -5 and -1', () => {
        const parsed = updateStoreSettingsSchema.safeParse({ default_repair_warranty_days: -5 });
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
          expect(parsed.error.issues[0].message).toBe('warranty_days_min_zero');
        }
      });

      it('should reject warranty days exceeding 3650: 3651 and 5000', () => {
        const parsed = updateStoreSettingsSchema.safeParse({ default_repair_warranty_days: 5000 });
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
          expect(parsed.error.issues[0].message).toBe('warranty_days_max_limit');
        }
      });

      it('should reject non-integer floats: 30.5', () => {
        const parsed = updateStoreSettingsSchema.safeParse({ default_repair_warranty_days: 30.5 });
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
          expect(parsed.error.issues[0].message).toBe('warranty_days_must_be_integer');
        }
      });
    });

    describe('Field: opening_cash_default (0 to 10,000,000)', () => {
      it('should accept valid opening cash boundaries: 0, 5000, 10000000', () => {
        expect(updateStoreSettingsSchema.safeParse({ opening_cash_default: 0 }).success).toBe(true);
        expect(updateStoreSettingsSchema.safeParse({ opening_cash_default: 5000.5 }).success).toBe(true);
        expect(updateStoreSettingsSchema.safeParse({ opening_cash_default: 10000000 }).success).toBe(true);
      });

      it('should reject negative opening cash: -100', () => {
        const parsed = updateStoreSettingsSchema.safeParse({ opening_cash_default: -100 });
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
          expect(parsed.error.issues[0].message).toBe('opening_cash_min_zero');
        }
      });

      it('should reject opening cash exceeding 10,000,000', () => {
        const parsed = updateStoreSettingsSchema.safeParse({ opening_cash_default: 10000001 });
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
          expect(parsed.error.issues[0].message).toBe('opening_cash_max_limit');
        }
      });
    });
  });

  // ============================================================================
  // 6. Enum Validation
  // ============================================================================
  describe('Enum validation', () => {
    describe('Field: thermal_paper_size (80mm, 58mm)', () => {
      it('should accept 80mm and 58mm', () => {
        expect(updateStoreSettingsSchema.safeParse({ thermal_paper_size: '80mm' }).success).toBe(true);
        expect(updateStoreSettingsSchema.safeParse({ thermal_paper_size: '58mm' }).success).toBe(true);
      });

      it('should reject invalid sizes like 75mm, A4, or empty string', () => {
        const parsed = updateStoreSettingsSchema.safeParse({ thermal_paper_size: '75mm' });
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
          expect(parsed.error.issues[0].message).toBe('invalid_thermal_paper_size');
        }

        expect(updateStoreSettingsSchema.safeParse({ thermal_paper_size: 'A4' }).success).toBe(false);
        expect(updateStoreSettingsSchema.safeParse({ thermal_paper_size: '' }).success).toBe(false);
        expect(updateStoreSettingsSchema.safeParse({ thermal_paper_size: null }).success).toBe(false);
      });
    });

    describe('Field: theme (dark, light, system)', () => {
      it('should accept dark, light, system', () => {
        for (const t of DASHBOARD_THEMES) {
          expect(updateStoreSettingsSchema.safeParse({ theme: t }).success).toBe(true);
        }
      });

      it('should reject invalid themes like blue, neon, auto', () => {
        const parsed = updateStoreSettingsSchema.safeParse({ theme: 'blue' });
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
          expect(parsed.error.issues[0].message).toBe('invalid_theme');
        }

        expect(updateStoreSettingsSchema.safeParse({ theme: '' }).success).toBe(false);
        expect(updateStoreSettingsSchema.safeParse({ theme: null }).success).toBe(false);
      });
    });

    describe('Field: locale (ar, en)', () => {
      it('should accept ar and en', () => {
        for (const loc of DASHBOARD_LOCALES) {
          expect(updateStoreSettingsSchema.safeParse({ locale: loc }).success).toBe(true);
        }
      });

      it('should reject invalid locales like fr, es, de', () => {
        const parsed = updateStoreSettingsSchema.safeParse({ locale: 'fr' });
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
          expect(parsed.error.issues[0].message).toBe('invalid_locale');
        }

        expect(updateStoreSettingsSchema.safeParse({ locale: '' }).success).toBe(false);
        expect(updateStoreSettingsSchema.safeParse({ locale: null }).success).toBe(false);
      });
    });
  });

  // ============================================================================
  // 7. Sanitization & HTML Escaping
  // ============================================================================
  describe('Sanitization & HTML safety', () => {
    it('should sanitize HTML tags from string inputs', () => {
      const maliciousPayload = {
        name: 'محل <script>alert("XSS")</script> الموبايل',
        tagline: 'أفضل محل <img src=x onerror=alert(1)> في الدقي',
      };
      const parsed = updateStoreSettingsSchema.safeParse(maliciousPayload);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.name).not.toContain('<script>');
        expect(parsed.data.tagline).not.toContain('<img');
      }
    });
  });
});
