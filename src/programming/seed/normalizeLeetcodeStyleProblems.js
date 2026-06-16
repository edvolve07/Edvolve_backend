import mongoose from '../../aptitude/config/mongoose.js';
import { User } from '../../aptitude/models/User.js';
import { config } from '../../config.js';
import { ProgrammingProblem } from '../models/ProgrammingProblem.js';
import { DEFAULT_PRACTICE_LANGUAGES } from '../utils/constants.js';
import { isVisibleProblemTitle } from '../utils/problemVisibility.js';

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || config.mongoUri;
const DIFFICULTY_RANK = { Easy: 1, Medium: 2, Hard: 3 };
const TOPIC_RANK = {
  Basics: 1,
  'Variables & Data Types': 2,
  'Control Flow': 3,
  Functions: 4,
  Arrays: 5,
  Strings: 6,
  Recursion: 7,
  'Linked Lists': 8,
  'Stacks & Queues': 9,
  Trees: 10,
  Graphs: 11,
  Sorting: 12,
  Searching: 13,
  'Hash Table': 14,
  Heaps: 15,
  Greedy: 16,
  Backtracking: 17,
  'Bit Manipulation': 18,
  'Dynamic Programming': 19,
};

const TITLE_CONTENT = {
  'Echo a Number': {
    description: 'Given an integer n, print the same integer n.',
    hints: ['Read the value from standard input and write it back without changing it.'],
    follow_up: 'Can you handle negative numbers and zero without adding special cases?',
  },
  'Add Two Numbers': {
    description: 'Given two integers a and b, print their sum.',
    hints: ['Split the input into two numbers, convert them to integers, and add them.'],
    follow_up: 'Can you solve it without using any extra arrays or collections?',
  },
  'Subtract Two Numbers': {
    description: 'Given two integers a and b, print the result of a - b.',
    hints: ['The order matters: subtract the second number from the first number.'],
    follow_up: 'Can you explain how the result changes when b is negative?',
  },
  'Multiply Two Numbers': {
    description: 'Given two integers a and b, print their product.',
    hints: ['Convert both input values to numbers before multiplying.'],
    follow_up: 'Can you reason about the largest possible product from the constraints?',
  },
  'Even or Odd': {
    description: 'Given an integer n, print "Even" if n is even. Otherwise, print "Odd".',
    hints: ['A number is even when n % 2 equals 0.'],
    follow_up: 'Does the same modulo check work for negative integers in your language?',
  },
  'Positive Negative or Zero': {
    description: 'Given an integer n, classify it as Positive, Negative, or Zero.',
    hints: ['Compare n with 0 using if, else if, and else.'],
    follow_up: 'Can you write the conditions so exactly one branch runs?',
  },
  'Maximum of Two Numbers': {
    description: 'Given two integers a and b, print the larger value.',
    hints: ['Use one comparison. If both values are equal, either one is the maximum.'],
    follow_up: 'Can you extend the same idea to three or more numbers?',
  },
  'Print Numbers from 1 to N': {
    description: 'Given an integer n, print all integers from 1 to n in increasing order.',
    hints: ['Use a loop that starts at 1 and stops after printing n.'],
    follow_up: 'Can you build the output in one string before printing it?',
  },
  'Sum from 1 to N': {
    description: 'Given an integer n, print the sum of all integers from 1 to n.',
    hints: ['Use a running sum, or use the formula n * (n + 1) / 2.'],
    follow_up: 'Can you solve it in O(1) time?',
  },
  'Count Digits': {
    description: 'Given a non-negative integer n, print the number of decimal digits in n.',
    hints: ['Convert n to a string, or repeatedly divide by 10. Remember that 0 has one digit.'],
    follow_up: 'Can you solve it without converting the number to a string?',
  },
  'Sum of Array Elements': {
    description: 'Given an array of integers, print the sum of all elements.',
    hints: ['Read n first, then loop through the next n values while maintaining a total.'],
    follow_up: 'Can you do it in one pass using O(1) extra space?',
  },
  'Maximum in an Array': {
    description: 'Given an array of integers, print the maximum element in the array.',
    hints: ['Initialize the answer with the first element, then update it whenever you see a larger value.'],
    follow_up: 'Can you solve it with exactly one traversal?',
  },
  'Reverse a String': {
    description: 'Given a string s, print the characters of s in reverse order.',
    hints: ['Walk from the end of the string to the beginning, or use your language reverse utility.'],
    follow_up: 'Can you reverse it in-place when the string is represented as a character array?',
  },
  'Check Palindrome String': {
    description: 'Given a string s, print "true" if it is a palindrome. Otherwise, print "false".',
    hints: ['Compare characters from the left and right ends while moving inward.'],
    follow_up: 'Can you solve it using O(1) extra space?',
  },
};

