import OpenAI from 'openai';
import { recordAiUsage } from '../../services/aiUsageService.js';
import { CONCEPTS } from '../utils/constants.js';
import { badRequest } from '../utils/httpError.js';
import { Question, Op } from '../../database/index.js';
import { checkForDuplicateIndices } from '../utils/questionValidation.js';

function extractJson(text) {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    return extractJson(fenceMatch[1]);
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return JSON.parse(trimmed);
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw badRequest('AI response did not contain valid JSON');
  }

  return JSON.parse(trimmed.slice(start, end + 1));
}

export function buildPrompt(config, fileContext = '', existingQuestionTexts = []) {
  const maxContextChars = Number(process.env.AI_FILE_CONTEXT_CHARS || 5000);
  const contextBlock = fileContext
    ? `\nUse this uploaded study material as optional context. Do not copy it verbatim unless needed for a question:\n${fileContext.slice(0, maxContextChars)}\n`
    : '';

  const existingBlock = existingQuestionTexts.length > 0
    ? `\nThe following questions already exist in the database and must NOT be reused or rephrased:\n${existingQuestionTexts.map((q, i) => `${i + 1}. ${q}`).join('\n')}\nGenerate completely different questions with different scenarios, numerical values, and wording.\n`
    : '';

  return `Generate aptitude assessment questions for placement preparation and interview preparation.

Concept: ${config.concept}
Difficulty: ${config.difficulty}
Number of questions: ${config.question_count}
Marks per question: ${config.marks}
Negative marks: ${config.negative_marks}
${contextBlock}
${existingBlock}
Requirements:

* Generate only MCQ questions
* Each question must contain exactly 4 options:
  A, B, C, D
* Only one correct answer
* CRITICAL — DIVERSITY RULE: Every question must have a completely unique question structure and text. Do NOT reuse the same sentence pattern across multiple questions (e.g., avoid multiple "The average of X numbers is Y. What is the sum?" style questions). Vary the framing, the unknown variable, the scenario, and the wording for each question.
* Every question MUST have a unique question_text — do NOT repeat, rephrase, or generate the same scenario as any other question in this output or the existing list above
* Use different numerical values, different contexts, different scenarios, and different sentence structures for every question
* Include a detailed, step-by-step explanation (3-6 sentences minimum) that shows:
  - The formula or concept used
  - Each step of the calculation with intermediate values
  - Why each step is performed
  - The final answer and how it was derived
* Include a shortcut solving method where applicable (1-2 sentences, alternative quick approach)
* Include concept name
* Include difficulty level
* Avoid ambiguity
* Questions should match placement aptitude standards
* Return ONLY valid JSON
* Do NOT return markdown

JSON structure:

{
"assessment_title": "",
"concept": "",
"difficulty": "",
"total_questions": 0,
"questions": [
{
"question_text": "",
"options": {
"A": "",
"B": "",
"C": "",
"D": ""
},
"correct_option": "",
"explanation": "",
"shortcut": "",
"concept": "",
"difficulty": "",
"marks": 1,
"negative_marks": 0.25
}
]
}`;
}

function getAiConfig() {
  const provider = (process.env.AI_PROVIDER || 'nvidia').toLowerCase();
  const apiKey =
    process.env.NVIDIA_NIM_API_KEY || process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
  const rawBaseUrl =
    process.env.NVIDIA_NIM_BASE_URL ||
    process.env.AI_BASE_URL ||
    process.env.NVIDIA_NIM_API_URL ||
    process.env.AI_API_URL ||
    process.env.OPENAI_API_URL ||
    'https://integrate.api.nvidia.com/v1';
  const model =
    process.env.NVIDIA_NIM_MODEL ||
    process.env.AI_MODEL ||
    process.env.OPENAI_MODEL ||
    'minimaxai/minimax-m2.7';
  const useResponseFormat =
    process.env.AI_USE_RESPONSE_FORMAT === 'true' ||
    (provider === 'openai' && process.env.AI_USE_RESPONSE_FORMAT !== 'false');
  const batchSize = Math.max(1, Number(process.env.AI_BATCH_SIZE || 5));
  const concurrency = Math.max(1, Number(process.env.AI_BATCH_CONCURRENCY || 2));
  const timeout = Math.max(15000, Number(process.env.AI_TIMEOUT_MS || 120000));

  const baseURL = rawBaseUrl.replace(/\/chat\/completions\/?$/, '').replace(/\/$/, '');

  return {
    provider,
    apiKey,
    baseURL,
    model,
    useResponseFormat,
    batchSize,
    concurrency,
    timeout,
  };
}

