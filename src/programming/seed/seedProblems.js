import mongoose from 'mongoose';
import { config } from '../../config.js';
import { ProgrammingProblem } from '../models/ProgrammingProblem.js';

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || config.mongoUri;
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

const TOPIC_MAP = {
  '01-basics': 'Basics',
  '02-variables-data-types': 'Variables & Data Types',
  '03-control-flow': 'Control Flow',
  '04-functions': 'Functions',
  '05-arrays': 'Arrays',
  '06-strings': 'Strings',
  '07-recursion': 'Recursion',
  '08-linked-lists': 'Linked Lists',
  '09-stacks-queues': 'Stacks & Queues',
  '10-trees': 'Trees',
  '11-graphs': 'Graphs',
  '12-sorting-algorithms': 'Sorting',
  '13-searching-algorithms': 'Searching',
  '14-dynamic-programming': 'Dynamic Programming',
  '15-greedy-algorithms': 'Greedy',
  '16-backtracking': 'Backtracking',
  '17-bit-manipulation': 'Bit Manipulation',
  '18-hash-tables': 'Hash Table',
  '19-heaps': 'Heaps',
  '20-oop-basics': 'OOP Basics',
  '21-inheritance-polymorphism': 'Inheritance & Polymorphism',
  '22-design-patterns': 'Design Patterns',
  '23-system-design-basics': 'System Design',
};

const TOPIC_CONTEXT = {
  '01-basics': 'basic programming constructs',
  '02-variables-data-types': 'variables and data types',
  '03-control-flow': 'control flow statements',
  '04-functions': 'functions and modular programming',
  '05-arrays': 'array manipulation',
  '06-strings': 'string processing',
  '07-recursion': 'recursive problem solving',
  '08-linked-lists': 'linked list operations',
  '09-stacks-queues': 'stack and queue data structures',
  '10-trees': 'tree data structures',
  '11-graphs': 'graph algorithms',
  '12-sorting-algorithms': 'sorting algorithms',
  '13-searching-algorithms': 'searching algorithms',
  '14-dynamic-programming': 'dynamic programming',
  '15-greedy-algorithms': 'greedy algorithms',
  '16-backtracking': 'backtracking techniques',
  '17-bit-manipulation': 'bit manipulation',
  '18-hash-tables': 'hash tables',
  '19-heaps': 'heap data structures',
  '20-oop-basics': 'object-oriented programming',
  '21-inheritance-polymorphism': 'inheritance and polymorphism',
  '22-design-patterns': 'design patterns',
  '23-system-design-basics': 'system design',
};

function fileToConcept(filename) {
  const key = filename.replace('.md', '');
  return TOPIC_MAP[key] || 'Basics';
}

function parseDifficulty(index, total) {
  const third = Math.ceil(total / 3);
  if (index < third) return 'Easy';
  if (index < third * 2) return 'Medium';
  return 'Hard';
}

