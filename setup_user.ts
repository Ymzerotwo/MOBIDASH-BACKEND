/**
 * ============================================================================
 *              MobiDash - أداة الإعداد السريع وإضافة المستخدمين
 * ============================================================================
 * 
 * 📝 تعليمات الاستخدام:
 * 1. عدل البيانات في كائن USER_CONFIG أدناه كما تريد.
 * 2. احفظ الملف.
 * 3. شغّل الأمر التالي:
 * 
 *      npx tsx setup_user.ts
 * 
 * سيقوم هذا الكود بحفظ المتجر في جدول Dashboards والمالك في جدول Users!
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { hashPassword } from './src/utils/crypto';

// ============================================================================
// ✏️ بيانات المتجر والمالك:
// ============================================================================
export const USER_CONFIG = {
  // اسم المتجر أو المحل
  storeName: 'محل الفا فون للهواتف والصيانة',

  // هاتف المتجر للدخول إلى لوحة التحكم
  storePhone: '01012345678',

  // كلمة مرور المتجر للدخول إلى لوحة التحكم
  storePassword: 'StorePassword123!',

  // الاسم الكامل لصاحب المحل / المالك
  ownerName: 'محمد أحمد',

  // البريد الإلكتروني للمالك
  email: 'owner@mobidash.local',

  // رقم الهاتف الشخصي للمالك
  ownerPhone: '01012345678',

  // كلمة المرور الشخصية للمالك (بديل الـ PIN وبدء الوردية)
  ownerPassword: 'Password123!',

  // الدور الوظيفي للمالك (owner فقط)
  role: 'owner' as const,
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_NAME = 'mobidash';

function sqlEscape(val: string | null | undefined): string {
  if (val === null || val === undefined || val === '') return 'NULL';
  return `'${String(val).replace(/'/g, "''")}'`;
}

async function run() {
  console.log('\n======================================================');
  console.log('🚀 بدء إضافة المتجر والمالك بنظام الحساب الموحد (MobiDash)...');
  console.log('======================================================\n');

  const storeName = USER_CONFIG.storeName.trim();
  const storePhone = USER_CONFIG.storePhone.trim();
  const storePassword = USER_CONFIG.storePassword;

  const ownerName = USER_CONFIG.ownerName.trim();
  const ownerEmail = USER_CONFIG.email.trim().toLowerCase();
  const ownerPhone = USER_CONFIG.ownerPhone?.trim() || null;
  const ownerPassword = USER_CONFIG.ownerPassword;
  const role = USER_CONFIG.role;

  // 1. التحقق من المدخلات
  if (!storeName || !storePhone || storePhone.length < 8) {
    console.error('❌ خطأ: يرجى كتابة اسم المتجر ورقم هاتف صالح.');
    process.exit(1);
  }
  if (!ownerName || ownerName.length < 2) {
    console.error('❌ خطأ: اسم المالك مطلوب.');
    process.exit(1);
  }
  if (!ownerPassword || ownerPassword.length < 6) {
    console.error('❌ خطأ: كلمة المرور يجب ألا تقل عن 6 أحرف.');
    process.exit(1);
  }

  // 2. تشفير كلمات المرور
  const storePasswordHash = await hashPassword(storePassword);
  const ownerPasswordHash = await hashPassword(ownerPassword);

  const dashboardId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  // توليد المعرف النصي (slug) للمتجر
  const slugPrefix = storeName
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 24) || 'store';
  const slug = `${slugPrefix}-${dashboardId.substring(0, 6)}`;

  const tempSqlFile = path.join(__dirname, '.temp_seed_user.sql');

  const sqlStatements = `
PRAGMA foreign_keys = OFF;

-- 1. إضافة المتجر إلى Dashboards مع بيانات الاعتماد (الهاتف وكلمة المرور)
INSERT INTO Dashboards (
  id, name, slug, phone, email, password_hash,
  currency, is_default, status, is_banned, created_at, updated_at
) VALUES (
  '${dashboardId}',
  ${sqlEscape(storeName)},
  '${slug}',
  ${sqlEscape(storePhone)},
  ${sqlEscape(ownerEmail)},
  ${sqlEscape(storePasswordHash)},
  'EGP',
  1,
  'active',
  0,
  '${nowIso}',
  '${nowIso}'
);

-- 2. إضافة المالك إلى Users بحساب موحد (role: owner)
INSERT INTO Users (
  id, dashboard_id, name, phone, email, password_hash,
  role, job_title, permissions, salary, commission_rate, max_discount_rate,
  can_open_drawer, can_view_cost_price, is_active, is_banned, created_at, updated_at
) VALUES (
  '${userId}',
  '${dashboardId}',
  ${sqlEscape(ownerName)},
  ${ownerPhone ? sqlEscape(ownerPhone) : 'NULL'},
  ${sqlEscape(ownerEmail)},
  ${sqlEscape(ownerPasswordHash)},
  '${role}',
  'المالك / صاحب المحل',
  '{"*": true}',
  0.0,
  0.0,
  100.0,
  1,
  1,
  1,
  0,
  '${nowIso}',
  '${nowIso}'
);

PRAGMA foreign_keys = ON;
`;

  try {
    fs.writeFileSync(tempSqlFile, sqlStatements, 'utf-8');

    execSync(`npx wrangler d1 execute ${DB_NAME} --local --file="${tempSqlFile}" -y`, {
      cwd: __dirname,
      stdio: 'pipe'
    });

    console.log('\n======================================================');
    console.log('🎉 تم إنشاء المتجر والمالك بنجاح في قاعدة البيانات المحلية!');
    console.log('======================================================');
    console.log(`🏪 اسم المتجر:             ${storeName}`);
    console.log(`📱 هاتف دخول المتجر:       ${storePhone}`);
    console.log(`🔑 كلمة مرور المتجر:       ${storePassword}`);
    console.log('------------------------------------------------------');
    console.log(`👤 اسم المالك:             ${ownerName}`);
    console.log(`📧 البريد الإلكتروني:     ${ownerEmail}`);
    console.log(`📱 هاتف المالك:            ${ownerPhone || 'غير مسجل'}`);
    console.log(`🔑 كلمة مرور المالك:       ${ownerPassword}`);
    console.log(`👑 الدور الوظيفي:         ${role}`);
    console.log('------------------------------------------------------');
    console.log(`🆔 Dashboard ID:         ${dashboardId}`);
    console.log(`🆔 User ID:              ${userId}`);
    console.log('======================================================\n');

  } catch (err: any) {
    const errorMsg = String(err?.stderr || err?.message || err);
    console.error('\n❌ حدث خطأ أثناء الحفظ في قاعدة البيانات:', errorMsg);
  } finally {
    if (fs.existsSync(tempSqlFile)) {
      try {
        fs.unlinkSync(tempSqlFile);
      } catch {}
    }
  }
}

run();