function pseudoRandom(seed) {
  return Number(`0.${Math.abs(Math.sin(seed)).toString().slice(6, 16)}`);
}

function randomInt(min, max, seed) {
  const value = pseudoRandom(seed);
  return Math.floor(value * (max - min + 1)) + min;
}

function buildOptions(correctValue, seed) {
  const delta = Math.max(1, Math.round(Math.abs(correctValue) * 0.12) || 1);
  const values = new Set([correctValue]);
  let attempt = 0;

  while (values.size < 4 && attempt < 20) {
    const offset = randomInt(1, delta * 3, seed + attempt);
    const candidate = correctValue + ((attempt % 2 === 0 ? 1 : -1) * offset);
    if (candidate !== correctValue) {
      values.add(candidate);
    }
    attempt += 1;
  }

  let fallbackValue = correctValue + delta;
  while (values.size < 4) {
    if (!values.has(fallbackValue)) {
      values.add(fallbackValue);
    }
    fallbackValue += delta;
  }

  const distractors = Array.from(values).filter((value) => value !== correctValue);
  while (distractors.length < 3) {
    const extra = correctValue + (distractors.length + 1) * delta;
    if (!distractors.includes(extra)) distractors.push(extra);
  }

  const correctIndex = randomInt(0, 3, seed + 100);
  const ordered = [...distractors];
  ordered.splice(correctIndex, 0, correctValue);

  return {
    options: {
      A: String(ordered[0]),
      B: String(ordered[1]),
      C: String(ordered[2]),
      D: String(ordered[3]),
    },
    correct_option: ['A', 'B', 'C', 'D'][correctIndex],
  };
}

