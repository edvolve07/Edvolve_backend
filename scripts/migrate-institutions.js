/**
 * Migration Script: Institution-Based Access Control
 *
 * This script:
 * 1. Creates a default institution ("Default Institution") for existing users
 * 2. Assigns all existing admins to the default institution
 * 3. Assigns all existing students to the default institution
 * 4. Backfills institutionId on existing assessments
 * 5. Verifies data integrity
 *
 * Usage: node scripts/migrate-institutions.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI or MONGO_URI environment variable is required');
  process.exit(1);
}

const MODULE_OPTIONS = ['ai_interview', 'aptitude', 'programming', 'both'];

const institutionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, trim: true, uppercase: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, default: '' },
    modules: {
      aptitude: { type: Boolean, default: true },
      coding: { type: Boolean, default: true },
      interviews: { type: Boolean, default: true },
      resumeBuilder: { type: Boolean, default: false },
      certificates: { type: Boolean, default: true },
    },
    status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, trim: true, default: '' },
    organization: { type: String, trim: true, default: '' },
    modules_access: { type: [String], enum: MODULE_OPTIONS, default: ['both'] },
    institutionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Institution', default: null, index: true },
    assigned_admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    role: { type: String, enum: ['student', 'admin', 'master_admin'], required: true, default: 'student', index: true },
    is_active: { type: Boolean, default: true, index: true },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);

const assessmentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    status: { type: String, enum: ['draft', 'published'], default: 'draft', index: true },
    is_deleted: { type: Boolean, default: false, index: true },
    institutionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Institution', default: null, index: true },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);

const Institution = mongoose.model('Institution', institutionSchema);
const User = mongoose.model('User', userSchema);
const Assessment = mongoose.model('Assessment', assessmentSchema);

async function migrate() {
  console.log('Connecting to MongoDB...');
  mongoose.set('strictQuery', true);
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB\n');

  // Step 1: Find or create the Default Institution
  console.log('--- Step 1: Create Default Institution ---');
  let defaultInstitution = await Institution.findOne({ code: 'DEFAULT' });

  if (!defaultInstitution) {
    const masterAdmin = await User.findOne({ role: 'master_admin' }).sort({ created_at: 1 });
    if (!masterAdmin) {
      console.error('No master admin found. Please create a master admin first.');
      process.exit(1);
    }

    defaultInstitution = await Institution.create({
      name: 'Default Institution',
      code: 'DEFAULT',
      email: 'default@institution.local',
      phone: '',
      address: '',
      modules: {
        aptitude: true,
        coding: true,
        interviews: true,
        resumeBuilder: false,
        certificates: true,
      },
      status: 'active',
      created_by: masterAdmin._id,
    });
    console.log(`  Created default institution: ${defaultInstitution.name} (${defaultInstitution.code}) [${defaultInstitution._id}]`);
  } else {
    console.log(`  Default institution already exists: ${defaultInstitution.name} (${defaultInstitution.code}) [${defaultInstitution._id}]`);
  }

  // Step 2: Assign existing admins to the default institution
  console.log('\n--- Step 2: Assign Admins to Institution ---');
  const adminsWithoutInstitution = await User.find({
    role: { $in: ['admin', 'master_admin'] },
    $or: [
      { institutionId: { $exists: false } },
      { institutionId: null },
    ],
  });

  if (adminsWithoutInstitution.length > 0) {
    const result = await User.updateMany(
      {
        role: { $in: ['admin', 'master_admin'] },
        $or: [
          { institutionId: { $exists: false } },
          { institutionId: null },
        ],
      },
      { $set: { institutionId: defaultInstitution._id } },
    );
    console.log(`  Assigned ${result.modifiedCount} admins/master_admins to default institution`);
  } else {
    console.log('  All admins already have an institution assigned');
  }

  // Step 3: Assign existing students to the default institution
  console.log('\n--- Step 3: Assign Students to Institution ---');
  const studentsWithoutInstitution = await User.find({
    role: 'student',
    $or: [
      { institutionId: { $exists: false } },
      { institutionId: null },
    ],
  });

  if (studentsWithoutInstitution.length > 0) {
    const result = await User.updateMany(
      {
        role: 'student',
        $or: [
          { institutionId: { $exists: false } },
          { institutionId: null },
        ],
      },
      { $set: { institutionId: defaultInstitution._id } },
    );
    console.log(`  Assigned ${result.modifiedCount} students to default institution`);
  } else {
    console.log('  All students already have an institution assigned');
  }

  // Step 4: Assign institutionId from creator for assessments
  console.log('\n--- Step 4: Backfill Institution on Assessments ---');
  const assessmentsWithoutInstitution = await Assessment.find({
    $or: [
      { institutionId: { $exists: false } },
      { institutionId: null },
    ],
  });

  if (assessmentsWithoutInstitution.length > 0) {
    let backfilled = 0;
    for (const assessment of assessmentsWithoutInstitution) {
      if (assessment.created_by) {
        const creator = await User.findById(assessment.created_by).select('institutionId');
        if (creator && creator.institutionId) {
          await Assessment.updateOne(
            { _id: assessment._id },
            { $set: { institutionId: creator.institutionId } },
          );
          backfilled += 1;
        }
      }
    }
    const remaining = assessmentsWithoutInstitution.length - backfilled;
    if (remaining > 0) {
      const result = await Assessment.updateMany(
        {
          $or: [
            { institutionId: { $exists: false } },
            { institutionId: null },
          ],
        },
        { $set: { institutionId: defaultInstitution._id } },
      );
      backfilled += result.modifiedCount;
    }
    console.log(`  Backfilled ${backfilled} assessments with institutionId`);
  } else {
    console.log('  All assessments already have an institutionId');
  }

  // Step 5: Assign students to their admin's institution if admin has one
  console.log('\n--- Step 5: Sync Students to Admin Institutions ---');
  const studentsWithAdmin = await User.find({
    role: 'student',
    assigned_admin: { $ne: null },
  }).populate('assigned_admin', 'institutionId');

  let synced = 0;
  for (const student of studentsWithAdmin) {
    if (
      student.assigned_admin &&
      student.assigned_admin.institutionId &&
      (!student.institutionId || student.institutionId.toString() !== student.assigned_admin.institutionId.toString())
    ) {
      await User.updateOne(
        { _id: student._id },
        { $set: { institutionId: student.assigned_admin.institutionId } },
      );
      synced += 1;
    }
  }
  console.log(`  Synced ${synced} students to their admin's institution`);

  // Step 6: Data Integrity Verification
  console.log('\n--- Step 6: Data Integrity Verification ---');

  const [totalUsers, totalAdmins, totalStudents, totalMasterAdmins, totalAssessments, totalInstitutions] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ role: 'admin' }),
    User.countDocuments({ role: 'student' }),
    User.countDocuments({ role: 'master_admin' }),
    Assessment.countDocuments(),
    Institution.countDocuments(),
  ]);

  const usersWithoutInstitution = await User.countDocuments({
    $or: [
      { institutionId: { $exists: false } },
      { institutionId: null },
    ],
  });

  const assessmentsWithoutInstitutionCount = await Assessment.countDocuments({
    $or: [
      { institutionId: { $exists: false } },
      { institutionId: null },
    ],
  });

  console.log('\n  Verification Results:');
  console.log(`  ─────────────────────────────────────────`);
  console.log(`  Total users:               ${totalUsers}`);
  console.log(`  Master admins:             ${totalMasterAdmins}`);
  console.log(`  Admins:                    ${totalAdmins}`);
  console.log(`  Students:                  ${totalStudents}`);
  console.log(`  Total institutions:        ${totalInstitutions}`);
  console.log(`  Total assessments:         ${totalAssessments}`);
  console.log(`  Users without institution: ${usersWithoutInstitution}`);
  console.log(`  Assessments w/o inst.:     ${assessmentsWithoutInstitutionCount}`);

  if (usersWithoutInstitution === 0 && assessmentsWithoutInstitutionCount === 0) {
    console.log('\n  ✓ All data integrity checks passed!');
  } else {
    console.log('\n  ✗ Some items still need institution assignment.');
    console.log('    Re-run this script or manually assign institutions.');
  }

  console.log('\nMigration complete!');
  await mongoose.disconnect();
}

migrate().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