function isImportedProblemTitle(title) {
  const value = String(title || '').trim();
  if (!value) return false;
  if (/^#?\s*Topic\s+\d+\s*:/i.test(value)) return false;
  if (/^(Easy|Medium|Hard)\s*\(/i.test(value)) return false;
  return true;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function desc(text, ctx) {
  return `${text.replace(/\.$/, '')}. This problem helps you practice ${ctx}. Pay close attention to the input format and edge cases.`;
}

function generateDescription(problemText, title, topicContext) {
  const p = problemText.toLowerCase();
  const t = title.toLowerCase();

  if (p.includes('hello world')) return desc('Write your first program that prints "Hello, World!" to the console. This is the traditional starting point for learning any programming language', topicContext);
  if (p.includes('your name') || p.includes('print name')) return desc('Write a program that reads a name from the input and prints a personalized greeting. This teaches you how to handle string input and output', topicContext);
  if (p.includes('sum of two') || (t.includes('sum') && (t.includes('two') || t.includes('add')))) return desc('Given two numbers, compute their sum. This simple arithmetic problem introduces you to reading multiple values, performing calculations, and displaying results', topicContext);
  if (p.includes('difference of two')) return desc('Compute the difference between two integers by subtracting the second from the first. This reinforces basic arithmetic operations and output formatting', topicContext);
  if (p.includes('product') && p.includes('two')) return desc('Multiply two numbers together and print the result. This problem strengthens your ability to handle multiplication operations', topicContext);
  if (p.includes('quotient') || (p.includes('divide') && p.includes('two'))) return desc('Divide two integers and find the quotient using integer division. Understand how programming languages handle division between integers', topicContext);
  if (p.includes('remainder') || p.includes('modulo') || p.includes('modulus')) return desc('Find the remainder when one integer is divided by another using the modulo operation. This is essential for many algorithmic problems', topicContext);
  if (p.includes('power') || p.includes('exponent')) return desc('Calculate the result of raising a number to a given power. This introduces exponentiation operations and handling of edge cases like zero exponents', topicContext);
  if (p.includes('absolute') || p.includes('abs value') || t.includes('abs')) return desc('Find the absolute value of a number, which is its distance from zero on the number line. This is a fundamental mathematical operation in programming', topicContext);
  if ((t + ' ' + p).includes('even') || (t + ' ' + p).includes('odd')) return desc('Determine whether a number is even or odd by checking its divisibility by 2. This teaches you about the modulo operator and conditional logic', topicContext);
  if ((t + ' ' + p).includes('positive') || (t + ' ' + p).includes('negative') || (t + ' ' + p).includes('check zero')) return desc('Classify a number as positive, negative, or zero. This problem reinforces conditional branching and comparison operators', topicContext);
  if ((t + ' ' + p).includes('leap')) return desc('Determine whether a given year is a leap year. This problem combines conditional logic with the specific rules of the Gregorian calendar', topicContext);

  if (p.includes('largest') || p.includes('greatest') || p.includes('maximum') || t.includes('maximum')) {
    if (p.includes('three')) return desc('Read three numbers and find the largest among them. This problem teaches comparison-based logic and decision making', topicContext);
    return desc('Given an array of integers, find and return the maximum element. This is a fundamental array traversal problem where you keep track of the largest value seen so far', topicContext);
  }
  if (p.includes('smallest') || p.includes('minimum') || t.includes('minimum')) {
    if (p.includes('three')) return desc('Read three numbers and find the smallest among them. Practice comparison operations and conditional logic', topicContext);
    return desc('Given an array of integers, find and return the minimum element. Traverse the array while keeping track of the smallest value encountered', topicContext);
  }
  if ((p.includes('sum') || t.includes('sum')) && (p.includes('array') || t.includes('array') || p.includes('element'))) return desc('Calculate the sum of all elements in an array. This problem teaches array traversal and accumulation patterns', topicContext);
  if (p.includes('average') || t.includes('average') || p.includes('mean')) return desc('Compute the average of all elements in an array by dividing the sum by the count. This combines array traversal with floating-point arithmetic', topicContext);
  if ((t.includes('reverse') || p.includes('reverse')) && (t.includes('array') || p.includes('array'))) return desc('Reverse the order of elements in an array. This problem teaches in-place array manipulation using two-pointer technique', topicContext);
  if ((t.includes('reverse') || p.includes('reverse')) && (t.includes('string') || p.includes('string'))) return desc('Reverse the characters in a string. This fundamental string operation teaches you about string indexing and manipulation', topicContext);
  if ((t + ' ' + p).includes('palindrome')) return desc('Check whether a given string reads the same forwards and backwards. This classic problem teaches string comparison techniques', topicContext);
  if ((t + ' ' + p).includes('anagram')) return desc('Determine if two strings are anagrams of each other, meaning they contain the same characters in different orders. This teaches character frequency counting', topicContext);
  if (t.includes('fibonacci') || t.includes('fib seq') || t.includes('fib number')) return desc('Generate the Fibonacci sequence up to a given term. This classic problem introduces recursion or iteration with the Fibonacci recurrence relation', topicContext);
  if (t.includes('factorial') || t.includes('fact of') || p.includes('factorial')) return desc('Calculate the factorial of a given number, which is the product of all positive integers up to that number. This is a classic recursion example', topicContext);
  if ((t + ' ' + p).includes('prime') && !t.includes('prime factor')) return desc('Determine whether a given number is prime. A prime number is only divisible by 1 and itself. This teaches efficient divisibility checking', topicContext);
  if (t.includes('gcd') || t.includes('hcf') || (t + ' ' + p).includes('greatest common')) return desc('Find the greatest common divisor (GCD) of two numbers. The Euclidean algorithm provides an efficient solution', topicContext);
  if (t.includes('lcm') || (t + ' ' + p).includes('least common')) return desc('Find the least common multiple (LCM) of two numbers. Use the relationship between LCM and GCD to solve efficiently', topicContext);

  if (t.includes('bubble') && t.includes('sort')) return desc('Implement the bubble sort algorithm to sort an array of integers. This simple sorting algorithm repeatedly steps through the list, compares adjacent elements, and swaps them if they are in the wrong order', topicContext);
  if (t.includes('selection') && t.includes('sort')) return desc('Implement selection sort, which divides the array into sorted and unsorted regions and repeatedly selects the minimum element from the unsorted region', topicContext);
  if (t.includes('insertion') && t.includes('sort')) return desc('Implement insertion sort, which builds the final sorted array one element at a time by repeatedly inserting elements into their correct position', topicContext);
  if (t.includes('merge') && t.includes('sort')) return desc('Implement merge sort, a divide-and-conquer algorithm that splits the array, recursively sorts each half, and then merges the sorted halves', topicContext);
  if (t.includes('quick') && t.includes('sort')) return desc('Implement quicksort, a divide-and-conquer algorithm that selects a pivot element and partitions the array around it', topicContext);
  if (p.includes('sort') || t.includes('sort')) return desc('Sort the given elements according to the specified order. This problem tests your understanding of sorting algorithms and comparison logic', topicContext);
  if (p.includes('binary search') || t.includes('binary search')) return desc('Implement binary search to efficiently find a target value in a sorted array. This logarithmic-time algorithm is fundamental to computer science', topicContext);
  if (t.includes('linear search')) return desc('Implement linear search to find a target value in an array by checking each element sequentially. This is the simplest searching algorithm', topicContext);

  if ((t.includes('inorder') || t.includes('in-order')) && t.includes('traversal')) return desc('Perform an inorder traversal of a binary tree, visiting nodes in the order: left subtree, root, right subtree. This traversal produces sorted order for BSTs', topicContext);
  if ((t.includes('preorder') || t.includes('pre-order')) && t.includes('traversal')) return desc('Perform a preorder traversal of a binary tree, visiting nodes in the order: root, left subtree, right subtree. Useful for creating a copy of the tree', topicContext);
  if ((t.includes('postorder') || t.includes('post-order')) && t.includes('traversal')) return desc('Perform a postorder traversal of a binary tree, visiting nodes in the order: left subtree, right subtree, root. Commonly used for tree deletion', topicContext);
  if (t.includes('level order') || t.includes('level-order') || (t.includes('bfs') && t.includes('tree'))) return desc('Perform a level-order traversal of a binary tree, visiting nodes level by level from left to right. This uses a queue to track nodes at each level', topicContext);
  if (t.includes('tree height') || t.includes('height of') || t.includes('max depth')) return desc('Calculate the height or maximum depth of a binary tree. The height is the number of edges on the longest path from root to a leaf', topicContext);

  if (t.includes('linked list') || (p.includes('linked') && (t.includes('list') || p.includes('list')))) {
    if (t.includes('reverse')) return desc('Reverse a linked list by changing the direction of the pointers. This is a fundamental linked list operation that teaches pointer manipulation', topicContext);
    if (t.includes('cycle') || t.includes('loop')) return desc('Detect whether a linked list contains a cycle. Use Floyd\'s cycle detection algorithm (tortoise and hare) for an efficient O(n) solution', topicContext);
    if (t.includes('middle')) return desc('Find the middle node of a linked list. Use the slow and fast pointer technique to find the middle in a single pass', topicContext);
    if (t.includes('merge')) return desc('Merge two sorted linked lists into a single sorted linked list. This operation is a building block for merge sort', topicContext);
    return desc('Perform operations on a linked list data structure. Linked lists consist of nodes where each node points to the next, enabling efficient insertions and deletions', topicContext);
  }

  if (t.includes('stack') && (t.includes('implement') || t.includes('push') || t.includes('pop') || p.includes('stack'))) return desc('Implement a stack data structure following the Last-In-First-Out (LIFO) principle. Stacks are fundamental for expression evaluation, backtracking, and more', topicContext);
  if (t.includes('queue') && (t.includes('implement') || t.includes('enqueue') || t.includes('dequeue') || p.includes('queue'))) return desc('Implement a queue data structure following the First-In-First-Out (FIFO) principle. Queues are essential for breadth-first traversal and scheduling', topicContext);
  if (t.includes('coin') || (t + ' ' + p).includes('coin change')) return desc('Find the minimum number of coins needed to make a given amount using a set of coin denominations. This is a classic dynamic programming problem', topicContext);
  if (t.includes('knapsack')) return desc('Solve the 0/1 knapsack problem: given items with weights and values, maximize the total value while keeping the total weight within a capacity', topicContext);
  if (t.includes('lcs') || (t + ' ' + p).includes('longest common subsequence')) return desc('Find the length of the longest common subsequence between two strings. A subsequence is a sequence that appears in the same order but not necessarily contiguous', topicContext);
  if ((t + ' ' + p).includes('longest increasing')) return desc('Find the length of the longest increasing subsequence in an array. This classic DP problem teaches patience sorting and binary search optimization', topicContext);

  if (p.includes('design') || t.includes('design') || t.includes('system')) {
    return `${capitalize(problemText.replace(/\.$/, ''))}. Consider scalability, fault tolerance, and trade-offs between consistency, availability, and partition tolerance (CAP theorem). Design a clean architecture with well-defined components.`;
  }

  return desc(capitalize(problemText.replace(/\.$/, '')), topicContext);
}

function genSamples(problemText, title) {
  const p = problemText.toLowerCase();
  const t = title.toLowerCase();
  const s = [];

  if (p.includes('hello world') || t.includes('hello')) {
    s.push({ input: '', output: 'Hello, World!', explanation: 'Simply print the exact string "Hello, World!" to standard output.' });
    return s;
  }
  if (p.includes('your name') || p.includes('print name')) {
    s.push({ input: 'Alice', output: 'Hello, Alice!', explanation: 'The program reads "Alice" and prints the greeting.' });
    s.push({ input: 'Bob', output: 'Hello, Bob!', explanation: 'Another name produces a different greeting.' });
    return s;
  }
  if (p.includes('sum of two') || (t.includes('sum') && (t.includes('two') || t.includes('add')))) {
    s.push({ input: '5 3', output: '8', explanation: '5 + 3 = 8' });
    s.push({ input: '-2 7', output: '5', explanation: '-2 + 7 = 5' });
    return s;
  }
  if (p.includes('difference')) {
    s.push({ input: '10 3', output: '7', explanation: '10 - 3 = 7' });
    s.push({ input: '5 8', output: '-3', explanation: '5 - 8 = -3' });
    return s;
  }
  if (p.includes('product')) {
    s.push({ input: '4 5', output: '20', explanation: '4 - 5 = 20' });
    s.push({ input: '-3 6', output: '-18', explanation: '-3 - 6 = -18' });
    return s;
  }
  if (p.includes('quotient')) {
    s.push({ input: '10 3', output: '3', explanation: '10 / 3 = 3 (integer division)' });
    s.push({ input: '7 2', output: '3', explanation: '7 / 2 = 3 (integer division)' });
    return s;
  }
  if (p.includes('remainder') || p.includes('modulo')) {
    s.push({ input: '10 3', output: '1', explanation: '10 % 3 = 1' });
    s.push({ input: '7 2', output: '1', explanation: '7 % 2 = 1' });
    return s;
  }
  if ((t + ' ' + p).includes('armstrong')) {
    s.push({ input: '153', output: 'true', explanation: '1^3 + 5^3 + 3^3 = 1 + 125 + 27 = 153.' });
    s.push({ input: '123', output: 'false', explanation: '1^3 + 2^3 + 3^3 = 1 + 8 + 27 = 36 != 123.' });
    return s;
  }
  if (p.includes('power') || p.includes('exponent') || t.includes('power') || t.includes('exponent')) {
    s.push({ input: '2 3', output: '8', explanation: '2 raised to the power 3 equals 8' });
    s.push({ input: '5 0', output: '1', explanation: 'Any non-zero number to the power of 0 equals 1' });
    return s;
  }
  if (p.includes('absolute') || t.includes('abs')) {
    s.push({ input: '-7', output: '7', explanation: 'The absolute value of -7 is 7' });
    s.push({ input: '5', output: '5', explanation: 'The absolute value of 5 is 5' });
    return s;
  }
  if ((t + ' ' + p).includes('collatz')) {
    s.push({ input: '6', output: '8 4 2 1', explanation: 'Collatz sequence: 6 -> 3 -> 10 -> 5 -> 16 -> 8 -> 4 -> 2 -> 1 (8 steps).' });
    return s;
  }
  if ((t + ' ' + p).includes('even') || (t + ' ' + p).includes('odd')) {
    s.push({ input: '4', output: 'Even', explanation: '4 is divisible by 2, so it is even.' });
    s.push({ input: '7', output: 'Odd', explanation: '7 is not divisible by 2, so it is odd.' });
    return s;
  }
  if ((t + ' ' + p).includes('positive') || (t + ' ' + p).includes('negative') || (t + ' ' + p).includes('check zero')) {
    s.push({ input: '5', output: 'Positive', explanation: '5 is greater than 0.' });
    s.push({ input: '-3', output: 'Negative', explanation: '-3 is less than 0.' });
    s.push({ input: '0', output: 'Zero', explanation: '0 is neither positive nor negative.' });
    return s;
  }
  if ((t + ' ' + p).includes('leap')) {
    s.push({ input: '2024', output: 'Leap Year', explanation: '2024 is divisible by 4 and not by 100.' });
    s.push({ input: '1900', output: 'Not a Leap Year', explanation: '1900 is divisible by 100 but not by 400.' });
    s.push({ input: '2000', output: 'Leap Year', explanation: '2000 is divisible by 400.' });
    return s;
  }
  // Specific array/number checks BEFORE generic ones
  if (t.includes('second') && (t.includes('largest') || t.includes('maximum'))) {
    s.push({ input: '3 9 1 7 2', output: '7', explanation: 'After sorting [1, 2, 3, 7, 9], the second largest is 7.' });
    s.push({ input: '10 5 8 12 3', output: '10', explanation: 'The second largest element is 10.' });
    return s;
  }
  if (t.includes('second') && (t.includes('smallest') || t.includes('minimum'))) {
    s.push({ input: '3 9 1 7 2', output: '2', explanation: 'After sorting [1, 2, 3, 7, 9], the second smallest is 2.' });
    s.push({ input: '10 5 8 12 3', output: '5', explanation: 'The second smallest element is 5.' });
    return s;
  }
  if ((t + ' ' + p).includes('duplicate')) {
    s.push({ input: '1 3 4 2 2', output: '2', explanation: 'The number 2 appears twice in the array.' });
    s.push({ input: '3 1 3 4 5', output: '3', explanation: 'The number 3 appears twice.' });
    return s;
  }
  if ((t + ' ' + p).includes('leaders')) {
    s.push({ input: '16 17 4 3 5 2', output: '17 5 2', explanation: 'Leaders are elements greater than all elements to their right.' });
    return s;
  }
  if ((t + ' ' + p).includes('subarray') && (t + ' ' + p).includes('sum') && !t.includes('maximum') && !t.includes('kadane')) {
    s.push({ input: '1 2 3 7 5', output: '3 5', explanation: 'Target sum 12 is found from indices 3 to 5 (7 + 5 = 12).' });
    return s;
  }
  if (t.includes('kadane') || (t + ' ' + p).includes('maximum subarray')) {
    s.push({ input: '-2 1 -3 4 -1 2 1 -5 4', output: '6', explanation: 'The maximum subarray is [4, -1, 2, 1] with sum 6.' });
    return s;
  }
  if ((t.includes('longest common') || t.includes('lcp')) && (t.includes('string') || p.includes('string') || p.includes('prefix'))) {
    s.push({ input: 'flower flow flight', output: 'fl', explanation: '"fl" is the common prefix of all three strings.' });
    s.push({ input: 'dog racecar car', output: '', explanation: 'There is no common prefix (empty string).' });
    return s;
  }
  if (t.includes('kth largest') || t.includes('kth maximum')) {
    s.push({ input: '3 2 1 5 6 4', output: '4', explanation: 'The 2nd largest element in sorted order [1, 2, 3, 4, 5, 6] is 5.' });
    s.push({ input: '3 2 3 1 2 4 5 5 6', output: '4', explanation: 'The 4th largest element is 4.' });
    return s;
  }
  if (t.includes('kth smallest')) {
    s.push({ input: '7 10 4 3 20 15', output: '7', explanation: 'The 3rd smallest element is 7.' });
    return s;
  }
  // Generic array max/min (after specific checks)
  if ((p.includes('largest') || p.includes('greatest') || t.includes('maximum')) && (p.includes('three') || t.includes('three'))) {
    s.push({ input: '4 9 2', output: '9', explanation: '9 is the largest among 4, 9, and 2.' });
    s.push({ input: '-5 -1 -8', output: '-1', explanation: '-1 is the largest among -5, -1, and -8.' });
    return s;
  }
  if (p.includes('smallest') || t.includes('minimum')) {
    if (p.includes('three') || t.includes('three')) {
      s.push({ input: '4 9 2', output: '2', explanation: '2 is the smallest among 4, 9, and 2.' });
      s.push({ input: '-5 -1 -8', output: '-8', explanation: '-8 is the smallest among -5, -1, and -8.' });
      return s;
    }
    s.push({ input: '3 9 1 7 2', output: '1', explanation: 'The minimum element in [3, 9, 1, 7, 2] is 1.' });
    s.push({ input: '-5 -2 -8', output: '-8', explanation: 'The minimum element in [-5, -2, -8] is -8.' });
    return s;
  }
  if ((p.includes('find') || p.includes('maximum') || t.includes('maximum')) && (p.includes('array') || t.includes('array'))) {
    s.push({ input: '3 9 1 7 2', output: '9', explanation: 'The maximum element in [3, 9, 1, 7, 2] is 9.' });
    s.push({ input: '-5 -2 -8', output: '-2', explanation: 'The maximum element in [-5, -2, -8] is -2.' });
    return s;
  }
  if ((t.includes('sum') || p.includes('sum')) && (p.includes('array') || t.includes('array') || p.includes('element'))) {
    s.push({ input: '1 2 3 4 5', output: '15', explanation: '1 + 2 + 3 + 4 + 5 = 15.' });
    s.push({ input: '-1 0 1', output: '0', explanation: '-1 + 0 + 1 = 0.' });
    return s;
  }
  if (p.includes('average') || t.includes('average') || p.includes('mean')) {
    s.push({ input: '1 2 3 4', output: '2.5', explanation: 'Sum is 10, average is 10 / 4 = 2.5.' });
    s.push({ input: '10 20 30', output: '20.0', explanation: 'Sum is 60, average is 60 / 3 = 20.0.' });
    return s;
  }
  if ((t.includes('reverse') || p.includes('reverse')) && (t.includes('array') || p.includes('array') || t.includes('element'))) {
    s.push({ input: '1 2 3 4 5', output: '5 4 3 2 1', explanation: 'The array reversed is [5, 4, 3, 2, 1].' });
    s.push({ input: 'a b c', output: 'c b a', explanation: 'The elements in reverse order.' });
    return s;
  }
  if ((t.includes('reverse') || p.includes('reverse')) && (t.includes('string') || p.includes('string'))) {
    s.push({ input: 'hello', output: 'olleh', explanation: 'Reversing "hello" gives "olleh".' });
    s.push({ input: 'world', output: 'dlrow', explanation: 'Reversing "world" gives "dlrow".' });
    return s;
  }
  if ((t + ' ' + p).includes('palindrome')) {
    s.push({ input: 'racecar', output: 'true', explanation: '"racecar" reads the same forwards and backwards.' });
    s.push({ input: 'hello', output: 'false', explanation: '"hello" reversed is "olleh", which is different.' });
    return s;
  }
  if ((t + ' ' + p).includes('anagram')) {
    s.push({ input: 'listen silent', output: 'true', explanation: '"listen" and "silent" contain the same letters.' });
    s.push({ input: 'hello world', output: 'false', explanation: '"hello" and "world" have different character counts.' });
    return s;
  }
  if (t.includes('fibonacci') || t.includes('fib seq') || t.includes('fib number') || t.includes('fib term')) {
    s.push({ input: '6', output: '8', explanation: 'Fibonacci sequence: 0, 1, 1, 2, 3, 5, 8. The 6th term is 8.' });
    s.push({ input: '10', output: '55', explanation: 'The 10th Fibonacci number is 55.' });
    return s;
  }
  if (t.includes('factorial') || t.includes('fact of')) {
    s.push({ input: '5', output: '120', explanation: '5! = 5 x 4 x 3 x 2 x 1 = 120.' });
    s.push({ input: '0', output: '1', explanation: '0! = 1 by definition.' });
    return s;
  }
  if ((t + ' ' + p).includes('prime') && !t.includes('prime factor')) {
    s.push({ input: '7', output: 'true', explanation: '7 is only divisible by 1 and itself.' });
    s.push({ input: '12', output: 'false', explanation: '12 is divisible by 2, 3, 4, and 6.' });
    return s;
  }
  if (t.includes('gcd') || t.includes('hcf') || (t + ' ' + p).includes('greatest common')) {
    s.push({ input: '12 18', output: '6', explanation: 'GCD of 12 and 18 is 6.' });
    s.push({ input: '7 13', output: '1', explanation: '7 and 13 are coprime, GCD is 1.' });
    return s;
  }
  if (t.includes('lcm') || (t + ' ' + p).includes('least common')) {
    s.push({ input: '4 6', output: '12', explanation: 'LCM of 4 and 6 is 12.' });
    s.push({ input: '7 5', output: '35', explanation: 'LCM of 7 and 5 is 35.' });
    return s;
  }
  if (t.includes('bubble') && t.includes('sort')) {
    s.push({ input: '5 3 8 1 2', output: '1 2 3 5 8', explanation: 'After bubble sort, elements are in ascending order.' });
    return s;
  }
  if (t.includes('selection') && t.includes('sort')) {
    s.push({ input: '64 25 12 22 11', output: '11 12 22 25 64', explanation: 'After selection sort, the array is sorted.' });
    return s;
  }
  if (t.includes('insertion') && t.includes('sort')) {
    s.push({ input: '12 11 13 5 6 7', output: '5 6 7 11 12 13', explanation: 'After insertion sort, the array is sorted.' });
    return s;
  }
  if (t.includes('merge') && t.includes('sort')) {
    s.push({ input: '38 27 43 3 9 82', output: '3 9 27 38 43 82', explanation: 'After merge sort, the array is sorted.' });
    return s;
  }
  if (t.includes('quick') && t.includes('sort')) {
    s.push({ input: '10 80 30 90 40 50', output: '10 30 40 50 80 90', explanation: 'After quick sort, the array is sorted.' });
    return s;
  }
  if ((p.includes('sort') || t.includes('sort')) && !t.includes('dictionary')) {
    s.push({ input: '3 1 4 1 5', output: '1 1 3 4 5', explanation: 'Array sorted in ascending order.' });
    s.push({ input: '9 2 7 1', output: '1 2 7 9', explanation: 'Sorted ascending.' });
    return s;
  }
  if (p.includes('binary search') || t.includes('binary search')) {
    s.push({ input: '1 3 5 7 9 5', output: '2', explanation: 'Value 5 is found at index 2 (0-based indexing) in the sorted array.' });
    s.push({ input: '2 4 6 8 10', output: '-1', explanation: 'Value 10 is not in the array.' });
    return s;
  }
  if (t.includes('linear search')) {
    s.push({ input: '3 9 1 7 2 7', output: '3', explanation: 'Value 7 is found at index 3.' });
    s.push({ input: '2 4 6 8 5', output: '-1', explanation: 'Value 5 is not in the array.' });
    return s;
  }
  if (t.includes('inorder') || t.includes('in-order')) {
    s.push({ input: '1 null 2 3', output: '1 3 2', explanation: 'Inorder traversal visits left subtree, root, then right subtree.' });
    return s;
  }
  if (t.includes('preorder') || t.includes('pre-order')) {
    s.push({ input: '1 null 2 3', output: '1 2 3', explanation: 'Preorder traversal visits root, left subtree, then right subtree.' });
    return s;
  }
  if (t.includes('postorder') || t.includes('post-order')) {
    s.push({ input: '1 null 2 3', output: '3 2 1', explanation: 'Postorder traversal visits left subtree, right subtree, then root.' });
    return s;
  }
  if (t.includes('level order') || t.includes('level-order') || (t.includes('bfs') && t.includes('tree'))) {
    s.push({ input: '3 9 20 null null 15 7', output: '3 9 20 15 7', explanation: 'Level-order visits each level from left to right.' });
    return s;
  }
  if (t.includes('height') || t.includes('max depth')) {
    s.push({ input: '3 9 20 null null 15 7', output: '3', explanation: 'The tree has 3 levels (root + 2 child levels).' });
    return s;
  }
  if (t.includes('create binary tree') || t.includes('create tree')) {
    s.push({ input: '1 2 3 4 5', output: 'Tree created successfully', explanation: 'The array is converted to a binary tree in level order.' });
    return s;
  }
  if (t.includes('reverse') && (t.includes('linked') || p.includes('linked'))) {
    s.push({ input: '1 2 3 4 5', output: '5 4 3 2 1', explanation: 'The linked list is reversed.' });
    return s;
  }
  if ((t.includes('cycle') || t.includes('loop')) && (t.includes('linked') || p.includes('linked'))) {
    s.push({ input: '1 2 3 4 5 2', output: 'true', explanation: 'The last node points back to node with value 2, forming a cycle.' });
    s.push({ input: '1 2 3 4 5', output: 'false', explanation: 'The list terminates with null, no cycle.' });
    return s;
  }
  if (t.includes('stack') && (t.includes('implement') || t.includes('push') || t.includes('pop') || p.includes('stack'))) {
    s.push({ input: 'push 5 push 3 pop top', output: '3', explanation: 'After pushing 5 and 3, popping returns 3.' });
    return s;
  }
  if (t.includes('queue') && (t.includes('implement') || t.includes('enqueue') || t.includes('dequeue') || p.includes('queue'))) {
    s.push({ input: 'enqueue 5 enqueue 3 dequeue front', output: '5', explanation: 'After enqueuing 5 and 3, dequeuing returns 5.' });
    return s;
  }
  if (t.includes('coin') || (t + ' ' + p).includes('coin change')) {
    s.push({ input: '11 1 2 5', output: '3', explanation: '11 = 5 + 5 + 1 (3 coins is the minimum).' });
    return s;
  }
  if (t.includes('knapsack')) {
    s.push({ input: '3 1 2 3 6 10 12 5', output: '22', explanation: 'Take items 2 and 3 (weight 2+3=5, value 10+12=22).' });
    return s;
  }
  if (t.includes('lcs') || (t + ' ' + p).includes('longest common subsequence')) {
    s.push({ input: 'abcde ace', output: '3', explanation: 'LCS of "abcde" and "ace" is "ace" (length 3).' });
    return s;
  }
  if ((t + ' ' + p).includes('longest increasing')) {
    s.push({ input: '10 9 2 5 3 7', output: '3', explanation: 'LIS is [2, 5, 7] or [2, 3, 7] (length 3).' });
    return s;
  }
  // Linked list operations
  if (t.includes('linked') && (t.includes('insert') || t.includes('delete'))) {
    s.push({ input: '1 2 3', output: 'List modified', explanation: 'The element is inserted/deleted at the specified position.' });
    return s;
  }
  if ((t + ' ' + p).includes('find middle') || (t + ' ' + p).includes('middle of')) {
    s.push({ input: '1 2 3 4 5', output: '3', explanation: 'The middle element of the linked list is 3.' });
    s.push({ input: '1 2 3 4', output: '3', explanation: 'For even length, the second middle is 3.' });
    return s;
  }
  if ((t + ' ' + p).includes('nth') || (t + ' ' + p).includes('get node')) {
    s.push({ input: '1 2 3 4 5', output: '3', explanation: 'Element at the specified position.' });
    return s;
  }
  // Tree operations
  if (t.includes('tree') && (t.includes('insert') || t.includes('bst'))) {
    s.push({ input: '5 3 7 2 4', output: 'Tree built successfully', explanation: 'Elements inserted into the BST in order.' });
    return s;
  }
  if ((t + ' ' + p).includes('search') && (t.includes('tree') || t.includes('bst'))) {
    s.push({ input: '3 9 20 15 7', output: 'true', explanation: 'Value 7 is found in the tree.' });
    s.push({ input: '3 9 20 15 7', output: 'false', explanation: 'Value 10 is not found.' });
    return s;
  }
  // Graph operations
  if (t.includes('graph') && (t.includes('bfs') || t.includes('dfs'))) {
    s.push({ input: '4 4 0 1 0 2 1 3 2 3', output: '0 1 2 3', explanation: 'Traversal starting from node 0.' });
    return s;
  }
  if (t.includes('graph') && (t + ' ' + p).includes('cycle')) {
    s.push({ input: '4 4 0 1 1 2 2 3 3 1', output: 'true', explanation: 'The graph contains a cycle (1-2-3-1).' });
    return s;
  }
  // Math / geometry
  if ((t + ' ' + p).includes('area of') || (t + ' ' + p).includes('find area')) {
    if (t.includes('circle')) s.push({ input: '5', output: '78.54', explanation: 'Area = pi x 5^2 = 78.54.' });
    else if (t.includes('rectangle')) s.push({ input: '4 5', output: '20', explanation: 'Area = 4 x 5 = 20.' });
    else s.push({ input: '3 4', output: '6', explanation: 'Area = 0.5 x 3 x 4 = 6.' });
    return s;
  }
  if (t.includes('perimeter') || (t + ' ' + p).includes('perimeter')) {
    s.push({ input: '4 5', output: '18', explanation: 'Perimeter = 2 x (4 + 5) = 18.' });
    return s;
  }
  if (t.includes('simple interest')) {
    s.push({ input: '1000 5 2', output: '100', explanation: 'SI = (1000 x 5 x 2) / 100 = 100.' });
    return s;
  }
  if ((t + ' ' + p).includes('compound interest')) {
    s.push({ input: '1000 5 2', output: '102.50', explanation: 'CI = 1000 x (1 + 5/100)^2 - 1000 = 102.50.' });
    return s;
  }
  // Conversions
  if (p.includes('convert') || p.includes('conversion') || t.includes('conversion') || t.includes('convert')) {
    if (t.includes('fahrenheit') || (t + ' ' + p).includes('f to c')) {
      s.push({ input: '32', output: '0', explanation: '32 F = (32 - 32) x 5/9 = 0 C.' });
      s.push({ input: '212', output: '100', explanation: '212 F = (212 - 32) x 5/9 = 100 C.' });
    } else if (t.includes('celsius') || (t + ' ' + p).includes('c to f')) {
      s.push({ input: '0', output: '32', explanation: '0 C = (0 x 9/5) + 32 = 32 F.' });
    } else {
      s.push({ input: '100', output: 'Converted', explanation: 'Conversion applied.' });
    }
    return s;
  }
  // Number operations
  if (t.includes('sum of digits') || (t + ' ' + p).includes('sum of digits')) {
    s.push({ input: '123', output: '6', explanation: '1 + 2 + 3 = 6.' });
    s.push({ input: '999', output: '27', explanation: '9 + 9 + 9 = 27.' });
    return s;
  }
  if (t.includes('reverse number') || t.includes('reverse a number') || (t + ' ' + p).includes('reverse of a number')) {
    s.push({ input: '1234', output: '4321', explanation: 'Reversing 1234 gives 4321.' });
    s.push({ input: '100', output: '1', explanation: 'Reversing 100 gives 1 (leading zeros dropped).' });
    return s;
  }
  if (t.includes('number of digits') || t.includes('count digits') || (t + ' ' + p).includes('count digits')) {
    s.push({ input: '12345', output: '5', explanation: '12345 has 5 digits.' });
    s.push({ input: '0', output: '1', explanation: '0 has 1 digit.' });
    return s;
  }
  if (t.includes('perfect number') || (t + ' ' + p).includes('perfect number')) {
    s.push({ input: '28', output: 'true', explanation: '1 + 2 + 4 + 7 + 14 = 28.' });
    s.push({ input: '12', output: 'false', explanation: '1 + 2 + 3 + 4 + 6 = 16 != 12.' });
    return s;
  }
  if (t.includes('strong number') || (t + ' ' + p).includes('strong number')) {
    s.push({ input: '145', output: 'true', explanation: '1! + 4! + 5! = 1 + 24 + 120 = 145.' });
    return s;
  }
  if (t.includes('square') && (t.includes('number') || p.includes('square'))) {
    s.push({ input: '7', output: '49', explanation: '7^2 = 49.' });
    s.push({ input: '12', output: '144', explanation: '12^2 = 144.' });
    return s;
  }
  if (t.includes('cube') && (t.includes('number') || p.includes('cube'))) {
    s.push({ input: '5', output: '125', explanation: '5^3 = 125.' });
    s.push({ input: '10', output: '1000', explanation: '10^3 = 1000.' });
    return s;
  }
  if (t.includes('circumference')) {
    s.push({ input: '7', output: '43.98', explanation: 'Circumference = 2 x pi x 7 = 43.98.' });
    return s;
  }
  if (t.includes('distance')) {
    s.push({ input: '0 0 3 4', output: '5.0', explanation: 'Distance = sqrt((3-0)^2 + (4-0)^2) = 5.' });
    return s;
  }
  if (t.includes('quadratic') || t.includes('roots of')) {
    s.push({ input: '1 -5 6', output: '2 3', explanation: 'Roots of x^2 - 5x + 6 = 0 are 2 and 3.' });
    return s;
  }
  if (t.includes('maximum of') || t.includes('max of')) {
    if (t.includes('three')) {
      s.push({ input: '4 9 2', output: '9', explanation: '9 is the maximum of 4, 9, 2.' });
      s.push({ input: '-5 -1 -8', output: '-1', explanation: '-1 is the maximum.' });
    } else {
      s.push({ input: '8 3', output: '8', explanation: '8 is the larger of 8 and 3.' });
      s.push({ input: '-5 2', output: '2', explanation: '2 is the larger of -5 and 2.' });
    }
    return s;
  }
  if (t.includes('minimum of') || t.includes('min of')) {
    if (t.includes('three')) {
      s.push({ input: '4 9 2', output: '2', explanation: '2 is the minimum of 4, 9, 2.' });
      s.push({ input: '-5 -1 -8', output: '-8', explanation: '-8 is the minimum.' });
    } else {
      s.push({ input: '8 3', output: '3', explanation: '3 is the smaller of 8 and 3.' });
      s.push({ input: '-5 2', output: '-5', explanation: '-5 is the smaller of -5 and 2.' });
    }
    return s;
  }
  // Swap
  if (t.includes('swap') || (t + ' ' + p).includes('swap')) {
    s.push({ input: '5 10', output: '10 5', explanation: 'After swapping, a=10 and b=5.' });
    return s;
  }
  // Multiplication table
  if (t.includes('multiplication table') || (t + ' ' + p).includes('multiplication table')) {
    s.push({ input: '5', output: '5 10 15 20 25 30 35 40 45 50', explanation: 'Table of 5 up to 10.' });
    return s;
  }
  // Print 1 to N / print N to 1
  if ((t + ' ' + p).includes('print 1') || (t + ' ' + p).includes('print numbers')) {
    s.push({ input: '5', output: '1 2 3 4 5', explanation: 'Numbers from 1 to 5.' });
    return s;
  }
  if ((t + ' ' + p).includes('print n to 1') || (t + ' ' + p).includes('print reverse')) {
    s.push({ input: '5', output: '5 4 3 2 1', explanation: 'Numbers from 5 down to 1.' });
    return s;
  }
  // Factors
  if (t.includes('factor') && !t.includes('prime factor')) {
    s.push({ input: '12', output: '1 2 3 4 6 12', explanation: 'All factors of 12.' });
    return s;
  }
  if (t.includes('prime factor')) {
    s.push({ input: '12', output: '2 2 3', explanation: 'Prime factors of 12 are 2, 2, and 3.' });
    return s;
  }
  // Pattern printing
  if (t.includes('pattern') || (t + ' ' + p).includes('pattern')) {
    s.push({ input: '3', output: '*\n**\n***', explanation: 'A right triangle pattern with 3 rows.' });
    return s;
  }
  // Even/Odd count in array
  if ((t + ' ' + p).includes('even count') || (t + ' ' + p).includes('odd count') || (t + ' ' + p).includes('count even') || (t + ' ' + p).includes('count odd')) {
    s.push({ input: '1 2 3 4 5', output: '2 evens, 3 odds', explanation: 'Numbers 2 and 4 are even, 1, 3, 5 are odd.' });
    return s;
  }
  // OOP / design pattern / conceptual
  if (t.includes('class') || t.includes('object') || t.includes('oop') || (t + ' ' + p).includes('encapsulation') || (t + ' ' + p).includes('abstraction')) {
    s.push({ input: 'Create instance and call method', output: 'Method executed successfully', explanation: 'The class is instantiated and the method is invoked correctly.' });
    return s;
  }
  if (t.includes('inheritance') || t.includes('polymorphism') || t.includes('override') || t.includes('overload')) {
    s.push({ input: 'Derived class instance', output: 'Polymorphic behavior demonstrated', explanation: 'The derived class method is called through the base class reference.' });
    return s;
  }
  if (t.includes('singleton') || t.includes('factory') || t.includes('observer') || t.includes('strategy') || t.includes('decorator') || t.includes('adapter')) {
    s.push({ input: 'Design pattern context', output: 'Pattern implemented correctly', explanation: 'The design pattern is applied according to its intent and structure.' });
    return s;
  }
  if ((t + ' ' + p).includes('design') || (t + ' ' + p).includes('system design')) {
    s.push({ input: 'Functional requirements, expected load: 1M DAU',
      output: 'High-level architecture with components, data flow, and API design.',
      explanation: 'Describe the system architecture, key components, data storage, and trade-offs.' });
    return s;
  }

  // Fallback based on input/output format hints
  return [
    { input: '42', output: '42', explanation: 'Sample test case demonstrating the expected input and output format.' },
    { input: '100', output: '100', explanation: 'Another test case to verify your solution handles different values correctly.' },
  ];
}

async function seedProblems() {
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB\n');

  const db = mongoose.connection.db;
  const usersCollection = db.collection('users');
  const problemsCollection = db.collection('programmingproblems');

  let sysUser = await usersCollection.findOne({ role: 'master_admin' });
  if (!sysUser) {
    sysUser = await usersCollection.findOne({});
  }
  if (!sysUser) {
    console.log('No users found. Creating a system user...');
    const bcrypt = await import('bcryptjs');
    const hashed = await bcrypt.hash('admin123', 10);
    const result = await usersCollection.insertOne({
      name: 'System Admin',
      email: 'admin@edvolve.com',
      password: hashed,
      role: 'master_admin',
      created_at: new Date(),
    });
    sysUser = await usersCollection.findOne({ _id: result.insertedId });
    console.log('  ✓ System admin created');
  }
  const createdBy = sysUser._id;
  console.log(`  Using user: ${sysUser.name} (${sysUser.email})\n`);

  const fs = await import('fs/promises');
  const path = await import('path');
  const { fileURLToPath } = await import('url');

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const problemsDir = path.resolve(__dirname, '../../../../problem-statements');

  const files = await fs.readdir(problemsDir);
  const mdFiles = files.filter(f => f.endsWith('.md')).sort();

  let totalInserted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  const BATCH_SIZE = 50;

  // Get existing titles to avoid duplicates
  const existing = await problemsCollection.find({}, { projection: { title: 1, concept: 1, _id: 0 } }).toArray();
  const existingSet = new Set(existing.map(e => `${e.title}|${e.concept}`));

  for (const file of mdFiles) {
    const content = await fs.readFile(path.join(problemsDir, file), 'utf8');
    const concept = fileToConcept(file);
    const fileKey = file.replace('.md', '');
    const topicContext = TOPIC_CONTEXT[fileKey] || 'programming';
    const blocks = content.split(/^### /m).filter(Boolean);
    const problems = [];
    let fileCount = 0;

    for (const block of blocks) {
      const lines = block.trim().split('\n');
      const titleLine = lines[0].replace(/^\d+\.\s*/, '').trim();
      if (!isImportedProblemTitle(titleLine)) continue;

      let problemText = '';
      let inputFormat = '';
      let outputFormat = '';
      let constraints = '';
      let collecting = null;

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (/^\*\*Problem\*\*/.test(line)) {
          collecting = 'desc';
          problemText += line.replace(/\*\*Problem\*\*:?\s*/, '') + ' ';
        } else if (/^\*\*Input\*\*/.test(line)) {
          collecting = 'input';
          inputFormat = line.replace(/\*\*Input\*\*:?\s*/, '');
        } else if (/^\*\*Output\*\*/.test(line)) {
          collecting = 'output';
          outputFormat = line.replace(/\*\*Output\*\*:?\s*/, '');
        } else if (/^\*\*Constraints\*\*/.test(line)) {
          collecting = 'constraints';
          constraints = line.replace(/\*\*Constraints\*\*:?\s*/, '');
        } else if (line && !line.startsWith('**') && collecting) {
          if (collecting === 'desc') problemText += line + ' ';
          else if (collecting === 'input') inputFormat += ' ' + line;
          else if (collecting === 'output') outputFormat += ' ' + line;
          else if (collecting === 'constraints') constraints += ' ' + line;
        }
      }

      problemText = problemText.trim();

      const key = `${titleLine}|${concept}`;
      if (existingSet.has(key)) {
        totalSkipped++;
        continue;
      }

      const difficulty = parseDifficulty(problems.length, 35);
      const description = generateDescription(problemText, titleLine, topicContext);
      const sampleTestCases = genSamples(problemText, titleLine);

      problems.push({
        title: titleLine,
        description,
        constraints,
        input_format: inputFormat,
        output_format: outputFormat,
        difficulty,
        concept,
        sample_test_cases: sampleTestCases,
        hidden_test_cases: [{ input: '1', output: '1' }],
        time_limit: 2,
        memory_limit: 256,
        languages: SUPPORTED_LANGUAGES,
        starter_code: Object.fromEntries(SUPPORTED_LANGUAGES.map((language) => [language, ''])),
        status: 'published',
        created_by: createdBy,
        is_deleted: false,
        total_submissions: 0,
        total_accepted: 0,
        created_at: new Date(),
        updated_at: new Date(),
      });
    }

    for (let i = 0; i < problems.length; i += BATCH_SIZE) {
      const batch = problems.slice(i, i + BATCH_SIZE).map(p => ({ ...p, created_at: new Date(), updated_at: new Date() }));
      try {
        await problemsCollection.insertMany(batch, { ordered: false });
        totalInserted += batch.length;
        fileCount += batch.length;
      } catch (err) {
        if (err.code === 11000) {
          totalInserted += batch.length;
          fileCount += batch.length;
        } else {
          totalErrors++;
          console.error(`  Batch error: ${err.message}`);
        }
      }
    }

    if (fileCount > 0) {
      console.log(`  ✓ ${file} → ${fileCount} problems added`);
    } else {
      console.log(`  - ${file} → already seeded, skipped`);
    }
  }

  await problemsCollection.createIndex({ status: 1, is_deleted: 1 });
  await problemsCollection.createIndex({ concept: 1 });
  await problemsCollection.createIndex({ difficulty: 1 });
  await problemsCollection.createIndex({ concept: 1, difficulty: 1, status: 1 });

  const finalCount = await problemsCollection.countDocuments({ status: 'published' });
  const allConcepts = await problemsCollection.distinct('concept', { status: 'published' });

  console.log(`\n✅ Done!`);
  console.log(`   ${totalInserted} new problems added`);
  console.log(`   ${totalSkipped} already existed (skipped)`);
  console.log(`   ${totalErrors} batch errors`);
  console.log(`   Total published: ${finalCount}`);
  console.log(`   Concepts (${allConcepts.length}): ${allConcepts.join(', ')}`);

  await mongoose.disconnect();
  process.exit(0);
}

seedProblems().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