function buildQuestionTemplate(concept, difficulty, index, marks, negative_marks) {
  const conceptSeed = Math.max(1, CONCEPTS.indexOf(concept) + 1);
  const seed = index + 1 + conceptSeed * 1000;
  const diff = (difficulty || 'Medium').toLowerCase();
  const isEasy = diff === 'easy';
  const isHard = diff === 'hard';
  let question_text = '';
  let correctValue = 0;
  let explanation = '';
  let shortcut = '';

  switch (concept) {
    case 'Percentages': {
      if (isEasy) {
        const base = randomInt(80, 260, seed);
        const percent = randomInt(5, 35, seed + 1);
        correctValue = Math.round((base * percent) / 100);
        question_text = `If ${percent}% of ${base} students passed the aptitude test, how many students passed?`;
        explanation = `Step 1: Total students = ${base}. Percentage that passed = ${percent}%. ` +
          `Step 2: Convert percent to decimal: ${percent}% = ${(percent / 100).toFixed(2)}. ` +
          `Step 3: ${base} × ${(percent / 100).toFixed(2)} = ${correctValue}. Therefore, ${correctValue} students passed.`;
        shortcut = `${base} × ${percent}/100 = ${correctValue}.`;
      } else if (isHard) {
        const base = randomInt(5000, 25000, seed);
        const firstChange = randomInt(10, 30, seed + 1);
        const secondChange = randomInt(10, 20, seed + 2);
        const afterFirst = isHard ? Math.round(base * (100 + firstChange) / 100) : 0;
        correctValue = Math.round(afterFirst * (100 - secondChange) / 100);
        question_text = `The population of a town is ${base}. It increases by ${firstChange}% in the first year and then decreases by ${secondChange}% in the second year. What is the population after 2 years?`;
        explanation = `Step 1: Initial population = ${base}. ` +
          `Step 2: After ${firstChange}% increase: ${base} × (100 + ${firstChange})/100 = ${base} × ${(100 + firstChange) / 100} = ${afterFirst}. ` +
          `Step 3: After ${secondChange}% decrease: ${afterFirst} × (100 - ${secondChange})/100 = ${afterFirst} × ${(100 - secondChange) / 100} = ${correctValue}. ` +
          `The population after 2 years is ${correctValue}.`;
        shortcut = `Use formula: ${base} × (1 + ${firstChange}/100) × (1 - ${secondChange}/100) = ${correctValue}.`;
      } else {
        const base = randomInt(300, 900, seed);
        const oldValue = randomInt(150, 400, seed + 1);
        const increase = base - oldValue;
        correctValue = Math.round((increase / oldValue) * 100);
        question_text = `A company's revenue increased from ₹${oldValue} to ₹${base}. What is the percentage increase?`;
        explanation = `Step 1: Increase = ${base} - ${oldValue} = ${increase}. ` +
          `Step 2: Percentage increase = (Increase / Original) × 100 = (${increase} / ${oldValue}) × 100. ` +
          `Step 3: = ${(increase / oldValue).toFixed(4)} × 100 = ${correctValue}%. ` +
          `The revenue increased by ${correctValue}%.`;
        shortcut = `((New - Old) / Old) × 100 = (${increase} / ${oldValue}) × 100 = ${correctValue}%.`;
      }
      break;
    }
    case 'Profit and Loss': {
      if (isEasy) {
        const cost = randomInt(250, 900, seed);
        const profit = randomInt(10, 45, seed + 1);
        correctValue = Math.round((cost * profit) / 100);
        question_text = `A product is bought for ₹${cost} and sold at a profit of ${profit}%. What is the profit amount?`;
        explanation = `Step 1: Cost Price (CP) = ₹${cost}. Profit% = ${profit}%. ` +
          `Step 2: Profit = (${profit}/100) × ${cost} = ${correctValue}. ` +
          `The profit is ₹${correctValue}.`;
        shortcut = `(${profit} × ${cost}) / 100 = ${correctValue}.`;
      } else if (isHard) {
        const cp = randomInt(200, 800, seed);
        const mp = Math.round(cp * randomInt(140, 200, seed + 1) / 100);
        const discount = randomInt(10, 30, seed + 2);
        const sp = Math.round(mp * (100 - discount) / 100);
        correctValue = sp - cp;
        question_text = `A shopkeeper marks an item costing ₹${cp} at ₹${mp} and offers a ${discount}% discount. What is his profit or loss?`;
        explanation = `Step 1: Cost Price = ₹${cp}. Marked Price = ₹${mp}. Discount = ${discount}%. ` +
          `Step 2: Selling Price = ${mp} × (100 - ${discount})/100 = ${mp} × ${(100 - discount) / 100} = ₹${sp}. ` +
          `Step 3: Profit/Loss = SP - CP = ${sp} - ${cp} = ${correctValue >= 0 ? 'Profit of ₹' : 'Loss of ₹'}${Math.abs(correctValue)}.`;
        shortcut = `SP = ${mp} × ${100 - discount}/100 = ${sp}. ${correctValue >= 0 ? 'Profit' : 'Loss'} = ${sp} - ${cp} = ${Math.abs(correctValue)}.`;
      } else {
        const cp = randomInt(300, 800, seed);
        const gain = randomInt(12, 30, seed + 1);
        correctValue = Math.round(cp * (100 + gain) / 100);
        question_text = `An item costing ₹${cp} is sold at a ${gain}% profit. What is the selling price?`;
        explanation = `Step 1: CP = ₹${cp}. Profit% = ${gain}%. ` +
          `Step 2: SP = CP × (100 + Profit%)/100 = ${cp} × ${100 + gain}/100. ` +
          `Step 3: SP = ₹${correctValue}.`;
        shortcut = `SP = ${cp} × ${100 + gain}/100 = ${correctValue}.`;
      }
      break;
    }
    case 'Ratio and Proportion': {
      if (isEasy) {
        const a = randomInt(2, 8, seed);
        const b = randomInt(3, 12, seed + 1);
        const multiple = randomInt(5, 15, seed + 2);
        correctValue = a * multiple;
        question_text = `If the ratio of A to B is ${a}:${b} and B is ${b * multiple}, what is the value of A?`;
        explanation = `Step 1: Ratio A:B = ${a}:${b}. Given B = ${b * multiple}. ` +
          `Step 2: Scaling factor = ${b * multiple} / ${b} = ${multiple}. ` +
          `Step 3: A = ${a} × ${multiple} = ${correctValue}.`;
        shortcut = `A = ${a} × (${b * multiple}/${b}) = ${correctValue}.`;
      } else if (isHard) {
        const total = randomInt(60, 200, seed);
        const a = randomInt(2, 5, seed + 1);
        const b = randomInt(3, 7, seed + 2);
        const c = randomInt(4, 9, seed + 3);
        const ratioSum = a + b + c;
        correctValue = Math.round(total * a / ratioSum);
        question_text = `₹${total} is to be divided among A, B, C in the ratio ${a}:${b}:${c}. What is A's share?`;
        explanation = `Step 1: Total parts = ${a} + ${b} + ${c} = ${ratioSum}. ` +
          `Step 2: A's share = (${a}/${ratioSum}) × ${total}. ` +
          `Step 3: = ${total} × ${a} / ${ratioSum} = ₹${correctValue}. ` +
          `A receives ₹${correctValue}.`;
        shortcut = `A's share = (${a}/${ratioSum}) × ${total} = ₹${correctValue}.`;
      } else {
        const a = randomInt(3, 9, seed);
        const b = randomInt(5, 12, seed + 1);
        const c = randomInt(6, 15, seed + 2);
        const bc = b * c;
        correctValue = a * c;
        question_text = `If a:b = ${a}:${b} and b:c = ${b}:${c}, what is a:c?`;
        explanation = `Step 1: a:b = ${a}:${b}, b:c = ${b}:${c}. ` +
          `Step 2: a:c = (a:b) × (b:c) = (${a} × ${c}) : (${b} × ${b}) = ${a * c} : ${b * b}. ` +
          `Step 3: Ratio a:c = ${correctValue} : ${b * b}. So a = ${correctValue} when c = ${b * b}.`;
        shortcut = `Multiply the antecedents: ${a} × ${c} = ${correctValue}.`;
      }
      break;
    }
    case 'Time and Work': {
      if (isEasy) {
        const rateA = randomInt(4, 10, seed);
        const rateB = randomInt(6, 14, seed + 1);
        correctValue = Math.round((rateA * rateB) / (rateA + rateB));
        question_text = `A can finish a job in ${rateA} days and B in ${rateB} days. In how many days will they finish together?`;
        explanation = `Step 1: A's rate = 1/${rateA} per day, B's rate = 1/${rateB} per day. ` +
          `Step 2: Combined rate = 1/${rateA} + 1/${rateB} = ${rateA + rateB}/${rateA * rateB}. ` +
          `Step 3: Time = 1 / Combined rate = ${rateA * rateB} / ${rateA + rateB} = ${correctValue} days.`;
        shortcut = `AB/(A+B) = (${rateA} × ${rateB})/(${rateA} + ${rateB}) = ${correctValue}.`;
      } else if (isHard) {
        const rateA = randomInt(6, 12, seed);
        const rateB = randomInt(8, 16, seed + 1);
        const workDays = randomInt(2, 5, seed + 2);
        const aWork = 1 / rateA * workDays;
        const remaining = 1 - aWork;
        correctValue = Math.round((rateA * rateB) / (rateA + rateB) * remaining);
        question_text = `A can finish a job in ${rateA} days and B in ${rateB} days. A works alone for ${workDays} days, then B joins. How many more days are needed to complete the work?`;
        explanation = `Step 1: A's rate = 1/${rateA}. Work done by A in ${workDays} days = ${workDays}/${rateA}. ` +
          `Step 2: Remaining work = 1 - ${workDays}/${rateA} = ${remaining.toFixed(2)}. ` +
          `Step 3: Combined rate = 1/${rateA} + 1/${rateB} = ${(1 / rateA + 1 / rateB).toFixed(4)}. ` +
          `Step 4: Time needed = Remaining / Combined rate = ${correctValue} days.`;
        shortcut = `Remaining work = 1 - ${workDays}/${rateA}. Time = Remaining / (1/${rateA} + 1/${rateB}).`;
      } else {
        const rateA = randomInt(5, 10, seed);
        const rateB = randomInt(8, 15, seed + 1);
        const rateC = randomInt(10, 20, seed + 2);
        correctValue = Math.round(1 / (1 / rateA + 1 / rateB - 1 / rateC));
        question_text = `A and B can do a job in ${rateA} and ${rateB} days respectively. C can destroy it in ${rateC} days. If all three work together, how many days to complete?`;
        explanation = `Step 1: A's rate = 1/${rateA}, B's rate = 1/${rateB}, C's destroy rate = 1/${rateC}. ` +
          `Step 2: Net rate = 1/${rateA} + 1/${rateB} - 1/${rateC} = ${(1 / rateA + 1 / rateB - 1 / rateC).toFixed(4)}. ` +
          `Step 3: Time = 1 / Net rate = ${correctValue} days.`;
        shortcut = `Time = 1/(1/${rateA} + 1/${rateB} - 1/${rateC}) = ${correctValue}.`;
      }
      break;
    }
    case 'Time, Speed and Distance': {
      if (isEasy) {
        const speed = randomInt(30, 70, seed);
        const time = randomInt(2, 5, seed + 1);
        correctValue = speed * time;
        question_text = `A vehicle travels at ${speed} km/h for ${time} hours. How many kilometers does it cover?`;
        explanation = `Step 1: Speed = ${speed} km/h, Time = ${time} hours. ` +
          `Step 2: Distance = Speed × Time = ${speed} × ${time} = ${correctValue} km.`;
        shortcut = `${speed} × ${time} = ${correctValue} km.`;
      } else if (isHard) {
        const dist = randomInt(300, 900, seed);
        const speedA = randomInt(40, 70, seed + 1);
        const speedB = randomInt(30, 60, seed + 2);
        const relativeSpeed = speedA + speedB;
        correctValue = Math.round((dist / relativeSpeed) * 60);
        question_text = `Two trains start from stations A and B ${dist} km apart at the same time. Train A travels at ${speedA} km/h and Train B at ${speedB} km/h towards each other. After how many minutes will they meet?`;
        explanation = `Step 1: Relative speed = ${speedA} + ${speedB} = ${relativeSpeed} km/h. ` +
          `Step 2: Time to meet = Distance / Relative speed = ${dist} / ${relativeSpeed} hours. ` +
          `Step 3: In minutes: (${dist} / ${relativeSpeed}) × 60 = ${correctValue} minutes.`;
        shortcut = `Time = (${dist} / (${speedA} + ${speedB})) × 60 = ${correctValue} minutes.`;
      } else {
        const speed = randomInt(30, 60, seed);
        const dist = randomInt(150, 350, seed + 1);
        correctValue = Math.round((dist / speed) * 60);
        question_text = `A cyclist covers ${dist} km at a speed of ${speed} km/h. How many minutes does the journey take?`;
        explanation = `Step 1: Time = Distance / Speed = ${dist} / ${speed} hours. ` +
          `Step 2: Convert to minutes: (${dist} / ${speed}) × 60 = ${correctValue} minutes.`;
        shortcut = `Time = (${dist} / ${speed}) × 60 = ${correctValue} minutes.`;
      }
      break;
    }
    case 'Number System': {
      if (isEasy) {
        const value = randomInt(15, 90, seed);
        const addend = randomInt(8, 22, seed + 1);
        correctValue = value + addend;
        question_text = `What is ${value} plus ${addend}?`;
        explanation = `Step 1: First number = ${value}. Step 2: Add ${addend}. ` +
          `Step 3: ${value} + ${addend} = ${correctValue}.`;
        shortcut = `Simple addition: ${value} + ${addend} = ${correctValue}.`;
      } else if (isHard) {
        const n = randomInt(3, 7, seed);
        const a = randomInt(3, 9, seed + 1);
        const d = randomInt(4, 12, seed + 2);
        const last = a + (n - 1) * d;
        correctValue = (n * (a + last)) / 2;
        question_text = `Find the sum of the first ${n} terms of an AP starting with ${a} and common difference ${d}.`;
        explanation = `Step 1: First term a = ${a}, common difference d = ${d}, number of terms n = ${n}. ` +
          `Step 2: Last term l = a + (n-1)d = ${a} + (${n - 1}) × ${d} = ${last}. ` +
          `Step 3: Sum = n(a + l)/2 = ${n}(${a} + ${last})/2 = ${n} × ${a + last} / 2 = ${a + last} × ${n} / 2 = ${correctValue}.`;
        shortcut = `Sum = n/2 × [2a + (n-1)d] = ${n}/2 × [${2 * a} + (${n - 1}) × ${d}] = ${correctValue}.`;
      } else {
        const a = randomInt(12, 50, seed);
        const b = randomInt(4, 11, seed + 1);
        correctValue = Math.floor(a / b);
        const remainder = a % b;
        question_text = `What is the quotient when ${a} is divided by ${b}?`;
        explanation = `Step 1: Dividend = ${a}, Divisor = ${b}. ` +
          `Step 2: ${b} × ${correctValue} = ${b * correctValue}, remainder = ${a - b * correctValue}. ` +
          `Step 3: Quotient = ${correctValue}, Remainder = ${remainder}.`;
        shortcut = `Divide and take the integer part: ${a} / ${b} = ${(a / b).toFixed(2)}, quotient = ${correctValue}.`;
      }
      break;
    }
    case 'Simplification': {
      if (isEasy) {
        const a = randomInt(20, 40, seed);
        const b = randomInt(1, 9, seed + 1);
        correctValue = Math.round(a / b);
        question_text = `Simplify ${a} ÷ ${b}.`;
        explanation = `Step 1: Divide ${a} by ${b}. ` +
          `Step 2: ${b} × ${correctValue} = ${b * correctValue}. Step 3: Result = ${correctValue}.`;
        shortcut = `${a} ÷ ${b} = ${correctValue}.`;
      } else if (isHard) {
        const a = randomInt(2, 6, seed);
        const b = randomInt(2, 5, seed + 1);
        const c = randomInt(3, 8, seed + 2);
        const lhs = a + b;
        const rhs = c;
        const result = Math.round((a + b) * c);
        question_text = `Simplify (${a} + ${b}) × ${c} - ${a * c}.`;
        correctValue = result - a * c;
        explanation = `Step 1: Solve brackets: (${a} + ${b}) = ${lhs}. ` +
          `Step 2: Multiply: ${lhs} × ${c} = ${result}. ` +
          `Step 3: Subtract: ${result} - ${a * c} = ${correctValue}.`;
        shortcut = `Apply BODMAS: Brackets first, then multiplication, then subtraction.`;
      } else {
        const a = randomInt(12, 30, seed);
        const b = randomInt(2, 8, seed + 1);
        const c = randomInt(3, 7, seed + 2);
        correctValue = Math.round((a * b) / c);
        question_text = `Simplify (${a} × ${b}) ÷ ${c}.`;
        explanation = `Step 1: Multiply: ${a} × ${b} = ${a * b}. ` +
          `Step 2: Divide: ${a * b} ÷ ${c} = ${correctValue}.`;
        shortcut = `(${a} × ${b}) ÷ ${c} = ${correctValue}.`;
      }
      break;
    }
    case 'Averages': {
      if (isEasy) {
        const n = randomInt(3, 6, seed);
        const values = Array.from({ length: n }, (_, i) => randomInt(10, 40, seed + 2 + i));
        const sum = values.reduce((acc, value) => acc + value, 0);
        const average = Math.round(sum / n);
        correctValue = average * n;
        question_text = `The average of ${n} numbers is ${average}. What is the sum of the numbers?`;
        explanation = `Step 1: Average = Sum / Count. Step 2: Sum = Average × Count. ` +
          `Step 3: Sum = ${average} × ${n} = ${correctValue}.`;
        shortcut = `${average} × ${n} = ${correctValue}.`;
      } else if (isHard) {
        const n = randomInt(4, 7, seed);
        const initialAvg = randomInt(25, 50, seed + 1);
        const replacedValue = randomInt(15, 40, seed + 2);
        const newValue = randomInt(40, 70, seed + 3);
        const totalChange = newValue - replacedValue;
        const newAvg = Math.round(initialAvg + totalChange / n);
        correctValue = newValue - replacedValue;
        question_text = `The average of ${n} numbers is ${initialAvg}. If ${replacedValue} is replaced by ${newValue}, what is the new average?`;
        explanation = `Step 1: Initial sum = ${initialAvg} × ${n} = ${initialAvg * n}. ` +
          `Step 2: Change = ${newValue} - ${replacedValue} = ${correctValue}. ` +
          `Step 3: New sum = ${initialAvg * n} + ${correctValue} = ${initialAvg * n + correctValue}. ` +
          `Step 4: New average = ${initialAvg * n + correctValue} / ${n} = ${newAvg}.`;
        shortcut = `New average = ${initialAvg} + (${newValue} - ${replacedValue})/${n} = ${newAvg}.`;
      } else {
        const n = randomInt(4, 6, seed);
        const initialAvg = randomInt(20, 40, seed + 1);
        const newNum = randomInt(30, 60, seed + 2);
        const newSum = initialAvg * n + newNum;
        correctValue = Math.round(newSum / (n + 1));
        question_text = `The average of ${n} numbers is ${initialAvg}. A new number ${newNum} is added. What is the new average?`;
        explanation = `Step 1: Initial sum = ${initialAvg} × ${n} = ${initialAvg * n}. ` +
          `Step 2: New sum = ${initialAvg * n} + ${newNum} = ${newSum}. ` +
          `Step 3: New count = ${n + 1}. ` +
          `Step 4: New average = ${newSum} / ${n + 1} = ${correctValue}.`;
        shortcut = `New average = (${initialAvg * n} + ${newNum}) / ${n + 1} = ${correctValue}.`;
      }
      break;
    }
    default: {
      const a = randomInt(7, 18, seed);
      const b = randomInt(3, 12, seed + 1);
      correctValue = a * b;
      question_text = `If one student solves ${a} questions each hour, how many questions will they solve in ${b} hours?`;
      explanation = `Step 1: Rate = ${a} questions per hour. ` +
        `Step 2: Time = ${b} hours. ` +
        `Step 3: Total = Rate × Time = ${a} × ${b} = ${correctValue}.`;
      shortcut = `${a} × ${b} = ${correctValue}.`;
      break;
    }
  }

  const { options, correct_option } = buildOptions(correctValue, seed + 50);
  return {
    question_text,
    options,
    correct_option,
    explanation,
    shortcut,
    concept,
    difficulty,
    marks,
    negative_marks,
  };
}

