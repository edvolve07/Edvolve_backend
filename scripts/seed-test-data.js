/**
 * Comprehensive test data seed script.
 *
 * Usage:  node scripts/seed-test-data.js
 *
 * Creates:
 *   - 1 master admin
 *   - 2 institutions with departments & branches
 *   - 2 institution admins (one per institution)
 *   - 2 placement admins (one per institution)
 *   - 8 enterprise students (4 per institution, across departments)
 *   - 3 individual students with subscriptions
 *   - Journey state for all students
 *
 * Test password for every account:  admin123
 */

import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { getSequelize, connectDatabase, closeDatabase } from '../src/database/connection.js';

const sequelize = getSequelize();

const PASSWORD_HASH = await bcrypt.hash('admin123', 10);

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function uid() {
  return uuid();
}

// ── Master Data ───────────────────────────────────────────────────────────

const masterAdminId = uid();

const inst1Id = uid();
const inst2Id = uid();

const inst1AdminId = uid();
const inst2AdminId = uid();
const inst1PlacementId = uid();
const inst2PlacementId = uid();

const dept1A = uid(); // CSE at inst1
const dept1B = uid(); // ECE at inst1
const dept2A = uid(); // CSE at inst2
const dept2B = uid(); // MBA at inst2

const branch1 = uid();
const branch2 = uid();
const branch3 = uid();
const branch4 = uid();

const entStudents = Array.from({ length: 8 }, () => uid());
const indStudents = Array.from({ length: 3 }, () => uid());
const indProfiles = Array.from({ length: 3 }, () => uid());
const entProfiles = Array.from({ length: 8 }, () => uid());
const subIds = Array.from({ length: 3 }, () => uid());
const payIds = Array.from({ length: 3 }, () => uid());

