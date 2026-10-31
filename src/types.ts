import { D1Database, R2Bucket, KVNamespace } from '@cloudflare/workers-types';

export type Bindings = {
  DB: D1Database;
  STORAGE: R2Bucket;
  /** المعرّف المعتمد في wrangler.jsonc لمساحة KV */
  mobidash: KVNamespace;
  /** أسماء تاريخية؛ src/index.ts يعيد تسميتها إلى mobidash قبل تسليم الطلب */
  ouradash_dashboard: KVNamespace;
  ouradash_dashboard_notifications?: KVNamespace;
  K1?: KVNamespace;
  EMAILER?: any;
  R2_PUBLIC_URL: string;
  CLOUDFLARE_API_TOKEN: string;
  AUTH_LIMITER: any;
  GLOBAL_LIMITER: any;
  DASHBOARD_LIMITER: any;
  LOGIN_RECOVERY_LIMITER: any;
  VERIFY_CODE_LIMITER: any;
  STATE_LIMITER: any;
  NOTIFICATIONS_LIMITER: any;
  FILES_LIMITER: any;
  HEALTH_LIMITER: any;
  OURADASH_MASTER_SECRET?: string;
  MOBIDASH_API_KEY?: string;
  FRONTEND_API_KEY?: string;
  API_KEY?: string;
  ALLOWED_ORIGINS?: string;
  CF_ACCOUNT_ID?: string;
  EMAIL_FROM_ADDRESS?: string;
  APP_FRONTEND_URL?: string;
  OURADASH_ANALYTICS?: any;
  VISITS_ENGINE?: any;
};

export type WorkspaceRole = 'owner' | 'user' | 'Owner' | 'Admin' | 'User';

export type ProfileItem = {
  id: string; // معرف المستخدم الفعلي في Users
  dashboard_id: string; // معرف لوحة التحكم في Dashboards
  dashboard_name?: string | null;
  dashboard_slug?: string | null;
  website_id?: string | null;
  name?: string;
  role: WorkspaceRole;
  job_title?: string | null;
  permissions: Record<string, boolean> | null;
  is_banned: boolean;
};

export type UserProfileSession = [
  ProfileItem[],
  ProfileItem | null
];

export type ActiveShiftWorker = {
  shift_id: string;
  user_id?: string;
  name?: string;
  role: 'owner' | 'user' | string;
  job_title?: string | null;
  permissions: Record<string, boolean> | null;
  opening_cash?: number;
  started_at: string;
  last_action_at?: string;
  is_banned?: boolean;
  ban_reason?: string | null;
  worker_name?: string; // alias for name
  user_profile_id?: string; // alias for user_id
  shift_token?: string;
};

export type UserSession = {
  id: string; // Users.id
  name: string;
  full_name?: string; // alias
  email?: string | null;
  phone?: string | null;
  dashboard_id: string;
  dashboard_name?: string;
  dashboard_slug?: string;
  role: 'owner' | 'user' | string;
  job_title?: string | null;
  permissions?: Record<string, boolean> | null;
  is_banned?: boolean;
  active_shift?: ActiveShiftWorker | null;
  profile_id?: string; // alias for id
  user_profile?: any; // legacy alias
};

export type AppContext = {
  Bindings: Bindings;
  Variables: {
    requestId?: string;
    user?: UserSession;
    session_id?: string;
    shift_token?: string;
    active_worker?: ActiveShiftWorker;
    apiKeyDomain?: string;
    isApiKeyAuthenticated?: boolean;
    website?: any;
    isNewVisit?: boolean;
  };
};

// ==========================================
// Telecom, POS Terminals & Wallets Types
// ==========================================

export type TelecomProvider = 
  | 'fawry' 
  | 'aman' 
  | 'masary' 
  | 'momken' 
  | 'khales' 
  | 'vodafone' 
  | 'etisalat' 
  | 'orange' 
  | 'we' 
  | 'instapay' 
  | 'bank' 
  | 'other';

export type TelecomCategory = 'pos' | 'wallet' | 'bank';

export type TerminalStatus = 'active' | 'low_balance' | 'maintenance' | 'suspended';

export type SubAccountType = 'main_balance' | 'cash_out_balance';

export type TelecomServiceCategory = 
  | 'utilities' 
  | 'telecom' 
  | 'wallet_transfer' 
  | 'installments' 
  | 'education' 
  | 'insurance_social' 
  | 'entertainment' 
  | 'government' 
  | 'internal_ops';