function generateLocalAssessmentJson(config) {
  const questions = [];

  if (config.concept === 'All Concepts') {
    const baseCount = Math.floor(config.question_count / CONCEPTS.length);
    const remainder = config.question_count % CONCEPTS.length;

    CONCEPTS.forEach((concept, conceptIndex) => {
      const conceptCount = baseCount + (conceptIndex < remainder ? 1 : 0);
      for (let index = 0; index < conceptCount; index += 1) {
        questions.push(
          buildQuestionTemplate(
            concept,
            config.difficulty,
            index,
            config.marks,
            config.negative_marks,
          ),
        );
      }
    });
  } else {
    for (let index = 0; index < config.question_count; index += 1) {
      questions.push(
        buildQuestionTemplate(
          config.concept,
          config.difficulty,
          index,
          config.marks,
          config.negative_marks,
        ),
      );
    }
  }

  return {
    assessment_title: config.title,
    concept: config.concept,
    difficulty: config.difficulty,
    total_questions: questions.length,
    questions,
  };
}

function createClient(ai) {
  return new OpenAI({
    apiKey: ai.apiKey,
    baseURL: ai.baseURL,
    maxRetries: 1,
    timeout: ai.timeout,
  });
}

function estimateMaxTokens(questionCount) {
  return Math.min(8192, Math.max(1800, questionCount * 700));
}