const TWO_SUM = {
  title: 'Two Sum',
  problem_number: 1,
  description: [
    'Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.',
    '',
    'You may assume that each input would have exactly one solution, and you may not use the same element twice.',
    '',
    'You can return the answer in any order.',
  ].join('\n'),
  constraints: [
    '2 <= nums.length <= 10^4',
    '-10^9 <= nums[i] <= 10^9',
    '-10^9 <= target <= 10^9',
    'Only one valid answer exists.',
  ].join('\n'),
  input_format: 'First line contains n. Second line contains n integers nums. Third line contains target.',
  output_format: 'Print the two indices as [i,j].',
  difficulty: 'Easy',
  concept: 'Arrays',
  tags: ['Array', 'Hash Table'],
  company_tags: [],
  companies_locked: true,
  hints: ['Use a hash map to remember the index of each number you have already seen.'],
  follow_up: 'Can you come up with an algorithm that is less than O(n^2) time complexity?',
  sample_test_cases: [
    {
      input: '4\n2 7 11 15\n9',
      output: '[0,1]',
      display_input: 'nums = [2,7,11,15], target = 9',
      display_output: '[0,1]',
      explanation: 'Because nums[0] + nums[1] == 9, we return [0, 1].',
    },
    {
      input: '3\n3 2 4\n6',
      output: '[1,2]',
      display_input: 'nums = [3,2,4], target = 6',
      display_output: '[1,2]',
      explanation: '',
    },
    {
      input: '2\n3 3\n6',
      output: '[0,1]',
      display_input: 'nums = [3,3], target = 6',
      display_output: '[0,1]',
      explanation: '',
    },
  ],
  hidden_test_cases: [
    { input: '5\n1 5 9 13 17\n22', output: '[2,3]' },
    { input: '4\n-3 4 3 90\n0', output: '[0,2]' },
    { input: '6\n10 20 30 40 50 60\n90', output: '[2,5]' },
  ],
};

function starterCode() {
  return Object.fromEntries(DEFAULT_PRACTICE_LANGUAGES.map((language) => [language, '']));
}

function compactDescription(problem) {
  const titleContent = TITLE_CONTENT[problem.title];
  if (titleContent?.description) return titleContent.description;

  const current = String(problem.description || '').trim();
  if (current && !/^Goal:/i.test(current)) return current;

  const output = String(problem.output_format || '').trim();
  if (output) {
    return `Given the input described below, solve ${problem.title} and ${output.charAt(0).toLowerCase()}${output.slice(1)}`;
  }
  return `Solve ${problem.title} using the given input and output format.`;
}

function fallbackHint(problem) {
  const titleContent = TITLE_CONTENT[problem.title];
  if (titleContent?.hints?.length) return titleContent.hints;
  if (problem.concept) return [`Focus on the ${problem.concept} pattern and verify the sample cases before submitting.`];
  return ['Start with the simplest correct approach, then check boundary cases.'];
}

function fallbackFollowUp(problem) {
  const titleContent = TITLE_CONTENT[problem.title];
  if (titleContent?.follow_up) return titleContent.follow_up;
  if (/array|search|sum|maximum|minimum/i.test(`${problem.title} ${problem.concept}`)) {
    return 'Can you solve it in one pass using O(1) or near O(1) extra space?';
  }
  return 'Can you improve the solution after first making it correct?';
}

function normalizeSamples(samples) {
  return (Array.isArray(samples) ? samples : []).map((testCase) => ({
    input: String(testCase.input || ''),
    output: String(testCase.output || ''),
    display_input: String(testCase.display_input || testCase.input || ''),
    display_output: String(testCase.display_output || testCase.output || ''),
    explanation: String(testCase.explanation || ''),
  }));
}

async function getCreator() {
  const user = await User.findOne({ role: 'master_admin' }) || await User.findOne({});
  if (!user) throw new Error('Create at least one user before normalizing programming problems');
  return user._id;
}

async function normalizeLeetcodeStyleProblems() {
  if (!mongoUri) throw new Error('MONGO_URI or MONGODB_URI is required');
  await mongoose.connect(mongoUri);

  const createdBy = await getCreator();
  const now = new Date();

  await ProgrammingProblem.updateOne(
    { title: TWO_SUM.title },
    {
      $set: {
        ...TWO_SUM,
        difficulty_rank: DIFFICULTY_RANK[TWO_SUM.difficulty],
        topic_rank: TOPIC_RANK[TWO_SUM.concept] || 99,
        curriculum_order: 0,
        languages: DEFAULT_PRACTICE_LANGUAGES,
        starter_code: starterCode(),
        status: 'published',
        is_deleted: false,
        is_auto_gradable: true,
        is_beginner_friendly: false,
        updated_at: now,
      },
      $setOnInsert: {
        created_by: createdBy,
        created_at: now,
        total_submissions: 0,
        total_accepted: 0,
      },
    },
    { upsert: true },
  );

  const problems = await ProgrammingProblem.find({ is_deleted: { $ne: true } })
    .sort({ curriculum_order: 1, topic_rank: 1, difficulty_rank: 1, created_at: 1 });

  let nextNumber = 2;
  let normalized = 0;

  for (const problem of problems) {
    if (!isVisibleProblemTitle(problem.title)) continue;
    if (problem.title === TWO_SUM.title) {
      await ProgrammingProblem.updateOne({ _id: problem._id }, { $set: { problem_number: 1 } });
      continue;
    }

    const tags = Array.isArray(problem.tags) && problem.tags.length
      ? problem.tags
      : [problem.concept].filter(Boolean);
    const sample_test_cases = normalizeSamples(problem.sample_test_cases);

    await ProgrammingProblem.updateOne(
      { _id: problem._id },
      {
        $set: {
          problem_number: nextNumber,
          description: compactDescription(problem),
          hints: Array.isArray(problem.hints) && problem.hints.length ? problem.hints : fallbackHint(problem),
          follow_up: problem.follow_up || fallbackFollowUp(problem),
          tags,
          companies_locked: problem.companies_locked !== false,
          sample_test_cases,
          difficulty_rank: DIFFICULTY_RANK[problem.difficulty] || 1,
          topic_rank: TOPIC_RANK[problem.concept] || 99,
          updated_at: now,
        },
      },
    );
    nextNumber += 1;
    normalized += 1;
  }

  await ProgrammingProblem.syncIndexes();

  console.log(JSON.stringify({
    upserted_two_sum: true,
    normalized_problems: normalized,
    assigned_numbers_through: nextNumber - 1,
  }, null, 2));

  await mongoose.disconnect();
}

normalizeLeetcodeStyleProblems().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
