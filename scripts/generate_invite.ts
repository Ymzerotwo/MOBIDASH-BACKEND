#!/usr/bin/env node

/**
 * ==============================================================================
 * MobiDash: Merchant Invitation Code Generator CLI Tool
 * Location: backend/scripts/generate_invite.ts
 * 
 * Usage:
 *   npx tsx scripts/generate_invite.ts
 *   npx tsx scripts/generate_invite.ts --env=remote --note="Furusan Shop" --days=30
 *   npx tsx scripts/generate_invite.ts --env=local --count=3
 * ==============================================================================
 */

import readline from 'readline';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendDir = path.resolve(__dirname, '..');
const configPath = path.join(backendDir, 'wrangler.jsonc');

// Clear and unambiguous letters and numbers (excluding 0, O, 1, I)
const CHARSET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * Generate a unique and professional invitation code
 * Pattern: MOBI-XXXX-XXXX
 */
function generateCode(): string {
  const bytes = crypto.randomBytes(8);
  let segment1 = '';
  let segment2 = '';
  for (let i = 0; i < 4; i++) {
    segment1 += CHARSET[bytes[i] % CHARSET.length];
  }
  for (let i = 4; i < 8; i++) {
    segment2 += CHARSET[bytes[i] % CHARSET.length];
  }
  return `MOBI-${segment1}-${segment2}`;
}

/**
 * Read interactive input from terminal
 */
function promptQuestion(rl: readline.Interface, query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function main() {
  console.log('\n======================================================');
  console.log('   🚀 MobiDash - New Merchant Invitation Code Generator CLI');
  console.log('======================================================\n');

  // Read command-line arguments if any
  const args = process.argv.slice(2);
  let targetEnv: 'remote' | 'local' | null = null;
  let note: string = '';
  let count: number = 1;
  let expiryDays: number = 30;

  for (const arg of args) {
    if (arg.startsWith('--env=')) {
      const val = arg.split('=')[1].toLowerCase();
      if (val === 'remote' || val === 'local') targetEnv = val;
    } else if (arg === '--remote' || arg === '-r') {
      targetEnv = 'remote';
    } else if (arg === '--local' || arg === '-l') {
      targetEnv = 'local';
    } else if (arg.startsWith('--note=')) {
      note = arg.split('=')[1];
    } else if (arg.startsWith('--count=')) {
      count = Math.max(1, parseInt(arg.split('=')[1], 10) || 1);
    } else if (arg.startsWith('--days=')) {
      expiryDays = Math.max(1, parseInt(arg.split('=')[1], 10) || 30);
    }
  }

  // If the environment is not specified in the arguments, ask interactively
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    if (!targetEnv) {
      console.log('Please select the target Cloudflare D1 database:');
      console.log('  [1] Cloud Remote D1 -- Recommended');
      console.log('  [2] Local D1 for development');
      const choice = (await promptQuestion(rl, '\nChoose [1 or 2] (default 1): ')).trim();
      targetEnv = choice === '2' ? 'local' : 'remote';
    }

    if (!note && args.length === 0) {
      note = (
        await promptQuestion(rl, 'Note to customize the code (e.g., merchant or shop name - optional): ')
      ).trim();
    }

    if (args.length === 0) {
      const daysInput = (
        await promptQuestion(rl, 'Code validity in days (press Enter for default 30 days): ')
      ).trim();
      if (daysInput && !isNaN(Number(daysInput))) {
        expiryDays = Number(daysInput);
      }

      const countInput = (
        await promptQuestion(rl, 'Number of codes to generate (press Enter to generate one code): ')
      ).trim();
      if (countInput && !isNaN(Number(countInput))) {
        count = Math.max(1, Number(countInput));
      }
    }

    const envLabel = targetEnv === 'remote' ? 'Cloud (Remote)' : 'Local (Development)';
    console.log(`\n⏳ Generating (${count}) codes and uploading them to database ${envLabel}...`);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000).toISOString();
    const generatedCodes: string[] = [];
    const sqlStatements: string[] = [];

    for (let i = 0; i < count; i++) {
      const id = crypto.randomUUID();
      const code = generateCode();
      generatedCodes.push(code);

      const noteText = count > 1 && note ? `${note} (#${i + 1})` : note || 'New merchant invitation';
      const safeNote = noteText.replace(/'/g, "''");

      sqlStatements.push(`
        INSERT INTO merchant_invitations (
          id, code, status, note, expires_at, created_at, updated_at
        ) VALUES (
          '${id}', '${code}', 'active', '${safeNote}', '${expiresAt}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        );
      `);
    }

    // Write SQL to a temporary file inside backend directory to avoid terminal escaping issues
    const tempSqlPath = path.join(backendDir, `.temp_invites_${Date.now()}.sql`);
    fs.writeFileSync(tempSqlPath, sqlStatements.join('\n'), 'utf-8');

    try {
      const flag = targetEnv === 'remote' ? '--remote' : '--local';
      const cmd = `npx wrangler d1 execute mobidash ${flag} --config="${configPath}" --file="${tempSqlPath}"`;
      execSync(cmd, { cwd: backendDir, stdio: 'pipe' });
    } catch (execError: any) {
      const stdout = execError.stdout?.toString() || '';
      const stderr = execError.stderr?.toString() || '';
      throw new Error(`${execError.message}\n${stderr}\n${stdout}`.trim());
    } finally {
      if (fs.existsSync(tempSqlPath)) {
        fs.unlinkSync(tempSqlPath);
      }
    }

    console.log('\n======================================================');
    console.log('   ✅ Codes created and uploaded successfully!');
    console.log('======================================================\n');
    console.log(`📌 Environment: ${envLabel}`);
    console.log(`📅 Valid until: ${new Date(expiresAt).toLocaleDateString('en-US', { dateStyle: 'full' })}`);
    console.log(`📝 Note: ${note || 'None'}\n`);

    generatedCodes.forEach((code, index) => {
      const registerUrlLocal = `http://localhost:3003/register?code=${code}`;
      console.log(`------------------------------------------------------`);
      console.log(`🔑 Invitation code #${index + 1}:  ${code}`);
      console.log(`🌐 Local registration link:   ${registerUrlLocal}`);
      console.log(`📱 Suggested WhatsApp message:`);
      console.log(`"Welcome! You can now create your store on the MobiDash platform using your exclusive invitation code:`);
      console.log(`Code: ${code}`);
      console.log(`Or directly via the link: ${registerUrlLocal}`);
      console.log(`(The code is valid for one-time use only)"`);
    });
    console.log('------------------------------------------------------\n');
  } catch (error: any) {
    console.error('\n❌ An error occurred while executing the command:', error.message || error);
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();