function getAiErrorMessage(error) {
  return (
    error?.error?.message ||
    error?.error?.code ||
    error?.response?.data?.error?.message ||
    error?.message ||
    'AI generation failed'
  );
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runNext() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => runNext()),
  );
  return results;
}

function buildGenerationJobs(config, batchSize) {
  if (config.concept === 'All Concepts') {
    const baseCount = Math.floor(config.question_count / CONCEPTS.length);
    const remainder = config.question_count % CONCEPTS.length;

    return CONCEPTS.flatMap((concept, conceptIndex) => {
      const conceptCount = baseCount + (conceptIndex < remainder ? 1 : 0);
      const jobs = [];
      let remaining = conceptCount;
      while (remaining > 0) {
        const questionCount = Math.min(batchSize, remaining);
        jobs.push({
          ...config,
          concept,
          question_count: questionCount,
        });
        remaining -= questionCount;
      }
      return jobs;
    });
  }

  const jobs = [];
  let remaining = config.question_count;
  while (remaining > 0) {
    const questionCount = Math.min(batchSize, remaining);
    jobs.push({
      ...config,
      question_count: questionCount,
    });
    remaining -= questionCount;
  }
  return jobs;
}

async function generateBatchJson(openai, ai, config, fileContext, batchLabel, existingQuestionTexts = []) {
  const prompt = `${buildPrompt(config, fileContext, existingQuestionTexts)}
 
Batch instruction:
Generate batch ${batchLabel}. Every question must be different from every other batch and from the existing list above. Use unique numerical values, wording, scenarios, AND sentence structures — never reuse a question_text or question pattern. Return exactly ${config.question_count} questions.`;

  const request = {
    model: ai.model,
    temperature: 0.7,
    top_p: 0.9,
    max_tokens: estimateMaxTokens(config.question_count),
    messages: [
      {
        role: 'system',
        content:
          'You are an expert aptitude assessment generator. Return strict JSON only.',
      },
      { role: 'user', content: prompt },
    ],
  };

  if (ai.useResponseFormat) {
    request.response_format = { type: 'json_object' };
  }

  let lastMessage = 'AI generation failed';

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const completion = await openai.chat.completions.create(request);
      await recordAiUsage({
        provider: ai.provider,
        model: ai.model,
        feature: 'assessment_question_generation',
        usage: completion.usage,
        metadata: {
          batch: batchLabel,
          question_count: config.question_count,
        },
      });
      const content = completion?.choices?.[0]?.message?.content;
      if (!content) {
        throw badRequest('AI response was empty');
      }

      return extractJson(content);
    } catch (error) {
      lastMessage = getAiErrorMessage(error);
      await recordAiUsage({
        provider: ai.provider,
        model: ai.model,
        feature: 'assessment_question_generation',
        status: 'error',
        metadata: {
          batch: batchLabel,
          question_count: config.question_count,
          message: lastMessage,
        },
      });
      if (attempt === 3) {
        throw badRequest(`AI batch ${batchLabel} failed`, [lastMessage]);
      }

      await sleep(attempt * 800);
      request.temperature = 0.3;
      request.messages = [
        ...request.messages,
        {
          role: 'user',
          content:
            'Retry with only one valid JSON object. No markdown, no comments, no prose.',
        },
      ];
    }
  }

  throw badRequest(`AI batch ${batchLabel} failed`, [lastMessage]);
}

