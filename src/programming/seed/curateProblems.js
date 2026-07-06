import mongoose from '../../aptitude/config/mongoose.js';
import { config } from '../../config.js';
import { User } from '../../aptitude/models/User.js';
import { ProgrammingProblem } from '../models/ProgrammingProblem.js';
import { INVALID_PROBLEM_TITLE_PATTERN, isVisibleProblemTitle } from '../utils/problemVisibility.js';

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
  'Bit Manipulation': 16,
  Greedy: 17,
  Backtracking: 18,
  'Dynamic Programming': 19,
  'OOP Basics': 30,
  'Inheritance & Polymorphism': 31,
  'Design Patterns': 32,
  'System Design': 40,
};

const NON_AUTOGRADABLE_CONCEPTS = new Set([
  'OOP Basics',
  'Inheritance & Polymorphism',
  'Design Patterns',
  'System Design',
]);

const BEGINNER_PROBLEMS = [
  {
    title: 'Echo a Number',
    concept: 'Basics',
    difficulty: 'Easy',
    input_format: 'One integer n.',
    output_format: 'Print the same integer n.',
    constraints: '-10^9 <= n <= 10^9',
    tests: [
      ['42', '42'], ['0', '0'], ['-17', '-17'], ['100', '100'], ['999999', '999999'], ['-1000000', '-1000000'],
    ],
    goal: 'Read one integer and print it exactly as it appears.',
    hint: 'Store the input value, then write it to standard output without changing it.',
  },
  {
    title: 'Add Two Numbers',
    concept: 'Basics',
    difficulty: 'Easy',
    input_format: 'Two integers a and b on one line.',
    output_format: 'Print a + b.',
    constraints: '-10^9 <= a, b <= 10^9',
    tests: [
      ['5 3', '8'], ['-2 7', '5'], ['0 0', '0'], ['100 -40', '60'], ['999 1', '1000'], ['-8 -9', '-17'],
    ],
    goal: 'Read two integers and print their sum.',
    hint: 'Split the input into two numbers and use the addition operator.',
  },
  {
    title: 'Subtract Two Numbers',
    concept: 'Basics',
    difficulty: 'Easy',
    input_format: 'Two integers a and b on one line.',
    output_format: 'Print a - b.',
    constraints: '-10^9 <= a, b <= 10^9',
    tests: [
      ['10 3', '7'], ['5 8', '-3'], ['0 0', '0'], ['-5 -2', '-3'], ['100 40', '60'], ['-10 5', '-15'],
    ],
    goal: 'Read two integers and print the result of subtracting the second from the first.',
    hint: 'The order matters: compute a - b, not b - a.',
  },
  {
    title: 'Multiply Two Numbers',
    concept: 'Basics',
    difficulty: 'Easy',
    input_format: 'Two integers a and b on one line.',
    output_format: 'Print a * b.',
    constraints: '-10^4 <= a, b <= 10^4',
    tests: [
      ['4 5', '20'], ['-3 6', '-18'], ['0 99', '0'], ['-7 -8', '56'], ['12 12', '144'], ['1 1000', '1000'],
    ],
    goal: 'Read two integers and print their product.',
    hint: 'Use multiplication after converting both input tokens to numbers.',
  },
  {
    title: 'Even or Odd',
    concept: 'Control Flow',
    difficulty: 'Easy',
    input_format: 'One integer n.',
    output_format: 'Print "Even" if n is even, otherwise print "Odd".',
    constraints: '-10^9 <= n <= 10^9',
    tests: [
      ['4', 'Even'], ['7', 'Odd'], ['0', 'Even'], ['-2', 'Even'], ['-9', 'Odd'], ['101', 'Odd'],
    ],
    goal: 'Classify a number as even or odd.',
    hint: 'A number is even when n % 2 equals 0.',
  },
  {
    title: 'Positive Negative or Zero',
    concept: 'Control Flow',
    difficulty: 'Easy',
    input_format: 'One integer n.',
    output_format: 'Print "Positive", "Negative", or "Zero".',
    constraints: '-10^9 <= n <= 10^9',
    tests: [
      ['5', 'Positive'], ['-3', 'Negative'], ['0', 'Zero'], ['999', 'Positive'], ['-1', 'Negative'], ['42', 'Positive'],
    ],
    goal: 'Use conditional logic to classify one integer.',
    hint: 'Compare n with 0 using if, else if, and else.',
  },
  {
    title: 'Maximum of Two Numbers',
    concept: 'Control Flow',
    difficulty: 'Easy',
    input_format: 'Two integers a and b.',
    output_format: 'Print the larger value.',
    constraints: '-10^9 <= a, b <= 10^9',
    tests: [
      ['8 3', '8'], ['-5 2', '2'], ['10 10', '10'], ['-1 -7', '-1'], ['0 -1', '0'], ['100 99', '100'],
    ],
    goal: 'Find the larger of two input numbers.',
    hint: 'Use a comparison; if the numbers are equal, either value is the maximum.',
  },
  {
    title: 'Print Numbers from 1 to N',
    concept: 'Control Flow',
    difficulty: 'Easy',
    input_format: 'One integer n.',
    output_format: 'Print numbers from 1 to n separated by spaces.',
    constraints: '1 <= n <= 1000',
    tests: [
      ['1', '1'], ['3', '1 2 3'], ['5', '1 2 3 4 5'], ['7', '1 2 3 4 5 6 7'], ['10', '1 2 3 4 5 6 7 8 9 10'], ['2', '1 2'],
    ],
    goal: 'Practice a simple counting loop.',
    hint: 'Start at 1, append each number, and stop when you reach n.',
  },
  {
    title: 'Sum from 1 to N',
    concept: 'Control Flow',
    difficulty: 'Easy',
    input_format: 'One integer n.',
    output_format: 'Print the sum 1 + 2 + ... + n.',
    constraints: '1 <= n <= 10^6',
    tests: [
      ['1', '1'], ['5', '15'], ['10', '55'], ['100', '5050'], ['7', '28'], ['50', '1275'],
    ],
    goal: 'Accumulate a running total from 1 through n.',
    hint: 'Use a loop with a sum variable, or use the formula n * (n + 1) / 2.',
  },
  {
    title: 'Count Digits',
    concept: 'Control Flow',
    difficulty: 'Easy',
    input_format: 'One non-negative integer n.',
    output_format: 'Print the number of digits in n.',
    constraints: '0 <= n <= 10^18',
    tests: [
      ['0', '1'], ['7', '1'], ['42', '2'], ['12345', '5'], ['100000', '6'], ['999999999', '9'],
    ],
    goal: 'Count how many decimal digits a number has.',
    hint: 'Convert to a string or repeatedly divide by 10. Remember that 0 has one digit.',
  },
  {
    title: 'Sum of Array Elements',
    concept: 'Arrays',
    difficulty: 'Easy',
    input_format: 'First line contains n. Second line contains n integers.',
    output_format: 'Print the sum of the array.',
    constraints: '1 <= n <= 10^5, -10^9 <= ai <= 10^9',
    tests: [
      ['5\n1 2 3 4 5', '15'], ['3\n-1 0 1', '0'], ['1\n10', '10'], ['4\n5 5 5 5', '20'], ['6\n1 -2 3 -4 5 -6', '-3'], ['2\n100 200', '300'],
    ],
    goal: 'Traverse an array and add every element.',
    hint: 'Read n, then loop through the next n numbers while maintaining a total.',
  },
  {
    title: 'Maximum in an Array',
    concept: 'Arrays',
    difficulty: 'Easy',
    input_format: 'First line contains n. Second line contains n integers.',
    output_format: 'Print the maximum element.',
    constraints: '1 <= n <= 10^5, -10^9 <= ai <= 10^9',
    tests: [
      ['5\n3 9 1 7 2', '9'], ['3\n-5 -2 -8', '-2'], ['1\n42', '42'], ['4\n0 0 0 0', '0'], ['6\n8 7 6 5 4 3', '8'], ['5\n-10 -20 -3 -40 -5', '-3'],
    ],
    goal: 'Find the largest value while scanning an array once.',
    hint: 'Initialize the answer with the first element, then update it whenever a larger value appears.',
  },
  {
    title: 'Reverse a String',
    concept: 'Strings',
    difficulty: 'Easy',
    input_format: 'One string s.',
    output_format: 'Print s in reverse order.',
    constraints: '1 <= length of s <= 10^5',
    tests: [
      ['hello', 'olleh'], ['world', 'dlrow'], ['a', 'a'], ['edvols', 'evlovede'], ['12345', '54321'], ['racecar', 'racecar'],
    ],
    goal: 'Reverse the characters of a string.',
    hint: 'Walk from the end to the beginning, or use your language string reverse utilities.',
  },
  {
    title: 'Check Palindrome String',
    concept: 'Strings',
    difficulty: 'Easy',
    input_format: 'One lowercase string s.',
    output_format: 'Print "true" if s is a palindrome, otherwise "false".',
    constraints: '1 <= length of s <= 10^5',
    tests: [
      ['racecar', 'true'], ['hello', 'false'], ['a', 'true'], ['madam', 'true'], ['abca', 'false'], ['level', 'true'],
    ],
    goal: 'Check whether a string reads the same from both directions.',
    hint: 'Compare characters from the left and right ends moving inward.',
  },
];