function ts(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

async function run() {
  console.log('🔗 Connecting to database...');
  await connectDatabase();

  console.log('🧹 Truncating all data (cascade)...');

  // Disable foreign key checks for clean truncation
  await sequelize.query('SET session_replication_role = replica;');

  const tables = [
    'payment_transactions',
    'subscriptions',
    'journey_interviews',
    'student_journeys',
    'journey_blueprints',
    'aptitude_results',
    'aptitude_questions',
    'interview_reports',
    'interview_sessions',
    'student_answers',
    'assessment_attempts',
    'assessments',
    'resume_versions',
    'programming_submissions',
    'programming_assessment_answers',
    'programming_assessment_attempts',
    'programming_assessment_problems',
    'programming_assessments',
    'programming_discussions',
    'programming_editorials',
    'programming_challenges',
    'programming_contests',
    'programming_problems',
    'communication_reports',
    'communication_sessions',
    'communication_scenarios',
    'student_certificates',
    'proctoring_events',
    'questions',
    'individual_students',
    'enterprise_students',
    'users',
    'admins',
    'students',
    'departments',
    'institutions',
    'api_keys',
  ];

  for (const table of tables) {
    try {
      await sequelize.query(`TRUNCATE TABLE "${table}" CASCADE;`);
    } catch {
      // table might not exist yet — ignore
    }
  }

  await sequelize.query('SET session_replication_role = origin;');
  console.log('✅ All tables truncated');

  // ── Institutions ─────────────────────────────────────────────────────────
  console.log('🏫 Seeding institutions...');
  await sequelize.query(`
    INSERT INTO institutions (_id, name, code, email, phone, address, modules, status, created_by, created_at, updated_at)
    VALUES
      (:id1, 'Global Tech University', 'GTU', 'admin@gtu.edu', '+91-80-1234-5678', '123 Tech Park, Bangalore, KA 560001',
        '{"aptitude":true,"coding":true,"interviews":true,"resumeBuilder":true,"certificates":true}', 'active', :master, NOW(), NOW()),
      (:id2, 'National Institute of Business', 'NIB', 'admin@nib.edu', '+91-22-8765-4321', '456 Business District, Mumbai, MH 400001',
        '{"aptitude":true,"coding":true,"interviews":true,"resumeBuilder":false,"certificates":true}', 'active', :master, NOW(), NOW())
  `, { replacements: { id1: inst1Id, id2: inst2Id, master: masterAdminId } });

  // ── Departments ──────────────────────────────────────────────────────────
  console.log('📚 Seeding departments...');
  await sequelize.query(`
    INSERT INTO departments (_id, institution_id, name, created_at, updated_at)
    VALUES
      (:d1, :i1, 'Computer Science & Engineering', NOW(), NOW()),
      (:d2, :i1, 'Electronics & Communication', NOW(), NOW()),
      (:d3, :i2, 'Computer Science & Engineering', NOW(), NOW()),
      (:d4, :i2, 'MBA - Business Administration', NOW(), NOW())
  `, { replacements: { d1: dept1A, d2: dept1B, d3: dept2A, d4: dept2B, i1: inst1Id, i2: inst2Id } });

  // ── Users (master admin, institution admins, placement admins) ───────────
  console.log('👤 Seeding users...');
  await sequelize.query(`
    INSERT INTO users (_id, name, email, password_hash, role, "institutionId", assigned_admin, department_id, admin_role, modules_access, is_active, must_change_password, status, created_at, updated_at)
    VALUES
      -- Master admin
      (:master, 'Master Admin', 'master@edvols.com', :pw, 'master_admin', NULL, NULL, NULL, NULL, '["both"]', true, false, 'active', NOW(), NOW()),
      -- Institution 1 admin
      (:adm1, 'Priya Sharma', 'priya@gtu.edu', :pw, 'admin', :i1, NULL, NULL, 'hod', '["both"]', true, false, 'active', NOW(), NOW()),
      -- Institution 2 admin
      (:adm2, 'Rajesh Patel', 'rajesh@nib.edu', :pw, 'admin', :i2, NULL, NULL, 'placement_officer', '["both"]', true, false, 'active', NOW(), NOW()),
      -- Institution 1 placement admin
      (:plc1, 'Ananya Reddy', 'ananya@gtu.edu', :pw, 'admin', :i1, NULL, NULL, 'placement_officer', '["both"]', true, false, 'active', NOW(), NOW()),
      -- Institution 2 placement admin
      (:plc2, 'Vikram Singh', 'vikram@nib.edu', :pw, 'admin', :i2, NULL, NULL, 'placement_officer', '["both"]', true, false, 'active', NOW(), NOW())
  `, {
    replacements: {
      master: masterAdminId,
      adm1: inst1AdminId,
      adm2: inst2AdminId,
      plc1: inst1PlacementId,
      plc2: inst2PlacementId,
      pw: PASSWORD_HASH,
      i1: inst1Id,
      i2: inst2Id,
    }
  });

  // ── Enterprise Students (in users table) ─────────────────────────────────
  console.log('🎓 Seeding enterprise students...');
  const entStudentData = [
    { id: entStudents[0], name: 'Aarav Kumar', email: 'aarav@student.com', dept: dept1A, inst: inst1Id, admin: inst1AdminId, usn: 'GTU-CSE-001', year: '4th' },
    { id: entStudents[1], name: 'Diya Nair', email: 'diya@student.com', dept: dept1A, inst: inst1Id, admin: inst1AdminId, usn: 'GTU-CSE-002', year: '3rd' },
    { id: entStudents[2], name: 'Rohan Gupta', email: 'rohan@student.com', dept: dept1B, inst: inst1Id, admin: inst1PlacementId, usn: 'GTU-ECE-001', year: '4th' },
    { id: entStudents[3], name: 'Sneha Iyer', email: 'sneha@student.com', dept: dept1B, inst: inst1Id, admin: inst1PlacementId, usn: 'GTU-ECE-002', year: '2nd' },
    { id: entStudents[4], name: 'Arjun Das', email: 'arjun@student.com', dept: dept2A, inst: inst2Id, admin: inst2AdminId, usn: 'NIB-CSE-001', year: '4th' },
    { id: entStudents[5], name: 'Kavya Menon', email: 'kavya@student.com', dept: dept2A, inst: inst2Id, admin: inst2AdminId, usn: 'NIB-CSE-002', year: '3rd' },
    { id: entStudents[6], name: 'Aditya Joshi', email: 'aditya@student.com', dept: dept2B, inst: inst2Id, admin: inst2PlacementId, usn: 'NIB-MBA-001', year: '2nd' },
    { id: entStudents[7], name: 'Meera Shah', email: 'meera@student.com', dept: dept2B, inst: inst2Id, admin: inst2PlacementId, usn: 'NIB-MBA-002', year: '1st' },
  ];

  for (const s of entStudentData) {
    await sequelize.query(`
      INSERT INTO users (_id, name, email, password_hash, role, "institutionId", assigned_admin, department_id, usn, year, modules_access, is_active, must_change_password, status, created_at, updated_at)
      VALUES (:id, :name, :email, :pw, 'student', :inst, :admin, :dept, :usn, :year, '["both"]', true, false, 'active', NOW(), NOW())
    `, { replacements: { ...s, pw: PASSWORD_HASH } });
  }

  // ── Enterprise Students (profile table) ──────────────────────────────────
  console.log('📋 Seeding enterprise_student profiles...');
  for (let i = 0; i < entStudents.length; i++) {
    const s = entStudentData[i];
    await sequelize.query(`
      INSERT INTO enterprise_students (_id, user_id, institution_id, department_id, branch_name, usn, year, assigned_admin, journey_access, current_level, current_interview, student_status, created_at, updated_at)
      VALUES (:pid, :uid, :inst, :dept, :branch, :usn, :year, :admin, :ja, :cl, :ci, 'active', NOW(), NOW())
    `, {
      replacements: {
        pid: entProfiles[i],
        uid: entStudents[i],
        inst: s.inst,
        dept: s.dept,
        branch: 'Main Campus',
        usn: s.usn,
        year: s.year,
        admin: s.admin,
        ja: [0, 2, 4, 6, 8, 10, 12, 14][i],
        cl: [1, 2, 3, 4, 5, 3, 2, 1][i],
        ci: [1, 3, 2, 4, 5, 3, 2, 1][i],
      }
    });
  }

  // ── Individual Students (in users table) ─────────────────────────────────
  console.log('🧑‍💻 Seeding individual students...');
  const indStudentData = [
    { id: indStudents[0], name: 'Priyanka Verma', email: 'individual@test.com' },
    { id: indStudents[1], name: 'Suresh Babu', email: 'suresh@test.com' },
    { id: indStudents[2], name: 'Lakshmi Rao', email: 'lakshmi@test.com' },
  ];

  for (const s of indStudentData) {
    await sequelize.query(`
      INSERT INTO users (_id, name, email, password_hash, role, is_active, must_change_password, status, created_at, updated_at)
      VALUES (:id, :name, :email, :pw, 'individual_student', true, false, 'active', NOW(), NOW())
    `, { replacements: { ...s, pw: PASSWORD_HASH } });
  }

  // ── Individual Students (profile table) ──────────────────────────────────
  console.log('📋 Seeding individual_student profiles...');
  const indPlanData = [
    { plan: 'professional', name: 'Professional', access: 6, interviews: 24, amount: 199900, gst: 35982, status: 'active' },
    { plan: 'advanced', name: 'Advanced', access: 3, interviews: 12, amount: 119900, gst: 21582, status: 'active' },
    { plan: 'basic', name: 'Basic', access: 1, interviews: 4, amount: 49900, gst: 8982, status: 'active' },
  ];

  for (let i = 0; i < indStudents.length; i++) {
    const p = indPlanData[i];
    await sequelize.query(`
      INSERT INTO individual_students (_id, user_id, subscription_id, journey_access, current_level, current_interview, subscription_status, created_at, updated_at)
      VALUES (:pid, :uid, :subId, :ja, :cl, :ci, :subStatus, NOW(), NOW())
    `, {
      replacements: {
        pid: indProfiles[i],
        uid: indStudents[i],
        subId: subIds[i],
        ja: p.access,
        cl: [1, 3, 2][i],
        ci: [1, 3, 2][i],
        subStatus: p.status,
      }
    });
  }

  // ── Subscriptions ────────────────────────────────────────────────────────
  console.log('💳 Seeding subscriptions...');
  for (let i = 0; i < 3; i++) {
    const p = indPlanData[i];
    await sequelize.query(`
      INSERT INTO subscriptions (_id, student_id, plan_key, plan_name, access_level, interviews_total, status, amount_paid, currency, gst_amount, start_date, end_date, created_at, updated_at)
      VALUES (:sid, :studentId, :planKey, :planName, :access, :interviews, 'active', :amount, 'INR', :gst, NOW(), NOW() + INTERVAL '365 days', NOW(), NOW())
    `, {
      replacements: {
        sid: subIds[i],
        studentId: indStudents[i],
        planKey: p.plan,
        planName: p.name,
        access: p.access,
        interviews: p.interviews,
        amount: p.amount,
        gst: p.gst,
      }
    });
  }

  // ── Payment Transactions ─────────────────────────────────────────────────
  console.log('💰 Seeding payment transactions...');
  for (let i = 0; i < 3; i++) {
    const p = indPlanData[i];
    const invNum = `EDV-INV-${String(i + 1).padStart(4, '0')}`;
    await sequelize.query(`
      INSERT INTO payment_transactions (_id, student_id, subscription_id, amount, currency, gst_amount, total_amount, payment_method, payment_id, order_id, status, invoice_number, invoice_date, plan_key, plan_name, created_at, updated_at)
      VALUES (:pid, :studentId, :subId, :amount, 'INR', :gst, :total, 'razorpay', :payId, :orderId, 'completed', :invNum, NOW(), :planKey, :planName, NOW(), NOW())
    `, {
      replacements: {
        pid: payIds[i],
        studentId: indStudents[i],
        subId: subIds[i],
        amount: p.amount,
        gst: p.gst,
        total: p.amount + p.gst,
        payId: `pay_${uid().slice(0, 16)}`,
        orderId: `order_${uid().slice(0, 16)}`,
        invNum,
        planKey: p.plan,
        planName: p.name,
      }
    });
  }

  // ── Student Journeys ─────────────────────────────────────────────────────
  console.log('🗺️  Seeding student journeys...');
  const allStudents = [
    ...entStudents.map((id, i) => ({ id, name: entStudentData[i].name, email: entStudentData[i].email, inst: entStudentData[i].inst, ja: [0, 2, 4, 6, 8, 10, 12, 14][i] })),
    ...indStudents.map((id, i) => ({ id, name: indStudentData[i].name, email: indStudentData[i].email, inst: null, ja: [6, 3, 1][i] })),
  ];

  for (let i = 0; i < allStudents.length; i++) {
    const s = allStudents[i];
    const cl = i < 8 ? [1, 2, 3, 4, 5, 3, 2, 1][i] : [1, 3, 2][i - 8];
    const ci = i < 8 ? [1, 3, 2, 4, 5, 3, 2, 1][i] : [1, 3, 2][i - 8];
    const completed = Math.max(0, (cl - 1) * 4 + (ci - 1));
    const status = completed === 0 ? 'not_started' : completed >= 24 ? 'completed' : 'in_progress';
    const score = completed > 0 ? Math.floor(Math.random() * 30) + 50 : 0;

    await sequelize.query(`
      INSERT INTO student_journeys (_id, student_id, student_name, student_email, institution_id, journey_access_level, current_level, current_interview_number, completed_interviews, total_interviews, overall_score, readiness_score, status, started_at, created_at, updated_at)
      VALUES (:jid, :sid, :name, :email, :inst, :ja, :cl, :ci, :completed, 24, :score, :rscore, :status, :started, NOW(), NOW())
    `, {
      replacements: {
        jid: uid(),
        sid: s.id,
        name: s.name,
        email: s.email,
        inst: s.inst,
        ja: s.ja,
        cl,
        ci,
        completed,
        score,
        rscore: Math.floor(Math.random() * 40) + 30,
        status,
        started: completed > 0 ? ts(30) : null,
      }
    });
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n✅ Test data seeded successfully!\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    TEST ACCOUNTS                           ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  Password for ALL accounts: admin123                        ║');
  console.log('╠──────────────────────────────────────────────────────────────╣');
  console.log('║  MASTER ADMIN                                              ║');
  console.log('║    master@edvols.com / admin123                             ║');
  console.log('╠──────────────────────────────────────────────────────────────╣');
  console.log('║  INSTITUTION ADMINS                                        ║');
  console.log('║    priya@gtu.edu / admin123   (Global Tech University)     ║');
  console.log('║    rajesh@nib.edu / admin123  (National Inst of Business)  ║');
  console.log('╠──────────────────────────────────────────────────────────────╣');
  console.log('║  PLACEMENT ADMINS                                          ║');
  console.log('║    ananya@gtu.edu / admin123  (Global Tech University)     ║');
  console.log('║    vikram@nib.edu / admin123  (National Inst of Business)  ║');
  console.log('╠──────────────────────────────────────────────────────────────╣');
  console.log('║  ENTERPRISE STUDENTS                                       ║');
  console.log('║    aarav@student.com / admin123  (GTU CSE 4th)             ║');
  console.log('║    diya@student.com / admin123   (GTU CSE 3rd)             ║');
  console.log('║    rohan@student.com / admin123  (GTU ECE 4th)             ║');
  console.log('║    sneha@student.com / admin123  (GTU ECE 2nd)             ║');
  console.log('║    arjun@student.com / admin123  (NIB CSE 4th)             ║');
  console.log('║    kavya@student.com / admin123  (NIB CSE 3rd)             ║');
  console.log('║    aditya@student.com / admin123 (NIB MBA 2nd)             ║');
  console.log('║    meera@student.com / admin123  (NIB MBA 1st)             ║');
  console.log('╠──────────────────────────────────────────────────────────────╣');
  console.log('║  INDIVIDUAL STUDENTS (with active subscriptions)            ║');
  console.log('║    individual@test.com / admin123  (Professional plan)     ║');
  console.log('║    suresh@test.com / admin123      (Advanced plan)         ║');
  console.log('║    lakshmi@test.com / admin123     (Basic plan)            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('\n📊 Data Summary:');
  console.log('   - 1 Master Admin');
  console.log('   - 2 Institutions (GTU + NIB)');
  console.log('   - 2 Institution Admins + 2 Placement Admins');
  console.log('   - 8 Enterprise Students (4 per institution)');
  console.log('   - 3 Individual Students (with subscriptions)');
  console.log('   - 4 Departments (2 per institution)');
  console.log('   - Journey state for all students');
  console.log('   - Subscription + payment records for individual students');
}

run()
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await closeDatabase();
    process.exit(0);
  });
