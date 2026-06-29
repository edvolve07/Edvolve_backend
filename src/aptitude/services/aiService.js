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

// Replace the contents of buildQuestionTemplate (lines 186-953) with this:

function buildQuestionTemplate(concept, difficulty, index, marks, negative_marks) {
  const conceptSeed = Math.max(1, CONCEPTS.indexOf(concept) + 1);
  const seed = index + 1 + conceptSeed * 1000;
  const P = (min, max, off) => randomInt(min, max, seed + off);
  const diffKey = (difficulty || 'Medium').toLowerCase();

  const T = {
    'Percentages': {
      easy: [
        (_) => { const b=P(80,260,0), p=P(5,35,1); const cv=Math.round(b*p/100); return {qt:`If ${p}% of ${b} students passed, how many passed?`,cv,exp:`(${p}/100)×${b} = ${cv}`,sh:`${b}×${p}/100 = ${cv}`}; },
        (_) => { const t=P(200,500,0), p=P(8,25,1); const cv=Math.round(p*100/t); return {qt:`${p} is what % of ${t}?`,cv,exp:`(${p}/${t})×100 = ${cv}%`,sh:`(${p}/${t})×100`}; },
        (_) => { const o=P(300,800,0), d=P(10,35,1); const cv=Math.round(o*d/100); return {qt:`A TV priced at ₹${o} has a ${d}% discount. What is the discount amount?`,cv,exp:`(${d}/100)×${o} = ₹${cv}`,sh:`${o}×${d}% = ${cv}`}; },
        (_) => { const n=P(30,90,0), d=P(3,9,1); const cv=Math.round(n/d*10); return {qt:`Express ${n}/${d*10} as a percentage.`,cv,exp:`(${n}/${d*10})×100 = ${cv}%`,sh:`(${n}×100)/${d*10}`}; },
        (_) => { const r=P(20,80,0), p=P(10,30,1); const cv=Math.round(r*100/p); return {qt:`${r} is ${p}% of what number?`,cv,exp:`(${r}×100)/${p} = ${cv}`,sh:`(${r}×100)/${p}`}; },
        (_) => { const b=P(50,150,0), p=P(10,25,1); const cv=Math.round(b*(100-p)/100); return {qt:`After a ${p}% decrease, a ${b} kg stock became?`,cv,exp:`${b}×(${100-p}/100) = ${cv} kg`,sh:`${b}×${100-p}/100`}; },
      ],
      medium: [
        (_) => { const b=P(300,900,0), o=P(150,400,1); const i=b-o; const cv=Math.round(i/o*100); return {qt:`Revenue rose from ₹${o} to ₹${b}. What is the % increase?`,cv,exp:`((${b}-${o})/${o})×100 = ${cv}%`,sh:`(${i}/${o})×100 = ${cv}%`}; },
        (_) => { const b=P(400,1000,0), n=P(250,700,1); const d=b-n; const cv=Math.round(d/b*100); return {qt:`A population fell from ${b} to ${n}. What is the % decrease?`,cv,exp:`((${b}-${n})/${b})×100 = ${cv}%`,sh:`(${d}/${b})×100`}; },
        (_) => { const f=P(50,200,0), p=P(15,40,1); const cv=Math.round(f*100/(p+100)); return {qt:`A number increased by ${p}% becomes ${f+p}. Find the original.`,cv,exp:`Original = (${f+p}×100)/(100+${p}) = ${cv}`,sh:`(${f+p}×100)/${100+p}`}; },
        (_) => { const b=P(100,500,0), p1=P(10,20,1), p2=P(5,15,2); const r1=Math.round(b*p1/100), r2=Math.round((b-r1)*p2/100); const cv=r1+r2; return {qt:`${b} items. ${p1}% off first batch, ${p2}% off remainder. Total discount?`,cv,exp:`Batch1 disc ₹${r1}, Batch2 disc ₹${r2}. Total = ${cv}`,sh:`${r1}+${r2} = ${cv}`}; },
        (_) => { const v=P(200,600,0), p=P(10,25,1); const cv=Math.round(v*(100+p)/100); return {qt:`Value ₹${v} increased by ${p}%. New value?`,cv,exp:`${v}×(${100+p}/100) = ₹${cv}`,sh:`${v}×${100+p}/100`}; },
        (_) => { const a=P(120,360,0), b=P(80,240,1); const cv=Math.round((a-b)/b*100); return {qt:`A scored ${a}, B scored ${b}. A's score is what % more than B's?`,cv,exp:`((${a}-${b})/${b})×100 = ${cv}%`,sh:`(${a-b}/${b})×100`}; },
      ],
      hard: [
        (_) => { const b=P(5000,25000,0), f=P(10,30,1), sc=P(10,20,2); const a1=Math.round(b*(100+f)/100); const cv=Math.round(a1*(100-sc)/100); return {qt:`Town pop ${b}. Increases ${f}% year1, decreases ${sc}% year2. Pop after 2 years?`,cv,exp:`${b}×(${100+f}/100)×(${100-sc}/100) = ${cv}`,sh:`${b}×(1+${f}/100)×(1-${sc}/100)`}; },
        (_) => { const s=P(8000,30000,0), r=P(10,25,1), f=P(5,15,2); const a1=Math.round(s*(100+r)/100); const cv=a1-Math.round(a1*f/100); return {qt:`Salary ₹${s} raised ${r}% then cut ${f}%. Final salary?`,cv,exp:`${s}×(${100+r}/100)×(${100-f}/100) = ${cv}`,sh:`Net change = ${100+r}×${100-f}/10000 - 1 = ${Math.round((100+r)*(100-f)/10000*100-100)}%`}; },
        (_) => { const p=P(20000,60000,0), n1=P(12,25,1), n2=P(8,20,2); const a1=Math.round(p*(100+n1)/100); const a2=Math.round(p*(100-n2)/100); const cv=a1-a2; return {qt:`Stock worth ₹${p}: rose ${n1}% then fell ${n2}%. Difference from original?`,cv,exp:`After rise = ₹${a1}, after fall = ₹${a2}. Diff = |${a1-a2}| = ${cv}`,sh:`₹${cv}`}; },
        (_) => { const b=P(100,300,0), p=P(5,15,1); const cv=Math.round(b*p/100); const l=Math.round(cv*P(5,15,2)/100); return {qt:`Base salary ₹${b}, ${p}% bonus, then ${P(5,15,2)}% tax on bonus. Net bonus?`,cv,exp:`Bonus = ₹${cv}, tax = ${l}. Net = ${cv-l}`,sh:`Net = ${b}×${p}/100×(${100-P(5,15,2)}/100)`}; },
        (_) => { const m=P(150,350,0), f=P(80,200,1), p=P(10,25,2); const t=m+f; const cv=Math.round(p/t*100); return {qt:`Men ${m}, women ${f}. ${p} people are graduates. % graduates?`,cv,exp:`(${p}/${t})×100 = ${cv}%`,sh:`(${p}/${t})×100`}; },
        (_) => { const o=P(3000,8000,0), n=P(100,500,1); const cv=Math.round((o+n)/o*100); return {qt:`Old price ₹${o}, new price ₹${o+n}. % increase?`,cv,exp:`(${o+n}-${o}/${o})×100 = ${cv}%`,sh:`(${n}/${o})×100`}; },
      ],
    },
    'Profit and Loss': {
      easy: [
        (_) => { const c=P(250,900,0), p=P(10,45,1); const cv=Math.round(c*p/100); return {qt:`Bought for ₹${c} sold at ${p}% profit. Profit amount?`,cv,exp:`(${p}/100)×${c} = ₹${cv}`,sh:`(${p}×${c})/100 = ${cv}`}; },
        (_) => { const c=P(200,600,0), l=P(8,20,1); const cv=Math.round(c*l/100); return {qt:`Bought for ₹${c} sold at ${l}% loss. Loss amount?`,cv,exp:`(${l}/100)×${c} = ₹${cv}`,sh:`(${l}×${c})/100`}; },
        (_) => { const c=P(300,700,0), g=P(10,25,1); const cv=Math.round(c*(100+g)/100); return {qt:`CP ₹${c}, gain ${g}%. SP?`,cv,exp:`${c}×(${100+g}/100) = ₹${cv}`,sh:`${c}×${100+g}/100`}; },
        (_) => { const c=P(200,500,0), l=P(8,20,1); const cv=Math.round(c*(100-l)/100); return {qt:`CP ₹${c}, loss ${l}%. SP?`,cv,exp:`${c}×(${100-l}/100) = ₹${cv}`,sh:`${c}×${100-l}/100`}; },
        (_) => { const s=P(300,800,0), c=P(200,500,1); const cv=s-c; return {qt:`Sold for ₹${s}, bought for ₹${c}. Profit amount?`,cv,exp:`${s} - ${c} = ₹${cv}`,sh:`${s}-${c}`}; },
        (_) => { const sp=P(150,400,0), cp=P(100,300,1); const lo=cp-sp; const cv=Math.round(lo/cp*100); return {qt:`CP ₹${cp}, SP ₹${sp}. Loss %?`,cv,exp:`((${cp}-${sp})/${cp})×100 = ${cv}%`,sh:`(${cp-sp}/${cp})×100`}; },
      ],
      medium: [
        (_) => { const s=P(400,900,0), p=P(10,25,1); const cv=Math.round(s*100/(100+p)); return {qt:`Sold at ₹${s} with ${p}% profit. CP?`,cv,exp:`CP = (100×${s})/(100+${p}) = ₹${cv}`,sh:`(100×${s})/${100+p}`}; },
        (_) => { const s=P(300,700,0), l=P(8,20,1); const cv=Math.round(s*100/(100-l)); return {qt:`Sold at ₹${s} with ${l}% loss. CP?`,cv,exp:`CP = (100×${s})/(100-${l}) = ₹${cv}`,sh:`(100×${s})/${100-l}`}; },
        (_) => { const c=P(200,600,0), s=P(260,700,1); const cv=Math.round((s-c)/c*100); return {qt:`CP ₹${c}, SP ₹${s}. Profit %?`,cv,exp:`(${s-c}/${c})×100 = ${cv}%`,sh:`(${s-c}/${c})×100`}; },
        (_) => { const m=P(500,1500,0), d=P(10,30,1); const cv=Math.round(m*d/100); return {qt:`MP ₹${m}, discount ${d}%. Discount amount?`,cv,exp:`(${d}/100)×${m} = ₹${cv}`,sh:`${m}×${d}/100`}; },
        (_) => { const m=P(400,1000,0), d=P(10,25,1); const cv=Math.round(m*(100-d)/100); return {qt:`MP ₹${m}, ${d}% discount. Selling price?`,cv,exp:`${m}×(${100-d}/100) = ₹${cv}`,sh:`${m}×${100-d}/100`}; },
        (_) => { const c=P(150,500,0), g=P(15,30,1); const cv=Math.round(c*(100+g)/100)-c; return {qt:`An item costing ₹${c} sold at ${g}% profit. Profit in rupees?`,cv,exp:`Profit = ${c}×${g}/100 = ₹${cv}`,sh:`${c}×${g}/100`}; },
      ],
      hard: [
        (_) => { const c=P(200,800,0), m=Math.round(c*P(140,200,1)/100), d=P(10,30,2); const sp=Math.round(m*(100-d)/100); const cv=sp-c; return {qt:`CP ₹${c}, MP ₹${m}, ${d}% discount. Profit or loss?`,cv,exp:`SP = ${m}×(${100-d}/100) = ₹${sp}. ${cv>=0?'Profit':'Loss'} = ${sp}-${c} = ${Math.abs(cv)}`,sh:`SP = ${m}×${100-d}/100 = ${sp}`}; },
        (_) => { const c=P(100,500,0), s=P(150,600,1); const cv=Math.round((s-c)/c*100); return {qt:`CP ₹${c}, SP ₹${s}. Profit %?`,cv,exp:`(${s-c}/${c})×100 = ${cv}%`,sh:`(${s-c}/${c})×100`}; },
        (_) => { const w=P(800,1200,0), cp=P(500,700,1); const sp=Math.round(w*(100+P(10,20,2))/100); const cv=sp-cp; return {qt:`Shopkeeper sells at ${P(10,20,2)}% profit on marked price ₹${w} (cost ₹${cp}). Actual profit?`,cv,exp:`SP = ${w}×${100+P(10,20,2)}/100 = ₹${sp}. Profit = ${sp}-${cp} = ${cv}`,sh:`₹${sp}-₹${cp}=${cv}`}; },
        (_) => { const c=P(200,600,0), d1=P(10,20,1), d2=P(5,15,2); const sp=Math.round(c*(100-d1)/100*(100-d2)/100); const cv=c-sp; return {qt:`CP ₹${c}, successive discounts ${d1}% and ${d2}%. Total discount?`,cv,exp:`SP = ${c}×(${100-d1}/100)×(${100-d2}/100) = ₹${sp}. Discount = ${c}-${sp} = ${cv}`,sh:`Net discount = ${d1+d2-d1*d2/100}%`}; },
        (_) => { const c=P(300,700,0), p=P(10,20,1), d=P(5,15,2); const sp=Math.round(c*(100+p)/100); const mp=Math.round(sp*100/(100-d)); const cv=mp-c; return {qt:`CP ₹${c}, wants ${p}% profit after ${d}% discount. MP? (excess over CP)`,cv,exp:`SP = ${c}×${100+p}/100 = ₹${sp}. MP = ${sp}×100/${100-d} = ₹${mp}. Excess = ₹${cv}`,sh:`₹${mp}-₹${c}=${cv}`}; },
        (_) => { const cp=P(150,400,0), sp=P(200,500,1); const p=sp-cp; const cp2=cp+P(20,100,2); const sp2=Math.round(cp2*(100+Math.round((sp-cp)/cp*100))/100); const cv=sp2-cp2; return {qt:`CP1=₹${cp}, SP1=₹${sp}. If CP rises by ₹${cp2-cp} and same profit%, new SP - new CP?`,cv,exp:`Profit% = ${Math.round((sp-cp)/cp*100)}%. New CP=₹${cp2}. SP2=₹${sp2}. Diff = ${cv}`,sh:`(SP1-CP1)/CP1 × CP2 = ${cv}`}; },
      ],
    },
    'Ratio and Proportion': {
      easy: [
        (_) => { const a=P(2,8,0), b=P(3,12,1), m=P(5,15,2); const cv=a*m; return {qt:`Ratio A:B = ${a}:${b}. B = ${b*m}. Find A.`,cv,exp:`A = ${a}×(${b*m}/${b}) = ${cv}`,sh:`${a}×${m} = ${cv}`}; },
        (_) => { const a=P(2,5,0), b=P(3,8,1), t=P(30,90,2); const cv=Math.round(t*a/(a+b)); return {qt:`₹${t} divided between A and B in ratio ${a}:${b}. A's share?`,cv,exp:`(${a}/${a+b})×${t} = ₹${cv}`,sh:`(${a}/${a+b})×${t}`}; },
        (_) => { const a=P(2,6,0), b=P(3,9,1), t=P(40,100,2); const cv=Math.round(t*b/(a+b)); return {qt:`₹${t} split A:B=${a}:${b}. B's share?`,cv,exp:`(${b}/${a+b})×${t} = ₹${cv}`,sh:`(${b}/${a+b})×${t}`}; },
        (_) => { const a=P(3,8,0), p=P(12,30,1); const cv=Math.round(p*a); return {qt:`Ratio 1:${a}. If first part is ${p}, find the ${a}nd part.`,cv,exp:`${p}×${a}/${1} = ${cv}`,sh:`${p}×${a}`}; },
        (_) => { const x=P(2,5,0), y=P(6,10,1); const cv=Math.round(x*100/y); return {qt:`Ratio ${x}:${y} expressed as first : 100. Find first term.`,cv,exp:`(${x}/${y})×100 = ${Math.round(x*100/y)}`,sh:`(${x}/${y})×100 = ${cv}`}; },
        (_) => { const a=P(2,4,0), b=P(5,8,1), c=P(10,15,2); const cv=a+b+c; return {qt:`If A=₹${a}, B=₹${b}, C=₹${c}, find ratio of total to A's amount.`,cv,exp:`Total = ${a+b+c}. Ratio = ${a+b+c}:${a}`,sh:`${a+b+c}:${a}`}; },
      ],
      medium: [
        (_) => { const a=P(3,9,0), b=P(5,12,1), c=P(6,15,2); const cv=a*c; return {qt:`a:b = ${a}:${b}, b:c = ${b}:${c}. a:c?`,cv,exp:`a:c = ${a}×${c} : ${b}×${b} = ${cv}:${b*b}`,sh:`${a}×${c} = ${cv}`}; },
        (_) => { const a=P(2,5,0), b=P(3,7,1), c=P(4,9,2), t=P(60,200,3); const s=a+b+c; const cv=Math.round(t*a/s); return {qt:`₹${t} divided A:B:C = ${a}:${b}:${c}. A's share?`,cv,exp:`(${a}/${s})×${t} = ₹${cv}`,sh:`(${a}/${s})×${t}`}; },
        (_) => { const a=P(2,5,0), b=P(3,7,1), t=P(50,150,2); const cv=Math.round(t*(b-a)/(a+b)); return {qt:`₹${t} in ratio ${a}:${b}. Difference between shares?`,cv,exp:`Diff = (${b-a}/${a+b})×${t} = ₹${cv}`,sh:`(${b-a}/${a+b})×${t}`}; },
        (_) => { const a=P(20,40,0), b=P(30,50,1), x=P(5,15,2); const cv=Math.round((a+x)/(b+x)*100); return {qt:`A:B = ${a}:${b}. If ${x} added to both, new ratio? (A/newB ×100)`,cv,exp:`New = ${a+x}:${b+x}. (${a+x})/(${b+x})×100 = ${cv}%`,sh:`(${a+x})/(${b+x})×100`}; },
        (_) => { const a=P(2,5,0), b=P(3,6,1), t=P(40,90,2); const cv=Math.round(t*a/(a+b)); const cv2=t-cv; return {qt:`₹${t} split ${a}:${b}. Difference between larger and smaller?`,cv,exp:`Smaller = ₹${Math.min(cv,cv2)}, Larger = ₹${Math.max(cv,cv2)}. Diff = ₹${Math.abs(cv-cv2)}`,sh:`₹${Math.abs(t*a/(a+b)-t*b/(a+b))}`}; },
        (_) => { const a=P(3,7,0), b=P(5,9,1), t=P(80,180,2); const cv=Math.round(t*b/(a+b)); return {qt:`${t} liters in ratio ${a}:${b}. Larger part?`,cv,exp:`Larger = (${Math.max(a,b)}/${a+b})×${t} = ${cv}`,sh:`(${Math.max(a,b)}/${a+b})×${t}`}; },
      ],
      hard: [
        (_) => { const t=P(60,200,0), a=P(2,5,1), b=P(3,7,2), c=P(4,9,3); const s=a+b+c; const cv=Math.round(t*a/s); return {qt:`₹${t} divided A:B:C = ${a}:${b}:${c}. A's share?`,cv,exp:`(${a}/${s})×${t} = ₹${cv}`,sh:`(${a}/${s})×${t} = ₹${cv}`}; },
        (_) => { const x=P(2,6,0), y=P(3,8,1), d=P(10,40,2); const cv=Math.round(d*x/(x+y)); return {qt:`${d} pens shared in ratio ${x}:${y}. Smaller share?`,cv,exp:`(${Math.min(x,y)}/${x+y})×${d} = ${cv}`,sh:`Use smaller ratio part / total ratio × total`}; },
        (_) => { const i=P(3000,8000,0), e=P(2000,5000,1); const r=Math.round(i/e); const cv=Math.round((i+P(500,2000,2))/(e+P(300,1000,3))); return {qt:`Income:Exp=${i}:${e}. Income↑₹${P(500,2000,2)}, Exp↑₹${P(300,1000,3)}. New ratio (rounded)?`,cv,exp:`Old ratio = ${i}:${e}. New = ${i+P(500,2000,2)}:${e+P(300,1000,3)} = ${cv}`,sh:`New ratio ≈ ${cv}`}; },
        (_) => { const c=P(100,300,0), d=P(5,25,1), add=P(5,20,2); const oc=c, od=d; const nc=c+add, nd=d+add; const cv=Math.round(oc/od*100)-Math.round(nc/nd*100); return {qt:`Coffee:milk ${c}:${d}. Add ${add} units of each. Change in coffee %?`,cv,exp:`Before: ${Math.round(c/(c+d)*100)}%. After: ${Math.round((c+add)/(c+d+2*add)*100)}%. Diff = ${cv}%`,sh:`${Math.round(c/(c+d)*100)}-${Math.round((c+add)/(c+d+2*add)*100)}`}; },
        (_) => { const d1=P(1,5,0), d2=P(2,5,1), v1=P(20,50,2), v2=P(30,60,3); const t=v1*d1+v2*d2; const cv=Math.round(t/(v1+v2)*10)/10; return {qt:`${d1}L @₹${v1}/L + ${d2}L @₹${v2}/L. Mean price/L? (1 decimal)`,cv,exp:`Mix = (${v1}×${d1}+${v2}×${d2})/(${d1+d2}) = ${cv}`,sh:`Weighted avg = ${cv}`}; },
        (_) => { const a=P(10,30,0), b=P(20,40,1), c=P(30,60,2); const s=a+b+c; const cv=Math.round(c*100/s); return {qt:`A=${a}, B=${b}, C=${c}. C's share in total as %?`,cv,exp:`Total = ${s}. C% = (${c}/${s})×100 = ${cv}%`,sh:`(${c}/${s})×100`}; },
      ],
    },
    'Time and Work': {
      easy: [
        (_) => { const a=P(4,10,0), b=P(6,14,1); const cv=Math.round(a*b/(a+b)); return {qt:`A: ${a} days, B: ${b} days. Together?`,cv,exp:`AB/(A+B) = ${a*b}/(${a+b}) = ${cv} days`,sh:`(${a}×${b})/(${a}+${b}) = ${cv}`}; },
        (_) => { const a=P(6,12,0), t=P(3,6,1); const cv=Math.round(a*t/(t-a)); return {qt:`A alone ${a} days, A+B together ${t} days. B alone?`,cv,exp:`1/B = 1/${t} - 1/${a} = ${(1/t-1/a).toFixed(3)}. B = ${cv}`,sh:`B = (${a}×${t})/(${a}-${t}) = ${cv}`}; },
        (_) => { const a=P(8,16,0), b=P(6,14,1); const cv=Math.round(b*a/(b-a)); return {qt:`A+B finish in ${a} days. B alone in ${b} days. A alone?`,cv,exp:`1/A = 1/${a} - 1/${b}. A = ${cv} days`,sh:`A = (${a}×${b})/(${b}-${a}) = ${cv}`}; },
        (_) => { const a=P(10,20,0), t=P(4,8,1); const cv=Math.round(1/(t/100-1/a)); return {qt:`A does ${a}% of work in ${t} days. Full work takes A?`,cv,exp:`${t} days = ${a}% → 100% = (${t}/${a})×100 = ${cv} days`,sh:`(${t}×100)/${a} = ${cv}`}; },
        (_) => { const a=P(5,10,0), b=P(10,15,1); const cv=Math.round(a*b/(a+b)); const f=P(2,5,2); const cv2=Math.round(f/cv); return {qt:`A:${a}d, B:${b}d. ${f}/${cv} part in how many days together?`,cv,exp:`Together = ${cv}d. Time = (${f}/${cv})×${cv} = ${cv2}d`,sh:`${f}/${a*b/(a+b)} = ${cv2}`}; },
        (_) => { const a=P(6,12,0); const cv=Math.round(a/2); return {qt:`A takes ${a} days. Half the work by A takes?`,cv,exp:`Half work = ${a}/2 = ${cv} days`,sh:`${a}/2 = ${cv}`}; },
      ],
      medium: [
        (_) => { const a=P(5,10,0), b=P(8,15,1), c=P(10,20,2); const cv=Math.round(1/(1/a+1/b-1/c)); return {qt:`A ${a}d, B ${b}d, C destroys in ${c}d. Together?`,cv,exp:`Rate = 1/${a}+1/${b}-1/${c}. Time = ${cv}d`,sh:`1/(1/${a}+1/${b}-1/${c})`}; },
        (_) => { const a=P(5,10,0), b=P(8,14,1), d=P(8,16,2); const cv=Math.round(1/(1/a+1/b+1/d)); return {qt:`Pipe A fills in ${a}h, B in ${b}h, C drains in ${d}h. All 3 open, time to fill?`,cv,exp:`Net rate = 1/${a}+1/${b}-1/${d} = ${(1/a+1/b-1/d).toFixed(3)}. Time = ${cv}h`,sh:`1/(1/${a}+1/${b}-1/${d}) = ${cv}`}; },
        (_) => { const a=P(8,15,0), b=P(10,18,1), d=P(2,4,2), rem=1-d/a; const cv=Math.round(rem/(1/a+1/b)); return {qt:`A:${a}h, B:${b}h. A works ${d}h then B joins. More hours?`,cv,exp:`Remaining = 1-${d}/${a}. Time = ${rem.toFixed(2)}/(1/${a}+1/${b}) = ${cv}h`,sh:`Remaining / combined rate`}; },
        (_) => { const a=P(5,9,0), b=P(7,12,1); const eff=Math.round(1/b*100/(1/a)); const cv=Math.round(eff); return {qt:`A:${a}d, B:${b}d. B's efficiency as % of A's?`,cv,exp:`A's 1-day = 1/${a}, B's = 1/${b}. B/A = (1/${b})/(1/${a}) = ${a}/${b} = ${Math.round(a/b*100)}%`,sh:`(${a}/${b})×100 = ${cv}%`}; },
        (_) => { const a=P(8,15,0), b=P(10,18,1), w=P(1000,3000,2); const ac=Math.round(w/a), bc=Math.round(w/b); const cv=ac-bc; return {qt:`Total wages ₹${w}. A:${a}d, B:${b}d. A's daily wage minus B's?`,cv,exp:`A daily = ₹${ac}, B daily = ₹${bc}. Diff = ₹${cv}`,sh:`₹${w}/${a} - ₹${w}/${b} = ${cv}`}; },
        (_) => { const a=P(10,20,0), b=P(12,18,1); const t=Math.round(a*b/(a+b)); const cv=Math.round((1/t-1/(a+b))*a*b); return {qt:`A:${a}d, B:${b}d. Together for ${t} days. Work fraction remaining?`,cv,exp:`Fraction done = ${t}/a + ${t}/b. Remaining = 1 - (${t}/a+${t}/b) = ${Math.round((1-t/a-t/b)*100)}%`,sh:`1 - (${t}/a+${t}/b)`}; },
      ],
      hard: [
        (_) => { const a=P(6,12,0), b=P(8,16,1), d=P(2,5,2), rem=1-d/a; const cv=Math.round(rem/(1/a+1/b)); return {qt:`A:${a}d, B:${b}d. A works ${d}d then B joins. More days needed?`,cv,exp:`Remaining = 1-${d}/${a}. Time = ${rem.toFixed(2)}/(1/${a}+1/${b}) = ${cv}d`,sh:`Remaining / combined rate`}; },
        (_) => { const a=P(8,15,0), b=P(12,20,1), c=P(15,25,2); const cv=Math.round(1/(1/a+1/b+1/c)); return {qt:`A:${a}d, B:${b}d, C:${c}d. All three together?`,cv,exp:`1/(1/${a}+1/${b}+1/${c}) = ${cv}d`,sh:`1/(1/${a}+1/${b}+1/${c})`}; },
        (_) => { const a=P(6,10,0), b=P(8,14,1), d=P(2,4,2); const ra=1/a, rb=1/b; const cv=Math.round((1-d*ra)/(ra+rb)); return {qt:`A:${a}d, B:${b}d. A works ${d}d, then B alone finishes. Total days?`,cv,exp:`Remaining = 1-${d}/${a}. B time = ${Math.round((1-d/a)/(1/b))}. Total = ${d}+${Math.round((1-d/a)/(1/b))} = ${cv}`,sh:`${d}+(1-${d}/${a})×${b}`}; },
        (_) => { const a=P(6,10,0), b=P(8,12,1), c=P(10,15,2); const cv=Math.round((1/a+1/b+1/c)*100); return {qt:`A:${a}h, B:${b}h, C:${c}h. Combined % of work done per hour?`,cv,exp:`Rate = 1/${a}+1/${b}+1/${c} = ${(1/a+1/b+1/c).toFixed(3)}. % = ${Math.round((1/a+1/b+1/c)*100)}%/h`,sh:`(1/${a}+1/${b}+1/${c})×100 = ${cv}%`}; },
        (_) => { const a=P(10,18,0), b=P(12,20,1); const ra=1/a, rb=1/b; const day2=ra+rb; const cv=Math.round(1/day2); return {qt:`A:${a}d, B:${b}d. Alternate days starting with A. Days to finish?`,cv,exp:`2-day work = 1/${a}+1/${b}. Days = 2×(${1/day2.toFixed(2)}) ≈ ${cv}`,sh:`2/(1/${a}+1/${b}) = ${cv}`}; },
        (_) => { const m=P(10,20,0), d=P(8,15,1); const md=m*d; const m2=m-P(2,5,3); const cv=Math.round(md/m2); return {qt:`${m} workers, ${d} days. If ${m2} workers remain, days needed?`,cv,exp:`Total work = ${m}×${d} = ${md} worker-days. Days = ${md}/${m2} = ${cv}`,sh:`${md}/${m2} = ${cv}`}; },
      ],
    },
    'Time, Speed and Distance': {
      easy: [
        (_) => { const sp=P(30,70,0), t=P(2,5,1); const cv=sp*t; return {qt:`Speed ${sp} km/h for ${t}h. Distance?`,cv,exp:`${sp}×${t} = ${cv} km`,sh:`${sp}×${t} = ${cv}`}; },
        (_) => { const d=P(100,300,0), t=P(2,5,1); const cv=Math.round(d/t); return {qt:`Covers ${d} km in ${t}h. Speed?`,cv,exp:`${d}/${t} = ${cv} km/h`,sh:`${d}/${t} = ${cv}`}; },
        (_) => { const sp=P(40,80,0), d=P(120,400,1); const cv=Math.round(d/sp); return {qt:`At ${sp} km/h, time to cover ${d} km?`,cv,exp:`${d}/${sp} = ${cv} h`,sh:`${d}/${sp}`}; },
        (_) => { const d1=P(60,120,0), d2=P(60,120,1); const cv=Math.round((d1+d2)/(2)); return {qt:`First half ${d1}m, second half ${d2}m. Average of 2 distances?`,cv,exp:`(${d1}+${d2})/2 = ${cv} m`,sh:`(${d1}+${d2})/2`}; },
        (_) => { const sp=P(18,72,0); const cv=Math.round(sp*5/18); return {qt:`${sp} km/h = ? m/s`,cv,exp:`${sp}×(5/18) = ${cv} m/s`,sh:`${sp}×5/18`}; },
        (_) => { const sp=P(10,40,0); const cv=Math.round(sp*18/5); return {qt:`${sp} m/s = ? km/h`,cv,exp:`${sp}×(18/5) = ${cv} km/h`,sh:`${sp}×18/5`}; },
      ],
      medium: [
        (_) => { const sp=P(30,60,0), d=P(150,350,1); const cv=Math.round(d/sp*60); return {qt:`Covers ${d} km at ${sp} km/h. Time in minutes?`,cv,exp:`(${d}/${sp})×60 = ${cv} min`,sh:`(${d}/${sp})×60`}; },
        (_) => { const d=P(200,500,0), t=P(3,6,1); const cv=Math.round(d/t); return {qt:`${d} km in ${t}h. Speed in m/s?`,cv,exp:`Speed = ${d}/${t} = ${Math.round(d/t)} km/h = ${Math.round(d/t*5/18)} m/s`,sh:`(${d}/${t})×5/18`}; },
        (_) => { const d=P(100,300,0), t1=P(2,4,1), t2=P(3,5,2); const s1=d/t1, s2=d/t2; const cv=Math.round(2*d/(t1+t2)); return {qt:`${d} km at ${Math.round(s1)}km/h then ${d} km at ${Math.round(s2)}km/h. Avg speed?`,cv,exp:`Avg = 2×${d}/(${t1}+${t2}) = ${cv} km/h`,sh:`2D/(T1+T2) = ${cv}`}; },
        (_) => { const d=P(120,300,0), a=P(30,50,1), b=P(40,60,2); const cv=Math.round(d/(a+b)); return {qt:`${d} km apart, A=${a} km/h, B=${b} km/h towards. Meeting distance from A's start?`,cv,exp:`Time = ${d}/(${a}+${b}) = ${(d/(a+b)).toFixed(1)}h. Distance from A = ${a}×${(d/(a+b)).toFixed(1)} = ${cv} km`,sh:`${a}×(${d}/(${a}+${b})) = ${cv}`}; },
        (_) => { const d=P(100,250,0), t=P(2,5,1); const cv=Math.round(d/t); return {qt:`Cyclist covers ${d} km. If speed increased by 5 km/h, time reduces by 1h. Original speed?`,cv,exp:`Let s be speed. ${d}/s - ${d}/(s+5) = 1. Solving: s²+5s-${d*5}=0 → s=${cv}`,sh:`Solve ${d}/s-${d}/(s+5)=1`}; },
        (_) => { const d=P(200,400,0), sp=P(40,70,1); const cv=Math.round(d/sp*60); return {qt:`${d} km at ${sp} km/h with two 15-min breaks. Total journey time (min)?`,cv,exp:`Travel time = ${d/sp}×60 = ${Math.round(d/sp*60)} min. Total = ${Math.round(d/sp*60)}+30 = ${cv} min`,sh:`(${d}/${sp}×60)+30 = ${cv}`}; },
      ],
      hard: [
        (_) => { const d=P(300,900,0), a=P(40,70,1), b=P(30,60,2); const cv=Math.round(d/(a+b)*60); return {qt:`${d} km apart, A=${a} km/h, B=${b} km/h towards. Meet after? (min)`,cv,exp:`Rel speed = ${a+b} km/h. Time = (${d}/${a+b})×60 = ${cv} min`,sh:`(${d}/${a+b})×60`}; },
        (_) => { const d=P(150,400,0), a=P(40,60,1), b=P(30,50,2); const cv=Math.round(d/Math.abs(a-b)*60); return {qt:`${d} km apart, A=${a} km/h, B=${b} km/h same direction. Overtake after? (min)`,cv,exp:`Rel speed = ${Math.abs(a-b)} km/h. Time = (${d}/${Math.abs(a-b)})×60 = ${cv} min`,sh:`(${d}/${Math.abs(a-b)})×60`}; },
        (_) => { const l=P(100,300,0), sp=P(40,80,1); const cv=Math.round((l+sp*10)/sp*18/5); return {qt:`Train ${l}m long at ${sp} km/h crosses a ${Math.round(sp*10)}m platform. Time (s)?`,cv,exp:`Total dist = ${l+Math.round(sp*10)}m. Speed = ${sp}×5/18 = ${Math.round(sp*5/18)} m/s. Time = ${Math.round((l+Math.round(sp*10))/(sp*5/18))}s`,sh:`(${l+Math.round(sp*10)})/(${sp}×5/18)`}; },
        (_) => { const sp=P(10,20,0), st=P(5,10,1); const up=sp-st, down=sp+st; const d=P(30,80,2); const cv=Math.round(d*(1/up+1/down)); return {qt:`Boat speed ${sp} km/h, stream ${st} km/h. ${d} km upstream & back. Total time?`,cv,exp:`Up time = ${d}/${up}h, Down = ${d}/${down}h. Total = ${cv}h`,sh:`${d}/(${sp}-${st})+${d}/(${sp}+${st}) = ${cv}`}; },
        (_) => { const l1=P(100,250,0), l2=P(150,300,1), s1=P(40,70,2), s2=P(50,80,3); const rs=s1*5/18+s2*5/18; const cv=Math.round((l1+l2)/rs); return {qt:`Train1 ${l1}m at ${s1}km/h, Train2 ${l2}m at ${s2}km/h opposite. Cross each other (s)?`,cv,exp:`Rel speed = ${s1+s2}×5/18 = ${Math.round(rs)} m/s. Time = (${l1+l2})/${Math.round(rs)} = ${cv}s`,sh:`(${l1+l2})/((${s1}+${s2})×5/18)`}; },
        (_) => { const d=P(60,150,0), a=P(30,50,1), b=P(35,55,2); const t=Math.round(d/(a+b)*60); const cv=Math.round(a*t/60); return {qt:`A=${a}km/h, B=${b}km/h, ${d}km apart towards. Distance A travels before meeting?`,cv,exp:`Time to meet = ${d}/(${a}+${b}) = ${t} min. A's distance = ${a}×(${t}/60) = ${cv} km`,sh:`${a}×(${d}/(${a}+${b})) = ${cv}`}; },
      ],
    },
    'Number System': {
      easy: [
        (_) => { const a=P(15,90,0), b=P(8,22,1); const cv=a+b; return {qt:`What is ${a} + ${b}?`,cv,exp:`${a}+${b} = ${cv}`,sh:`Simple addition`}; },
        (_) => { const a=P(12,50,0), b=P(4,11,1); const cv=Math.floor(a/b); return {qt:`Quotient when ${a} ÷ ${b}?`,cv,exp:`${b}×${cv} = ${b*cv}, remainder ${a-b*cv}`,sh:`${Math.floor(a/b)}`}; },
        (_) => { const d=P(2,9,0), u=P(1,9,1); const cv=d*10+u; return {qt:`${d} tens + ${u} units = ?`,cv,exp:`${d}×10+${u} = ${cv}`,sh:`${d}×10+${u}`}; },
        (_) => { const a=P(10,50,0), b=P(2,9,1); const cv=a%b; return {qt:`Remainder when ${a} ÷ ${b}?`,cv,exp:`${b}×${Math.floor(a/b)} = ${b*Math.floor(a/b)}. ${a} - ${b*Math.floor(a/b)} = ${cv}`,sh:`${a}%${b} = ${cv}`}; },
        (_) => { const a=P(2,9,0), b=P(0,9,1); const cv=a*100+b*10+a; return {qt:`3-digit number: hundreds & units = ${a}, tens = ${b}. The number?`,cv,exp:`${a}×100+${b}×10+${a} = ${cv}`,sh:`${a}${b}${a} = ${cv}`}; },
        (_) => { const a=P(1,9,0), b=P(1,9,1); const cv=a*10+b; const s=a+b; return {qt:`Two-digit number, sum of digits = ${s}, tens = ${a}. The number?`,cv,exp:`${a}×10+${s-a} = ${cv}`,sh:`${a}×10+${s-a}`}; },
      ],
      medium: [
        (_) => { const a=P(12,50,0), b=P(4,11,1); const cv=Math.floor(a/b); const r=a-b*cv; return {qt:`Quotient & remainder when ${a} ÷ ${b}?`,cv,exp:`${b}×${cv}+${r} = ${a}`,sh:`Quotient = ${cv}`}; },
        (_) => { const n=P(15,60,0), d=P(2,7,1); const cv=n*d; return {qt:`A number divided by ${d} gives ${n}. The number?`,cv,exp:`${d}×${n} = ${cv}`,sh:`${d}×${n}`}; },
        (_) => { const n=P(50,120,0); const cv=n%2===0?1:0; return {qt:`Is ${n} even? (1 for yes, 0 for no)`,cv,exp:`${n}%2 = ${n%2}. ${n%2===0?'Yes':'No'}`,sh:`Check last digit`}; },
        (_) => { const a=P(10,50,0), b=P(2,9,1); const cv=Math.floor((a+b-1)/b); return {qt:`Smallest number ≥ ${a} divisible by ${b}?`,cv,exp:`${a}/${b} = ${(a/b).toFixed(1)}. Next = ${Math.ceil(a/b)}×${b} = ${cv}`,sh:`ceil(${a}/${b})×${b}`}; },
        (_) => { const a=P(10,50,0), b=P(5,10,1); const cv=Math.floor(a/b)*b; return {qt:`Largest number ≤ ${a} divisible by ${b}?`,cv,exp:`${a}/${b} = ${(a/b).toFixed(1)}. ${Math.floor(a/b)}×${b} = ${cv}`,sh:`floor(${a}/${b})×${b}`}; },
        (_) => { const a=P(10,99,0); const cv=Math.floor(a/10)+a%10; return {qt:`Sum of digits of ${a}?`,cv,exp:`Digits: ${Math.floor(a/10)} and ${a%10}. Sum = ${cv}`,sh:`${Math.floor(a/10)}+${a%10}`}; },
      ],
      hard: [
        (_) => { const n=P(3,7,0), a=P(3,9,1), d=P(4,12,2); const l=a+(n-1)*d; const cv=n*(a+l)/2; return {qt:`Sum of ${n} terms of AP: start=${a}, diff=${d}?`,cv,exp:`Sum = ${n}/2×(${a}+${l}) = ${cv}`,sh:`${n}/2×[2×${a}+(${n-1})×${d}]`}; },
        (_) => { const c=P(10,90,0), d=P(2,9,1); const t=c/d; const r=c% d; return {qt:`${c} ÷ ${d}: quotient?`,cv,exp:`${d}×${t} + ${r} = ${c}. Quotient = ${t}`,sh:`${t} remainder ${r}`}; },
        (_) => { const x=P(1,9,0), y=P(1,9,1); const n=x*10+y, rev=y*10+x; const cv=Math.abs(n-rev); return {qt:`Two-digit number ${n}, digits differ by ${Math.abs(x-y)}. Difference with reverse?`,cv,exp:`${n} - ${rev} = ${Math.abs(n-rev)}`,sh:`9×|${x}-${y}| = ${cv}`}; },
        (_) => { const n=P(10,99,0); const cv=n+parseInt(String(n).split('').reverse().join('')); return {qt:`${n} + its reverse = ?`,cv,exp:`Reverse = ${String(n).split('').reverse().join('')}. Sum = ${n+parseInt(String(n).split('').reverse().join(''))}`,sh:`Add reverse`}; },
        (_) => { const b=P(2,9,0), p=P(2,5,1); const cv=Math.pow(b,p)%10; return {qt:`Unit digit of ${b}^${p}?`,cv,exp:`Cyclicity of ${b} = ${b%10===0||b%10===1||b%10===5||b%10===6?1:b%10===4||b%10===9?2:4}. Unit digit = ${cv}`,sh:`Cyclicity method`}; },
        (_) => { const n=P(2,9,0); const cv=n*111; return {qt:`${n} + ${n*10+n} + ${n*100+n*10+n} = ?`,cv,exp:`${n}+${n*10+n}+${n*100+n*10+n} = ${n}×123 = ${cv}`,sh:`${n}×123 = ${cv}`}; },
      ],
    },
    'Simplification': {
      easy: [
        (_) => { const a=P(20,80,0), b=P(2,9,1); const cv=Math.round(a/b); return {qt:`${a} ÷ ${b} = ?`,cv,exp:`${a}/${b} = ${cv}`,sh:`${a}÷${b} = ${cv}`}; },
        (_) => { const a=P(12,30,0), b=P(3,10,1); const cv=a+b; return {qt:`${a} + ${b} = ?`,cv,exp:`${a}+${b} = ${cv}`,sh:`Simple addition`}; },
        (_) => { const a=P(3,12,0), b=P(4,15,1); const cv=a*b; return {qt:`${a} × ${b} = ?`,cv,exp:`${a}×${b} = ${cv}`,sh:`${a}×${b}`}; },
        (_) => { const a=P(2,9,0), b=P(2,9,1), c=P(2,9,2); const cv=Math.round(a*b/c); return {qt:`(${a} × ${b}) ÷ ${c} = ?`,cv,exp:`(${a*b})/${c} = ${cv}`,sh:`${a}×${b}÷${c} = ${cv}`}; },
        (_) => { const a=P(10,50,0), p=P(10,50,1); const cv=Math.round(a*p/100); return {qt:`${p}% of ${a} = ?`,cv,exp:`(${p}/100)×${a} = ${cv}`,sh:`${a}×${p}/100 = ${cv}`}; },
        (_) => { const a=P(2,12,0); const cv=a*a; return {qt:`${a}² = ?`,cv,exp:`${a}×${a} = ${cv}`,sh:`${a}^2 = ${cv}`}; },
      ],
      medium: [
        (_) => { const a=P(12,30,0), b=P(2,8,1), c=P(3,7,2); const cv=Math.round(a*b/c); return {qt:`(${a} × ${b}) ÷ ${c} = ?`,cv,exp:`(${a*b})/${c} = ${cv}`,sh:`${a}×${b}÷${c}`}; },
        (_) => { const a=P(10,25,0), b=P(2,7,1), c=P(2,6,2); const cv=Math.round((a+b)/c); return {qt:`(${a} + ${b}) ÷ ${c} = ?`,cv,exp:`(${a+b})/${c} = ${cv}`,sh:`(${a}+${b})÷${c}`}; },
        (_) => { const a=P(5,15,0), b=P(2,8,1); const cv=a*b+P(2,9,2); return {qt:`${a} × ${b} + ${P(2,9,2)} = ?`,cv,exp:`${a*b} + ${P(2,9,2)} = ${cv}`,sh:`${a}×${b}+${P(2,9,2)}`}; },
        (_) => { const a=P(4,16,0); const cv=Math.round(Math.sqrt(a)); return {qt:`√${a} = ?`,cv,exp:`${Math.round(Math.sqrt(a))}² = ${a}`,sh:`√${a} = ${cv}`}; },
        (_) => { const a=P(2,5,0), b=P(3,7,1), c=P(2,5,2); const cv=Math.round((a+b)*c); return {qt:`(${a}+${b}) × ${c} = ?`,cv,exp:`(${a+b})×${c} = ${cv}`,sh:`(${a}+${b})×${c}`}; },
        (_) => { const a=P(5,20,0), b=P(2,8,1); const cv=a*a+b; return {qt:`${a}² + ${b} = ?`,cv,exp:`${a*a}+${b} = ${cv}`,sh:`${a}^2 + ${b}`}; },
      ],
      hard: [
        (_) => { const a=P(2,6,0), b=P(2,5,1), c=P(3,8,2); const r=(a+b)*c; const cv=r-a*c; return {qt:`(${a}+${b})×${c} - ${a}×${c} = ?`,cv,exp:`(${a+b})×${c} - ${a*c} = ${cv}`,sh:`Simplify: ${a+b}×${c} - ${a*c}`}; },
        (_) => { const a=P(5,15,0), b=P(2,6,1); const cv=a*a-b*b; return {qt:`${a}² - ${b}² = ?`,cv,exp:`${a*a} - ${b*b} = ${cv}`,sh:`${a}² - ${b}² = ${cv}`}; },
        (_) => { const a=P(3,8,0), b=P(2,5,1); const cv=a*a+2*a*b+b*b; return {qt:`(${a}+${b})² = ?`,cv,exp:`${a}²+2×${a}×${b}+${b}² = ${a*a}+${2*a*b}+${b*b} = ${cv}`,sh:`(${a}+${b})²`}; },
        (_) => { const a=P(5,12,0), b=P(2,6,1); const cv=(a+b)*(a-b); return {qt:`(${a}+${b})(${a}-${b}) = ?`,cv,exp:`${a}²-${b}² = ${a*a}-${b*b} = ${cv}`,sh:`Difference of squares`}; },
        (_) => { const a=P(4,10,0), b=P(3,8,1), c=P(2,6,2); const cv=Math.round((a+b*c)/(a-b)); return {qt:`(${a}+${b}×${c}) ÷ (${a}-${b}) = ?`,cv,exp:`Numerator = ${a+b*c}, Denominator = ${a-b}. ${a+b*c}÷${a-b} = ${cv}`,sh:`BODMAS: brackets first`}; },
        (_) => { const a=P(2,5,0), b=P(2,5,1), c=P(1,4,2); const cv=a*b+b*c+a*c; return {qt:`${a}×${b} + ${b}×${c} + ${a}×${c} = ?`,cv,exp:`${a*b}+${b*c}+${a*c} = ${cv}`,sh:`Compute each term`}; },
      ],
    },
    'Averages': {
      easy: [
        (_) => { const n=P(3,6,0), av=P(15,35,1); const cv=av*n; return {qt:`Average of ${n} nos = ${av}. Sum?`,cv,exp:`${av}×${n} = ${cv}`,sh:`${av}×${n} = ${cv}`}; },
        (_) => { const n=P(3,5,0); const v=Array.from({length:n},(_,i)=>P(10,40,2+i)); const s=v.reduce((a,b)=>a+b,0); const cv=Math.round(s/n); return {qt:`Numbers: ${v.join(', ')}. Average?`,cv,exp:`(${v.join('+')})/${n} = ${s}/${n} = ${cv}`,sh:`Sum/Count = ${cv}`}; },
        (_) => { const n=P(3,8,0); const cv=Math.round((n*(n+1)/2)/n); return {qt:`Average of first ${n} natural numbers?`,cv,exp:`Sum = ${n*(n+1)/2}. Avg = (${n*(n+1)/2})/${n} = ${cv}`,sh:`(${n}+1)/2 = ${cv}`}; },
        (_) => { const n=P(4,8,0); const v=Array.from({length:n-1},(_,i)=>P(10,50,10+i)); const s=v.reduce((a,b)=>a+b,0); const t=P(20,40,1); const cv=n*t-s; return {qt:`Avg of ${n} numbers = ${t}. The first ${n-1} are ${v.join(', ')}. Last number?`,cv,exp:`Sum of all = ${n*t}. Sum of first ${n-1} = ${s}. Last = ${n*t}-${s} = ${cv}`,sh:`${n}×${t} - ${v.join('+')}`}; },
        (_) => { const a=P(15,25,0), b=P(25,35,1); const cv=Math.round((a+b)/2); return {qt:`Average of ${a} and ${b}?`,cv,exp:`(${a}+${b})/2 = ${cv}`,sh:`(${a}+${b})/2`}; },
        (_) => { const a=P(20,50,0), b=P(10,40,1); const cv=Math.round((a*5+b*3)/8); return {qt:`${a} (weight 5) and ${b} (weight 3). Weighted mean?`,cv,exp:`(${a}×5+${b}×3)/(5+3) = ${cv}`,sh:`Weighted average`}; },
      ],
      medium: [
        (_) => { const n=P(4,6,0), a=P(20,40,1), x=P(30,60,2); const ns=a*n+x; const cv=Math.round(ns/(n+1)); return {qt:`Avg of ${n} nos = ${a}. ${x} added. New avg?`,cv,exp:`(${a*n}+${x})/${n+1} = ${cv}`,sh:`(${a*n}+${x})/${n+1} = ${cv}`}; },
        (_) => { const n=P(3,6,0), a=P(15,35,1), x=P(5,20,2); const ns=a*n-x; const cv=Math.round(ns/(n-1)); return {qt:`Avg of ${n} nos = ${a}. One '${x}' removed. New avg?`,cv,exp:`(${a*n}-${x})/${n-1} = ${cv}`,sh:`(${a*n}-${x})/${n-1}`}; },
        (_) => { const n=P(4,7,0), a=P(20,40,1); const x=P(5,20,2); const cv=Math.round((a*n+x*2)/(n+2)); return {qt:`Avg of ${n} = ${a}. Two numbers avg ${x} added. New avg?`,cv,exp:`(${a*n}+${x*2})/${n+2} = ${cv}`,sh:`(${a*n}+${x*2})/${n+2}`}; },
        (_) => { const a=P(15,30,0), b=P(25,45,1), n1=P(3,5,2), n2=P(4,7,3); const cv=Math.round((a*n1+b*n2)/(n1+n2)); return {qt:`Group1 avg ${a} (n=${n1}), Group2 avg ${b} (n=${n2}). Combined avg?`,cv,exp:`(${a*n1}+${b*n2})/(${n1}+${n2}) = ${cv}`,sh:`(${a*n1}+${b*n2})/(${n1}+${n2})`}; },
        (_) => { const n=P(3,6,0), a=P(15,30,1), x=P(25,50,2); const ns=a*n+x; const cv=Math.round(ns/(n+1)); return {qt:`Avg age of ${n} = ${a}. New person age ${x} joins. New avg?`,cv,exp:`(${a*n}+${x})/${n+1} = ${cv}`,sh:`(${a*n}+${x})/${n+1}`}; },
        (_) => { const n=P(3,5,0), a=P(15,30,1); const s=a*n; const x=P(10,25,2); const ns=s-x; const cv=Math.round(ns/(n-1)); return {qt:`Avg of ${n} scores = ${a}. Lowest ${x} dropped. New avg?`,cv,exp:`(${a*n}-${x})/${n-1} = ${cv}`,sh:`(${a*n}-${x})/${n-1}`}; },
      ],
      hard: [
        (_) => { const n=P(4,7,0), a=P(25,50,1), r=P(15,40,2), x=P(40,70,3); const cv=Math.round(a+(x-r)/n); return {qt:`Avg ${n} nos = ${a}. ${r} replaced by ${x}. New avg?`,cv,exp:`New avg = ${a}+(${x}-${r})/${n} = ${cv}`,sh:`${a}+(${x}-${r})/${n}`}; },
        (_) => { const n=P(3,6,0), a=P(20,40,1), x=P(10,25,2), r=P(30,50,3); const cv=Math.round((a*n+x-r)/n); return {qt:`Avg of ${n} = ${a}. Add ${x}, remove ${r}. New avg?`,cv,exp:`(${a*n}+${x}-${r})/${n} = ${cv}`,sh:`(${a*n}+${x}-${r})/${n}`}; },
        (_) => { const a=P(20,40,0), b=P(30,60,1); const na=P(4,7,2), nb=P(3,6,3); const cv=Math.round((a*na+b*nb)/(na+nb)); return {qt:`Class A avg ${a} (${na} students), B avg ${b} (${nb} students). Combined avg?`,cv,exp:`(${a*na}+${b*nb})/(${na}+${nb}) = ${cv}`,sh:`Weighted average = ${cv}`}; },
        (_) => { const m=P(20,40,0), n=P(3,6,1), f=P(20,40,2); const sm=m*n; const sf=f; const cv=Math.round((sm+sf)/(n+1)); return {qt:`${n} numbers avg = ${m}. A new number ${f} added exactly equals old avg? New avg?`,cv,exp:`(${m*n}+${f})/${n+1} = ${cv}`,sh:`(${m*n}+${f})/${n+1}`}; },
        (_) => { const n=P(4,7,0), a=P(25,45,1); const cv=Math.round(a*n-a); return {qt:`Avg of ${n} distinct numbers is ${a}. If one is zero, max possible avg of rest?`,cv,exp:`Max sum = ${a*n}. With one 0, rest sum = ${a*n}. New avg = ${a*n}/(${n-1}) = ${cv}`,sh:`(${a*n})/(${n-1})`}; },
        (_) => { const p=P(25,45,0), q=P(35,55,1); const cv=Math.round((p+q)/2); return {qt:`Average of ${p}% and ${q}%?`,cv,exp:`(${p}+${q})/2 = ${cv}%`,sh:`(${p}+${q})/2`}; },
      ],
    },
    'Mixtures and Allegations': {
      easy: [
        (_) => { const vA=P(10,50,0), cA=P(10,30,1), vB=P(10,50,2), cB=P(40,70,3); const tv=vA+vB; const cv=Math.round((vA*cA+vB*cB)/tv); return {qt:`${vA}L ${cA}% + ${vB}L ${cB}%. Mix concentration?`,cv,exp:`(${vA}×${cA}+${vB}×${cB})/${tv} = ${cv}%`,sh:`Weighted avg = ${cv}%`}; },
        (_) => { const qA=P(10,30,0), pA=P(20,50,1), qB=P(10,30,2), pB=P(60,100,3); const tq=qA+qB; const cv=Math.round((qA*pA+qB*pB)/tq); return {qt:`${qA}kg @₹${pA}/kg + ${qB}kg @₹${pB}/kg. Cost per kg?`,cv,exp:`(${qA}×${pA}+${qB}×${pB})/${tq} = ₹${cv}`,sh:`₹${cv}/kg`}; },
        (_) => { const vA=P(10,30,0), cA=P(30,50,1), vB=P(10,30,2), cB=P(50,90,3); const tv=vA+vB; const cv=Math.round((vA*cA+vB*cB)/tv); return {qt:`Mix ${vA}L of ${cA}% alcohol with ${vB}L of ${cB}% alcohol. Alcohol %?`,cv,exp:`(${vA}×${cA}+${vB}×${cB})/${tv} = ${cv}%`,sh:`Weighted avg = ${cv}%`}; },
        (_) => { const qA=P(10,25,0), pA=P(15,30,1), qB=P(10,25,2), pB=P(40,60,3); const tq=qA+qB; const cv=Math.round((qA*pA+qB*pB)/tq); return {qt:`${qA}g ₹${pA}/g + ${qB}g ₹${pB}/g gold alloy. Avg price/g?`,cv,exp:`(${qA*pA}+${qB*pB})/(${qA}+${qB}) = ₹${cv}`,sh:`₹${cv}/g`}; },
        (_) => { const v=P(20,50,0), c=P(10,20,1); const cv=Math.round(v*c/100); return {qt:`${v}L of ${c}% sugar solution. Amount of sugar?`,cv,exp:`(${c}/100)×${v} = ${cv} L`,sh:`${v}×${c}/100 = ${cv}`}; },
        (_) => { const a=P(10,30,0), b=P(20,50,1); const cv=Math.round((a+b)/2); return {qt:`Two alloys: 1st is ${a}% gold, 2nd is ${b}% gold. Equal quantities mixed. Gold %?`,cv,exp:`(${a}+${b})/2 = ${cv}%`,sh:`(${a}+${b})/2`}; },
      ],
      medium: [
        (_) => { const qA=P(10,30,0), pA=P(20,50,1), qB=P(10,30,2), pB=P(60,100,3); const tq=qA+qB; const cv=Math.round((qA*pA+qB*pB)/tq); return {qt:`${qA}kg ₹${pA}/kg + ${qB}kg ₹${pB}/kg tea. Avg price/kg?`,cv,exp:`(${qA*pA}+${qB*pB})/${tq} = ₹${cv}`,sh:`Weighted average = ₹${cv}`}; },
        (_) => { const tP=P(20,50,0), c1=P(10,20,1), c2=P(30,50,2); const r=Math.round((c2-tP)/(tP-c1)); const cv=r; return {qt:`Target ${tP}% conc. ${c1}% and ${c2}% mixed. Ratio (c2:c1) needed?`,cv,exp:`Allegation: (${c2}-${tP}):(${tP}-${c1}) = ${c2-tP}:${tP-c1} = ${Math.round((c2-tP)/P(Math.round((c2-tP)/Math.max(1,(tP-c1))),Math.max(1,(c2-tP)),99))}:${Math.round((tP-c1)/P(Math.round((c2-tP)/Math.max(1,(tP-c1))),Math.max(1,(c2-tP)),99))}. Ratio = ${cv}`,sh:`(${c2}-${tP})/(${tP}-${c1}) = ${(c2-tP)/(tP-c1)}`}; },
        (_) => { const v=P(20,50,0), c=P(20,40,1), r=P(5,15,2); const sol=Math.round((v-r)*c/100); const cv=Math.round(sol/(v)*100); return {qt:`${v}L ${c}% solution. ${r}L removed. New conc?`,cv,exp:`Solute = ${(v-r)*c/100}L. Conc = ${(v-r)*c/100}/${v-r}×${100} = ${c}% (unchanged)`,sh:`Concentration unchanged = ${c}%`}; },
        (_) => { const v=P(20,50,0), c=P(10,25,1), add=P(5,15,2), ac=P(50,90,3); const ts=Math.round(v*c/100+add*ac/100); const tv=v+add; const cv=Math.round(ts/tv*100); return {qt:`${v}L ${c}% + ${add}L pure (${ac}%). Final conc?`,cv,exp:`Solute = ${v*c/100}+${add*ac/100} = ${ts}. Total = ${tv}. Conc = ${ts}/${tv}×100 = ${cv}%`,sh:`(${v*c/100}+${add*ac/100})/${tv}×100`}; },
        (_) => { const v=P(20,50,0), c=P(20,40,1), r=P(5,15,2); const rem=v-r; const ts=Math.round(rem*c/100); const cv=Math.round(ts/v*100); return {qt:`${v}L of ${c}% milk. ${r}L removed, ${r}L water added. Milk %?`,cv,exp:`Milk left = (${v}-${r})L of ${c}% = ${ts}L. New conc = ${ts}/${v}×100 = ${cv}%`,sh:`(${v}-${r})×${c}/${v} = ${cv}%`}; },
        (_) => { const c1=P(10,20,0), c2=P(50,80,1), t=P(25,40,2); const r=Math.round((c2-t)/(t-c1)); const cv=r; return {qt:`Two types: ₹${c1}/kg and ₹${c2}/kg. Mix cost ₹${t}/kg. Ratio of cheaper:costlier?`,cv,exp:`Allegation: (${c2}-${t}):(${t}-${c1}) = ${c2-t}:${t-c1}. Ratio = ${cv}:1`,sh:`(${c2}-${t})/(${t}-${c1}) = ${cv}`}; },
      ],
      hard: [
        (_) => { const v=P(20,60,0), c=P(20,40,1), r=P(5,15,2), rc=P(0,10,3); const ts=((v-r)*c+r*rc)/100; const cv=Math.round(ts/v*100); return {qt:`${v}L ${c}% solution. ${r}L replaced with ${rc}%. New conc?`,cv,exp:`New conc = (${(v-r)*c/100}+${r*rc/100})/${v}×100 = ${cv}%`,sh:`(solute after replace)/total × 100`}; },
        (_) => { const v=P(20,50,0), c=P(20,30,1), t=P(10,20,2); const req=Math.round(v*(c-t)/t); const cv=req; return {qt:`${v}L of ${c}% sol. Water added to make ${t}%. Water needed?`,cv,exp:`Solute = ${v*c/100}L. ${v*c/100}/${v+x}=${t}/100 → x = ${Math.round(v*c/t-v)}L`,sh:`(${v*c/100})×100/${t} - ${v} = ${cv}L`}; },
        (_) => { const v1=P(10,30,0), c1=P(20,40,1), v2=P(10,30,2), c2=P(50,70,3); const t=c1*v1+c2*v2; const tv=v1+v2; const cv=Math.round(t/tv); return {qt:`${v1}L ${c1}% + ${v2}L ${c2}% mixed. % concentration?`,cv,exp:`Solute = ${c1*v1/100}+${c2*v2/100} = ${t/100}. Total = ${tv}. Conc = (${t/100})/${tv}×100 = ${cv}%`,sh:`Weighted avg = ${cv}%`}; },
        (_) => { const v=P(20,50,0), c=P(20,40,1), r=P(5,15,2), rc=P(0,10,3); const ts=Math.round(((v-r)*c+r*rc)/100); const cv=Math.round(ts/v*100); return {qt:`${v}L ${c}% milk. ${r}L replaced by ${rc}% milk. Final milk %?`,cv,exp:`Milk = (${v-r})×${c/100}+${r}×${rc/100} = ${ts}L. Conc = ${ts}/${v}×100 = ${cv}%`,sh:`(${(v-r)*c+r*rc})/${v*100}×100`}; },
        (_) => { const v1=P(10,20,0), c1=P(30,50,1), v2=P(10,20,2), c2=P(10,20,3); const tv=v1+v2; const ts=Math.round((v1*c1+v2*c2)/100); const cv=Math.round(ts/tv*100); return {qt:`${v1}L ${c1}% alcohol + ${v2}L ${c2}% alcohol. Alcohol %?`,cv,exp:`Alcohol = ${v1*c1/100}+${v2*c2/100} = ${ts}L. Conc = ${ts}/${tv}×100 = ${cv}%`,sh:`(${v1*c1}+${v2*c2})/${tv*100}×100`}; },
        (_) => { const v=P(20,40,0), c=P(20,40,1), r=P(5,10,2); const rep=Math.round(r*100/v); const cv=Math.round(c*(100-rep)/100); return {qt:`${v}L ${c}% sol. ${r}L replaced with water twice. Final conc?`,cv,exp:`After 1st: ${Math.round(c*(100-r*100/v)/100)}%. After 2nd: ${cv}%`,sh:`${c}×(1-${r}/${v})² = ${cv}%`}; },
      ],
    },
    'Permutation and Combination': {
      easy: [
        (_) => { const n=P(4,7,0); const f=[1,2,6,24,120,720,5040]; const cv=f[n-1]; return {qt:`Ways to arrange ${n} distinct books?`,cv,exp:`${n}! = ${cv}`,sh:`${n}! = ${cv}`}; },
        (_) => { const n=P(5,10,0); const cv=n*(n-1); return {qt:`Ways to pick president & VP from ${n} candidates?`,cv,exp:`${n}P2 = ${n}×${n-1} = ${cv}`,sh:`${n}×${n-1}`}; },
        (_) => { const n=P(4,7,0); const cv=(n-1)*(n); return {qt:`Ways to choose 1st and 2nd prize winner from ${n}?`,cv,exp:`${n}×${n-1} = ${cv}`,sh:`${n}×${n-1}`}; },
        (_) => { const n=P(3,5,0); const f=[1,2,6,24,120]; let cv=f[n-1]; cv*=(n-1); return {qt:`Ways to arrange ${n} people around a circular table?`,cv,exp:`(${n}-1)! = ${n-1}! = ${cv}`,sh:`(${n}-1)! = ${cv}`}; },
        (_) => { const n=P(3,6,0); const f=[1,2,6,24,120,720]; const cv=f[n]; return {qt:`How many 4-letter words from letters A,B,C,D? (repetition allowed)`,cv,exp:`4^4 = 256`,sh:`n^r`}; },
        (_) => { const n=P(3,6,0); const cv=n*(n-1)*(n-2); return {qt:`Ways to pick and arrange 3 from ${n} items?`,cv,exp:`${n}P3 = ${n}×${n-1}×${n-2} = ${cv}`,sh:`${n}×${n-1}×${n-2}`}; },
      ],
      medium: [
        (_) => { const n=P(5,8,0), r=2; const cv=n*(n-1); return {qt:`Ways ${r} prizes awarded to ${n} students (max 1 each)?`,cv,exp:`${n}P${r} = ${n}×${n-1} = ${cv}`,sh:`${n}P${r} = ${cv}`}; },
        (_) => { const n=P(5,8,0), r=3; let cv=n; for(let i=0;i<r;i++)cv*=(n-i); return {qt:`Ways ${r} distinct prizes to ${n} students?`,cv,exp:`${n}P${r} = ${n}×${n-1}×${n-2} = ${cv}`,sh:`${n}P${r} = ${cv}`}; },
        (_) => { const n=P(5,8,0), r=P(2,3,1); let cv=n; for(let i=0;i<r;i++)cv*=(n-i); return {qt:`Ways to select and arrange ${r} from ${n} items?`,cv,exp:`${n}P${r} = ${cv}`,sh:`${n}P${r} = ${cv}`}; },
        (_) => { const n=P(6,10,0); const cv=n*(n-1)/2; return {qt:`Ways to choose 2 representatives from ${n}?`,cv,exp:`${n}C2 = ${n}×(${n-1})/2 = ${cv}`,sh:`${n}(${n-1})/2 = ${cv}`}; },
        (_) => { const n=P(5,8,0); const f=[1,2,6,24,120,720,5040]; const cv=f[n]; return {qt:`Ways to arrange ${n} different colored flags in a line?`,cv,exp:`${n}! = ${cv}`,sh:`${n}! = ${cv}`}; },
        (_) => { const n=P(5,7,0), r=P(2,3,1); let num=n; for(let i=0;i<r;i++)num*=(n-i); let den=1; for(let i=2;i<=r;i++)den*=i; const cv=Math.round(num/den); return {qt:`Ways to select ${r} from ${n} for a team (order irrelevant)?`,cv,exp:`${n}C${r} = ${cv}`,sh:`${n}C${r} = ${cv}`}; },
      ],
      hard: [
        (_) => { const n=P(5,7,0), r=P(2,3,1); let cv=n; for(let i=0;i<r;i++)cv*=(n-i); const d=[1,1,2,6][r]; cv=Math.round(cv/d); return {qt:`Ways to choose ${r} from ${n} candidates for a committee?`,cv,exp:`${n}C${r} = ${n}!/(${r}!(${n}-${r})!) = ${cv}`,sh:`${n}C${r} = ${cv}`}; },
        (_) => { const n=P(6,10,0), r=Math.round(n/2); let num=n; for(let i=0;i<r;i++)num*=(n-i); let den=1; for(let i=2;i<=r;i++)den*=i; const cv=Math.round(num/den); return {qt:`Ways to form ${r}-member team from ${n} people?`,cv,exp:`${n}C${r} = ${cv}`,sh:`${n}C${r} = ${cv}`}; },
        (_) => { const n=P(5,8,0); const f=[1,2,6,24,120,720,5040]; const cv=f[n-1]*(n-1); return {qt:`Ways to seat ${n} people around a circular table?`,cv,exp:`(${n}-1)! = ${n-1}! = ${cv}`,sh:`(${n}-1)! = ${cv}`}; },
        (_) => { const n=P(4,7,0), r=P(2,4,1); let cv=n; for(let i=0;i<r;i++)cv*=(n-i); return {qt:`Ways to form ${r}-digit numbers from ${n} distinct digits (no repeat)?`,cv,exp:`${n}P${r} = ${cv}`,sh:`${n}P${r} = ${cv}`}; },
        (_) => { const n=P(4,6,0); const f=[1,2,6,24,120,720]; const cv=f[n]/2; return {qt:`Ways to arrange ${n} books with 2 specific always together?`,cv,exp:`Treat 2 as 1: ${n-1}!×2 = ${f[n-1]}×2 = ${cv}`,sh:`(${n-1})!×2 = ${cv}`}; },
        (_) => { const n=P(5,7,0), r=P(2,3,1); let sel=n; for(let i=0;i<r;i++)sel*=(n-i); const d=[1,1,2,6][r]; const cv=Math.round(sel/d); return {qt:`Ways to choose ${r} colors from ${n}?`,cv,exp:`${n}C${r} = ${cv}`,sh:`${n}C${r} = ${cv}`}; },
      ],
    },
    'Probability': {
      easy: [
        (_) => { const t=P(6,12,0), f=P(2,5,1); const cv=Math.round(f/t*100); return {qt:`${t} balls, ${f} red. P(red) in %?`,cv,exp:`(${f}/${t})×100 = ${cv}%`,sh:`${f}/${t} = ${cv}%`}; },
        (_) => { const t=P(4,10,0), f=P(1,3,1); const cv=Math.round(f/t*100); return {qt:`Die rolled. P(${f} or less) in %?`,cv,exp:`(${f}/${t})×100 = ${cv}%`,sh:`${f}/${t}×100`}; },
        (_) => { const cv=Math.round(50); return {qt:`Coin tossed. P(heads) in %?`,cv,exp:`1/2×100 = 50%`,sh:`50%`}; },
        (_) => { const t=P(6,10,0), f=P(2,4,1); const cv=Math.round((t-f)/t*100); return {qt:`${t} pens, ${f} defective. P(not defective) %?`,cv,exp:`Non-defective = ${t-f}. P = (${t-f}/${t})×100 = ${cv}%`,sh:`(total-defective)/total×100`}; },
        (_) => { const d=P(2,6,0); const cv=Math.round((6/d)/6*100); return {qt:`Die rolled. P(multiple of ${d}) in %?`,cv,exp:`Multiples: ${Math.floor(6/d)}. P = ${Math.floor(6/d)}/6×100 = ${cv}%`,sh:`${Math.floor(6/d)}/6×100`}; },
        (_) => { const t=P(4,8,0); const c=Math.floor(t/2); const cv=Math.round(c/t*100); return {qt:`${t} cards numbered 1-${t}. P(even) %?`,cv,exp:`Even = ${c}. P = ${c}/${t}×100 = ${cv}%`,sh:`count even/total×100`}; },
      ],
      medium: [
        (_) => { const t=P(6,10,0), r=P(2,5,1); const b=t-r; const cv=Math.round((r/t+b/t)*100); return {qt:`${r} red, ${b} blue balls. P(red or blue) %?`,cv,exp:`(${r}+${b})/${t} = 1 = ${cv}%`,sh:`Certain event = 100%`}; },
        (_) => { const d=P(1,6,0), c=P(1,6,1); const cv=d/c; return {qt:`Die rolled. P(multiple of ${d})? Express as numerator.`,cv,exp:`Favorable = ${Math.floor(6/d)}. P = ${Math.floor(6/d)}/6`}; },
        (_) => { const d1=P(1,6,0), d2=P(1,6,1); const fav=Math.round(d1*d2); const cv=Math.round(fav/36*100); return {qt:`Two dice rolled. P(sum = ${d1+d2}) in %? (nearest)`,cv,exp:`Sum ${d1+d2} has ${fav} combos. P = ${fav}/36×100 = ${cv}%`,sh:`Favorable/36×100`}; },
        (_) => { const t=P(6,10,0), r=P(2,4,1); const b=t-r; const cv=Math.round(1-r/t*100); return {qt:`${r}R, ${b}B. P(not red) %?`,cv,exp:`P(not red) = 1 - ${r}/${t}×100 = ${cv}%`,sh:`(1 - ${r}/${t})×100 = ${cv}%`}; },
        (_) => { const s=P(1,4,0); const cv=Math.round(s/4*100); return {qt:`Cards: hearts, clubs, spades, diamonds. P(${['hearts','clubs','spades','diamonds'][s-1]}) %?`,cv,exp:`1 suit out of 4 = 1/4×100 = ${cv}%`,sh:`25% per suit`}; },
        (_) => { const n=P(2,5,0); const cv=Math.round(1/n*100); return {qt:`Bag with ${n} distinct colored balls. P(specific color) %?`,cv,exp:`1/${n}×100 = ${cv}%`,sh:`1/${n}×100 = ${cv}%`}; },
      ],
      hard: [
        (_) => { const t=P(6,10,0), r=P(2,4,1), b=P(2,4,2); const g=t-r-b; const cv=Math.round(r/t*(r-1)/(t-1)*100); return {qt:`${r}R, ${b}B${g>0?`, ${g}G`:''}. 2 drawn w/o replacement. P(both red) %?`,cv,exp:`(${r}/${t})×(${r-1}/${t-1})×100 = ${cv}%`,sh:`(${r}/${t})×(${r-1}/${t-1})`}; },
        (_) => { const t=P(6,10,0), r=P(2,4,1), b=t-r; const cv=Math.round(r/t*b/(t-1)*100); return {qt:`${r}R, ${b}B. Two drawn w/o replacement. P(one red, one blue) %?`,cv,exp:`2×(${r}/${t})×(${b}/${t-1})×100 = ${cv}%`,sh:`2×(${r}/${t})×(${b}/${t-1})`}; },
        (_) => { const t=P(6,10,0), r=P(2,4,1), b=t-r; const cv=Math.round((1-r/t*(r-1)/(t-1))*100); return {qt:`${r}R, ${b}B. Two draws w/o replacement. P(at least 1 blue) %?`,cv,exp:`P(at least 1 blue) = 1 - P(both red) = 1 - ${r}/${t}×${r-1}/${t-1}×100 = ${cv}%`,sh:`1 - (${r}/${t}×${r-1}/${t-1})`}; },
        (_) => { const t=P(6,10,0), r=P(2,4,1), b=t-r; const cv=Math.round(r/t*r/t*100); return {qt:`${r}R, ${b}B. Two draws WITH replacement. P(both red) %?`,cv,exp:`(${r}/${t})²×100 = ${cv}%`,sh:`(${r}/${t})²×100`}; },
        (_) => { const t=P(6,10,0), r=P(2,4,1), b=t-r; const a1=r/t, a2=(r-1)/(t-1); const cv=Math.round(a1*a2*100); return {qt:`${r}R, ${b}B. Two draws w/o replacement. P(2nd red | 1st red) %? (as %)`,cv,exp:`P(2nd red|1st red)=(${r}-1)/(${t}-1)×100 = ${cv}%`,sh:`(${r}-1)/(${t}-1)×100`}; },
        (_) => { const t=P(6,10,0), r=P(2,4,1); const b=t-r; const cv=Math.round(r/t*b/(t-1)*2*100); return {qt:`${r}R, ${b}B. Two picks w/o replacement. P(different colors) %?`,cv,exp:`P(R then B) = ${r}/${t}×${b}/${t-1}. P(B then R) = ${b}/${t}×${r-1}/${t-1}. Total = ${Math.round((r/t*b/(t-1)+b/t*(r-1)/(t-1))*100)}%`,sh:`2×${r}×${b}/(${t}×(${t-1}))`}; },
      ],
    },
    'Simple Interest': {
      easy: [
        (_) => { const p=P(1000,8000,0), r=P(5,12,1), t=P(2,5,2); const cv=Math.round(p*r*t/100); return {qt:`SI on ₹${p} at ${r}% for ${t}y?`,cv,exp:`(${p}×${r}×${t})/100 = ₹${cv}`,sh:`(${p}×${r}×${t})/100`}; },
        (_) => { const p=P(2000,6000,0), r=P(6,10,1), t=P(3,6,2); const cv=Math.round(p*r*t/100); return {qt:`₹${p} at ${r}% for ${t}y. Interest?`,cv,exp:`SI = (${p}×${r}×${t})/100 = ₹${cv}`,sh:`₹${cv}`}; },
        (_) => { const p=P(1500,5000,0), r=P(4,10,1), t=P(1,3,2); const si=Math.round(p*r*t/100); const cv=si+p; return {qt:`₹${p} at ${r}% for ${t}y SI. Total amount?`,cv,exp:`SI = ₹${si}. Amount = ${p}+${si} = ₹${cv}`,sh:`P + SI = ₹${cv}`}; },
        (_) => { const p=P(3000,8000,0), r=P(5,12,1); const cv=Math.round(p*r*1/100); return {qt:`Interest on ₹${p} at ${r}% per annum for 1 year?`,cv,exp:`(${p}×${r}×1)/100 = ₹${cv}`,sh:`(${p}×${r})/100`}; },
        (_) => { const p=P(5000,12000,0), r=P(6,10,1); const cv=Math.round(p*r*6/1200); return {qt:`SI on ₹${p} at ${r}% for 6 months?`,cv,exp:`(${p}×${r}×0.5)/100 = ₹${cv}`,sh:`(${p}×${r})/(100×2)`}; },
        (_) => { const p=P(2000,7000,0), r=P(5,12,1), t=P(2,4,2); const si=Math.round(p*r*t/100); const cv=si; return {qt:`Principal ₹${p}, ${r}%, ${t}y. Simple interest?`,cv,exp:`SI = ${p}×${r}×${t}/100 = ₹${cv}`,sh:`₹${cv}`}; },
      ],
      medium: [
        (_) => { const p=P(2000,9000,0), t=P(2,4,1), a=P(3000,12000,2); const si=a-p; const cv=Math.round(si*100/(p*t)); return {qt:`₹${p} → ₹${a} in ${t}y at SI. Rate %?`,cv,exp:`R = (${si}×100)/(${p}×${t}) = ${cv}%`,sh:`(SI×100)/(P×T)`}; },
        (_) => { const si=P(400,1500,0), r=P(6,12,1), t=P(2,5,2); const cv=Math.round(si*100/(r*t)); return {qt:`SI = ₹${si}, Rate = ${r}%, Time = ${t}y. Principal?`,cv,exp:`P = (${si}×100)/(${r}×${t}) = ₹${cv}`,sh:`(SI×100)/(R×T)`}; },
        (_) => { const p=P(2000,8000,0), t=P(2,4,1), a=P(2500,10000,2); const si=a-p; const cv=Math.round(si*100/(p*t)); return {qt:`₹${p} amounts to ₹${a} in ${t}y at SI. Rate?`,cv,exp:`SI = ${a}-${p} = ${si}. R = (${si}×100)/(${p}×${t}) = ${cv}%`,sh:`(${si}×100)/(${p}×${t})`}; },
        (_) => { const si=P(500,2000,0), p=P(5000,15000,1), r=P(5,10,2); const cv=Math.round(si*100/(p*r)); return {qt:`SI = ₹${si}, P = ₹${p}, R = ${r}%. Time?`,cv,exp:`T = (${si}×100)/(${p}×${r}) = ${cv} y`,sh:`(SI×100)/(P×R)`}; },
        (_) => { const p=P(4000,10000,0), r1=P(5,8,1), r2=P(9,14,2), t=P(2,4,3); const si1=Math.round(p*r1*t/100), si2=Math.round(p*r2*t/100); const cv=si2-si1; return {qt:`₹${p} at ${r1}% vs ${r2}% for ${t}y. Extra SI at higher rate?`,cv,exp:`SI1 = ₹${si1}, SI2 = ₹${si2}. Diff = ₹${cv}`,sh:`₹${p}×(${r2}-${r1})×${t}/100 = ${cv}`}; },
        (_) => { const p=P(3000,10000,0), r=P(6,12,1), t=P(2,5,2); const cv=Math.round(p*r*t/100); const am=cv+p; return {qt:`₹${p} at ${r}% for ${t}y at SI. Amount = ?`,cv,exp:`SI = ₹${cv}. Amt = ${p}+${cv} = ₹${am}`,sh:`P+SI = ₹${am}`}; },
      ],
      hard: [
        (_) => { const si=P(500,2000,0), p=P(5000,15000,1), r=P(6,15,2); const cv=Math.round(si*100/(p*r)); return {qt:`SI = ₹${si} at ${r}% on ₹${p}. Time?`,cv,exp:`T = (${si}×100)/(${p}×${r}) = ${cv}y`,sh:`(SI×100)/(P×R)`}; },
        (_) => { const p=P(3000,10000,0), r=P(5,10,1), t=P(3,5,2); const cv=Math.round(p*r*t/100); return {qt:`SI on ₹${p} at ${r}% for ${t}y?`,cv,exp:`(${p}×${r}×${t})/100 = ₹${cv}`,sh:`₹${cv}`}; },
        (_) => { const p=P(5000,15000,0), r=P(5,8,1), t1=P(2,3,2), t2=P(4,6,3); const si1=Math.round(p*r*t1/100), si2=Math.round(p*r*t2/100); const cv=si2-si1; return {qt:`₹${p} at ${r}% SI. Difference in SI between ${t2}y and ${t1}y?`,cv,exp:`SI(${t2}y) = ₹${si2}, SI(${t1}y) = ₹${si1}. Diff = ₹${cv}`,sh:`₹${p}×${r}×(${t2}-${t1})/100 = ${cv}`}; },
        (_) => { const si=P(1200,3000,0), p=P(8000,20000,1), t=P(2,4,2); const cv=Math.round(si*100/(p*t)); return {qt:`SI = ₹${si}, P = ₹${p}, T = ${t}y. Rate %?`,cv,exp:`R = (${si}×100)/(${p}×${t}) = ${cv}%`,sh:`(${si}×100)/(${p}×${t})`}; },
        (_) => { const p1=P(3000,8000,0), r1=P(5,8,1), p2=P(4000,10000,2), r2=P(7,12,3), t=P(2,4,4); const si1=Math.round(p1*r1*t/100), si2=Math.round(p2*r2*t/100); const cv=si1+si2; return {qt:`₹${p1} at ${r1}% + ₹${p2} at ${r2}% for ${t}y. Total SI?`,cv,exp:`SI1 = ₹${si1}, SI2 = ₹${si2}. Total = ${cv}`,sh:`₹${si1}+₹${si2}=${cv}`}; },
        (_) => { const a=P(6000,15000,0), r=P(5,10,1), t=P(2,4,2); const cv=Math.round(a*100/(100+r*t)); return {qt:`Amount = ₹${a} after ${t}y at ${r}% SI. Principal?`,cv,exp:`P = (${a}×100)/(100+${r}×${t}) = ₹${cv}`,sh:`(A×100)/(100+RT) = ${cv}`}; },
      ],
    },
    'Compound Interest': {
      easy: [
        (_) => { const p=P(2000,8000,0), r=P(5,10,1), t=P(2,3,2); const am=Math.round(p*((100+r)/100)**t); const cv=am-p; return {qt:`CI on ₹${p} at ${r}% for ${t}y?`,cv,exp:`A = ${p}×(${100+r}/100)^${t} = ₹${am}. CI = ₹${cv}`,sh:`P[(1+R/100)^T-1]`}; },
        (_) => { const p=P(3000,6000,0), r=P(8,12,1); const am=Math.round(p*((100+r)/100)**2); const cv=am-p; return {qt:`CI on ₹${p} at ${r}% for 2y?`,cv,exp:`A = ${p}×(${100+r}/100)² = ₹${am}. CI = ${cv}`,sh:`P[(1+R/100)²-1]`}; },
        (_) => { const p=P(2000,5000,0), r=P(5,10,1); const am=Math.round(p*((100+r)/100)**2); const cv=am; return {qt:`₹${p} at ${r}% CI for 2y. Total amount?`,cv,exp:`A = ${p}×(${100+r}/100)² = ₹${cv}`,sh:`P(1+R/100)^T = ${cv}`}; },
        (_) => { const p=P(3000,8000,0), r=P(5,8,1); const si=Math.round(p*r*2/100); const ci=Math.round(p*((100+r)/100)**2-p); const cv=ci-si; return {qt:`₹${p} at ${r}% for 2y. Diff CI - SI?`,cv,exp:`SI = ₹${si}, CI = ₹${ci}. Diff = ₹${cv}`,sh:`P×(R/100)² = ${Math.round(p*(r/100)**2)}`}; },
        (_) => { const p=P(4000,10000,0), r=P(5,10,1); const cv=Math.round(p*((100+r)/100)**3-p); return {qt:`CI on ₹${p} at ${r}% for 3y?`,cv,exp:`A = ${p}×(${100+r}/100)³. CI = A-P = ₹${cv}`,sh:`P[(1+R/100)³-1]`}; },
        (_) => { const p=P(5000,12000,0), r=P(5,10,1); const cv=Math.round(p*((100+r)/100)**1-p); return {qt:`CI on ₹${p} at ${r}% for 1y (compounded yearly)?`,cv,exp:`CI = ${p}×${r}/100 = ₹${cv}`,sh:`P×R/100 = ${cv}`}; },
      ],
      medium: [
        (_) => { const p=P(5000,15000,0), r=P(8,12,1), t=2, n=2; const am=Math.round(p*(1+r/(100*n))**(n*t)); const cv=am-p; return {qt:`CI on ₹${p} at ${r}% compounded half-yearly for ${t}y?`,cv,exp:`A = ${p}×(1+${r}/200)^${n*t} = ₹${am}. CI = ₹${cv}`,sh:`₹${cv}`}; },
        (_) => { const p=P(4000,10000,0), r=P(8,12,1), t=2, n=4; const am=Math.round(p*(1+r/(100*n))**(n*t)); const cv=am-p; return {qt:`CI on ₹${p} at ${r}% compounded quarterly for 2y?`,cv,exp:`A = ${p}×(1+${r}/400)^8 = ₹${am}. CI = ₹${cv}`,sh:`₹${cv}`}; },
        (_) => { const p=P(3000,8000,0), r=P(6,10,1), t=P(2,3,2); const am=Math.round(p*((100+r)/100)**t); const cv=am-p; return {qt:`CI on ₹${p} at ${r}% for ${t}y (compounded annually)?`,cv,exp:`A = ${p}×(${100+r}/100)^${t}=₹${am}. CI=₹${cv}`,sh:`P[(1+R/100)^T-1]`}; },
        (_) => { const p=P(5000,12000,0), t=P(2,3,1), a=Math.round(p*1.1**t); const cv=Math.round((a/p)**(1/t)*100-100); return {qt:`₹${p} → ₹${a} in ${t}y at CI compounded annually. Rate %?`,cv,exp:`R = (${a}/${p})^(1/${t}) - 1 = ${Math.round(((a/p)**(1/t)-1)*100)}%`,sh:`[(A/P)^(1/T)-1]×100`}; },
        (_) => { const p=P(3000,10000,0), r=P(5,10,1), t=P(2,3,2); const a=Math.round(p*((100+r)/100)**t); const cv=Math.round(a-p); return {qt:`₹${p} at ${r}% CI for ${t}y. Compound interest?`,cv,exp:`A = ₹${a}. CI = ${a}-${p} = ₹${cv}`,sh:`P[(1+R/100)^T-1]`}; },
        (_) => { const p=P(5000,15000,0), r=P(8,12,1); const si=Math.round(p*r*2/100); const ci=Math.round(p*((100+r)/100)**2-p); const cv=ci-si; return {qt:`Principal ₹${p} at ${r}% for 2y. (CI - SI) difference?`,cv,exp:`SI = ₹${si}, CI = ₹${ci}. Diff = ₹${cv}`,sh:`P×(R/100)² = ₹${Math.round(p*(r/100)**2)}`}; },
      ],
      hard: [
        (_) => { const p=P(3000,10000,0), t=P(2,3,1); const am=Math.round(p*1.1**t); const cv=Math.round((am/p)**(1/t)*100-100); return {qt:`₹${p} → ₹${am} in ${t}y at CI. Rate %?`,cv,exp:`R = (${am}/${p})^(1/${t}) - 1 = ${cv}%`,sh:`[(A/P)^(1/T)-1]×100`}; },
        (_) => { const p=P(5000,15000,0), r1=P(5,8,1), r2=P(9,12,2), t=P(2,3,3); const a1=Math.round(p*((100+r1)/100)**t); const a2=Math.round(p*((100+r2)/100)**t); const cv=a2-a1; return {qt:`₹${p} at ${r1}% vs ${r2}% for ${t}y. Extra CI at higher rate?`,cv,exp:`A1 = ₹${a1}, A2 = ₹${a2}. Diff = ₹${cv}`,sh:`₹${a2}-₹${a1}=${cv}`}; },
        (_) => { const p=P(4000,12000,0), r=P(5,10,1), t=2; const hy=Math.round(p*(1+r/(200))**(4)); const ay=Math.round(p*((100+r)/100)**2); const cv=hy-ay; return {qt:`₹${p} at ${r}%. CI half-yearly vs yearly for 2y. Extra?`,cv,exp:`Half-yearly A = ₹${hy}, Yearly A = ₹${ay}. Extra = ₹${cv}`,sh:`₹${hy}-₹${ay}=${cv}`}; },
        (_) => { const p=P(5000,15000,0), t=P(2,3,1), a=Math.round(p*1.12**t); const cv=Math.round((a/p)**(1/t)*100-100); return {qt:`₹${p} grows to ₹${a} in ${t}y at CI. Rate %?`,cv,exp:`R = ((${a}/${p})^(1/${t})-1)×100 = ${cv}%`,sh:`[(A/P)^(1/T)-1]×100`}; },
        (_) => { const p=P(4000,10000,0), r=P(5,10,1), t=P(2,4,2); const a=Math.round(p*((100+r)/100)**t); const cv=a-p; return {qt:`CI on ₹${p} at ${r}% for ${t}y if compounded annually?`,cv,exp:`A = ₹${a}. CI = ${a}-${p} = ₹${cv}`,sh:`CI = P[(1+R/100)^T-1] = ₹${cv}`}; },
        (_) => { const p=P(5000,15000,0), r=P(8,12,1), n=P(2,4,1); const am=Math.round(p*(1+r/(100*n))**(n*2)); const cv=am-p; return {qt:`₹${p} at ${r}%, compounded ${n} times a year for 2y. CI?`,cv,exp:`A = ${p}×(1+${r}/${100*n})^${n*2} = ₹${am}. CI = ₹${cv}`,sh:`₹${cv}`}; },
      ],
    },
    'Data Interpretation': {
      easy: [
        (_) => { const a=P(100,500,0), b=P(100,500,1); const cv=a+b; return {qt:`Q1=${a}, Q2=${b} units. Total sales?`,cv,exp:`${a}+${b} = ${cv}`,sh:`${a}+${b}`}; },
        (_) => { const a=P(200,600,0), b=P(100,500,1); const cv=Math.abs(a-b); return {qt:`Company A=${a}, B=${b} sales. Difference?`,cv,exp:`|${a}-${b}| = ${cv}`,sh:`|${a}-${b}|`}; },
        (_) => { const a=P(50,150,0), b=P(30,90,1); const c=P(20,80,2); const cv=a+b+c; return {qt:`Jan=${a}, Feb=${b}, Mar=${c}. Total Q1 sales?`,cv,exp:`${a}+${b}+${c} = ${cv}`,sh:`Sum`}; },
        (_) => { const a=P(100,400,0), b=P(200,600,1), c=P(150,500,2); const cv=Math.round((a+b+c)/3); return {qt:`Jan=${a}, Feb=${b}, Mar=${c}. Average monthly sales?`,cv,exp:`(${a}+${b}+${c})/3 = ${cv}`,sh:`Sum/3`}; },
        (_) => { const a=P(150,450,0), b=P(100,350,1); const cv=Math.round(a/(a+b)*100); return {qt:`Product A=${a}, B=${b}. A's share of total %?`,cv,exp:`${a}/(${a}+${b})×100 = ${cv}%`,sh:`(${a}/${a+b})×100`}; },
        (_) => { const a=P(300,800,0), b=P(100,400,1); const cv=Math.round((a-b)/a*100); return {qt:`Total=${a}, sold=${b}. Unsold %?`,cv,exp:`Unsold = ${a-b}. % = (${a-b}/${a})×100 = ${cv}%`,sh:`(total-sold)/total×100`}; },
      ],
      medium: [
        (_) => { const q1=P(200,600,0), q2=P(250,700,1); const cv=Math.round((q2-q1)/q1*100); return {qt:`Jan=${q1}, Feb=${q2} sales. % increase Jan→Feb?`,cv,exp:`(${q2-q1}/${q1})×100 = ${cv}%`,sh:`(${q2-q1}/${q1})×100`}; },
        (_) => { const v=P(300,800,0), c=P(200,500,1); const cv=Math.round((v-c)/c*100); return {qt:`Revenue ₹${v}, cost ₹${c}. Profit %?`,cv,exp:`(${v-c}/${c})×100 = ${cv}%`,sh:`(${v-c}/${c})×100`}; },
        (_) => { const a=P(100,300,0), b=P(200,400,1); const cv=Math.round(b/a); return {qt:`Year1=${a}, Year2=${b}. Ratio of Year2:Year1?`,cv,exp:`${b}:${a} = ${Math.round(b/a)}:1`,sh:`${b}/${a} = ${cv}`}; },
        (_) => { const t=P(500,1500,0), a=P(200,500,1), b=P(150,400,2); const c=t-a-b; const cv=Math.round(c/t*100); return {qt:`Total ₹${t}. A=₹${a}, B=₹${b}, C=rest. C's share %?`,cv,exp:`C = ${t}-${a}-${b} = ${c}. % = (${c}/${t})×100 = ${cv}%`,sh:`(${c}/${t})×100`}; },
        (_) => { const a=P(200,600,0), b=P(150,500,1); const cv=Math.round((a-b)/b*100); return {qt:`Revenue ${a}, Cost ${b}. Profit as % of cost?`,cv,exp:`Profit = ${a-b}. ${a-b}/${b}×100 = ${cv}%`,sh:`(${a-b}/${b})×100`}; },
        (_) => { const a=P(100,300,0), b=P(200,500,1); const cv=Math.round((b-a)/a*100); return {qt:`Q1 sales ${a}, Q2 sales ${b}. % change?`,cv,exp:`(${b-a}/${a})×100 = ${cv}% ${b>=a?'increase':'decrease'}`,sh:`(${b-a}/${a})×100`}; },
      ],
      hard: [
        (_) => { const r=P(50000,200000,0), c=P(30000,100000,1), tr=P(15,30,2); const p=r-c; const cv=Math.round(p*(100-tr)/100); return {qt:`Revenue ₹${r}, cost ₹${c}, tax ${tr}%. Net profit?`,cv,exp:`Profit = ${p}. Tax = ${Math.round(p*tr/100)}. Net = ${cv}`,sh:`(${p})×(${100-tr}/100) = ₹${cv}`}; },
        (_) => { const a=P(150,400,0), b=P(200,500,1); const cv=Math.round((b-a)/a*100); return {qt:`Year1=${a}, Year2=${b}. Growth %?`,cv,exp:`(${b-a}/${a})×100 = ${cv}%`,sh:`(${b-a}/${a})×100`}; },
        (_) => { const a=P(100,300,0), b=P(200,500,1), c=P(300,700,2); const g1=Math.round((b-a)/a*100), g2=Math.round((c-b)/b*100); const cv=Math.round((g1+g2)/2); return {qt:`Year1 ${a}, Year2 ${b}, Year3 ${c}. Avg growth % per year?`,cv,exp:`Growth1 = ${g1}%, Growth2 = ${g2}%. Avg = ${cv}%`,sh:`(${g1}+${g2})/2 = ${cv}%`}; },
        (_) => { const r=P(60000,180000,0), c=P(40000,120000,1), tr=P(10,25,2); const gp=r-c; const np=Math.round(gp*(100-tr)/100); const cv=Math.round(np/gp*100); return {qt:`Revenue ₹${r}, cost ₹${c}, tax ${tr}%. Net profit as % of gross profit?`,cv,exp:`Gross = ${gp}, Net = ${np}. % = (${np}/${gp})×100 = ${cv}%`,sh:`${100-tr}% = ${cv}%`}; },
        (_) => { const a=P(200,500,0), b=P(300,600,1); const ra=Math.round(a/(a+b)*100); const rb=Math.round(b/(a+b)*100); const cv=ra-rb; return {qt:`A sales ${a}, B sales ${b}. % points difference (A - B)?`,cv,exp:`A% = ${ra}%, B% = ${rb}%. Diff = ${cv} pp`,sh:`+${cv} pp`}; },
        (_) => { const y1=P(1000,5000,0), y2=Math.round(y1*P(110,150,1)/100); const g=Math.round((y2-y1)/y1*100); const cv=g; return {qt:`Year1 profit ₹${y1}, Year2 profit ₹${y2}. Growth %?`,cv,exp:`(${y2-y1}/${y1})×100 = ${g}%`,sh:`(${y2-y1}/${y1})×100 = ${g}%`}; },
      ],
    },
    'Logical Reasoning': {
      easy: [
        (_) => { const st=P(2,10,0), d=P(2,6,1); const cv=st+4*d; return {qt:`Series: ${st}, ${st+d}, ${st+2*d}, ${st+3*d}, ?`,cv,exp:`Diff = ${d}. Next = ${st+3*d}+${d} = ${cv}`,sh:`${st+3*d}+${d} = ${cv}`}; },
        (_) => { const st=P(3,15,0), r=P(2,5,1); const cv=st*r; const nxt=st*r*r; return {qt:`Series: ${st}, ${st*r}, ?, ${nxt}. Missing term?`,cv,exp:`Ratio = ${r}. So mid = ${st}×${r} = ${cv}`}; },
        (_) => { const st=P(10,50,0), d=P(5,15,1); const cv=st+3*d; return {qt:`Series: ${st}, ${st+d}, ${st+2*d}, ?. Next term?`,cv,exp:`Diff = ${d}. Next = ${st+2*d}+${d} = ${cv}`,sh:`${st+2*d}+${d}`}; },
        (_) => { const pos=l=>l.charCodeAt(0)-64; const a=String.fromCharCode(64+P(1,10,0)); const d=P(1,4,1); const la=String.fromCharCode(a.charCodeAt(0)+2*d); const cv=pos(la); return {qt:`Series: ${a}, ${String.fromCharCode(a.charCodeAt(0)+d)}, ?. Next letter position?`,cv,exp:`Diff = ${d}. Next = ${a.charCodeAt(0)-64+2*d} → ${la} = ${cv}`,sh:`pos(${a})+${2*d} = ${cv}`}; },
        (_) => { const n=P(2,9,0); const cv=n*2+1; return {qt:`Odd one out? ${n}, ${n+2}, ${n+4}, ${n+7}, ${n+6} (find the next number in pattern)`,cv,exp:`Series: ${n},${n+2},${n+4},${n+6},... Next = ${cv}`,sh:`Add 2 each time`}; },
        (_) => { const a=P(5,20,0), b=P(3,15,1); const cv=a+b; return {qt:`${a}, ${b}, ${a+b}, ${b+(a+b)}. Next term?`,cv,exp:`Pattern: add prev two. Next = ${a+b} + ${b+(a+b)} = ${cv}`,sh:`Fibonacci-like`}; },
      ],
      medium: [
        (_) => { const a=P(20,40,0), b=P(5,15,1), y=P(5,12,2); const cv=(a+y)-(b+y); return {qt:`A=${a}, B=${b}. Age difference after ${y}y?`,cv,exp:`Diff = (${a}+${y}) - (${b}+${y}) = ${cv}`,sh:`Age diff constant: ${a}-${b} = ${cv}`}; },
        (_) => { const d=P(5,15,0), q=P(2,5,1); const cv=q*d; return {qt:`A is ${q}× age of B. B is ${d}. A's age?`,cv,exp:`A = ${q}×${d} = ${cv}`,sh:`${q}×${d} = ${cv}`}; },
        (_) => { const a=P(10,30,0), d=P(3,8,1); const cv=a+d; const nxt=a+2*d; return {qt:`Code: ${a}→${a+d}→${a+2*d}→?. If pattern continues, next?`,cv,exp:`Add ${d}: ${a+2*d}+${d} = ${cv}`,sh:`+${d} each step`}; },
        (_) => { const n=P(25,80,0), d=P(3,9,1); const cv=n-d; return {qt:`${n} → ${n-d} → ${n-2*d} → ?. Next number?`,cv,exp:`Subtract ${d}: ${n-2*d}-${d} = ${cv}`,sh:`-${d} each step`}; },
        (_) => { const x=P(1,5,0), y=P(2,8,1); const cv=x*y; return {qt:`If ${x} : ${y} :: ${x+2} : ?`,cv,exp:`Ratio = ${y}/${x} = ${(y/x)}. So ? = (${x+2})×${(y/x)} = ${cv}`,sh:`Multiply by ${(y/x)}`}; },
        (_) => { const a=P(2,9,0), m=P(2,5,1); const cv=a*10 + (a+m); return {qt:`If A=${a}, B=${a+m}, C=${a+2*m}. Find the 2-digit number AB?`,cv,exp:`A=${a}, B=${a+m}. Number = ${a}${a+m} = ${cv}`,sh:`${a}${a+m}`}; },
      ],
      hard: [
        (_) => { const a=P(2,6,0), b=P(8,15,1), c=P(3,7,2), d=P(1,5,3); const ageA=a*d, ageB=b+d; const cv=ageA+ageB; return {qt:`A=${a}×D, B=${b}+D. D=${d}. Sum of A+B?`,cv,exp:`A=${ageA}, B=${ageB}. Sum=${cv}`,sh:`(${a}×${d})+(${b}+${d})`}; },
        (_) => { const x=P(1,9,0), y=P(1,9,1); const cv=x*10+y; const r=y*10+x; return {qt:`Two digits sum to ${x+y}, reversed less by ${Math.abs(cv-r)}. Original? (tens=${x})`,cv,exp:`Original = ${x}${y} = ${cv}`,sh:`${x}${y}`}; },
        (_) => { const h=P(1,11,0), m=P(0,5,1)*10; const a=Math.abs(30*h-5.5*m); const cv=Math.round(Math.min(a,360-a)); return {qt:`Time ${h}:${m===0?'00':m}. Angle between hands? (nearest degree)`,cv,exp:`Angle = |30×${h}-5.5×${m}| = ${Math.round(a)}°. Smaller angle = ${cv}°`,sh:`|30H-5.5M| = ${cv}°`}; },
        (_) => { const d=P(1,6,0); const f=[1,2,3,4,5,6].filter(x=>x!==d); const cv=f[P(0,4,1)]; return {qt:`Opposite face of ${d} on a standard die?`,cv,exp:`Opposite of ${d} = ${7-d}. So ${cv} is not opposite of ${d} (since 7-${d}=${7-d})`,sh:`Sum = 7 → opposite = ${7-d}`}; },
        (_) => { const x=P(1,9,0), y=P(1,9,1); const n=x*10+y; const cv=Math.abs(x-y)*9; return {qt:`Two-digit number ${n} reversed. Difference?`,cv,exp:`${n} - ${y*10+x} = ${Math.abs(n-(y*10+x))}`,sh:`9×|${x}-${y}| = ${cv}`}; },
        (_) => { const a=P(2,9,0), b=P(3,9,1); const cv=a*b; return {qt:`If ${a}*${b} = ${cv}, ${a+1}*${b+1} = ?`,cv,exp:`(${a}+1)×(${b}+1) = ${a+1}×${b+1} = ${(a+1)*(b+1)}`,sh:`FOIL expansion`}; },
      ],
    },
    'Verbal Ability': {
      easy: [
        (_) => { const w=['BEAUTIFUL','EDUCATION','KNOWLEDGE','COMPUTER','SCIENCE'][P(0,4,0)]; const cv=w.replace(/[^AEIOU]/g,'').length; return {qt:`Vowels in "${w}"?`,cv,exp:`Vowels: ${w.replace(/[^AEIOU]/g,'').split('').join(',')}. Count = ${cv}`,sh:`Count vowels = ${cv}`}; },
        (_) => { const w=['HAPPY','SAD','BIG','SMALL','FAST'][P(0,4,0)]; const cv=w.length; return {qt:`How many letters in "${w}"?`,cv,exp:`"${w}" has ${w.length} letters. Answer = ${cv}`,sh:`${w}.length = ${cv}`}; },
        (_) => { const w=['HELLO','WORLD','PEACE'][P(0,2,0)]; const pos=l=>l.charCodeAt(0)-64; const cv=pos(w[0])+pos(w[w.length-1]); return {qt:`Sum of alphabet positions of first & last letter of "${w}"?`,cv,exp:`${w[0]}=${pos(w[0])}, ${w[w.length-1]}=${pos(w[w.length-1])}. Sum = ${cv}`,sh:`pos(${w[0]})+pos(${w[w.length-1]})`}; },
        (_) => { const w=['APPLE','MANGO','GRAPE'][P(0,2,0)]; const m=Math.floor(w.length/2); const pos=l=>l.charCodeAt(0)-64; const cv=pos(w[m]); return {qt:`Position of middle letter of "${w}"?`,cv,exp:`"${w}"[${m}] = ${w[m]}. Position = ${cv}`,sh:`pos(${w[m]}) = ${cv}`}; },
        (_) => { const p=[{w:'HOT',a:'COLD'},{w:'BIG',a:'SMALL'},{w:'FAST',a:'SLOW'}][P(0,2,0)]; const pos=l=>l.charCodeAt(0)-64; const cv=pos(p.a[0]); return {qt:`Antonym of "${p.w}" starts with "${p.a[0]}". Position of "${p.a[0]}"?`,cv,exp:`${p.a[0]} = ${cv}`,sh:`pos(${p.a[0]})`}; },
        (_) => { const ws=['RAIN','GOOD','FINE','HARD']; const wi=P(0,3,0); const w=ws[wi]; const pos=l=>l.charCodeAt(0)-64; const cv=w.split('').reduce((a,l)=>a+pos(l),0); return {qt:`Sum of alphabet positions of letters in "${w}"?`,cv,exp:`${w.split('').map(l=>`${l}=${pos(l)}`).join(', ')}. Sum = ${cv}`,sh:`Sum positions`}; },
      ],
      medium: [
        (_) => { const p=[{w:'BRIEF',s:'SHORT',a:'LONG'},{w:'ABUNDANT',s:'PLENTIFUL',a:'SCARCE'},{w:'FAMOUS',s:'RENOWNED',a:'OBSCURE'}][P(0,2,0)]; const pos=l=>l.charCodeAt(0)-64; const cv=pos(p.s[0])+pos(p.a[0]); return {qt:`Sum of alphabet positions of synonym & antonym first letters of "${p.w}"?`,cv,exp:`${p.s[0]}=${pos(p.s[0])}, ${p.a[0]}=${pos(p.a[0])}. Sum=${cv}`,sh:`pos(${p.s[0]})+pos(${p.a[0]})`}; },
        (_) => { const p=[{w1:'HAPPY',w2:'JOYFUL'},{w1:'BIG',w2:'LARGE'},{w1:'FAST',w2:'QUICK'}][P(0,2,0)]; const cl=p.w1.split('').filter(l=>p.w2.includes(l)); const pos=l=>l.charCodeAt(0)-64; const cv=cl.length>0?pos(cl[0]):1; return {qt:`Synonym "${p.w1}" & "${p.w2}". Position of 1st common letter?`,cv,exp:`Common: ${cl.join(',')||'none'}. Position of ${cl[0]||'?'} = ${cv}`,sh:`pos(${cl[0]||'?'})`}; },
        (_) => { const w=['LEARN','STUDY','READ'][P(0,2,0)]; const pos=l=>l.charCodeAt(0)-64; const cv=w.split('').reduce((a,l)=>a+pos(l),0); return {qt:`Sum of letter positions for "${w}"?`,cv,exp:`${w.split('').map(l=>`${l}=${pos(l)}`).join(', ')}. Sum = ${cv}`,sh:`Sum positions = ${cv}`}; },
        (_) => { const ws=[['LARGE','BIG'],['QUICK','FAST'],['SMALL','TINY']][P(0,2,0)]; const pos=l=>l.charCodeAt(0)-64; const cv=Math.abs(ws[0].split('').reduce((a,l)=>a+pos(l),0)-ws[1].split('').reduce((a,l)=>a+pos(l),0)); return {qt:`Difference in sums of letter positions of "${ws[0]}" and "${ws[1]}"?`,cv,exp:`${ws[0]} = ${ws[0].split('').reduce((a,l)=>a+pos(l),0)}, ${ws[1]} = ${ws[1].split('').reduce((a,l)=>a+pos(l),0)}. Diff = ${cv}`,sh:`|sum1 - sum2|`}; },
        (_) => { const ws=['ALWAYS','NEVER','OFTEN','SELDOM']; const wi=P(0,3,0); const w=ws[wi]; const sd=[...new Set(w.split(''))].length; const cv=sd; return {qt:`Number of distinct letters in "${w}"?`,cv,exp:`Letters: ${[...new Set(w.split(''))].join(',')}. Count = ${cv}`,sh:`Unique letters = ${cv}`}; },
        (_) => { const ws=['BOAT','SHIP','YACHT']; const wi=P(0,2,0); const w=ws[wi]; const pos=l=>l.charCodeAt(0)-64; const cv=pos(w[0])+pos(w[w.length-1]); return {qt:`Sum of alphabet positions of 1st and last letter of "${w}"?`,cv,exp:`${w[0]}=${pos(w[0])}, ${w[w.length-1]}=${pos(w[w.length-1])}. Sum=${cv}`,sh:`pos(${w[0]})+pos(${w[w.length-1]})`}; },
      ],
      hard: [
        (_) => { const w=['STRONG','WEAK','HARD','SOFT'][P(0,3,0)]; const t=w.split('').reverse().join(''); const cv=w.split('').filter((l,i)=>l===t[i]).length; return {qt:`How many letters in "${w}" are in the same position when reversed?`,cv,exp:`Reverse = "${t}". Same pos: ${w.split('').filter((l,i)=>l===t[i]).join(',')||'none'}. Count=${cv}`,sh:`Compare original and reverse`}; },
        (_) => { const pos=l=>l.charCodeAt(0)-64; const w=['LAPTOP','MOBILE','TABLET'][P(0,2,0)]; const s=w.split('').reduce((a,l)=>a+pos(l),0); const t=w.split('').reverse().reduce((a,l)=>a+pos(l),0); const cv=Math.abs(s-t); return {qt:`"${w}" vs reverse. Absolute diff in sum of positions?`,cv,exp:`Forward sum = ${s}, Reverse sum = ${t}. Diff = ${cv}`,sh:`|sum(forward)-sum(reverse)|`}; },
        (_) => { const pos=l=>l.charCodeAt(0)-64; const w=['PLANET','STAR','MOON'][P(0,2,0)]; const cv=w.split('').filter((l,i)=>l===w.split('').reverse().join('')[i]).length; return {qt:`"${w}" reversed. How many letters unchanged position?`,cv,exp:`Reverse = "${w.split('').reverse().join('')}". Unchanged: ${w.split('').filter((l,i)=>l===w.split('').reverse().join('')[i]).join(',')||'none'}. Count=${cv}`,sh:`Compare with reverse`}; },
        (_) => { const ws=[['HAPPY','GLAD','JOYFUL'],['SAD','UNHAPPY','MISERABLE']]; const li=P(0,1,0); const w=ws[li][P(0,2,1)]; const pos=l=>l.charCodeAt(0)-64; const ss=w.split('').reduce((a,l)=>a+pos(l),0); const cv=ss%10; return {qt:`Word: "${w}". Sum of positions mod 10?`,cv,exp:`${w.split('').map(l=>`${l}=${pos(l)}`).join('+')} = ${ss}. ${ss}%10 = ${cv}`,sh:`Sum mod 10 = ${cv}`}; },
        (_) => { const w=['CLEAN','DIRTY','PURE'][P(0,2,0)]; const t=w.split('').reverse().join(''); const cv=w.split('').filter((l,i)=>l===t[i]).length; return {qt:`"${w}" reversed. Letters in same position?`,cv,exp:`Reverse="${t}". Matching: ${w.split('').filter((l,i)=>l===t[i]).join(',')||'none'}. Count=${cv}`,sh:`${cv} letters match`}; },
        (_) => { const pos=l=>l.charCodeAt(0)-64; const w=['LIGHT','HEAVY','DARK'][P(0,2,0)]; const cv=w.split('').reduce((a,l,i)=>a+pos(l)*(i+1),0); return {qt:`"${w}". Sum of position × index (1-indexed)?`,cv,exp:`${w.split('').map((l,i)=>`${l}(${i+1})×${pos(l)}`).join('+')} = ${cv}`,sh:`Sum of weighted positions`}; },
      ],
    },
    'Coding-Decoding': {
      easy: [
        (_) => { const w=['CAT','DOG','BAT','FAN','CUP'][P(0,4,0)]; const sh=P(1,3,1); const cd=w.split('').map(l=>String.fromCharCode(l.charCodeAt(0)+sh)).join(''); const pos=l=>l.charCodeAt(0)-64; const cv=cd.split('').reduce((a,l)=>a+pos(l),0); return {qt:`"${w}" shifted by ${sh} → "${cd}". Sum of alphabetical positions of coded?`,cv,exp:`${cd.split('').map(l=>`${l}=${pos(l)}`).join(', ')}. Sum = ${cv}`,sh:`${cv}`}; },
        (_) => { const w='CODE'[P(0,3,0)]; const sh=P(1,4,1); const cd=String.fromCharCode(w.charCodeAt(0)+sh); const pos=l=>l.charCodeAt(0)-64; const cv=pos(cd); return {qt:`"${w}" shifted by ${sh} → "${cd}". Position of "${cd}"?`,cv,exp:`pos(${w})+${sh} = ${pos(w)+sh} = ${cv}`,sh:`${pos(w)+sh}`}; },
        (_) => { const w=['PEN','BOOK','CUP'][P(0,2,0)]; const cd=w.split('').reverse().join(''); const pos=l=>l.charCodeAt(0)-64; const cv=cd.split('').reduce((a,l)=>a+pos(l),0); return {qt:`"${w}" reversed → "${cd}". Sum of positions?`,cv,exp:`${cd.split('').map(l=>`${l}=${pos(l)}`).join(', ')}. Sum = ${cv}`,sh:`Sum positions = ${cv}`}; },
        (_) => { const w=['BOX','CAR','BAG'][P(0,2,0)]; const cd=w.split('').map(l=>String.fromCharCode(155-l.charCodeAt(0))).join(''); const pos=l=>l.charCodeAt(0)-64; const cv=cd.split('').reduce((a,l)=>a+pos(l),0); return {qt:`A↔Z code on "${w}" → "${cd}". Sum of coded positions?`,cv,exp:`${cd.split('').map(l=>`${l}=${pos(l)}`).join(', ')}. Sum=${cv}`,sh:`27×${w.length} - original sum`}; },
        (_) => { const w=['SUN','MAP','KEY'][P(0,2,0)]; const sh=P(1,3,1); const cd=w.split('').map(l=>String.fromCharCode(l.charCodeAt(0)-sh)).join(''); const pos=l=>l.charCodeAt(0)-64; const cv=cd.split('').reduce((a,l)=>a+pos(l),0); return {qt:`"${w}" backward shift ${sh} → "${cd}". Sum of coded positions?`,cv,exp:`${cd.split('').map(l=>`${l}=${pos(l)}`).join(', ')}. Sum = ${cv}`,sh:`Original sum - ${w.length}×${sh} = ${cv}`}; },
        (_) => { const w=['RED','BLUE','GOLD'][P(0,2,0)]; const sh=P(1,3,1); const cd=w.split('').map(l=>String.fromCharCode(l.charCodeAt(0)+sh)).join(''); const cv=cd.split('').reduce((a,l)=>a+String.fromCharCode(l.charCodeAt(0)-sh).charCodeAt(0)-64,0); return {qt:`"${w}" forward shift ${sh} → "${cd}". Decode: sum of original positions?`,cv,exp:`Original positions sum = ${w.split('').reduce((a,l)=>a+l.charCodeAt(0)-64,0)}`,sh:`Original sum = ${cv}`}; },
      ],
      medium: [
        (_) => { const w=['APPLE','MANGO','GRAPE'][P(0,2,0)]; const cd=w.split('').map(l=>String.fromCharCode(155-l.charCodeAt(0))).join(''); const pos=l=>l.charCodeAt(0)-64; const cv=cd.split('').reduce((a,l)=>a+pos(l),0); return {qt:`A↔Z code: "${w}" → "${cd}". Sum of coded letter positions?`,cv,exp:`${cd.split('').map(l=>`${l}=${pos(l)}`).join(', ')}. Sum = ${cv}`,sh:`Each: 27 - original pos. Sum = ${cv}`}; },
        (_) => { const w=['BALL','CALL','FALL'][P(0,2,0)]; const sh=P(1,3,1); const cd=w.split('').map(l=>String.fromCharCode(l.charCodeAt(0)+sh)).join(''); const pos=l=>l.charCodeAt(0)-64; const cv=cd.split('').reduce((a,l)=>a+pos(l),0); return {qt:`"${w}" shift ${sh} → "${cd}". Coded sum of positions?`,cv,exp:`${cd.split('').map(l=>`${l}=${pos(l)}`).join(', ')}. Sum = ${cv}`,sh:`Original sum + ${w.length}×${sh} = ${cv}`}; },
        (_) => { const w=['TIGER','LION','BEAR'][P(0,2,0)]; const cd=w.split('').map(l=>String.fromCharCode(l.charCodeAt(0)+1)).join(''); const pos=l=>l.charCodeAt(0)-64; const cv=cd.split('').reduce((a,l)=>a+pos(l),0); return {qt:`"${w}" each letter +1 → "${cd}". Sum of coded positions?`,cv,exp:`${cd.split('').map(l=>`${l}=${pos(l)}`).join(', ')}. Sum = ${cv}`,sh:`Original sum + ${w.length} = ${cv}`}; },
        (_) => { const w=['MILK','BREAD','RICE'][P(0,2,0)]; const cd=w.split('').map(l=>String.fromCharCode(155-l.charCodeAt(0))).join(''); const cv=cd.split('').reduce((a,l)=>a+(155-l.charCodeAt(0))-64,0); return {qt:`"${w}" → A↔Z code. Decoded sum?`,cv,exp:`Decoded = original letters. Sum = ${w.split('').reduce((a,l)=>a+l.charCodeAt(0)-64,0)}`,sh:`Same as original sum = ${cv}`}; },
        (_) => { const w=['TAP','CAB','RAG'][P(0,2,0)]; const sh=P(1,4,1); const cd=w.split('').map(l=>String.fromCharCode(l.charCodeAt(0)+sh)).join(''); const pos=l=>l.charCodeAt(0)-64; const cv=cd.split('').reduce((a,l,i)=>a+(i+1)*pos(l),0); return {qt:`"${w}" shift ${sh}. Weighted sum of coded (pos × index)?`,cv,exp:`${cd.split('').map((l,i)=>`${l}(${i+1}×${pos(l)})`).join('+')} = ${cv}`,sh:`Weighted sum = ${cv}`}; },
        (_) => { const w=['FISH','BIRD','FROG'][P(0,2,0)]; const cd=w.split('').reverse().join(''); const pos=l=>l.charCodeAt(0)-64; const cv=cd.split('').reduce((a,l)=>a+pos(l),0); return {qt:`"${w}" reversed. Sum of positions?`,cv,exp:`Reverse = "${cd}". ${cd.split('').map(l=>`${l}=${pos(l)}`).join(', ')}. Sum = ${cv}`,sh:`Sum reversed = ${cv}`}; },
      ],
      hard: [
        (_) => { const w=['TABLE','CHAIR','BENCH'][P(0,2,0)]; const sh=P(2,5,1); const cd=w.split('').map(l=>String.fromCharCode(l.charCodeAt(0)+sh)).join(''); const pos=l=>l.charCodeAt(0)-64; const cv=cd.split('').reduce((a,l)=>a+pos(l),0)-w.split('').reduce((a,l)=>a+pos(l),0); return {qt:`"${w}" → "${cd}" (shift ${sh}). Difference in sum of positions?`,cv,exp:`Original sum = ${w.split('').reduce((a,l)=>a+pos(l),0)}. Coded sum = ${cd.split('').reduce((a,l)=>a+pos(l),0)}. Diff = ${cv}`,sh:`${w.length}×${sh} = ${cv}`}; },
        (_) => { const w=['PINK','BLUE','GREY'][P(0,2,0)]; const cd=w.split('').reverse().join(''); const pos=l=>l.charCodeAt(0)-64; const cv=cd.split('').reduce((a,l)=>a+pos(l),0); return {qt:`"${w}" reversed → "${cd}". Sum of positions of reversed?`,cv,exp:`${cd.split('').map(l=>`${l}=${pos(l)}`).join(', ')}. Sum = ${cv}`,sh:`Sum of reversed = ${cv}`}; },
        (_) => { const w=['HOUSE','TIGER','APPLE'][P(0,2,0)]; const sh=P(2,4,1); const cd=w.split('').map((l,i)=>String.fromCharCode(l.charCodeAt(0)+sh+(i%2))).join(''); const pos=l=>l.charCodeAt(0)-64; const cv=cd.split('').reduce((a,l)=>a+pos(l),0); return {qt:`"${w}" coded (shift ${sh}, odd indices +1 extra). Sum?`,cv,exp:`Coded = "${cd}". ${cd.split('').map(l=>`${l}=${pos(l)}`).join(', ')}. Sum = ${cv}`,sh:`Sum = ${cv}`}; },
        (_) => { const w=['CROWD','BRAIN','FLOAT'][P(0,2,0)]; const cd=w.split('').map(l=>String.fromCharCode(155-l.charCodeAt(0))).join(''); const pos=l=>l.charCodeAt(0)-64; const cv=cd.split('').reduce((a,l,i)=>a+pos(l)*(i%2===0?1:-1),0); return {qt:`A↔Z code "${w}" → "${cd}". Alternate sum (+ - + -)?`,cv,exp:`${cd.split('').map((l,i)=>`${i%2===0?'+':'-'}${pos(l)}`).join('').slice(1)} = ${cv}`,sh:`Alternating sum = ${cv}`}; },
        (_) => { const w=['FLAME','CHEST','BRISK'][P(0,2,0)]; const sh=P(1,3,1); const fwd=w.split('').map(l=>String.fromCharCode(l.charCodeAt(0)+sh)).join(''); const rev=fwd.split('').reverse().join(''); const pos=l=>l.charCodeAt(0)-64; const cv=rev.split('').reduce((a,l)=>a+pos(l),0); return {qt:`"${w}" shift+${sh} then reversed. Sum of final positions?`,cv,exp:`Shifted = "${fwd}", reversed = "${rev}". ${rev.split('').map(l=>`${l}=${pos(l)}`).join(', ')}. Sum = ${cv}`,sh:`Sum = ${cv}`}; },
        (_) => { const w=['GREEN','BLACK','WHITE'][P(0,2,0)]; const sh1=P(1,3,1), sh2=P(1,3,2); const cd=w.split('').map((l,i)=>String.fromCharCode(l.charCodeAt(0)+(i%2===0?sh1:sh2))).join(''); const pos=l=>l.charCodeAt(0)-64; const cv=cd.split('').reduce((a,l)=>a+pos(l),0); return {qt:`"${w}" → even+${sh1}, odd+${sh2}. Sum of coded?`,cv,exp:`Coded = "${cd}". ${cd.split('').map(l=>`${l}=${pos(l)}`).join(', ')}. Sum = ${cv}`,sh:`Variable shift = ${cv}`}; },
      ],
    },
    'Blood Relations': {
      easy: [
        (_) => { const f=[{g:70,p:40,c:12},{g:65,p:38,c:10},{g:75,p:45,c:15}][P(0,2,0)]; const cv=f.g-f.c; return {qt:`Grandfather ${f.g}, grandchild ${f.c}. Grandfather's age at grandchild's birth?`,cv,exp:`${f.g} - ${f.c} = ${cv}`,sh:`${f.g}-${f.c}`}; },
        (_) => { const f=[{g:70,p:40,c:12},{g:65,p:38,c:10},{g:75,p:45,c:15}][P(0,2,0)]; const cv=f.p-f.c; return {qt:`Parent ${f.p}, child ${f.c}. Parent's age at child's birth?`,cv,exp:`${f.p} - ${f.c} = ${cv}`,sh:`${f.p}-${f.c}`}; },
        (_) => { const dad=P(35,50,0), child=P(5,15,1); const cv=dad-child; return {qt:`Father ${dad}, child ${child}. Father's age at child's birth?`,cv,exp:`${dad} - ${child} = ${cv}`,sh:`${dad}-${child}`}; },
        (_) => { const a=P(30,50,0), b=P(5,15,1); const cv=a+b; return {qt:`Mother ${a}, daughter ${b}. Sum of their ages?`,cv,exp:`${a}+${b} = ${cv}`,sh:`${a}+${b}`}; },
        (_) => { const g=P(60,80,0), p=P(30,45,1), c=P(5,15,2); const cv=g+p+c; return {qt:`Grandfather ${g}, father ${p}, son ${c}. Sum?`,cv,exp:`${g}+${p}+${c} = ${cv}`,sh:`Add all three`}; },
        (_) => { const dad=P(35,50,0), mom=dad-P(2,6,1); const cv=dad-mom; return {qt:`Father ${dad}, mother ${mom}. Age difference?`,cv,exp:`${dad} - ${mom} = ${cv}`,sh:`${dad}-${mom}`}; },
      ],
      medium: [
        (_) => { const m=P(30,45,0), d=P(5,15,1), y=P(5,10,2); const mf=m+y, df=d+y; const g=(a,b)=>b===0?a:g(b,a%b); const div=g(mf,df); const cv=Math.round((mf/div)/(df/div)*10); return {qt:`Mother ${m}, daughter ${d}. Age ratio after ${y}y?`,cv,exp:`(${m}+${y})/(${d}+${y}) = ${mf}/${df} = ${(mf/df).toFixed(1)}`,sh:`(M+${y})/(D+${y})`}; },
        (_) => { const a=P(20,40,0), q=P(2,5,1); const cv=a*q; return {qt:`B is ${a} years old. A is ${q} times B's age. A's age?`,cv,exp:`A = ${q}×${a} = ${cv}`,sh:`${q}×${a} = ${cv}`}; },
        (_) => { const a=P(25,45,0), b=P(5,15,1); const cv=a-b; return {qt:`A=${a}, B=${b}. How many years ago was A twice B's age?`,cv,exp:`Let x years ago: ${a}-x = 2(${b}-x). Solving: x = ${a-2*b} = ${cv}`,sh:`${a} - 2×${b} = ${cv}`}; },
        (_) => { const m=P(30,45,0), d=P(5,12,1), y=P(3,8,2); const cv=Math.round((m+y)/(d+y)); return {qt:`Mother ${m}, daughter ${d}. Ratio after ${y}y? (nearest)`,cv,exp:`(${m}+${y})/(${d}+${y}) = ${(m+y)/(d+y).toFixed(1)} ≈ ${cv}`,sh:`(M+${y})/(D+${y})`}; },
        (_) => { const a=P(30,50,0), b=P(5,15,1), y=P(5,10,2); const cv=Math.round((a-y)/(b-y)); return {qt:`A=${a}, B=${b}. Ratio of ages ${y}y ago? (nearest)`,cv,exp:`(${a}-${y})/(${b}-${y}) = ${(a-y)/(b-y).toFixed(1)} ≈ ${cv}`,sh:`(A-${y})/(B-${y})`}; },
        (_) => { const f=P(35,50,0), s=P(5,15,1); const cv=f+s+5; return {qt:`Father ${f}, son ${s}. Sum of their ages after 5 years?`,cv,exp:`(${f}+5)+(${s}+5) = ${cv}`,sh:`${f}+${s}+10 = ${cv}`}; },
      ],
      hard: [
        (_) => { const dad=P(35,50,0), son=P(8,18,1), mom=dad-P(2,6,2); const cv=dad-mom; return {qt:`Father ${dad}, mother ${mom}, son ${son}. Father-mother age diff when son was 5?`,cv,exp:`Diff remains ${dad}-${mom} = ${cv}`,sh:`Age diff constant: ${dad}-${mom}`}; },
        (_) => { const a=P(20,40,0), b=P(5,15,1), r=P(3,10,2); const af=a+r, bf=b+r; const cv=Math.round(af/bf); return {qt:`A=${a}, B=${b}. Ratio of ages after ${r}y? (nearest integer)`,cv,exp:`(${a}+${r})/(${b}+${r}) = ${(af/bf).toFixed(1)} ≈ ${cv}`,sh:`(A+${r})/(B+${r})`}; },
        (_) => { const f=P(35,50,0), s=P(5,15,1); const cv=Math.round((f-5)/(s-5)); return {qt:`Father ${f}, son ${s}. Ratio of ages 5 years ago? (nearest)`,cv,exp:`(${f}-5)/(${s}-5) = ${((f-5)/(s-5)).toFixed(1)} ≈ ${cv}`,sh:`(${f}-5)/(${s}-5)`}; },
        (_) => { const g=P(60,80,0), f=P(30,45,1), s=P(5,15,2), y=P(3,8,3); const cv=g+f+s+3*y; return {qt:`Grandpa ${g}, father ${f}, son ${s}. Sum after ${y}y?`,cv,exp:`(${g}+${y})+(${f}+${y})+(${s}+${y}) = ${cv}`,sh:`${g+f+s}+${3*y} = ${cv}`}; },
        (_) => { const a=P(25,45,0), b=P(5,15,1); const cv=Math.round((a-2*b)); return {qt:`A=${a}, B=${b}. In how many years will A be twice B?`,cv,exp:`${a}+x = 2(${b}+x) → x = ${a-2*b} = ${cv}`,sh:`${a} - 2×${b} = ${cv}`}; },
        (_) => { const mom=P(30,45,0), son=P(5,12,1), dad=mom+P(2,6,2); const cv=Math.round((dad+son+mom)/3); return {qt:`Mom ${mom}, dad ${dad}, son ${son}. Average age?`,cv,exp:`(${mom}+${dad}+${son})/3 = ${cv}`,sh:`Sum/3 = ${cv}`}; },
      ],
    },
    'Seating Arrangement': {
      easy: [
        (_) => { const t=P(8,15,0), p=P(2,P(8,14,1),1); const cv=t-p+1; return {qt:`${t} students. X is ${p}th from left. Position from right?`,cv,exp:`${t} - ${p} + 1 = ${cv}`,sh:`${t}-${p}+1`}; },
        (_) => { const t=P(8,15,0), p=P(2,t-1,1); const cv=t-p+1; return {qt:`Row of ${t}. R is ${p}th from right. Position from left?`,cv,exp:`${t} - ${p} + 1 = ${cv}`,sh:`${t}-${p}+1`}; },
        (_) => { const t=P(8,15,0), a=P(2,t-1,1), b=P(2,t-1,2); const cv=a+b-1; return {qt:`${t} chairs. A at position ${a}, B at position ${b} from left. People between them?`,cv,exp:`Between = ${Math.abs(a-b)} - 1 = ${Math.abs(a-b)-1 >= 0 ? Math.abs(a-b)-1 : 0}`,sh:`|${a}-${b}|-1`}; },
        (_) => { const t=P(9,15,0), p=P(3,t-2,1); const cv=t-p+1; return {qt:`${t} in a row. X is ${p}th from right. How many to X's left?`,cv,exp:`${t} - ${p} = ${cv}`,sh:`${t}-${p}`}; },
        (_) => { const t=P(10,18,0), f=P(2,6,1), l=P(2,6,2); const cv=t-f-l+1; return {qt:`${t} in queue. First person at position ${f} from left, last at ${l} from right. Total people in between?`,cv,exp:`Between = ${t-f-l+1}`,sh:`${t}-${f}-${l}+1`}; },
        (_) => { const t=P(8,12,0), a=P(2,4,1), b=P(t-3,t-1,2); const cv=t-a-b+2; return {qt:`${t} chairs. A ${a} from left, B ${b} from right. How many between? (if positions don't overlap)`,cv,exp:`Between = ${t-a-b+2 >= 0 ? t-a-b+2 : 0}`,sh:`${t}-${a}-${b}+2`}; },
      ],
      medium: [
        (_) => { const t=P(8,12,0), a=P(3,t-2,1), b=P(3,t-2,2); const cv=a+b-t-2>0?a+b-t-2:0; return {qt:`${t} persons. A ${a}th from left, B ${b}th from right. Between them?`,cv,exp:`${a}+${b}-${t}-2 = ${cv}${cv<=0?' (no one)':''}`,sh:`${a}+${b}-${t}-2`}; },
        (_) => { const t=P(9,15,0), a=P(3,t-3,1), b=P(3,t-3,2); const cv=a+b-1< t?t-(a+b-1):0; return {qt:`${t} in row. A ${a}th from left, B ${b}th from left. People to right of B?`,cv,exp:`Right of B = ${t} - ${b} = ${cv}`,sh:`${t}-${b}`}; },
        (_) => { const t=P(10,15,0), a=P(3,Math.floor(t/2),1), b=P(3,Math.floor(t/2),2); const cv=Math.abs(a-b)-1; return {qt:`${t} people. A at ${a}, B at ${b} from left. How many between?`,cv,exp:`Between = |${a}-${b}| - 1 = ${cv}`,sh:`|${a}-${b}|-1`}; },
        (_) => { const t=P(9,13,0); const mid=Math.ceil(t/2); const cv=mid; return {qt:`${t} persons in a row. Position of the middle person?`,cv,exp:`Middle = (${t}+1)/2 = ${mid}`,sh:`(${t}+1)/2 = ${mid}`}; },
        (_) => { const t=P(10,16,0), a=P(4,t-3,1), b=P(a+1,t-2,2); const cv=t-b; return {qt:`${t} chairs. A at ${a}, B at ${b} from left. How many to right of B?`,cv,exp:`Right of B = ${t} - ${b} = ${cv}`,sh:`${t}-${b}`}; },
        (_) => { const t=P(9,15,0), a=P(2,4,1), b=P(t-4,t-2,2); const cv=t-a-b+2>0?t-a-b+2:0; return {qt:`${t} students. A ${a} from left, B ${b} from right. Students between?`,cv,exp:`Between = ${a}+(${t}-${b}+1)-1 = ${t-a-b+2>0?t-a-b+2:0}`,sh:`${t-a-b+2}`}; },
      ],
      hard: [
        (_) => { const t=P(10,18,0), a=P(3,6,1), b=P(3,6,2), bt=P(2,5,3); const cv=a+bt+b; return {qt:`${t} people. A ${a}th from left, B ${b}th from right, ${bt} between. Total from A's extreme left to B's extreme right?`,cv,exp:`${a}+${bt}+${b} = ${cv}`,sh:`${a}+${bt}+${b}`}; },
        (_) => { const t=P(8,14,0); const l=P(2,Math.floor(t/2),1); const r=P(2,t-l,2); const cv=l+r-1; return {qt:`${t} chairs. A sits ${l} from left, B sits ${r} from right. Chairs between them? (no overlap)`,cv,exp:`Chairs between = ${cv < t ? t-cv-l+1-r+1 : 0}`,sh:`${t}-${l}-${r}`}; },
        (_) => { const t=P(10,16,0), a=P(4,Math.floor(t/2),1), b=P(Math.floor(t/2)+1,t-2,2), bt=P(2,4,3); const cv=a+bt+b; return {qt:`${t} seats. A from left = ${a}, B from right = ${b}, ${bt} between them. Total from left of A to right of B?`,cv,exp:`${a}+${bt}+${b} = ${cv}`,sh:`${a}+${bt}+${b}=${cv}`}; },
        (_) => { const t=P(8,14,0); const a=P(2,3,1), b=P(t-3,t-2,2); const cv=t-a-b+1; return {qt:`${t} chairs. A ${a} from left, B ${b} from left (to the right of A). How many chairs between A and B?`,cv,exp:`Between B and A = ${b-a-1}`,sh:`${b}-${a}-1 = ${b-a-1}`}; },
        (_) => { const t=P(10,16,0), a=P(3,Math.floor(t/3),1); const cv=t-a+1; return {qt:`${t} people. A is ${a}th from left in a circular arrangement. Position from right?`,cv,exp:`In circle, right pos = ${t} - ${a} + 1 = ${cv}`,sh:`${t}-${a}+1 = ${cv}`}; },
        (_) => { const t=P(10,15,0), a=P(4,t-3,1), b=P(2,t-4,2); const cv=a+b-1; return {qt:`${t} persons. A ${a} from left, B ${b} from right. If they swap, B's new position from left?`,cv,exp:`If A is ${a} from left, after swap B is at A's old pos = ${a} from left = ${cv}`,sh:`B moves to ${a}`}; },
      ],
    },
    'Puzzles': {
      easy: [
        (_) => { const a=P(1,9,0), b=P(1,9,1); const cv=a*10+b; return {qt:`Tens=${a}, units=${b}. The 2-digit number?`,cv,exp:`${a}×10+${b} = ${cv}`,sh:`${a}×10+${b}`}; },
        (_) => { const a=P(1,9,0), b=P(1,9,1); const cv=a+b; return {qt:`Sum of digits of number ${a}${b}?`,cv,exp:`${a}+${b} = ${cv}`,sh:`${a}+${b}`}; },
        (_) => { const a=P(1,9,0), b=P(1,9,1); const cv=Math.abs(a*10+b-(b*10+a)); return {qt:`Difference between ${a}${b} and its reverse?`,cv,exp:`|${a*10+b}-${b*10+a}| = ${Math.abs(a*10+b-(b*10+a))}`,sh:`9×|${a}-${b}| = ${cv}`}; },
        (_) => { const a=P(1,9,0), b=P(1,9,1); const cv=a*b; return {qt:`Product of digits of ${a}${b}?`,cv,exp:`${a}×${b} = ${cv}`,sh:`${a}×${b}`}; },
        (_) => { const a=P(1,9,0); const cv=a*100+a*10+a; return {qt:`3-digit number with all digits = ${a}. The number?`,cv,exp:`${a}×100+${a}×10+${a} = ${cv}`,sh:`${a}×111 = ${cv}`}; },
        (_) => { const a=P(1,4,0), b=P(1,4,1); const n=a*10+b; const cv=n%2===0?1:0; return {qt:`Is ${a}${b} even? (1=yes,0=no)`,cv,exp:`Last digit = ${b}. ${b%2===0?'Even':'Odd'}`,sh:`Check last digit`}; },
      ],
      medium: [
        (_) => { const a=P(2,8,0), b=P(1,9,1); const s=a+b, p=a*b; const disc=s*s-4*p; const r1=Math.round((s+Math.sqrt(disc))/2); const cv=r1; return {qt:`Sum=${s}, product=${p}. Larger number?`,cv,exp:`Roots of t²-${s}t+${p}=0: ${r1} and ${s-r1}`,sh:`(${s}+√${disc})/2 = ${cv}`}; },
        (_) => { const a=P(1,9,0), b=P(0,9,1), c=P(0,9,2); const n=a*100+b*10+c; const cv=Math.floor(a)+Math.floor(b)+Math.floor(c); return {qt:`Sum of digits of ${n}?`,cv,exp:`${a}+${b}+${c} = ${cv}`,sh:`Add digits`}; },
        (_) => { const a=P(1,9,0), b=P(1,9,1); const n=a*10+b; const rev=b*10+a; const cv=n+rev; return {qt:`${a}${b} + ${b}${a} = ?`,cv,exp:`${n}+${rev} = ${cv}`,sh:`11×(${a}+${b}) = ${11*(a+b)}`}; },
        (_) => { const a=P(1,5,0); const n=a*10+(a+1); const cv=n+(a+1)*10+a; return {qt:`${a}${a+1} + ${a+1}${a} = ?`,cv,exp:`${n}+${(a+1)*10+a} = ${cv}`,sh:`11×${2*a+1} = ${11*(2*a+1)}`}; },
        (_) => { const a=P(1,9,0), b=P(1,9,1), d=Math.abs(a-b); const n=a*10+b; const cv=n; return {qt:`Two-digit number: digits differ by ${d}, number > reverse by ${Math.abs(a*10+b-(b*10+a))}. Tens digit = ${a}. Number?`,cv,exp:`Number = ${a}${b} = ${cv}`,sh:`${a}${b}`}; },
        (_) => { const a=P(2,8,0), b=P(1,5,1); const cv=Math.round((a*b)/(a+b)); return {qt:`If sum of two numbers = ${a+b} and product = ${a*b}, find the harmonic mean (approx)?`,cv,exp:`HM = 2ab/(a+b) = 2×${a}×${b}/${a+b} = ${Math.round(2*a*b/(a+b))}`,sh:`2ab/(a+b) = ${cv}`}; },
      ],
      hard: [
        (_) => { const a=P(1,4,0), b=P(1,4,1), c=P(0,9,2); const n=a*100+b*10+c; const r=c*100+b*10+a; const cv=Math.abs(n-r); return {qt:`${n} reversed. Positive difference?`,cv,exp:`|${n} - ${r}| = ${cv}`,sh:`|${n}-${r}| = ${cv}`}; },
        (_) => { const a=P(1,9,0), b=P(1,9,1), c=P(1,9,2); const abc=a*100+b*10+c, cba=c*100+b*10+a; const cv=Math.abs(abc-cba); return {qt:`3-digit ${abc} reversed. Difference?`,cv,exp:`|${abc}-${cba}| = ${cv}`,sh:`99×|${a}-${c}| = ${cv}`}; },
        (_) => { const a=P(1,9,0), b=P(0,9,1), c=P(0,9,2); const n=a*100+b*10+c; const pal=a*100+b*10+a; const cv=n+1; return {qt:`${n}. Find the next palindrome?`,cv,exp:`Next palindrome = ${pal > n ? pal : (a*100+b*10+a)}`,sh:`Find next palindrome`}; },
        (_) => { const a=P(1,9,0), b=P(1,9,1), c=P(1,9,2); const abc=a*100+b*10+c; const s=a+b+c; const cv=s; return {qt:`3-digit number ${abc}. Sum of its digits = ?`,cv,exp:`${a}+${b}+${c} = ${cv}`,sh:`Add digits`}; },
        (_) => { const a=P(1,9,0), b=P(0,9,1); const n=a*100+b*10+a; const cv=n; return {qt:`3-digit palindrome: hundreds=units=${a}, tens=${b}. Number?`,cv,exp:`${a}${b}${a} = ${n}`,sh:`${a}${b}${a}`}; },
        (_) => { const a=P(1,4,0), b=P(1,4,1), c=P(1,4,2), d=P(1,4,3); const s=a*1000+b*100+c*10+d; const r=d*1000+c*100+b*10+a; const cv=Math.abs(s-r); return {qt:`4-digit ${s} reversed. Difference?`,cv,exp:`|${s} - ${r}| = ${Math.abs(s-r)}`,sh:`999×(hundreds digit diff) + 90×(tens diff)`}; },
      ],
    },
  };

  const conceptTemplates = T[concept];
  const diffTemplates = conceptTemplates[diffKey] || conceptTemplates.medium;
  const variant = diffTemplates[index % diffTemplates.length](seed);

  const { options, correct_option } = buildOptions(variant.cv, seed + 50);
  return {
    question_text: variant.qt,
    options,
    correct_option,
    explanation: variant.exp,
    shortcut: variant.sh,
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
