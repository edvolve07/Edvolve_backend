import OpenAI from 'openai';
import { recordAiUsage } from '../../services/aiUsageService.js';
import { CONCEPTS } from '../utils/constants.js';
import { badRequest } from '../utils/httpError.js';

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

export function buildPrompt(config, fileContext = '') {
  const maxContextChars = Number(process.env.AI_FILE_CONTEXT_CHARS || 5000);
  const contextBlock = fileContext
    ? `\nUse this uploaded study material as optional context. Do not copy it verbatim unless needed for a question:\n${fileContext.slice(0, maxContextChars)}\n`
    : '';

  return `Generate aptitude assessment questions for placement preparation and interview preparation.

Concept: ${config.concept}
Difficulty: ${config.difficulty}
Number of questions: ${config.question_count}
Marks per question: ${config.marks}
Negative marks: ${config.negative_marks}
${contextBlock}
Requirements:

* Generate only MCQ questions
* Each question must contain exactly 4 options:
  A, B, C, D
* Only one correct answer
* Include detailed step-by-step explanation
* Include shortcut solving method where applicable
* Include concept name
* Include difficulty level
* Avoid repeated questions
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
  let question_text = '';
  let correctValue = 0;
  let explanation = '';
  let shortcut = '';

  switch (concept) {
    case 'Percentages': {
      const base = randomInt(80, 260, seed);
      const percent = randomInt(5, 35, seed + 1);
      correctValue = Math.round((base * percent) / 100);
      question_text = `If ${percent}% of ${base} students passed the aptitude test, how many students passed?`;
      explanation = `Calculate ${percent}% of ${base}: multiply ${base} by ${percent} and divide by 100 to get ${correctValue}.`;
      shortcut = `Use quick percentage: ${base} × ${percent}/100 = ${correctValue}.`;
      break;
    }
    case 'Profit and Loss': {
      const cost = randomInt(250, 900, seed);
      const profit = randomInt(10, 45, seed + 1);
      correctValue = Math.round((cost * profit) / 100);
      question_text = `A product is bought for ₹${cost} and sold at a profit of ${profit}%. What is the profit amount?`;
      explanation = `Profit = ${profit}% of ₹${cost} = ₹${correctValue}.`;
      shortcut = `Multiply cost by profit percent and divide by 100.`;
      break;
    }
    case 'Ratio and Proportion': {
      const a = randomInt(2, 8, seed);
      const b = randomInt(3, 12, seed + 1);
      const multiple = randomInt(5, 15, seed + 2);
      correctValue = a * multiple;
      question_text = `If the ratio of A to B is ${a}:${b} and B is ${b * multiple}, what is the value of A?`;
      explanation = `For ratio ${a}:${b}, if B is ${b * multiple}, then A = ${a} × ${multiple} = ${correctValue}.`;
      shortcut = `Scale the ratio by the same multiplier for both terms.`;
      break;
    }
    case 'Time and Work': {
      const rateA = randomInt(4, 10, seed);
      const rateB = randomInt(6, 14, seed + 1);
      correctValue = Math.round((rateA * rateB) / (rateA + rateB));
      question_text = `A can finish a job in ${rateA} days and B in ${rateB} days. In how many days will they finish together?`;
      explanation = `Combined rate = 1/${rateA} + 1/${rateB}. Total days = 1 / combined rate = ${correctValue}.`;
      shortcut = `Use harmonic sum: AB/(A+B).`;
      break;
    }
    case 'Time, Speed and Distance': {
      const speed = randomInt(30, 70, seed);
      const time = randomInt(2, 5, seed + 1);
      correctValue = speed * time;
      question_text = `A vehicle travels at ${speed} km/h for ${time} hours. How many kilometers does it cover?`;
      explanation = `Distance = speed × time = ${speed} × ${time} = ${correctValue} km.`;
      shortcut = `Multiply the rate by time.`;
      break;
    }
    case 'Number System': {
      const value = randomInt(15, 90, seed);
      correctValue = value + randomInt(8, 22, seed + 1);
      question_text = `What is ${value} plus ${correctValue - value}?`;
      explanation = `Add the two numbers: ${value} + ${correctValue - value} = ${correctValue}.`;
      shortcut = `Combine the numbers directly.`;
      break;
    }
    case 'Simplification': {
      const a = randomInt(20, 40, seed);
      const b = randomInt(1, 9, seed + 1);
      correctValue = a / b;
      question_text = `Simplify ${a} ÷ ${b}.`;
      explanation = `Divide ${a} by ${b} to get ${correctValue}.`;
      shortcut = `Use integer division when divisible.`;
      break;
    }
    case 'Averages': {
      const n = randomInt(3, 6, seed);
      const values = Array.from({ length: n }, (_, i) => randomInt(10, 40, seed + 2 + i));
      const sum = values.reduce((acc, value) => acc + value, 0);
      const average = Math.round(sum / n);
      correctValue = average * n;
      question_text = `The average of ${n} numbers is ${average}. What is the sum of the numbers?`;
      explanation = `Sum = average × count = ${average} × ${n} = ${correctValue}.`;
      shortcut = `Multiply average by the quantity.`;
      break;
    }
    default: {
      const a = randomInt(7, 18, seed);
      const b = randomInt(3, 12, seed + 1);
      correctValue = a * b;
      question_text = `If one student solves ${a} questions each hour, how many questions will they solve in ${b} hours?`;
      explanation = `Multiply rate by time: ${a} × ${b} = ${correctValue}.`;
      shortcut = `Use repeated addition or multiplication.`;
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

async function generateBatchJson(openai, ai, config, fileContext, batchLabel) {
  const prompt = `${buildPrompt(config, fileContext)}

Batch instruction:
Generate batch ${batchLabel}. Make every question unique within this batch.
Return exactly ${config.question_count} questions.`;

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

async function generateJobWithRecovery(openai, ai, job, fileContext, jobIndex) {
  const batchLabel = String(jobIndex + 1);

  try {
    return await generateBatchJson(openai, ai, job, fileContext, batchLabel);
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
          await generateBatchJson(openai, ai, individualJobs[index], fileContext, label),
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

  const openai = createClient(ai);
  const jobs = buildGenerationJobs(config, ai.batchSize);
  const batches = await runWithConcurrency(jobs, ai.concurrency, (job, index) =>
    generateJobWithRecovery(openai, ai, job, fileContext, index),
  );
  const questions = batches.flatMap((batch) => batch.questions || []);

  return {
    assessment_title: config.title || batches[0]?.assessment_title || '',
    concept: config.concept,
    difficulty: config.difficulty,
    total_questions: questions.length,
    questions,
  };
}
