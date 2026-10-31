-- ==============================================================================
-- MobiDash - Clean Database Drop Script
-- Purpose: Safely drops all tables, indexes, and migration history for mobidash
-- ==============================================================================

PRAGMA foreign_keys = OFF;

-- 1. Financial Movements (General Ledger) - References telecom, terminals, shifts, dashboards
DROP TABLE IF EXISTS financial_movements;

-- 2. Repair Workshop
DROP TABLE IF EXISTS repair_parts_used;
DROP TABLE IF EXISTS repair_tickets;

-- 3. Invoices & POS
DROP TABLE IF EXISTS invoice_items;
DROP TABLE IF EXISTS invoices;

-- 4. Finances & Cash Drawer
DROP TABLE IF EXISTS cash_movements;
DROP TABLE IF EXISTS shifts;

-- 5. Telecom & Digital Wallets
DROP TABLE IF EXISTS telecom_transactions;
DROP TABLE IF EXISTS telecom_terminals;

-- 6. Suppliers & Vendor Accounts
DROP TABLE IF EXISTS supplier_transactions;
DROP TABLE IF EXISTS suppliers;

-- 7. Accessories & Phone Essentials Inventory
DROP TABLE IF EXISTS accessory_stock_movements;
DROP TABLE IF EXISTS accessories;

-- 8. Phones & Spare Parts Inventory
DROP TABLE IF EXISTS phones;
DROP TABLE IF EXISTS spare_parts;

-- 9. Customer Credits & Installments
DROP TABLE IF EXISTS installment_payments;
DROP TABLE IF EXISTS installments;
DROP TABLE IF EXISTS customer_credit_transactions;
DROP TABLE IF EXISTS customer_credits;

-- 10. Notifications & Merchant Invitations
DROP TABLE IF EXISTS Notifications;
DROP TABLE IF EXISTS merchant_invitations;

-- 11. Multi-tenant members & Sessions
DROP TABLE IF EXISTS Sessions;
DROP TABLE IF EXISTS Users;
DROP TABLE IF EXISTS Dashboards;

-- 12. Cloudflare D1 migrations table
DROP TABLE IF EXISTS d1_migrations;

PRAGMA foreign_keys = ON;