const SUPPORTED_LANGUAGES = [
  'javascript',
  'typescript',
  'python',
  'java',
  'cpp',
  'c',
  'csharp',
  'go',
  'rust',
  'kotlin',
  'ruby',
  'swift',
  'php',
];

function toCase(input, output, explanation = '') {
  return { input: String(input), output: String(output), explanation };
}

function splitCases(cases) {
  return {
    sample_test_cases: cases.slice(0, 2).map(([input, output], index) =>
      toCase(input, output, index === 0 ? 'Basic example for the stated input format.' : 'Second visible example for comparison.'),
    ),
    hidden_test_cases: cases.slice(2).map(([input, output]) => ({ input: String(input), output: String(output) })),
  };
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function lowerProblem(problem) {
  return `${problem.title} ${problem.input_format} ${problem.output_format} ${problem.constraints}`.toLowerCase();
}

function isConceptual(problem) {
  const text = lowerProblem(problem);
  return NON_AUTOGRADABLE_CONCEPTS.has(problem.concept)
    || text.includes('system design')
    || text.includes('design pattern')
    || text.includes('demonstrate')
    || text.includes('class ')
    || text.includes('inheritance')
    || text.includes('polymorphism');
}

function isTopicHeadingTitle(title) {
  return !isVisibleProblemTitle(title);
}

function goalFor(problem) {
  const text = lowerProblem(problem);
  if (text.includes('echo a number')) return 'Read one integer and print it exactly as it appears.';
  if (text.includes('add two') || text.includes('sum of two')) return 'Read two numbers and print their sum.';
  if (text.includes('subtract two') || text.includes('difference of two')) return 'Read two numbers and print the first number minus the second.';
  if (text.includes('multiply two') || text.includes('product of two')) return 'Read two numbers and print their product.';
  if (text.includes('print numbers from 1 to n')) return 'Print every number from 1 through n in increasing order.';
  if (text.includes('sum from 1 to n')) return 'Compute the sum of all integers from 1 through n.';
  if (text.includes('count digits')) return 'Count how many decimal digits are present in the input number.';
  if (text.includes('sum') && text.includes('array')) return 'Traverse the input array and compute the required sum.';
  if (text.includes('maximum') || text.includes('largest')) return 'Identify the largest value using comparisons.';
  if (text.includes('minimum') || text.includes('smallest')) return 'Identify the smallest value using comparisons.';
  if (text.includes('reverse') && text.includes('string')) return 'Reverse the characters of the input string.';
  if (text.includes('reverse') && text.includes('array')) return 'Print the input elements in reverse order.';
  if (text.includes('palindrome')) return 'Decide whether the input reads the same forward and backward.';
  if (text.includes('sort')) return 'Rearrange the input elements into the requested sorted order.';
  if (text.includes('binary search')) return 'Use the sorted order to find the target efficiently.';
  if (text.includes('linear search')) return 'Scan the array from left to right until the target is found.';
  if (text.includes('factorial')) return 'Compute the product of all positive integers up to n.';
  if (text.includes('fibonacci')) return 'Generate Fibonacci values using iteration or recursion.';
  if (text.includes('prime')) return 'Check whether the number has divisors other than 1 and itself.';
  if (text.includes('gcd') || text.includes('hcf')) return 'Find the greatest common divisor of two numbers.';
  if (text.includes('lcm')) return 'Find the least common multiple of two numbers.';
  if (text.includes('even') || text.includes('odd')) return 'Use divisibility by 2 to classify the number.';
  if (text.includes('positive') || text.includes('negative') || text.includes('zero')) return 'Use comparisons with zero to classify the value.';
  return `Solve the ${problem.title} task using the input and output contract exactly.`;
}

function hintFor(problem) {
  const text = lowerProblem(problem);
  if (text.includes('array')) return 'Read the count first when present, then process the array with one clear loop.';
  if (text.includes('string')) return 'Think about indexes, character order, and whether case sensitivity matters.';
  if (text.includes('sort')) return 'You may implement the named algorithm, but the final printed order must match exactly.';
  if (text.includes('search')) return 'Return the expected index convention from the statement; most edvols search tasks use 0-based indexing.';
  if (text.includes('recursion')) return 'Define the base case first, then reduce the problem toward that base case.';
  if (isConceptual(problem)) return 'Focus on a clean implementation and explainable behavior; these tasks are better reviewed by a mentor than by hidden tests.';
  return 'Start with the simplest correct approach, then check edge cases such as zero, negatives, duplicates, and single-item input.';
}

function buildDescription(problem) {
  const input = compact(problem.input_format) || 'Read input from standard input as described in the problem.';
  const output = compact(problem.output_format) || 'Print the required answer to standard output.';
  const concept = problem.concept || 'programming';

  return [
    `Goal: ${goalFor(problem)}`,
    `Why this matters: This exercise builds fluency with ${concept.toLowerCase()} and strengthens careful input/output handling.`,
    `Input: ${input}`,
    `Output: ${output}`,
    `Approach hint: ${hintFor(problem)}`,
  ].join('\n\n');
}

function generatedCases(problem) {
  const text = lowerProblem(problem);

  if (text.includes('hello world')) {
    return [['', 'Hello, World!'], ['', 'Hello, World!'], ['', 'Hello, World!'], ['', 'Hello, World!'], ['', 'Hello, World!'], ['', 'Hello, World!']];
  }
  if (text.includes('your name') || text.includes('print name') || text.includes('greeting')) {
    return [['Alice', 'Hello, Alice!'], ['Bob', 'Hello, Bob!'], ['Santhosh', 'Hello, Santhosh!'], ['A', 'Hello, A!'], ['edvols', 'Hello, edvols!'], ['Student', 'Hello, Student!']];
  }
  if (text.includes('sum of two') || text.includes('add two')) {
    return BEGINNER_PROBLEMS.find((p) => p.title === 'Add Two Numbers').tests;
  }
  if (text.includes('difference') || text.includes('subtract')) {
    return BEGINNER_PROBLEMS.find((p) => p.title === 'Subtract Two Numbers').tests;
  }
  if (text.includes('product') || text.includes('multiply')) {
    return BEGINNER_PROBLEMS.find((p) => p.title === 'Multiply Two Numbers').tests;
  }
  if (text.includes('even') || text.includes('odd')) {
    return BEGINNER_PROBLEMS.find((p) => p.title === 'Even or Odd').tests;
  }
  if (text.includes('positive') || text.includes('negative') || text.includes('zero')) {
    return BEGINNER_PROBLEMS.find((p) => p.title === 'Positive Negative or Zero').tests;
  }
  if (text.includes('maximum of two') || text.includes('max of two')) {
    return BEGINNER_PROBLEMS.find((p) => p.title === 'Maximum of Two Numbers').tests;
  }
  if (text.includes('largest of three') || text.includes('maximum of three')) {
    return [['4 9 2', '9'], ['-5 -1 -8', '-1'], ['1 1 1', '1'], ['0 10 5', '10'], ['100 99 98', '100'], ['-10 -20 -3', '-3']];
  }
  if (text.includes('smallest of three') || text.includes('minimum of three')) {
    return [['4 9 2', '2'], ['-5 -1 -8', '-8'], ['1 1 1', '1'], ['0 10 5', '0'], ['100 99 98', '98'], ['-10 -20 -3', '-20']];
  }
  if (text.includes('sum') && text.includes('array')) {
    return BEGINNER_PROBLEMS.find((p) => p.title === 'Sum of Array Elements').tests;
  }
  if ((text.includes('maximum') || text.includes('largest')) && text.includes('array')) {
    return BEGINNER_PROBLEMS.find((p) => p.title === 'Maximum in an Array').tests;
  }
  if ((text.includes('minimum') || text.includes('smallest')) && text.includes('array')) {
    return [['5\n3 9 1 7 2', '1'], ['3\n-5 -2 -8', '-8'], ['1\n42', '42'], ['4\n0 0 0 0', '0'], ['6\n8 7 6 5 4 3', '3'], ['5\n-10 -20 -3 -40 -5', '-40']];
  }
  if (text.includes('reverse') && text.includes('string')) {
    return BEGINNER_PROBLEMS.find((p) => p.title === 'Reverse a String').tests;
  }
  if (text.includes('reverse') && text.includes('array')) {
    return [['5\n1 2 3 4 5', '5 4 3 2 1'], ['3\na b c', 'c b a'], ['1\n9', '9'], ['4\n0 -1 2 -3', '-3 2 -1 0'], ['2\n10 20', '20 10'], ['6\n1 1 2 2 3 3', '3 3 2 2 1 1']];
  }
  if (text.includes('palindrome')) {
    return BEGINNER_PROBLEMS.find((p) => p.title === 'Check Palindrome String').tests;
  }
  if (text.includes('factorial')) {
    return [['5', '120'], ['0', '1'], ['1', '1'], ['3', '6'], ['7', '5040'], ['10', '3628800']];
  }
  if (text.includes('fibonacci')) {
    return [['0', '0'], ['1', '1'], ['2', '1'], ['6', '8'], ['10', '55'], ['15', '610']];
  }
  if (text.includes('prime') && !text.includes('prime factor')) {
    return [['7', 'true'], ['12', 'false'], ['2', 'true'], ['1', 'false'], ['97', 'true'], ['100', 'false']];
  }
  if (text.includes('gcd') || text.includes('hcf')) {
    return [['12 18', '6'], ['7 13', '1'], ['48 18', '6'], ['100 10', '10'], ['17 17', '17'], ['270 192', '6']];
  }
  if (text.includes('lcm')) {
    return [['4 6', '12'], ['7 5', '35'], ['12 18', '36'], ['10 10', '10'], ['3 11', '33'], ['21 6', '42']];
  }
  if (text.includes('linear search')) {
    return [['5\n3 9 1 7 2\n7', '3'], ['4\n2 4 6 8\n5', '-1'], ['1\n10\n10', '0'], ['5\n1 2 3 4 5\n1', '0'], ['5\n1 2 3 4 5\n5', '4'], ['5\n9 9 9 9 9\n9', '0']];
  }
  if (text.includes('binary search')) {
    return [['5\n1 3 5 7 9\n5', '2'], ['4\n2 4 6 8\n10', '-1'], ['1\n6\n6', '0'], ['6\n1 2 3 4 5 6\n1', '0'], ['6\n1 2 3 4 5 6\n6', '5'], ['5\n10 20 30 40 50\n35', '-1']];
  }
  if (text.includes('sort')) {
    return [['5\n3 1 4 1 5', '1 1 3 4 5'], ['4\n9 2 7 1', '1 2 7 9'], ['1\n42', '42'], ['5\n-1 -3 0 2 -2', '-3 -2 -1 0 2'], ['6\n5 5 4 4 3 3', '3 3 4 4 5 5'], ['3\n100 1 50', '1 50 100']];
  }

  return null;
}

function updateCases(problem) {
  if (isConceptual(problem)) return {};

  const cases = generatedCases(problem);
  if (cases?.length >= 5) return splitCases(cases.slice(0, 6));

  const currentSamples = Array.isArray(problem.sample_test_cases) ? problem.sample_test_cases : [];
  const currentHidden = Array.isArray(problem.hidden_test_cases) ? problem.hidden_test_cases : [];
  const total = currentSamples.length + currentHidden.length;

  if (total >= 5) return {};
  if (currentSamples.length && currentHidden.length) return {};

  return {};
}

function starterCode() {
  return Object.fromEntries(SUPPORTED_LANGUAGES.map((language) => [language, '']));
}

function beginnerDoc(problem, createdBy, order) {
  const cases = splitCases(problem.tests);
  return {
    title: problem.title,
    description: buildDescription(problem),
    constraints: problem.constraints,
    input_format: problem.input_format,
    output_format: problem.output_format,
    difficulty: problem.difficulty,
    concept: problem.concept,
    ...cases,
    time_limit: 2,
    memory_limit: 256,
    languages: SUPPORTED_LANGUAGES,
    starter_code: starterCode(),
    status: 'published',
    is_deleted: false,
    created_by: createdBy,
    difficulty_rank: DIFFICULTY_RANK[problem.difficulty],
    topic_rank: TOPIC_RANK[problem.concept] || 99,
    curriculum_order: order,
    is_beginner_friendly: true,
    is_auto_gradable: true,
    updated_at: new Date(),
  };
}

async function getCreator() {
  const user = await User.findOne({ role: 'master_admin' }) || await User.findOne({});
  if (!user) throw new Error('Create at least one user before curating programming problems');
  return user._id;
}

async function curateProblems() {
  if (!mongoUri) throw new Error('MONGO_URI or MONGODB_URI is required');
  await mongoose.connect(mongoUri);

  const createdBy = await getCreator();
  const removedTopicHeadings = await ProgrammingProblem.updateMany(
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
  let inserted = 0;
  let beginnerUpdated = 0;

  for (let index = 0; index < BEGINNER_PROBLEMS.length; index += 1) {
    const problem = BEGINNER_PROBLEMS[index];
    const result = await ProgrammingProblem.updateOne(
      { title: problem.title, concept: problem.concept },
      {
        $set: beginnerDoc(problem, createdBy, index + 1),
        $setOnInsert: {
          total_submissions: 0,
          total_accepted: 0,
          created_at: new Date(),
        },
      },
      { upsert: true },
    );
    inserted += result.upsertedCount || 0;
    beginnerUpdated += result.modifiedCount || 0;
  }

  const problems = await ProgrammingProblem.find({ is_deleted: { $ne: true } });
  const counters = { Easy: 1000, Medium: 2000, Hard: 3000 };
  let updated = 0;
  let improvedTests = 0;
  let conceptual = 0;

  for (const problem of problems) {
    if (isTopicHeadingTitle(problem.title)) continue;

    const difficulty = DIFFICULTY_RANK[problem.difficulty] ? problem.difficulty : 'Easy';
    const difficultyRank = DIFFICULTY_RANK[difficulty];
    const topicRank = TOPIC_RANK[problem.concept] || 99;
    counters[difficulty] = (counters[difficulty] || 9999) + 1;
    const autoGradable = !isConceptual(problem);
    const caseUpdate = updateCases(problem);

    if (Object.keys(caseUpdate).length) improvedTests += 1;
    if (!autoGradable) conceptual += 1;

    await ProgrammingProblem.updateOne(
      { _id: problem._id },
      {
        $set: {
          description: buildDescription(problem),
          difficulty,
          difficulty_rank: difficultyRank,
          topic_rank: topicRank,
          curriculum_order: problem.is_beginner_friendly ? problem.curriculum_order || 1 : counters[difficulty],
          is_beginner_friendly: Boolean(problem.is_beginner_friendly),
          is_auto_gradable: autoGradable,
          ...caseUpdate,
          updated_at: new Date(),
        },
      },
    );
    updated += 1;
  }

  await ProgrammingProblem.syncIndexes();

  const summary = await ProgrammingProblem.aggregate([
    { $match: { is_deleted: { $ne: true } } },
    {
      $group: {
        _id: { difficulty: '$difficulty', concept: '$concept' },
        count: { $sum: 1 },
      },
    },
    { $sort: { '_id.difficulty': 1, '_id.concept': 1 } },
  ]);

  console.log(JSON.stringify({
    inserted_beginner_problems: inserted,
    updated_beginner_problems: beginnerUpdated,
    removed_topic_heading_titles: removedTopicHeadings.modifiedCount || 0,
    updated_total: updated,
    improved_test_sets: improvedTests,
    conceptual_or_not_auto_gradable: conceptual,
    groups: summary,
  }, null, 2));

  await mongoose.disconnect();
}

curateProblems().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
