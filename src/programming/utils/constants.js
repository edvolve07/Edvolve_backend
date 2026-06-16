export const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];
export const STATUSES = ['draft', 'published'];
export const SUBMISSION_STATUSES = [
  'pending',
  'running',
  'accepted',
  'wrong_answer',
  'time_limit_exceeded',
  'memory_limit_exceeded',
  'runtime_error',
  'compilation_error',
];
export const LANGUAGES = [
  { id: 'javascript', label: 'JavaScript', extension: 'js', monaco: 'javascript' },
  { id: 'typescript', label: 'TypeScript', extension: 'ts', monaco: 'typescript' },
  { id: 'python', label: 'Python', extension: 'py', monaco: 'python' },
  { id: 'java', label: 'Java', extension: 'java', monaco: 'java' },
  { id: 'cpp', label: 'C++', extension: 'cpp', monaco: 'cpp' },
  { id: 'c', label: 'C', extension: 'c', monaco: 'c' },
  { id: 'csharp', label: 'C#', extension: 'cs', monaco: 'csharp' },
  { id: 'go', label: 'Go', extension: 'go', monaco: 'go' },
  { id: 'rust', label: 'Rust', extension: 'rs', monaco: 'rust' },
  { id: 'kotlin', label: 'Kotlin', extension: 'kt', monaco: 'kotlin' },
  { id: 'ruby', label: 'Ruby', extension: 'rb', monaco: 'ruby' },
  { id: 'swift', label: 'Swift', extension: 'swift', monaco: 'swift' },
  { id: 'php', label: 'PHP', extension: 'php', monaco: 'php' },
];
export const LANGUAGE_IDS = LANGUAGES.map((language) => language.id);
export const DEFAULT_PRACTICE_LANGUAGES = LANGUAGE_IDS;
export const CONCEPTS = [
  'Basics',
  'Variables & Data Types',
  'Control Flow',
  'Functions',
  'Arrays',
  'Strings',
  'Recursion',
  'Linked Lists',
  'Stacks & Queues',
  'Trees',
  'Graphs',
  'Sorting',
  'Searching',
  'Dynamic Programming',
  'Greedy',
  'Backtracking',
  'Bit Manipulation',
  'Hash Table',
  'Heaps',
  'OOP Basics',
  'Inheritance & Polymorphism',
  'Design Patterns',
  'System Design',
];
export const DEFAULT_TIME_LIMIT = 2;
export const DEFAULT_MEMORY_LIMIT = 256;
