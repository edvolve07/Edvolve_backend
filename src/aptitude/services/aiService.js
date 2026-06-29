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
    case 'Mixtures and Allegations': {
      if (isEasy) {
        const volA = randomInt(10, 50, seed);
        const concA = randomInt(10, 30, seed + 1);
        const volB = randomInt(10, 50, seed + 2);
        const concB = randomInt(40, 70, seed + 3);
        const totalVol = volA + volB;
        correctValue = Math.round((volA * concA + volB * concB) / totalVol);
        question_text = `${volA} liters of ${concA}% solution is mixed with ${volB} liters of ${concB}% solution. What is the concentration of the mixture?`;
        explanation = `Step 1: Total volume = ${volA} + ${volB} = ${totalVol} L. ` +
          `Step 2: Solute in first = ${volA} × ${concA}/100 = ${(volA * concA / 100).toFixed(1)}. ` +
          `Step 3: Solute in second = ${volB} × ${concB}/100 = ${(volB * concB / 100).toFixed(1)}. ` +
          `Step 4: Total solute = ${(volA * concA / 100 + volB * concB / 100).toFixed(1)}. ` +
          `Step 5: Concentration = (Total solute / Total volume) × 100 = ${correctValue}%.`;
        shortcut = `(${volA}×${concA} + ${volB}×${concB}) / ${totalVol} = ${correctValue}%.`;
      } else if (isHard) {
        const initialVol = randomInt(20, 60, seed);
        const conc = randomInt(20, 40, seed + 1);
        const replaceVol = randomInt(5, 15, seed + 2);
        const replacementConc = randomInt(0, 10, seed + 3);
        const totalSolute = (initialVol - replaceVol) * conc / 100 + replaceVol * replacementConc / 100;
        correctValue = Math.round(totalSolute / initialVol * 100);
        question_text = `${initialVol} liters of ${conc}% solution has ${replaceVol} liters replaced with ${replacementConc}% solution. What is the new concentration?`;
        explanation = `Step 1: Initial solute = ${initialVol} × ${conc}/100 = ${(initialVol * conc / 100).toFixed(1)}. ` +
          `Step 2: Removed solute = ${replaceVol} × ${conc}/100 = ${(replaceVol * conc / 100).toFixed(1)}. ` +
          `Step 3: Added solute = ${replaceVol} × ${replacementConc}/100 = ${(replaceVol * replacementConc / 100).toFixed(1)}. ` +
          `Step 4: New solute = ${(initialVol * conc / 100).toFixed(1)} - ${(replaceVol * conc / 100).toFixed(1)} + ${(replaceVol * replacementConc / 100).toFixed(1)} = ${totalSolute.toFixed(1)}. ` +
          `Step 5: New concentration = ${totalSolute.toFixed(1)} / ${initialVol} × 100 = ${correctValue}%.`;
        shortcut = `New conc = (initial solute - removed + added) / total volume × 100.`;
      } else {
        const qtyA = randomInt(10, 30, seed);
        const priceA = randomInt(20, 50, seed + 1);
        const qtyB = randomInt(10, 30, seed + 2);
        const priceB = randomInt(60, 100, seed + 3);
        const totalQty = qtyA + qtyB;
        correctValue = Math.round((qtyA * priceA + qtyB * priceB) / totalQty);
        question_text = `${qtyA} kg of tea at ₹${priceA}/kg is mixed with ${qtyB} kg at ₹${priceB}/kg. What is the cost per kg of the mixture?`;
        explanation = `Step 1: Total weight = ${qtyA} + ${qtyB} = ${totalQty} kg. ` +
          `Step 2: Total cost = (${qtyA} × ${priceA}) + (${qtyB} × ${priceB}) = ${qtyA * priceA + qtyB * priceB}. ` +
          `Step 3: Cost per kg = ${qtyA * priceA + qtyB * priceB} / ${totalQty} = ₹${correctValue}.`;
        shortcut = `Average price = (${qtyA}×${priceA} + ${qtyB}×${priceB}) / ${totalQty} = ₹${correctValue}.`;
      }
      break;
    }
    case 'Permutation and Combination': {
      if (isEasy) {
        const n = randomInt(4, 7, seed);
        correctValue = n;
        question_text = `How many ways can ${n} distinct books be arranged on a shelf?`;
        correctValue = n <= 5 ? [1, 2, 6, 24, 120][n - 1] : n * (n - 1) * (n - 2);
        explanation = `Step 1: Number of ways to arrange n distinct objects = n!. ` +
          `Step 2: ${n}! = ${n} × ${n - 1} × ${n - 2}` + (n > 3 ? ` × ${n - 3}` : '') + (n > 4 ? ` × ${n - 4}` : '') + ` = ${correctValue}.`;
        shortcut = `${n}! = ${correctValue} ways.`;
      } else if (isHard) {
        const n = randomInt(5, 7, seed);
        const r = randomInt(2, 3, seed + 1);
        correctValue = n;
        for (let i = 0; i < r; i++) correctValue *= (n - i);
        correctValue /= [1, 1, 2, 6][r];
        question_text = `How many ways can a committee of ${r} people be formed from ${n} candidates?`;
        explanation = `Step 1: Number of combinations = ${n}C${r}. ` +
          `Step 2: ${n}C${r} = ${n}! / (${r}! × (${n} - ${r})!) = (${n} × ${n - 1}` + (r > 2 ? ` × ${n - 2}` : '') + `) / ${[1, 1, 2, 6][r]}. ` +
          `Step 3: = ${correctValue} ways.`;
        shortcut = `Use combination formula: ${n}C${r} = ${correctValue}.`;
      } else {
        const n = randomInt(5, 8, seed);
        const r = randomInt(2, 3, seed + 1);
        correctValue = n;
        for (let i = 0; i < r; i++) correctValue *= (n - i);
        question_text = `How many ways can ${r} prizes be awarded to ${n} students (each gets at most one)?`;
        explanation = `Step 1: Number of permutations = ${n}P${r}. ` +
          `Step 2: ${n}P${r} = ${n}! / (${n} - ${r})! = ${n} × ${n - 1}` + (r > 2 ? ` × ${n - 2}` : '') + `. ` +
          `Step 3: = ${correctValue} ways.`;
        shortcut = `Use permutation formula: ${n}P${r} = ${correctValue}.`;
      }
      break;
    }
    case 'Probability': {
      if (isEasy) {
        const total = randomInt(6, 12, seed);
        const favorable = randomInt(2, 5, seed + 1);
        correctValue = Math.round((favorable / total) * 100);
        question_text = `A bag has ${total} balls. ${favorable} are red and the rest are blue. What is the probability (in %) of drawing a red ball?`;
        explanation = `Step 1: Total outcomes = ${total}. Favorable = ${favorable}. ` +
          `Step 2: Probability = ${favorable} / ${total} = ${(favorable / total).toFixed(3)}. ` +
          `Step 3: In percentage: ${(favorable / total).toFixed(3)} × 100 = ${correctValue}%.`;
        shortcut = `P(red) = ${favorable}/${total} = ${correctValue}%.`;
      } else if (isHard) {
        const total = randomInt(6, 10, seed);
        const red = randomInt(2, 4, seed + 1);
        const blue = randomInt(2, 4, seed + 2);
        const green = total - red - blue;
        const p1 = red / total;
        const p2 = (red - 1) / (total - 1);
        correctValue = Math.round(p1 * p2 * 100);
        question_text = `A box has ${red} red, ${blue} blue${green > 0 ? `, ${green} green` : ''} balls. Two balls are drawn without replacement. What is the probability (%) both are red?`;
        explanation = `Step 1: P(first red) = ${red}/${total} = ${p1.toFixed(3)}. ` +
          `Step 2: P(second red | first red) = ${red - 1}/${total - 1} = ${p2.toFixed(3)}. ` +
          `Step 3: P(both red) = ${p1.toFixed(3)} × ${p2.toFixed(3)} = ${(p1 * p2).toFixed(3)} = ${correctValue}%.`;
        shortcut = `P(both red) = (${red}/${total}) × (${red - 1}/${total - 1}) = ${correctValue}%.`;
      } else {
        const total = randomInt(6, 10, seed);
        const red = randomInt(2, 4, seed + 1);
        const blue = total - red;
        const pRed = red / total;
        const pBlue = blue / total;
        correctValue = Math.round((pRed + pBlue) * 100);
        question_text = `A bag has ${red} red and ${blue} blue balls. What is the probability (%) of drawing a red OR a blue ball?`;
        explanation = `Step 1: P(red) = ${red}/${total}. P(blue) = ${blue}/${total}. ` +
          `Step 2: P(red or blue) = ${red}/${total} + ${blue}/${total} = ${(red + blue)}/${total} = 1 = ${correctValue}%.`;
        shortcut = `Since only red and blue exist, probability = 100%.`;
      }
      break;
    }
    case 'Simple Interest': {
      if (isEasy) {
        const p = randomInt(1000, 8000, seed);
        const r = randomInt(5, 12, seed + 1);
        const t = randomInt(2, 5, seed + 2);
        correctValue = Math.round((p * r * t) / 100);
        question_text = `Find the simple interest on ₹${p} at ${r}% per annum for ${t} years.`;
        explanation = `Step 1: SI = (P × R × T) / 100 = (${p} × ${r} × ${t}) / 100. ` +
          `Step 2: = ${p * r * t} / 100 = ₹${correctValue}.`;
        shortcut = `SI = (${p} × ${r} × ${t}) / 100 = ₹${correctValue}.`;
      } else if (isHard) {
        const si = randomInt(500, 2000, seed);
        const p = randomInt(5000, 15000, seed + 1);
        const r = randomInt(6, 15, seed + 2);
        correctValue = Math.round((si * 100) / (p * r));
        question_text = `The simple interest on a sum is ₹${si} at ${r}% per annum. If the principal is ₹${p}, for how many years was it lent?`;
        explanation = `Step 1: SI = (P × R × T) / 100 => T = (SI × 100) / (P × R). ` +
          `Step 2: T = (${si} × 100) / (${p} × ${r}) = ${si * 100} / ${p * r}. ` +
          `Step 3: T = ${correctValue} years.`;
        shortcut = `T = (${si} × 100) / (${p} × ${r}) = ${correctValue} years.`;
      } else {
        const p = randomInt(2000, 9000, seed);
        const t = randomInt(2, 4, seed + 1);
        const amount = randomInt(3000, 12000, seed + 2);
        const si = amount - p;
        correctValue = Math.round((si * 100) / (p * t));
        question_text = `A sum of ₹${p} amounts to ₹${amount} in ${t} years at simple interest. What is the rate of interest?`;
        explanation = `Step 1: SI = Amount - Principal = ${amount} - ${p} = ${si}. ` +
          `Step 2: R = (SI × 100) / (P × T) = (${si} × 100) / (${p} × ${t}). ` +
          `Step 3: R = ${si * 100} / ${p * t} = ${correctValue}%.`;
        shortcut = `R = (${si} × 100) / (${p} × ${t}) = ${correctValue}%.`;
      }
      break;
    }
    case 'Compound Interest': {
      if (isEasy) {
        const p = randomInt(2000, 8000, seed);
        const r = randomInt(5, 10, seed + 1);
        const t = randomInt(2, 3, seed + 2);
        const amount = Math.round(p * Math.pow((100 + r) / 100, t));
        correctValue = amount - p;
        question_text = `Find the compound interest on ₹${p} at ${r}% per annum for ${t} years.`;
        explanation = `Step 1: A = P(1 + R/100)^T = ${p} × (1 + ${r}/100)^${t}. ` +
          `Step 2: A = ${p} × ${((100 + r) / 100).toFixed(4)}^${t} = ₹${amount}. ` +
          `Step 3: CI = A - P = ${amount} - ${p} = ₹${correctValue}.`;
        shortcut = `CI = P[(1 + R/100)^T - 1] = ${p} × [(${(100 + r) / 100}^${t}) - 1] = ₹${correctValue}.`;
      } else if (isHard) {
        const p = randomInt(3000, 10000, seed);
        const t = randomInt(2, 3, seed + 1);
        const amount = Math.round(p * Math.pow(1.1, t));
        const ci = amount - p;
        correctValue = Math.round((Math.pow(amount / p, 1 / t) - 1) * 100);
        question_text = `A sum of ₹${p} amounts to ₹${amount} in ${t} years at compound interest. What is the rate of interest?`;
        explanation = `Step 1: A = P(1 + R/100)^T => (1 + R/100)^${t} = ${amount}/${p} = ${(amount / p).toFixed(4)}. ` +
          `Step 2: 1 + R/100 = (${(amount / p).toFixed(4)})^(1/${t}) = ${correctValue / 100 + 1}. ` +
          `Step 3: R = ${correctValue}%.`;
        shortcut = `R = [(A/P)^(1/T) - 1] × 100 = ${correctValue}%.`;
      } else {
        const p = randomInt(5000, 15000, seed);
        const r = randomInt(8, 12, seed + 1);
        const t = 2;
        const n = 2;
        const amount = Math.round(p * Math.pow(1 + r / (100 * n), n * t));
        correctValue = amount - p;
        question_text = `Find the compound interest on ₹${p} at ${r}% per annum compounded half-yearly for ${t} years.`;
        explanation = `Step 1: A = P(1 + R/(100×n))^(n×T) where n = 2 (half-yearly). ` +
          `Step 2: A = ${p} × (1 + ${r}/(200))^${n * t} = ${p} × ${(1 + r / 200).toFixed(4)}^${n * t} = ₹${amount}. ` +
          `Step 3: CI = ${amount} - ${p} = ₹${correctValue}.`;
        shortcut = `CI = P[(1 + R/200)^${n * t} - 1] = ₹${correctValue}.`;
      }
      break;
    }
    case 'Data Interpretation': {
      if (isEasy) {
        const valA = randomInt(100, 500, seed);
        const valB = randomInt(100, 500, seed + 1);
        correctValue = valA + valB;
        question_text = `A company sold ${valA} units in Q1 and ${valB} units in Q2. What are the total sales?`;
        explanation = `Step 1: Q1 = ${valA}, Q2 = ${valB}. ` +
          `Step 2: Total = ${valA} + ${valB} = ${correctValue}.`;
        shortcut = `${valA} + ${valB} = ${correctValue}.`;
      } else if (isHard) {
        const revenue = randomInt(50000, 200000, seed);
        const cost = randomInt(30000, 100000, seed + 1);
        const taxRate = randomInt(15, 30, seed + 2);
        const profit = revenue - cost;
        const tax = Math.round(profit * taxRate / 100);
        correctValue = profit - tax;
        question_text = `A company's revenue is ₹${revenue} and cost is ₹${cost}. Tax rate is ${taxRate}%. What is the net profit after tax?`;
        explanation = `Step 1: Profit before tax = ${revenue} - ${cost} = ₹${profit}. ` +
          `Step 2: Tax = ${profit} × ${taxRate}% = ₹${tax}. ` +
          `Step 3: Net profit = ${profit} - ${tax} = ₹${correctValue}.`;
        shortcut = `Net profit = (${revenue} - ${cost}) × (100 - ${taxRate})/100 = ₹${correctValue}.`;
      } else {
        const q1 = randomInt(200, 600, seed);
        const q2 = randomInt(250, 700, seed + 1);
        const q3 = randomInt(300, 800, seed + 2);
        const avg = Math.round((q1 + q2 + q3) / 3);
        correctValue = Math.round(((q2 - q1) / q1) * 100);
        question_text = `Sales were ${q1} in Jan, ${q2} in Feb, ${q3} in Mar. What is the percentage increase from Jan to Feb?`;
        explanation = `Step 1: Increase = ${q2} - ${q1} = ${q2 - q1}. ` +
          `Step 2: % Increase = (${q2 - q1} / ${q1}) × 100 = ${((q2 - q1) / q1 * 100).toFixed(1)} = ${correctValue}%.`;
        shortcut = `% Increase = (${q2} - ${q1}) / ${q1} × 100 = ${correctValue}%.`;
      }
      break;
    }
    case 'Logical Reasoning': {
      if (isEasy) {
        const start = randomInt(2, 10, seed);
        const diff = randomInt(2, 6, seed + 1);
        correctValue = start + 4 * diff;
        question_text = `Find the next number in the series: ${start}, ${start + diff}, ${start + 2 * diff}, ${start + 3 * diff}, ?`;
        explanation = `Step 1: Common difference = ${start + diff} - ${start} = ${diff}. ` +
          `Step 2: Next term = ${start + 3 * diff} + ${diff} = ${correctValue}.`;
        shortcut = `Add ${diff} to the last term: ${start + 3 * diff} + ${diff} = ${correctValue}.`;
      } else if (isHard) {
        const a = randomInt(2, 6, seed);
        const b = randomInt(8, 15, seed + 1);
        const c = randomInt(3, 7, seed + 2);
        const d = randomInt(1, 5, seed + 3);
        const ageA = a * d;
        const ageB = b + d;
        correctValue = ageA + ageB;
        question_text = `A is ${a} times as old as D. B is ${b} years older than D. If D is ${d} years old, what is the sum of ages of A and B?`;
        explanation = `Step 1: A's age = ${a} × ${d} = ${ageA}. ` +
          `Step 2: B's age = ${b} + ${d} = ${ageB}. ` +
          `Step 3: Sum = ${ageA} + ${ageB} = ${correctValue}.`;
        shortcut = `Sum = (${a} × ${d}) + (${b} + ${d}) = ${correctValue}.`;
      } else {
        const aNow = randomInt(20, 40, seed);
        const bNow = randomInt(5, 15, seed + 1);
        const years = randomInt(5, 12, seed + 2);
        correctValue = (aNow + years) - (bNow + years);
        question_text = `A is ${aNow} years old and B is ${bNow} years old. After ${years} years, what will be the difference in their ages?`;
        explanation = `Step 1: A's age after ${years} years = ${aNow} + ${years} = ${aNow + years}. ` +
          `Step 2: B's age after ${years} years = ${bNow} + ${years} = ${bNow + years}. ` +
          `Step 3: Difference = ${aNow + years} - ${bNow + years} = ${correctValue}.`;
        shortcut = `Age difference remains constant: ${aNow} - ${bNow} = ${correctValue}.`;
      }
      break;
    }
    case 'Verbal Ability': {
      if (isEasy) {
        const words = ['BEAUTIFUL', 'EDUCATION', 'KNOWLEDGE', 'COMPUTER', 'SCIENCE'];
        const word = words[seed % words.length];
        const vowels = word.replace(/[^AEIOU]/g, '').length;
        correctValue = vowels;
        question_text = `How many vowels are in the word "${word}"?`;
        explanation = `Step 1: The word "${word}" has letters: ${word.split('').join(', ')}. ` +
          `Step 2: Vowels (A, E, I, O, U) found: ${word.replace(/[^AEIOU]/g, word => word + ' ')}. ` +
          `Step 3: Count = ${correctValue}.`;
        shortcut = `Count vowels in "${word}" = ${correctValue}.`;
      } else if (isHard) {
        const pairs = [
          { word: 'BRIEF', syn: 'SHORT', ant: 'LONG' },
          { word: 'ABUNDANT', syn: 'PLENTIFUL', ant: 'SCARCE' },
          { word: 'FAMOUS', syn: 'RENOWNED', ant: 'OBSCURE' },
          { word: 'WEALTHY', syn: 'AFFLUENT', ant: 'POOR' },
        ];
        const pair = pairs[seed % pairs.length];
        const alphabetPos = (letter) => letter.charCodeAt(0) - 64;
        correctValue = alphabetPos(pair.syn[0]) + alphabetPos(pair.ant[0]);
        question_text = `What is the sum of the alphabetical positions of the first letters of the synonym and antonym of "${pair.word}"?`;
        explanation = `Step 1: Synonym of "${pair.word}" = "${pair.syn}". First letter = ${pair.syn[0]}. ` +
          `Step 2: Antonym of "${pair.word}" = "${pair.ant}". First letter = ${pair.ant[0]}. ` +
          `Step 3: Position of ${pair.syn[0]} = ${alphabetPos(pair.syn[0])}, Position of ${pair.ant[0]} = ${alphabetPos(pair.ant[0])}. ` +
          `Step 4: Sum = ${alphabetPos(pair.syn[0])} + ${alphabetPos(pair.ant[0])} = ${correctValue}.`;
        shortcut = `Sum = pos(${pair.syn[0]}) + pos(${pair.ant[0]}) = ${correctValue}.`;
      } else {
        const pairs = [
          { w1: 'HAPPY', w2: 'JOYFUL' },
          { w1: 'BIG', w2: 'LARGE' },
          { w1: 'FAST', w2: 'QUICK' },
          { w1: 'CLEVER', w2: 'INTELLIGENT' },
          { w1: 'WEAK', w2: 'FRAIL' },
        ];
        const pair = pairs[seed % pairs.length];
        const alphabetPos = (letter) => letter.charCodeAt(0) - 64;
        const commonLetters = pair.w1.split('').filter(l => pair.w2.includes(l));
        correctValue = commonLetters.length > 0 ? alphabetPos(commonLetters[0]) : 1;
        question_text = `Words "${pair.w1}" and "${pair.w2}" are synonyms. What is the alphabetical position of the first common letter between them?`;
        explanation = `Step 1: Letters in "${pair.w1}": ${pair.w1.split('').join(', ')}. ` +
          `Step 2: Letters in "${pair.w2}": ${pair.w2.split('').join(', ')}. ` +
          `Step 3: Common letters: ${commonLetters.join(', ') || 'none'}. ` +
          `Step 4: First common letter = "${commonLetters[0]}". Position = ${correctValue}.`;
        shortcut = `Find common letter, then its alphabetical position: ${correctValue}.`;
      }
      break;
    }
    case 'Coding-Decoding': {
      if (isEasy) {
        const word = ['CAT', 'DOG', 'BAT', 'FAN', 'CUP'][seed % 5];
        const shift = randomInt(1, 3, seed + 1);
        const coded = word.split('').map(l => String.fromCharCode(l.charCodeAt(0) + shift)).join('');
        const alphabetPos = (letter) => letter.charCodeAt(0) - 64;
        correctValue = coded.split('').reduce((s, l) => s + alphabetPos(l), 0);
        question_text = `If "${word}" is coded as "${coded}" (each letter shifted by ${shift}), what is the sum of alphabetical positions of letters in "${coded}"?`;
        explanation = `Step 1: Each letter in "${word}" shifted by ${shift}: ` +
          word.split('').map(l => `${l}→${String.fromCharCode(l.charCodeAt(0) + shift)}`).join(', ') + `. ` +
          `Step 2: Alphabetical positions: ${coded.split('').map(l => `${l}=${alphabetPos(l)}`).join(', ')}. ` +
          `Step 3: Sum = ${correctValue}.`;
        shortcut = `Sum of positions of coded letters = ${correctValue}.`;
      } else if (isHard) {
        const words = ['APPLE', 'MANGO', 'GRAPE', 'PEARL'];
        const word = words[seed % words.length];
        const code = word.split('').map(l => String.fromCharCode(155 - l.charCodeAt(0))).join('');
        const alphabetPos = (letter) => letter.charCodeAt(0) - 64;
        correctValue = code.split('').reduce((s, l) => s + alphabetPos(l), 0);
        question_text = `In a code, each letter is replaced by its opposite letter (A↔Z, B↔Y, etc.). If "${word}" is coded as "${code}", find the sum of alphabetical positions of the coded letters.`;
        explanation = `Step 1: Opposite coding: position + opposite position = 27. ` +
          `Step 2: "${word}" → "${code}" (${word.split('').map((l, i) => `${l}→${code[i]}`).join(', ')}). ` +
          `Step 3: Positions in code: ${code.split('').map(l => `${l}=${alphabetPos(l)}`).join(', ')}. ` +
          `Step 4: Sum = ${correctValue}.`;
        shortcut = `Sum of coded positions = ${correctValue}.`;
      } else {
        const word = 'CODE'[seed % 4];
        const shift = randomInt(1, 4, seed + 1);
        const coded = String.fromCharCode(word.charCodeAt(0) + shift);
        const alphabetPos = (letter) => letter.charCodeAt(0) - 64;
        correctValue = alphabetPos(coded);
        question_text = `If "${word}" is coded as "${coded}" (each letter shifted by ${shift}), what is the alphabetical position of the coded form of "${word}"?`;
        explanation = `Step 1: Original letter = "${word}". Shift = ${shift}. ` +
          `Step 2: Coded letter = "${coded}". ` +
          `Step 3: Position of "${coded}" = ${correctValue}.`;
        shortcut = `Position = pos("${word}") + ${shift} = ${alphabetPos(word) + shift} = ${correctValue}.`;
      }
      break;
    }
    case 'Blood Relations': {
      if (isEasy) {
        const ages = [
          { grandparent: 70, parent: 40, child: 12 },
          { grandparent: 65, parent: 38, child: 10 },
          { grandparent: 75, parent: 45, child: 15 },
        ];
        const family = ages[seed % ages.length];
        correctValue = family.grandparent - family.child;
        question_text = `A grandfather is ${family.grandparent} years old and his grandchild is ${family.child}. What was the grandfather's age when the grandchild was born?`;
        explanation = `Step 1: Grandfather's age at grandchild's birth = Grandfather's age - Grandchild's age. ` +
          `Step 2: = ${family.grandparent} - ${family.child} = ${correctValue} years.`;
        shortcut = `${family.grandparent} - ${family.child} = ${correctValue}.`;
      } else if (isHard) {
        const dad = randomInt(35, 50, seed);
        const son = randomInt(8, 18, seed + 1);
        const mom = dad - randomInt(2, 6, seed + 2);
        correctValue = (dad + son) - mom;
        question_text = `A father is ${dad}, his son is ${son}, and his wife is ${mom} years old. By how many years is the father's age more than the mother's when the son was 5?`;
        const dadWhenSonWas5 = dad - (son - 5);
        const momWhenSonWas5 = mom - (son - 5);
        explanation = `Step 1: When son was 5 (${son - 5} years ago), father was ${dad} - ${son - 5} = ${dadWhenSonWas5}. ` +
          `Step 2: Mother was ${mom} - ${son - 5} = ${momWhenSonWas5}. ` +
          `Step 3: Difference = ${dadWhenSonWas5} - ${momWhenSonWas5} = ${correctValue} years.`;
        shortcut = `Age difference between parents remains constant: ${dad} - ${mom} = ${correctValue}.`;
      } else {
        const mom = randomInt(30, 45, seed);
        const daughter = randomInt(5, 15, seed + 1);
        const years = randomInt(5, 10, seed + 2);
        correctValue = (mom + years) / (daughter + years);
        question_text = `A mother is ${mom} and her daughter is ${daughter}. After ${years} years, what will be the ratio of their ages (mother : daughter)?`;
        const momFuture = mom + years;
        const dauFuture = daughter + years;
        const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
        const divisor = gcd(momFuture, dauFuture);
        const ratioNum = momFuture / divisor;
        const ratioDen = dauFuture / divisor;
        correctValue = Math.round(ratioNum / ratioDen * 10);
        explanation = `Step 1: Mother's age after ${years} years = ${mom} + ${years} = ${momFuture}. ` +
          `Step 2: Daughter's age after ${years} years = ${daughter} + ${years} = ${dauFuture}. ` +
          `Step 3: Ratio = ${momFuture} : ${dauFuture} = ${ratioNum} : ${ratioDen} = ${(ratioNum / ratioDen).toFixed(1)}.`;
        shortcut = `Ratio = (${mom} + ${years}) / (${daughter} + ${years}) = ${(ratioNum / ratioDen).toFixed(1)}.`;
      }
      break;
    }
    case 'Seating Arrangement': {
      if (isEasy) {
        const total = randomInt(8, 15, seed);
        const positionFromLeft = randomInt(2, total - 1, seed + 1);
        correctValue = total - positionFromLeft + 1;
        question_text = `In a row of ${total} students, X is ${positionFromLeft}th from the left. What is X's position from the right?`;
        explanation = `Step 1: Total students = ${total}. Position from left = ${positionFromLeft}. ` +
          `Step 2: Position from right = Total - Position from left + 1 = ${total} - ${positionFromLeft} + 1 = ${correctValue}.`;
        shortcut = `Right position = ${total} - ${positionFromLeft} + 1 = ${correctValue}.`;
      } else if (isHard) {
        const total = randomInt(10, 18, seed);
        const aFromLeft = randomInt(3, 6, seed + 1);
        const bFromRight = randomInt(3, 6, seed + 2);
        const between = randomInt(2, 5, seed + 3);
        correctValue = aFromLeft + between + bFromRight;
        question_text = `In a row of ${total} people, A is ${aFromLeft}th from left and B is ${bFromRight}th from right. There are ${between} people between A and B. What is the total number of people counted from A's left to B's right?`;
        explanation = `Step 1: People from left end to A = ${aFromLeft}. ` +
          `Step 2: People between A and B = ${between}. ` +
          `Step 3: People from B to right end = ${bFromRight}. ` +
          `Step 4: Total covered = ${aFromLeft} + ${between} + ${bFromRight} = ${correctValue}.`;
        shortcut = `Total = ${aFromLeft} + ${between} + ${bFromRight} = ${correctValue}.`;
      } else {
        const total = randomInt(8, 12, seed);
        const aFromLeft = randomInt(3, total - 2, seed + 1);
        const bFromRight = randomInt(3, total - 2, seed + 2);
        const overlap = aFromLeft + bFromRight - total;
        correctValue = overlap > 0 ? overlap : 0;
        question_text = `In a row of ${total} persons, A is ${aFromLeft}th from left and B is ${bFromRight}th from right. How many persons are there between A and B?`;
        explanation = `Step 1: If overlapping, persons between = position from left + position from right - total - 2. ` +
          `Step 2: = ${aFromLeft} + ${bFromRight} - ${total} - 2 = ${correctValue}.` +
          (correctValue <= 0 ? ` Since this is ≤ 0, no one is between them.` : ` There are ${correctValue} persons between A and B.`);
        shortcut = `Between = ${aFromLeft} + ${bFromRight} - ${total} - 2 = ${correctValue}.`;
      }
      break;
    }
    case 'Puzzles': {
      if (isEasy) {
        const a = randomInt(1, 9, seed);
        const b = randomInt(1, 9, seed + 1);
        correctValue = a * 10 + b;
        question_text = `If a 2-digit number has ${a} in the tens place and ${b} in the units place, what is the number?`;
        explanation = `Step 1: Tens digit = ${a}, Units digit = ${b}. ` +
          `Step 2: Number = ${a} × 10 + ${b} = ${correctValue}.`;
        shortcut = `${a} × 10 + ${b} = ${correctValue}.`;
      } else if (isHard) {
        const a = randomInt(2, 8, seed);
        const b = randomInt(1, 9, seed + 1);
        const sum = a + b;
        const product = a * b;
        const discriminant = sum * sum - 4 * product;
        const root1 = Math.round((sum + Math.sqrt(discriminant)) / 2);
        correctValue = root1;
        question_text = `The sum of two numbers is ${sum} and their product is ${product}. What is the larger number?`;
        explanation = `Step 1: Let numbers be x and y. x + y = ${sum}, xy = ${product}. ` +
          `Step 2: Quadratic: t² - ${sum}t + ${product} = 0. ` +
          `Step 3: Roots = [${sum} ± √(${sum * sum} - ${4 * product})] / 2 = [${sum} ± ${Math.sqrt(discriminant).toFixed(1)}] / 2. ` +
          `Step 4: Numbers are ${Math.round((sum - Math.sqrt(discriminant)) / 2)} and ${Math.round((sum + Math.sqrt(discriminant)) / 2)}. Larger = ${correctValue}.`;
        shortcut = `Larger = (${sum} + √(${sum * sum} - ${4 * product})) / 2 = ${correctValue}.`;
      } else {
        const d1 = randomInt(1, 4, seed);
        const d2 = randomInt(1, 4, seed + 1);
        const d3 = randomInt(0, 9, seed + 2);
        const num = d1 * 100 + d2 * 10 + d3;
        const reversed = d3 * 100 + d2 * 10 + d1;
        correctValue = Math.abs(num - reversed);
        question_text = `The digits of ${num} are reversed. What is the positive difference between the original and reversed number?`;
        explanation = `Step 1: Original = ${num}. ` +
          `Step 2: Reversed = ${reversed}. ` +
          `Step 3: Difference = |${num} - ${reversed}| = ${correctValue}.`;
        shortcut = `Difference = ${num} - ${reversed} = ${correctValue}.`;
      }
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
