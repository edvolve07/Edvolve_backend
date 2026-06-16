import mongoose from '../../aptitude/config/mongoose.js';
import { config } from '../../config.js';
import { ProgrammingProblem } from '../models/ProgrammingProblem.js';
import { INVALID_PROBLEM_TITLE_PATTERN } from '../utils/problemVisibility.js';

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || config.mongoUri;

async function removeHeadingProblems() {
  if (!mongoUri) throw new Error('MONGO_URI or MONGODB_URI is required');
  await mongoose.connect(mongoUri);

  const matchingProblems = await ProgrammingProblem.find({
    title: { $regex: INVALID_PROBLEM_TITLE_PATTERN },
    is_deleted: { $ne: true },
  }).select('title concept status');

  const result = await ProgrammingProblem.updateMany(
    {
      title: { $regex: INVALID_PROBLEM_TITLE_PATTERN },
      is_deleted: { $ne: true },
    },
    {
      $set: {
        is_deleted: true,
        status: 'draft',
        deleted_at: new Date(),
        updated_at: new Date(),
      },
    },
  );

  console.log(JSON.stringify({
    matched: matchingProblems.length,
    removed: result.modifiedCount || 0,
    titles: matchingProblems.map((problem) => problem.title),
  }, null, 2));

  await mongoose.disconnect();
}

removeHeadingProblems().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