export type TelecomTransactionType = 
  | 'cash_in' 
  | 'cash_out' 
  | 'bill_payment' 
  | 'airtime' 
  | 'top_up' 
  | 'withdraw' 
  | 'internal_transfer';

export type SourceOfFunds = 'cash_drawer' | 'bank' | 'distributor' | 'other';

export interface TelecomTerminal {
  id: string;
  dashboard_id: string;
  name: string;
  provider: TelecomProvider;
  category: TelecomCategory;
  balance: number;
  has_dual_accounts: number;
  cash_out_balance: number;
  allow_overdraft: number;
  overdraft_limit: number;
  min_threshold: number;
  account_number?: string | null;
  status: TerminalStatus;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TelecomTransaction {
  id: string;
  dashboard_id: string;
  terminal_id?: string | null;
  sub_account: SubAccountType;
  category: TelecomServiceCategory;
  type: TelecomTransactionType;
  service_name: string;
  service_code?: string | null;
  amount: number;
  commission: number;
  service_fee: number;
  total_customer_amount: number;
  phone_or_ref: string;
  customer_name?: string | null;
  cashier_profile_id?: string | null;
  cashier_name: string;
  shift_id?: string | null;
  source_of_funds?: SourceOfFunds | null;
  target_terminal_id?: string | null;
  notes?: string | null;
  created_at: string;
}

export interface CreateTerminalInput {
  name: string;
  provider: TelecomProvider;
  category: TelecomCategory;
  balance?: number;
  has_dual_accounts?: boolean;
  cash_out_balance?: number;
  allow_overdraft?: boolean;
  overdraft_limit?: number;
  min_threshold?: number;
  account_number?: string;
  notes?: string;
}

export interface UpdateTerminalInput {
  name?: string;
  provider?: TelecomProvider;
  category?: TelecomCategory;
  has_dual_accounts?: boolean;
  allow_overdraft?: boolean;
  overdraft_limit?: number;
  min_threshold?: number;
  account_number?: string;
  status?: TerminalStatus;
  notes?: string;
}

export interface TopUpTerminalInput {
  amount: number;
  sub_account?: SubAccountType;
  source_of_funds: SourceOfFunds;
  notes?: string;
}

export interface WithdrawTerminalInput {
  amount: number;
  sub_account?: SubAccountType;
  destination: 'cash_drawer' | 'bank' | 'other';
  notes?: string;
}

export interface InternalTransferInput {
  source_terminal_id: string;
  source_sub_account?: SubAccountType;
  target_terminal_id: string;
  target_sub_account?: SubAccountType;
  amount: number;
  notes?: string;
}

export interface RecordTelecomTransactionInput {
  terminal_id: string;
  sub_account?: SubAccountType;
  category: TelecomServiceCategory;
  type: 'cash_in' | 'cash_out' | 'bill_payment' | 'airtime';
  service_name: string;
  service_code?: string;
  amount: number;
  commission?: number;
  service_fee?: number;
  total_customer_amount?: number;
  phone_or_ref: string;
  customer_name?: string;
  notes?: string;
}

export interface TelecomFilterQuery {
  page?: number;
  limit?: number;
  search?: string;
  provider?: string;
  category?: string;
  status?: string;
  terminal_id?: string;
  type?: string;
  start_date?: string;
  end_date?: string;
}

export interface TelecomStats {
  total_digital_balance: number;
  total_cash_out_balance: number;
  total_terminals_count: number;
  active_terminals_count: number;
  low_balance_terminals_count: number;
  today_transactions_count: number;
  today_transactions_volume: number;
  today_commission_profit: number;
  today_cash_in_volume: number;
  today_cash_out_volume: number;
}

// ==========================================
// Suppliers & Vendor Accounts Types
// ==========================================

export type SupplierCategory = 'هواتف' | 'إكسسوار' | 'إكسسوارات' | 'قطع غيار' | 'سنترال' | 'عام';
export type SupplierStatus = 'active' | 'inactive' | 'archived';
export type SupplierTxType = 'supply_bill' | 'payment' | 'return' | 'adjustment';
export type SupplierPaymentSource = 'cash_drawer' | 'bank' | 'other';

export interface Supplier {
  id: string;
  dashboard_id: string;
  name: string;
  company_name: string;
  phone: string;
  address?: string | null;
  category: SupplierCategory;
  balance_due: number;
  last_supply_date?: string | null;
  status: SupplierStatus;
  notes?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupplierTransaction {
  id: string;
  dashboard_id: string;
  supplier_id: string;
  type: SupplierTxType;
  amount: number;
  payment_source?: SupplierPaymentSource | null;
  receipt_number?: string | null;
  notes?: string | null;
  shift_id?: string | null;
  cashier_profile_id?: string | null;
  cashier_name?: string | null;
  cash_movement_id?: string | null;
  created_at: string;
}

export interface CreateSupplierInput {
  name: string;
  company_name: string;
  phone: string;
  category: SupplierCategory;
  address?: string | null;
  balance_due?: number;
  notes?: string | null;
}

export interface UpdateSupplierInput {
  name?: string;
  company_name?: string;
  phone?: string;
  category?: SupplierCategory;
  address?: string | null;
  status?: SupplierStatus;
  notes?: string | null;
}

export interface PaySupplierInput {
  amount: number;
  payment_source: SupplierPaymentSource;
  receipt_number?: string | null;
  notes?: string | null;
}

export interface SupplierFilterQuery {
  page?: number;
  limit?: number;
  search?: string;
  category?: string;
  status?: string;
  balance_filter?: 'all' | 'due' | 'cleared';
  sort_by?: 'created_at' | 'company_name' | 'balance_due';
  sort_order?: 'asc' | 'desc';
}

export interface SupplierStats {
  total_suppliers_count: number;
  total_balance_due: number;
  due_suppliers_count: number;
  cleared_suppliers_count: number;
  devices_suppliers_count: number;
  spare_parts_suppliers_count: number;
}

// ==============================================================================
// Phones Inventory & IMEI Module Types
// ==============================================================================

export type DeviceCondition = 'new' | 'used_like_new' | 'used';
export type PhoneCondition = DeviceCondition;
export type PhoneStatus = 'in_stock' | 'sold' | 'reserved';
export type PhoneNetwork = '3G' | '4G' | '5G';

export interface PhoneRecord {
  id: string;
  dashboard_id: string;
  brand: string;
  model: string;
  color: string;
  storage: string;
  ram?: string | null;
  battery_capacity?: number | null;
  screen_size?: string | null;
  network?: PhoneNetwork | null;
  processor?: string | null;
  condition: DeviceCondition;
  battery_health?: number | null;
  imei: string;
  imei2?: string | null;
  purchase_price: number;
  selling_price: number;
  min_price: number;
  warranty_period?: string | null;
  status: PhoneStatus;
  supplier_id?: string | null;
  purchased_by?: string | null;
  purchased_at?: string | null;
  seller_name?: string | null;
  seller_national_id?: string | null;
  seller_phone?: string | null;
  seller_id_front_url?: string | null;
  seller_id_back_url?: string | null;
  contract_image_url?: string | null;
  has_box: number;
  has_charger: number;
  reserved_at?: string | null;
  reserved_by?: string | null;
  invoice_id?: string | null;
  sold_price?: number | null;
  sold_by?: string | null;
  sold_at?: string | null;
  buyer_name?: string | null;
  buyer_phone?: string | null;
  notes?: string | null;
  date_added: string;
  created_by?: string | null;
  created_at: string;
  updated_by?: string | null;
  updated_at: string;
}

export interface CreatePhoneInput {
  brand: string;
  model: string;
  color: string;
  storage: string;
  ram?: string | null;
  battery_capacity?: number | null;
  screen_size?: string | null;
  network?: PhoneNetwork | null;
  processor?: string | null;
  condition: DeviceCondition;
  battery_health?: number | null;
  imei: string;
  imei2?: string | null;
  purchase_price: number;
  selling_price: number;
  min_price?: number;
  warranty_period?: string | null;
  supplier_id?: string | null;
  seller_name?: string | null;
  seller_national_id?: string | null;
  seller_phone?: string | null;
  seller_id_front_url?: string | null;
  seller_id_back_url?: string | null;
  contract_image_url?: string | null;
  has_box?: boolean | number;
  has_charger?: boolean | number;
  notes?: string | null;
  date_added?: string | null;
  pay_from_drawer?: boolean;
}

export interface UpdatePhoneInput {
  brand?: string;
  model?: string;
  color?: string;
  storage?: string;
  ram?: string | null;
  battery_capacity?: number | null;
  screen_size?: string | null;
  network?: PhoneNetwork | null;
  processor?: string | null;
  condition?: DeviceCondition;
  battery_health?: number | null;
  imei?: string;
  imei2?: string | null;
  purchase_price?: number;
  selling_price?: number;
  min_price?: number;
  warranty_period?: string | null;
  supplier_id?: string | null;
  seller_name?: string | null;
  seller_national_id?: string | null;
  seller_phone?: string | null;
  seller_id_front_url?: string | null;
  seller_id_back_url?: string | null;
  contract_image_url?: string | null;
  has_box?: boolean | number;
  has_charger?: boolean | number;
  notes?: string | null;
}

export interface ReservePhoneInput {
  deposit_amount?: number;
  customer_name: string;
  customer_phone: string;
  notes?: string | null;
  collect_cash_to_drawer?: boolean;
}

export interface SellPhoneInput {
  sold_price: number;
  buyer_name?: string | null;
  buyer_phone?: string | null;
  invoice_id?: string | null;
  payment_method?: 'cash' | 'bank' | 'wallet' | 'other';
  notes?: string | null;
}

export interface PhoneFilterQuery {
  tab?: 'all' | 'in_stock' | 'new' | 'used' | 'reserved' | 'sold';
  condition?: 'all' | 'new' | 'used_like_new' | 'used';
  status?: 'all' | 'in_stock' | 'sold' | 'reserved';
  brand?: string;
  search?: string;
  supplier_id?: string;
  min_price?: number;
  max_price?: number;
  page?: number;
  limit?: number;
  sort_by?: 'date_added' | 'created_at' | 'selling_price' | 'purchase_price';
  sort_order?: 'asc' | 'desc';
}

export interface PhoneStats {
  total_count: number;
  in_stock_count: number;
  in_stock_purchase_value: number;
  in_stock_selling_value: number;
  new_count: number;
  new_value: number;
  used_count: number;
  used_value: number;
  reserved_count: number;
  sold_count: number;
  sold_revenue: number;
  sold_profit: number;
}

export interface ImeiCheckResult {
  exists: boolean;
  is_available: boolean;
  message: string;
  existing_phone?: {
    id: string;
    brand: string;
    model: string;
    color: string;
    status: PhoneStatus;
    imei: string;
    condition: PhoneCondition;
  } | null;
}

// ==============================================================================
// Accessories & Chargers Module Types
// ==============================================================================

export type AccessoryCategory =
  | 'شواحن وكيابل'
  | 'جرابات وكفرات'
  | 'حمايات شاشة'
  | 'سماعات وصوتيات'
  | 'باور بانك'
  | 'إكسسوارات سيارة'
  | 'عام'
  | 'chargers_cables'
  | 'cases_covers'
  | 'screen_protectors'
  | 'audio_headphones'
  | 'power_banks'
  | 'car_accessories'
  | 'other';

export type AccessoryStatus = 'active' | 'inactive' | 'archived';

export type StockMovementType =
  | 'initial'
  | 'purchase'
  | 'pos_sale'
  | 'return'
  | 'adjustment'
  | 'damage'
  | 'transfer';

export interface Accessory {
  id: string;
  dashboard_id: string;
  name: string;
  category: AccessoryCategory;
  brand: string;
  barcode?: string | null;
  cost_price: number;
  retail_price: number;
  wholesale_price?: number | null;
  stock: number;
  min_stock_alert: number;
  compatibility?: string | null;
  location?: string | null;
  date_added: string;
  status: AccessoryStatus;
  supplier_id?: string | null;
  notes?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccessoryStockMovement {
  id: string;
  dashboard_id: string;
  accessory_id: string;
  type: StockMovementType;
  quantity_change: number;
  previous_stock: number;
  new_stock: number;
  cost_price?: number | null;
  unit_price?: number | null;
  invoice_id?: string | null;
  supplier_id?: string | null;
  shift_id?: string | null;
  created_by?: string | null;
  notes?: string | null;
  created_at: string;
}

export interface AccessoryStats {
  total_items_count: number;
  total_stock_quantity: number;
  total_cost_valuation: number;
  total_retail_valuation: number;
  low_stock_items_count: number;
  out_of_stock_items_count: number;
}

export interface BarcodeCheckResult {
  exists: boolean;
  is_available: boolean;
  message: string;
  existing_accessory?: {
    id: string;
    name: string;
    category: string;
    brand: string;
    barcode: string;
  } | null;
}

export interface CreateAccessoryInput {
  name: string;
  category: AccessoryCategory;
  brand?: string;
  barcode?: string | null;
  cost_price: number;
  retail_price: number;
  wholesale_price?: number | null;
  stock?: number;
  min_stock_alert?: number;
  compatibility?: string | null;
  location?: string | null;
  supplier_id?: string | null;
  notes?: string | null;
  date_added?: string | null;
}

export interface UpdateAccessoryInput {
  name?: string;
  category?: AccessoryCategory;
  brand?: string;
  barcode?: string | null;
  cost_price?: number;
  retail_price?: number;
  wholesale_price?: number | null;
  min_stock_alert?: number;
  compatibility?: string | null;
  location?: string | null;
  status?: AccessoryStatus;
  supplier_id?: string | null;
  notes?: string | null;
}

export interface AdjustStockInput {
  type: 'adjustment' | 'damage' | 'purchase' | 'return';
  quantity_change: number;
  cost_price?: number | null;
  notes?: string | null;
  supplier_id?: string | null;
}

export interface AccessoryFilterQuery {
  page?: number;
  limit?: number;
  search?: string;
  category?: string;
  brand?: string;
  stock_filter?: 'all' | 'low' | 'available' | 'out_of_stock';
  status?: AccessoryStatus | 'all';
  sort_by?: 'created_at' | 'name' | 'stock' | 'retail_price';
  sort_order?: 'asc' | 'desc';
}

// ==============================================================================
// Spare Parts & Maintenance Workshop Types
// ==============================================================================

export type SparePartCategory =
  | 'screens'
  | 'batteries'
  | 'glass'
  | 'charging_ports'
  | 'cameras'
  | 'housing_frame'
  | 'ics'
  | 'speakers'
  | 'microphones'
  | 'flex_cables'
  | 'sensors'
  | 'wireless_charging'
  | 'antennas'
  | 'sim_trays'
  | 'vibrators'
  | 'small_parts'
  | 'other'
  | 'شاشات'
  | 'بطاريات'
  | 'باغات وزجاج'
  | 'فلاتات وبوردات شحن'
  | 'كاميرات وعدسات'
  | 'هاوسينج وشاصيه وظهر'
  | 'آيسيهات وبوردة'
  | 'سماعات وأجراس'
  | 'مايكات'
  | 'فلاتات وأزرار'
  | 'حساسات وفيس آي دي'
  | 'شحن لاسلكي وNFC'
  | 'هوائيات وشبكات'
  | 'أدراج وقارئات الشرائح'
  | 'هزازات ومحركات لمس'
  | 'أجزاء صغيرة ولواصق'
  | 'أخرى';

export type SparePartQuality =
  | 'original_pull'
  | 'original_new'
  | 'oem'
  | 'refurbished'
  | 'soft_oled'
  | 'hard_oled'
  | 'incell'
  | 'high_copy'
  | 'copy'
  | 'خلع أصلي'
  | 'أصلي وكالة جديد'
  | 'فرز أول مصنع'
  | 'مجدد باغة'
  | 'سوفت أوليد'
  | 'هارد أوليد'
  | 'إن سيل'
  | 'هاي كوبي'
  | 'تجاري اقتصادي';

export type SparePartStatus = 'available' | 'low_stock' | 'out_of_stock' | 'archived';

export interface SparePartRecord {
  id: string;
  dashboard_id: string;
  part_code?: string | null;
  name: string;
  category: SparePartCategory;
  device_model: string;
  compatible_models?: string | null;
  quality: SparePartQuality;
  cost_price: number;
  selling_price: number;
  stock: number;
  min_stock_alert: number;
  warranty_days: number;
  shelf_location?: string | null;
  supplier_id?: string | null;
  status: SparePartStatus;
  notes?: string | null;
  created_by?: string | null;
  created_at?: string;
  updated_by?: string | null;
  updated_at?: string;
}

export interface CreateSparePartInput {
  name: string;
  part_code?: string | null;
  category: SparePartCategory;
  device_model: string;
  compatible_models?: string[] | null;
  quality: SparePartQuality;
  cost_price: number;
  selling_price: number;
  stock: number;
  min_stock_alert?: number;
  warranty_days?: number;
  shelf_location?: string | null;
  supplier_id?: string | null;
  notes?: string | null;
}

export interface UpdateSparePartInput {
  name?: string;
  part_code?: string | null;
  category?: SparePartCategory;
  device_model?: string;
  compatible_models?: string[] | null;
  quality?: SparePartQuality;
  cost_price?: number;
  selling_price?: number;
  stock?: number;
  min_stock_alert?: number;
  warranty_days?: number;
  shelf_location?: string | null;
  supplier_id?: string | null;
  status?: SparePartStatus;
  notes?: string | null;
}

export interface AdjustSparePartStockInput {
  type: 'adjustment' | 'damage' | 'purchase' | 'used_in_repair' | 'return';
  quantity_change: number;
  notes?: string | null;
}

export interface SparePartFilterQuery {
  page?: number;
  limit?: number;
  search?: string;
  category?: string;
  quality?: string;
  stock_status?: 'all' | 'low_stock' | 'available' | 'out_of_stock';
  device_model?: string;
  supplier_id?: string;
  sort_by?: 'created_at' | 'name' | 'stock' | 'selling_price' | 'cost_price';
  sort_order?: 'asc' | 'desc';
}

export interface SparePartStats {
  total_types: number;
  total_quantity: number;
  total_cost_value: number;
  total_selling_value: number;
  low_stock_count: number;
  out_of_stock_count: number;
}

export interface PartCodeCheckResult {
  exists: boolean;
  is_available: boolean;
  message: string;
  existing_part?: {
    id: string;
    name: string;
    category: SparePartCategory;
    device_model: string;
    part_code: string;
  } | null;
}

// ==============================================================================
// Customer Credits & Ledger Types (دفتر النوتة / الحسابات الآجلة للعملاء)
// ==============================================================================

export type CustomerCreditStatus = 'active' | 'cleared' | 'archived';
export type CustomerCreditTransactionType = 'debt' | 'payment' | 'discount' | 'adjustment';
export type CustomerCreditPaymentMethod = 'cash' | 'bank' | 'wallet' | 'pos_split' | 'other';

export interface CustomerCredit {
  id: string;
  dashboard_id: string;
  name: string;
  phone: string;
  balance_due: number;
  total_debt: number;
  total_paid: number;
  last_transaction_date?: string | null;
  status: CustomerCreditStatus;
  notes?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomerCreditTransaction {
  id: string;
  dashboard_id: string;
  credit_id: string;
  type: CustomerCreditTransactionType;
  amount: number;
  balance_before: number;
  balance_after: number;
  payment_method?: CustomerCreditPaymentMethod | null;
  receipt_number?: string | null;
  invoice_id?: string | null;
  shift_id?: string | null;
  cashier_profile_id?: string | null;
  cashier_name?: string | null;
  cash_movement_id?: string | null;
  notes?: string | null;
  created_at: string;
}

export interface CustomerCreditStats {
  total_customers: number;
  total_due_balance: number;
  due_customers_count: number;
  cleared_customers_count: number;
  total_accumulated_debt: number;
  total_settled_amount: number;
}

export interface CreateCustomerCreditInput {
  name: string;
  phone: string;
  balance_due?: number;
  notes?: string | null;
}

export interface UpdateCustomerCreditInput {
  name?: string;
  phone?: string;
  notes?: string | null;
  status?: CustomerCreditStatus;
}

export interface SettleCustomerCreditInput {
  amount: number;
  payment_method?: CustomerCreditPaymentMethod;
  receipt_number?: string | null;
  notes?: string | null;
}

export interface AddCustomerDebtInput {
  amount: number;
  notes?: string | null;
  invoice_id?: string | null;
}

export interface CustomerFilterQuery {
  page?: number;
  limit?: number;
  search?: string;
  status_filter?: 'all' | 'due' | 'cleared';
  status?: CustomerCreditStatus | 'all';
  sort_by?: 'created_at' | 'name' | 'balance_due' | 'last_transaction_date';
  sort_order?: 'asc' | 'desc';
}

// ==============================================================================
// Phone Installments Types (ملفات وعقود تقسيط الهواتف المحمولة)
// ==============================================================================

export type InstallmentStatus = 'active' | 'overdue' | 'completed' | 'cancelled';
export type InstallmentPaymentMethod = 'cash' | 'bank' | 'wallet' | 'other';

export interface Installment {
  id: string;
  dashboard_id: string;
  customer_name: string;
  customer_phone: string;
  customer_national_id?: string | null;
  guarantor_name?: string | null;
  guarantor_phone?: string | null;
  guarantor_national_id?: string | null;
  device_purchased: string;
  phone_id?: string | null;
  total_amount: number;
  paid_down_payment: number;
  monthly_amount: number;
  total_months: number;
  remaining_months: number;
  paid_months: number;
  total_paid_installments: number;
  next_due_date: string;
  status: InstallmentStatus;
  notes?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface InstallmentPayment {
  id: string;
  dashboard_id: string;
  installment_id: string;
  installment_number: number;
  amount: number;
  payment_method: InstallmentPaymentMethod;
  receipt_number?: string | null;
  shift_id?: string | null;
  cashier_profile_id?: string | null;
  cashier_name?: string | null;
  cash_movement_id?: string | null;
  notes?: string | null;
  created_at: string;
}

export interface InstallmentStats {
  total_contracts: number;
  active_contracts: number;
  overdue_contracts: number;
  completed_contracts: number;
  total_financed_amount: number;
  total_down_payments: number;
  total_collected_installments: number;
  total_remaining_amount: number;
}

export interface CreateInstallmentInput {
  customer_name: string;
  customer_phone: string;
  customer_national_id?: string | null;
  guarantor_name?: string | null;
  guarantor_phone?: string | null;
  guarantor_national_id?: string | null;
  device_purchased: string;
  phone_id?: string | null;
  total_amount: number;
  paid_down_payment?: number;
  monthly_amount: number;
  total_months?: number;
  next_due_date: string;
  notes?: string | null;
}

export interface UpdateInstallmentInput {
  customer_name?: string;
  customer_phone?: string;
  customer_national_id?: string | null;
  guarantor_name?: string | null;
  guarantor_phone?: string | null;
  guarantor_national_id?: string | null;
  device_purchased?: string;
  phone_id?: string | null;
  monthly_amount?: number;
  next_due_date?: string;
  status?: InstallmentStatus;
  notes?: string | null;
}

export interface PayInstallmentInput {
  amount?: number;
  payment_method?: InstallmentPaymentMethod;
  receipt_number?: string | null;
  notes?: string | null;
}

export interface InstallmentFilterQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: InstallmentStatus | 'all';
  sort_by?: 'created_at' | 'customer_name' | 'next_due_date' | 'total_amount';
  sort_order?: 'asc' | 'desc';
}

// ==============================================================================
// Store & System Settings Types (إعدادات المتجر والنظام)
// ==============================================================================

export type ThermalPaperSize = '80mm' | '58mm';
export type DashboardTheme = 'dark' | 'light' | 'system';
export type DashboardLocale = 'ar' | 'en';

// Backwards-compatible aliases
export type AppTheme = DashboardTheme;
export type AppLocale = DashboardLocale;

export interface StoreSettings {
  id: string;
  name: string;
  slug: string;
  phone: string;
  email: string | null;
  tagline: string | null;
  logo_url: string | null;
  address: string | null;
  city: string | null;
  currency: string;
  timezone: string;
  receipt_header: string | null;
  receipt_footer: string | null;
  receipt_terms: string | null;
  enable_thermal_print: boolean;
  thermal_paper_size: ThermalPaperSize;
  show_tax_invoice: boolean;
  tax_rate: number;
  repair_terms: string | null;
  default_repair_warranty_days: number;
  require_imei_for_phones: boolean;
  opening_cash_default: number;
  enable_telecom_wallets: boolean;
  theme: DashboardTheme;
  locale: DashboardLocale;
  created_at: string;
  updated_at: string;
}

export interface UpdateStoreSettingsInput {
  name?: string;
  phone?: string;
  email?: string | null;
  tagline?: string | null;
  logo_url?: string | null;
  address?: string | null;
  city?: string | null;
  currency?: string;
  timezone?: string;
  receipt_header?: string | null;
  receipt_footer?: string | null;
  receipt_terms?: string | null;
  enable_thermal_print?: boolean;
  thermal_paper_size?: ThermalPaperSize;
  show_tax_invoice?: boolean;
  tax_rate?: number;
  repair_terms?: string | null;
  default_repair_warranty_days?: number;
  require_imei_for_phones?: boolean;
  opening_cash_default?: number;
  enable_telecom_wallets?: boolean;
  theme?: DashboardTheme;
  locale?: DashboardLocale;
}

// ==============================================================================
// POS & Point of Sale Catalog Types
// ==============================================================================

export interface PosAccessoryFilters {
  category?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface PosAccessoryItem {
  id: string;
  name: string;
  barcode: string;
  category: string;
  brand: string | null;
  retail_price: number;
  cost_price: number;
  stock: number;
  compatibility: string | null;
  location: string | null;
  image_url: string | null;
}

export interface PosPhoneFilters {
  brand?: string;
  condition?: 'new' | 'used_like_new' | 'used';
  search?: string;
  page?: number;
  limit?: number;
}

export interface PosPhoneItem {
  id: string;
  brand: string;
  model: string;
  color: string;
  storage: string;
  imei: string;
  imei2: string | null;
  condition: string;
  selling_price: number;
  purchase_price: number;
  battery_health: number | null;
  battery_capacity: number | null;
  has_box: boolean;
  has_charger: boolean;
  status: string;
}

export interface PosSparePartFilters {
  category?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface PosSparePartItem {
  id: string;
  name: string;
  part_code: string | null;
  category: string;
  quality: string;
  selling_price: number;
  cost_price: number;
  stock: number;
  compatible_models: string[];
}

export interface PosTelecomFilters {
  provider?: string;
  type?: string;
  search?: string;
}

export interface PosTelecomItem {
  id: string;
  name: string;
  provider: string;
  type: string;
  balance: number;
  cash_out_balance: number;
  terminal_code: string | null;
  sim_number: string | null;
  is_dual_account: boolean;
  allow_negative: boolean;
  status: string;
}

// ==============================================================================
// Unified Financial Movements & POS Sales Types
// ==============================================================================

export type MovementDepartment =
  | 'accessories'
  | 'phones'
  | 'spare_parts'
  | 'telecom'
  | 'mixed_pos'
  | 'repairs'
  | 'general_finance';

export type MovementType =
  | 'sale'
  | 'refund'
  | 'telecom_service'
  | 'expense'
  | 'cash_in'
  | 'cash_out'
  | 'shift_adjust';

export type PaymentMethod = 'cash' | 'card' | 'wallet' | 'credit' | 'split';

export interface PosCartItemPayload {
  id: string; // Product ID
  type: string;
  title: string;
  quantity: number;
  price: number;
  cost_price?: number;
  costPrice?: number;
  total_price?: number;
  barcode?: string | null;
  imei?: string | null;
  terminal_id?: string | null;
  telecom_action?: string | null;
  telecom_amount?: number | null;
  customer_phone?: string | null;
  agent_commission?: number;
  service_fee?: number;
  telecom_details?: {
    terminal_id: string;
    sub_account: 'main_balance' | 'cash_out_balance';
    category: string;
    type: string;
    service_name: string;
    service_code?: string;
    phone_or_ref: string;
    amount?: number;
    commission?: number;
    service_fee?: number;
  } | null;
}

export interface SplitPaymentDetail {
  cash_amount?: number;
  electronic_amount?: number;
  card_amount?: number;
  wallet_amount?: number;
  electronic_method?: 'card' | 'wallet';
  card_terminal_id?: string | null;
  wallet_terminal_id?: string | null;
}

export interface PosCheckoutInput {
  items: PosCartItemPayload[];
  subtotal?: number;
  discount?: number;
  total?: number;
  paid_amount: number;
  payment_method: PaymentMethod;
  split_details?: SplitPaymentDetail | null;
  customer_id?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  notes?: string | null;
}

export interface FinancialMovement {
  id: string;
  dashboard_id: string;
  invoice_number: string;
  department: MovementDepartment;
  movement_type: MovementType;
  payment_method: PaymentMethod;
  subtotal: number;
  discount: number;
  total_amount: number;
  cost_amount: number;
  net_profit: number;
  paid_amount: number;
  remaining_amount: number;
  customer_id?: string | null;
  customer_name: string;
  customer_phone: string;
  cashier_id?: string | null;
  cashier_name: string;
  shift_id?: string | null;
  terminal_id?: string | null;
  telecom_transaction_id?: string | null;
  items_json?: string | null;
  telecom_details_json?: string | null;
  split_details_json?: string | null;
  notes?: string | null;
  created_at: string;
}

export interface PosMovementFilterQuery {
  department?: string;
  movement_type?: string;
  payment_method?: string;
  shift_id?: string;
  start_date?: string;
  end_date?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface PosSalesStats {
  today_sales_revenue: number;
  today_net_profit: number;
  today_transactions_count: number;
  today_cash_collected: number;
  today_electronic_collected: number;
  today_cash_in: number;
  today_cash_out: number;
  today_expenses: number;
  departments: {
    accessories_revenue: number;
    phones_revenue: number;
    spare_parts_revenue: number;
    telecom_revenue: number;
  };
}

export interface CreateExpenseInput {
  amount: number;
  category: string;
  description: string;
}

// ==============================================================================
// Merchant Invitation Codes Module Types
// ==============================================================================

export type MerchantInvitationStatus = 'active' | 'used' | 'revoked' | 'expired';

export interface MerchantInvitation {
  id: string;
  code: string;
  status: MerchantInvitationStatus;
  note?: string | null;
  expires_at?: string | null;
  used_at?: string | null;
  used_by_user_id?: string | null;
  used_by_dashboard_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface RegisterWithInviteInput {
  invite_code: string;
  full_name: string;
  phone: string;
  email?: string;
  password: string;
  store_name: string;
  store_address?: string;
  device_fingerprint?: string;
}

export interface VerifyInviteCodeResult {
  valid: boolean;
  code: string;
  note?: string | null;
  expires_at?: string | null;
  message?: string;
}