async function generateJobWithRecovery(openai, ai, job, fileContext, jobIndex, existingQuestionTexts = []) {
  const batchLabel = String(jobIndex + 1);

  try {
    return await generateBatchJson(openai, ai, job, fileContext, batchLabel, existingQuestionTexts);
  } catch (error) {
    if (job.question_count <= 1) {
      throw error;
    }

    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[ai-generation] Batch ${batchLabel} failed. Retrying as individual questions.`,
        getAiErrorMessage(error),
      );
    }

    const individualJobs = Array.from({ length: job.question_count }, () => ({
      ...job,
      question_count: 1,
    }));

    const individualBatches = [];
    for (let index = 0; index < individualJobs.length; index += 1) {
      const label = `${batchLabel}.${index + 1}`;
      try {
        individualBatches.push(
          await generateBatchJson(openai, ai, individualJobs[index], fileContext, label, existingQuestionTexts),
        );
      } catch (individualError) {
        throw badRequest(`AI batch ${batchLabel} failed after recovery`, [
          getAiErrorMessage(individualError),
        ]);
      }
    }

    return {
      assessment_title: job.title,
      concept: job.concept,
      difficulty: job.difficulty,
      total_questions: individualBatches.reduce(
        (sum, batch) => sum + (batch.questions?.length || 0),
        0,
      ),
      questions: individualBatches.flatMap((batch) => batch.questions || []),
    };
  }
}

export async function generateAssessmentJson(config, fileContext = '') {
  const ai = getAiConfig();

  if (config.generation_mode === 'fast') {
    return generateLocalAssessmentJson(config);
  }

  if (!ai.apiKey) {
    if (process.env.NODE_ENV === 'development') {
      return generateLocalAssessmentJson(config, fileContext);
    }

    throw badRequest(
      'AI API credentials are missing. Set NVIDIA_NIM_API_KEY, AI_API_KEY, or OPENAI_API_KEY in .env.',
    );
  }

  // Fetch existing question texts for the same concept to avoid duplicates
  let existingQuestionTexts = [];
  try {
    const whereClause = config.concept === 'All Concepts'
      ? { concept: { [Op.ne]: null } }
      : { concept: config.concept };
    const existingQuestions = await Question.findAll({
      where: whereClause,
      attributes: ['question_text'],
    });
    existingQuestionTexts = existingQuestions.map((q) => q.question_text);
  } catch {
    // Non-critical — proceed without existing context
  }

  const openai = createClient(ai);
  const jobs = buildGenerationJobs(config, ai.batchSize);
  const batches = await runWithConcurrency(jobs, ai.concurrency, (job, index) =>
    generateJobWithRecovery(openai, ai, job, fileContext, index, existingQuestionTexts),
  );
  let questions = batches.flatMap((batch) => batch.questions || []);

  // Enhanced dedup: remove duplicates and re-prompt for missing count
  const TARGET_COUNT = config.question_count;
  let dedupContext = [...existingQuestionTexts];
  let uniqueQuestions = [];
  const MAX_ROUNDS = 10;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const seen = new Set(dedupContext.map((t) => t.toLowerCase().replace(/\s+/g, ' ').trim()));

    for (const q of questions) {
      const normalized = (q.question_text || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      uniqueQuestions.push(q);
      dedupContext.push(q.question_text);
    }

    if (uniqueQuestions.length >= TARGET_COUNT) break;

    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[dedup-guardrail] Round ${round}/${MAX_ROUNDS}: Have ${uniqueQuestions.length}/${TARGET_COUNT} unique questions. Generating ${TARGET_COUNT - uniqueQuestions.length} more...`,
      );
    }

    const remaining = TARGET_COUNT - uniqueQuestions.length;
    const refillJobs = buildGenerationJobs({ ...config, question_count: remaining }, ai.batchSize);
    const refillBatches = await runWithConcurrency(refillJobs, ai.concurrency, (job, index) =>
      generateJobWithRecovery(openai, ai, job, fileContext, `refill-${round}-${index}`, dedupContext),
    );
    questions = refillBatches.flatMap((batch) => batch.questions || []);
  }

  questions = uniqueQuestions.slice(0, TARGET_COUNT);

  return {
    assessment_title: config.title || batches[0]?.assessment_title || '',
    concept: config.concept,
    difficulty: config.difficulty,
    total_questions: questions.length,
    questions,
  };
}
