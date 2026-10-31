import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_NAME = 'mobidash';
const dbDir = __dirname;
const dropFilePath = path.join(dbDir, 'drop_all.sql');

const DROP_ALL_SQL_TEMPLATE = `-- ==============================================================================
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
`;

function ensureDropSqlFile(): string {
  if (!fs.existsSync(dropFilePath)) {
    fs.writeFileSync(dropFilePath, DROP_ALL_SQL_TEMPLATE, 'utf-8');
    console.log(`📄 Created clean drop script at: ${dropFilePath}`);
  }
  return dropFilePath;
}

function runCommand(cmd: string, description: string) {
  console.log(`\n⏳ ${description}...`);
  try {
    execSync(cmd, { stdio: 'inherit' });
    console.log(`✅ Completed: ${description}`);
    return true;
  } catch (error: any) {
    console.error(`❌ Failed: ${description}`);
    return false;
  }
}

function dropTables(isRemote: boolean) {
  const target = isRemote ? '--remote' : '--local';
  const modeName = isRemote ? 'Cloudflare D1 (REMOTE)' : 'Local D1';
  const filePath = ensureDropSqlFile();

  return runCommand(
    `npx wrangler d1 execute ${DB_NAME} ${target} --file="${filePath}" -y`,
    `Dropping all tables on ${modeName}`
  );
}

function applySchemas(isRemote: boolean) {
  const target = isRemote ? '--remote' : '--local';
  const modeName = isRemote ? 'Cloudflare D1 (REMOTE)' : 'Local D1';
  console.log(`\n🚀 Starting migrations on ${modeName} [Database: ${DB_NAME}]...`);

  const success = runCommand(
    `npx wrangler d1 migrations apply ${DB_NAME} ${target}`,
    `Applying migrations [${modeName}]`
  );
  
  console.log('\n----------------------------------------');
  if (success) {
    console.log(`📊 Result [${modeName}]: All migrations applied successfully to ${DB_NAME}.`);
  } else {
    console.log(`⚠️ Result [${modeName}]: Migration process encountered an issue.`);
  }
  return success;
}

function listMigrations(isRemote: boolean) {
  const target = isRemote ? '--remote' : '--local';
  const modeName = isRemote ? 'Cloudflare D1 (REMOTE)' : 'Local D1';

  return runCommand(
    `npx wrangler d1 migrations list ${DB_NAME} ${target}`,
    `Listing migrations status on ${modeName}`
  );
}

async function showMenu() {
  const args = process.argv.slice(2);

  if (args.includes('--local')) {
    applySchemas(false);
    return;
  }
  if (args.includes('--remote')) {
    applySchemas(true);
    return;
  }
  if (args.includes('--drop-local')) {
    dropTables(false);
    return;
  }
  if (args.includes('--drop-remote')) {
    dropTables(true);
    return;
  }
  if (args.includes('--reset-local')) {
    if (dropTables(false)) {
      applySchemas(false);
    }
    return;
  }
  if (args.includes('--reset-remote')) {
    if (dropTables(true)) {
      applySchemas(true);
    }
    return;
  }
  if (args.includes('--list-local')) {
    listMigrations(false);
    return;
  }
  if (args.includes('--list-remote')) {
    listMigrations(true);
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (query: string): Promise<string> => {
    return new Promise((resolve) => rl.question(query, resolve));
  };

  console.log('\n========================================');
  console.log(`   🗄️  OuraDash Database Manager: ${DB_NAME}  `);
  console.log('========================================');
  console.log('1) 🟢 Local: Apply All Schemas/Migrations');
  console.log('2) ☁️ Remote (Cloudflare D1): Apply All Schemas/Migrations');
  console.log('3) 🗑️ Local: Drop All Tables');
  console.log('4) 🗑️ Remote (Cloudflare D1): Drop All Tables');
  console.log('5) 💥 Full Remote Reset (Drop + Re-apply Schemas)');
  console.log('6) 💥 Full Local Reset (Drop + Re-apply Schemas)');
  console.log('7) 📋 Local: List Migrations Status');
  console.log('8) 📋 Remote: List Migrations Status');
  console.log('0) ❌ Exit');
  console.log('========================================');

  const answer = (await question('Select Option [0-8]: ')).trim();
  rl.close();

  switch (answer) {
    case '1':
      applySchemas(false);
      break;
    case '2':
      applySchemas(true);
      break;
    case '3':
      dropTables(false);
      break;
    case '4':
      dropTables(true);
      break;
    case '5':
      console.log(`\n⚠️ WARNING: This will drop ALL tables in REMOTE Cloudflare D1 (${DB_NAME})!`);
      if (dropTables(true)) {
        applySchemas(true);
      }
      break;
    case '6':
      console.log(`\n⚠️ WARNING: This will drop ALL tables in LOCAL D1 (${DB_NAME})!`);
      if (dropTables(false)) {
        applySchemas(false);
      }
      break;
    case '7':
      listMigrations(false);
      break;
    case '8':
      listMigrations(true);
      break;
    case '0':
      console.log('Bye! 👋');
      break;
    default:
      console.log('❌ Invalid option.');
      break;
  }
}

showMenu().catch((err) => {
  console.error('Fatal error:', err);
});
