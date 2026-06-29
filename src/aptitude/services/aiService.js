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
      ],
      medium: [
        (_) => { const b=P(300,900,0), o=P(150,400,1); const i=b-o; const cv=Math.round(i/o*100); return {qt:`Revenue rose from ₹${o} to ₹${b}. What is the % increase?`,cv,exp:`((${b}-${o})/${o})×100 = ${cv}%`,sh:`(${i}/${o})×100 = ${cv}%`}; },
        (_) => { const b=P(400,1000,0), n=P(250,700,1); const d=b-n; const cv=Math.round(d/b*100); return {qt:`A population fell from ${b} to ${n}. What is the % decrease?`,cv,exp:`((${b}-${n})/${b})×100 = ${cv}%`,sh:`(${d}/${b})×100`}; },
      ],
      hard: [
        (_) => { const b=P(5000,25000,0), f=P(10,30,1), sc=P(10,20,2); const a1=Math.round(b*(100+f)/100); const cv=Math.round(a1*(100-sc)/100); return {qt:`Town pop ${b}. Increases ${f}% year1, decreases ${sc}% year2. Pop after 2 years?`,cv,exp:`${b}×(${100+f}/100)×(${100-sc}/100) = ${cv}`,sh:`${b}×(1+${f}/100)×(1-${sc}/100)`}; },
        (_) => { const s=P(8000,30000,0), r=P(10,25,1), f=P(5,15,2); const a1=Math.round(s*(100+r)/100); const cv=a1-Math.round(a1*f/100); return {qt:`Salary ₹${s} raised ${r}% then cut ${f}%. Final salary?`,cv,exp:`${s}×(${100+r}/100)×(${100-f}/100) = ${cv}`,sh:`Net change = ${100+r}×${100-f}/10000 - 1 = ${Math.round((100+r)*(100-f)/10000*100-100)}%`}; },
      ],
    },
    'Profit and Loss': {
      easy: [
        (_) => { const c=P(250,900,0), p=P(10,45,1); const cv=Math.round(c*p/100); return {qt:`Bought for ₹${c} sold at ${p}% profit. Profit amount?`,cv,exp:`(${p}/100)×${c} = ₹${cv}`,sh:`(${p}×${c})/100 = ${cv}`}; },
        (_) => { const c=P(200,600,0), l=P(8,20,1); const cv=Math.round(c*l/100); return {qt:`Bought for ₹${c} sold at ${l}% loss. Loss amount?`,cv,exp:`(${l}/100)×${c} = ₹${cv}`,sh:`(${l}×${c})/100`}; },
        (_) => { const c=P(300,700,0), g=P(10,25,1); const cv=Math.round(c*(100+g)/100); return {qt:`CP ₹${c}, gain ${g}%. SP?`,cv,exp:`${c}×(${100+g}/100) = ₹${cv}`,sh:`${c}×${100+g}/100`}; },
      ],
      medium: [
        (_) => { const c=P(300,800,0), g=P(12,30,1); const cv=Math.round(c*(100+g)/100); return {qt:`An item costing ₹${c} sold at ${g}% profit. SP?`,cv,exp:`SP = ${c}×(${100+g}/100) = ₹${cv}`,sh:`${c}×${100+g}/100`}; },
        (_) => { const s=P(400,900,0), p=P(10,25,1); const cv=Math.round(s*100/(100+p)); return {qt:`Sold at ₹${s} with ${p}% profit. CP?`,cv,exp:`CP = (100×${s})/(100+${p}) = ₹${cv}`,sh:`(100×${s})/${100+p}`}; },
      ],
      hard: [
        (_) => { const c=P(200,800,0), m=Math.round(c*P(140,200,1)/100), d=P(10,30,2); const sp=Math.round(m*(100-d)/100); const cv=sp-c; return {qt:`CP ₹${c}, MP ₹${m}, ${d}% discount. Profit or loss?`,cv,exp:`SP = ${m}×(${100-d}/100) = ₹${sp}. ${cv>=0?'Profit':'Loss'} = ${sp}-${c} = ${Math.abs(cv)}`,sh:`SP = ${m}×${100-d}/100 = ${sp}`}; },
        (_) => { const c=P(100,500,0), s=P(150,600,1); const cv=Math.round((s-c)/c*100); return {qt:`CP ₹${c}, SP ₹${s}. Profit %?`,cv,exp:`(${s-c}/${c})×100 = ${cv}%`,sh:`(${s-c}/${c})×100`}; },
      ],
    },
    'Ratio and Proportion': {
      easy: [
        (_) => { const a=P(2,8,0), b=P(3,12,1), m=P(5,15,2); const cv=a*m; return {qt:`Ratio A:B = ${a}:${b}. B = ${b*m}. Find A.`,cv,exp:`A = ${a}×(${b*m}/${b}) = ${cv}`,sh:`${a}×${m} = ${cv}`}; },
        (_) => { const a=P(2,5,0), b=P(3,8,1), t=P(30,90,2); const cv=Math.round(t*a/(a+b)); return {qt:`₹${t} divided between A and B in ratio ${a}:${b}. A's share?`,cv,exp:`(${a}/${a+b})×${t} = ₹${cv}`,sh:`(${a}/${a+b})×${t}`}; },
      ],
      medium: [
        (_) => { const a=P(3,9,0), b=P(5,12,1), c=P(6,15,2); const cv=a*c; return {qt:`a:b = ${a}:${b}, b:c = ${b}:${c}. a:c?`,cv,exp:`a:c = ${a}×${c} : ${b}×${b} = ${cv}:${b*b}`,sh:`${a}×${c} = ${cv}`}; },
      ],
      hard: [
        (_) => { const t=P(60,200,0), a=P(2,5,1), b=P(3,7,2), c=P(4,9,3); const s=a+b+c; const cv=Math.round(t*a/s); return {qt:`₹${t} divided A:B:C = ${a}:${b}:${c}. A's share?`,cv,exp:`(${a}/${s})×${t} = ₹${cv}`,sh:`(${a}/${s})×${t} = ₹${cv}`}; },
        (_) => { const x=P(2,6,0), y=P(3,8,1), d=P(10,40,2); const cv=Math.round(d*x/(x+y)); return {qt:`${d} pens shared in ratio ${x}:${y}. Smaller share?`,cv,exp:`(${Math.min(x,y)}/${x+y})×${d} = ${cv}`,sh:`Use smaller ratio part / total ratio × total`}; },
      ],
    },
    'Time and Work': {
      easy: [
        (_) => { const a=P(4,10,0), b=P(6,14,1); const cv=Math.round(a*b/(a+b)); return {qt:`A: ${a} days, B: ${b} days. Together?`,cv,exp:`AB/(A+B) = ${a*b}/(${a+b}) = ${cv} days`,sh:`(${a}×${b})/(${a}+${b}) = ${cv}`}; },
        (_) => { const a=P(6,12,0), t=P(3,6,1); const cv=Math.round(a*t/(t-a)); return {qt:`A alone ${a} days, A+B together ${t} days. B alone?`,cv,exp:`1/B = 1/${t} - 1/${a} = ${(1/t-1/a).toFixed(3)}. B = ${cv}`,sh:`B = (${a}×${t})/(${a}-${t}) = ${cv}`}; },
      ],
      medium: [
        (_) => { const a=P(5,10,0), b=P(8,15,1), c=P(10,20,2); const cv=Math.round(1/(1/a+1/b-1/c)); return {qt:`A ${a}d, B ${b}d, C destroys in ${c}d. Together?`,cv,exp:`Rate = 1/${a}+1/${b}-1/${c}. Time = ${cv}d`,sh:`1/(1/${a}+1/${b}-1/${c})`}; },
      ],
      hard: [
        (_) => { const a=P(6,12,0), b=P(8,16,1), d=P(2,5,2), rem=1-d/a; const cv=Math.round(rem/(1/a+1/b)); return {qt:`A:${a}d, B:${b}d. A works ${d}d then B joins. More days needed?`,cv,exp:`Remaining = 1-${d}/${a}. Time = ${rem.toFixed(2)}/(1/${a}+1/${b}) = ${cv}d`,sh:`Remaining / combined rate`}; },
        (_) => { const a=P(8,15,0), b=P(12,20,1), c=P(15,25,2); const cv=Math.round(1/(1/a+1/b+1/c)); return {qt:`A:${a}d, B:${b}d, C:${c}d. All three together?`,cv,exp:`1/(1/${a}+1/${b}+1/${c}) = ${cv}d`,sh:`1/(1/${a}+1/${b}+1/${c})`}; },
      ],
    },
    'Time, Speed and Distance': {
      easy: [
        (_) => { const sp=P(30,70,0), t=P(2,5,1); const cv=sp*t; return {qt:`Speed ${sp} km/h for ${t}h. Distance?`,cv,exp:`${sp}×${t} = ${cv} km`,sh:`${sp}×${t} = ${cv}`}; },
        (_) => { const d=P(100,300,0), t=P(2,5,1); const cv=Math.round(d/t); return {qt:`Covers ${d} km in ${t}h. Speed?`,cv,exp:`${d}/${t} = ${cv} km/h`,sh:`${d}/${t} = ${cv}`}; },
      ],
      medium: [
        (_) => { const sp=P(30,60,0), d=P(150,350,1); const cv=Math.round(d/sp*60); return {qt:`Covers ${d} km at ${sp} km/h. Time in minutes?`,cv,exp:`(${d}/${sp})×60 = ${cv} min`,sh:`(${d}/${sp})×60`}; },
        (_) => { const d=P(200,500,0), t=P(3,6,1); const cv=Math.round(d/t); return {qt:`${d} km in ${t}h. Speed in m/s?`,cv,exp:`Speed = ${d}/${t} = ${Math.round(d/t)} km/h = ${Math.round(d/t*5/18)} m/s`,sh:`(${d}/${t})×5/18`}; },
      ],
      hard: [
        (_) => { const d=P(300,900,0), a=P(40,70,1), b=P(30,60,2); const cv=Math.round(d/(a+b)*60); return {qt:`${d} km apart, A=${a} km/h, B=${b} km/h towards. Meet after? (min)`,cv,exp:`Rel speed = ${a+b} km/h. Time = (${d}/${a+b})×60 = ${cv} min`,sh:`(${d}/${a+b})×60`}; },
        (_) => { const d=P(150,400,0), a=P(40,60,1), b=P(30,50,2); const cv=Math.round(d/Math.abs(a-b)*60); return {qt:`${d} km apart, A=${a} km/h, B=${b} km/h same direction. Overtake after? (min)`,cv,exp:`Rel speed = ${Math.abs(a-b)} km/h. Time = (${d}/${Math.abs(a-b)})×60 = ${cv} min`,sh:`(${d}/${Math.abs(a-b)})×60`}; },
      ],
    },
    'Number System': {
      easy: [
        (_) => { const a=P(15,90,0), b=P(8,22,1); const cv=a+b; return {qt:`What is ${a} + ${b}?`,cv,exp:`${a}+${b} = ${cv}`,sh:`Simple addition`}; },
        (_) => { const a=P(12,50,0), b=P(4,11,1); const cv=Math.floor(a/b); return {qt:`Quotient when ${a} ÷ ${b}?`,cv,exp:`${b}×${cv} = ${b*cv}, remainder ${a-b*cv}`,sh:`${Math.floor(a/b)}`}; },
        (_) => { const d=P(2,9,0), u=P(1,9,1); const cv=d*10+u; return {qt:`${d} tens + ${u} units = ?`,cv,exp:`${d}×10+${u} = ${cv}`,sh:`${d}×10+${u}`}; },
      ],
      medium: [
        (_) => { const a=P(12,50,0), b=P(4,11,1); const cv=Math.floor(a/b); const r=a-b*cv; return {qt:`Quotient & remainder when ${a} ÷ ${b}?`,cv,exp:`${b}×${cv}+${r} = ${a}`,sh:`Quotient = ${cv}`}; },
        (_) => { const n=P(15,60,0), d=P(2,7,1); const cv=n*d; return {qt:`A number divided by ${d} gives ${n}. The number?`,cv,exp:`${d}×${n} = ${cv}`,sh:`${d}×${n}`}; },
      ],
      hard: [
        (_) => { const n=P(3,7,0), a=P(3,9,1), d=P(4,12,2); const l=a+(n-1)*d; const cv=n*(a+l)/2; return {qt:`Sum of ${n} terms of AP: start=${a}, diff=${d}?`,cv,exp:`Sum = ${n}/2×(${a}+${l}) = ${cv}`,sh:`${n}/2×[2×${a}+(${n-1})×${d}]`}; },
        (_) => { const cv=P(10,90,0), d=P(2,9,1); const t=cv/d; const r=cv% d; return {qt:`${cv} ÷ ${d}: quotient?`,cv,exp:`${d}×${t} + ${r} = ${cv}. Quotient = ${t}`,sh:`${t} remainder ${r}`}; },
      ],
    },
    'Simplification': {
      easy: [
        (_) => { const a=P(20,40,0), b=P(2,9,1); const cv=Math.round(a/b); return {qt:`${a} ÷ ${b} = ?`,cv,exp:`${a}/${b} = ${cv}`,sh:`${a}÷${b} = ${cv}`}; },
        (_) => { const a=P(12,25,0), b=P(3,8,1); const cv=a+b; return {qt:`${a} + ${b} = ?`,cv,exp:`${a}+${b} = ${cv}`,sh:`Simple addition`}; },
      ],
      medium: [
        (_) => { const a=P(12,30,0), b=P(2,8,1), c=P(3,7,2); const cv=Math.round(a*b/c); return {qt:`(${a} × ${b}) ÷ ${c} = ?`,cv,exp:`(${a*b})/${c} = ${cv}`,sh:`${a}×${b}÷${c}`}; },
        (_) => { const a=P(10,25,0), b=P(2,7,1), c=P(2,6,2); const cv=Math.round((a+b)/c); return {qt:`(${a} + ${b}) ÷ ${c} = ?`,cv,exp:`(${a+b})/${c} = ${cv}`,sh:`(${a}+${b})÷${c}`}; },
      ],
      hard: [
        (_) => { const a=P(2,6,0), b=P(2,5,1), c=P(3,8,2); const r=(a+b)*c; const cv=r-a*c; return {qt:`(${a}+${b})×${c} - ${a}×${c} = ?`,cv,exp:`(${a+b})×${c} - ${a*c} = ${cv}`,sh:`Simplify: ${a+b}×${c} - ${a*c}`}; },
        (_) => { const a=P(5,15,0), b=P(2,6,1); const cv=a*a-b*b; return {qt:`${a}² - ${b}² = ?`,cv,exp:`${a*a} - ${b*b} = ${cv}`,sh:`${a}² - ${b}² = ${cv}`}; },
      ],
    },
    'Averages': {
      easy: [
        (_) => { const n=P(3,6,0), av=P(15,35,1); const cv=av*n; return {qt:`Average of ${n} nos = ${av}. Sum?`,cv,exp:`${av}×${n} = ${cv}`,sh:`${av}×${n} = ${cv}`}; },
        (_) => { const n=P(3,5,0); const v=Array.from({length:n},(_,i)=>P(10,40,2+i)); const s=v.reduce((a,b)=>a+b,0); const cv=Math.round(s/n); return {qt:`Numbers: ${v.join(', ')}. Average?`,cv,exp:`(${v.join('+')})/${n} = ${s}/${n} = ${cv}`,sh:`Sum/Count = ${cv}`}; },
      ],
      medium: [
        (_) => { const n=P(4,6,0), a=P(20,40,1), x=P(30,60,2); const ns=a*n+x; const cv=Math.round(ns/(n+1)); return {qt:`Avg of ${n} nos = ${a}. ${x} added. New avg?`,cv,exp:`(${a*n}+${x})/${n+1} = ${cv}`,sh:`(${a*n}+${x})/${n+1} = ${cv}`}; },
        (_) => { const n=P(3,6,0), a=P(15,35,1), x=P(5,20,2); const ns=a*n-x; const cv=Math.round(ns/(n-1)); return {qt:`Avg of ${n} nos = ${a}. One '${x}' removed. New avg?`,cv,exp:`(${a*n}-${x})/${n-1} = ${cv}`,sh:`(${a*n}-${x})/${n-1}`}; },
      ],
      hard: [
        (_) => { const n=P(4,7,0), a=P(25,50,1), r=P(15,40,2), x=P(40,70,3); const cv=Math.round(a+(x-r)/n); return {qt:`Avg ${n} nos = ${a}. ${r} replaced by ${x}. New avg?`,cv,exp:`New avg = ${a}+(${x}-${r})/${n} = ${cv}`,sh:`${a}+(${x}-${r})/${n}`}; },
      ],
    },
    'Mixtures and Allegations': {
      easy: [
        (_) => { const vA=P(10,50,0), cA=P(10,30,1), vB=P(10,50,2), cB=P(40,70,3); const tv=vA+vB; const cv=Math.round((vA*cA+vB*cB)/tv); return {qt:`${vA}L ${cA}% + ${vB}L ${cB}%. Mix concentration?`,cv,exp:`(${vA}×${cA}+${vB}×${cB})/${tv} = ${cv}%`,sh:`Weighted avg = ${cv}%`}; },
        (_) => { const qA=P(10,30,0), pA=P(20,50,1), qB=P(10,30,2), pB=P(60,100,3); const tq=qA+qB; const cv=Math.round((qA*pA+qB*pB)/tq); return {qt:`${qA}kg @₹${pA}/kg + ${qB}kg @₹${pB}/kg. Cost per kg?`,cv,exp:`(${qA}×${pA}+${qB}×${pB})/${tq} = ₹${cv}`,sh:`₹${cv}/kg`}; },
      ],
      medium: [
        (_) => { const qA=P(10,30,0), pA=P(20,50,1), qB=P(10,30,2), pB=P(60,100,3); const tq=qA+qB; const cv=Math.round((qA*pA+qB*pB)/tq); return {qt:`${qA}kg ₹${pA}/kg + ${qB}kg ₹${pB}/kg tea. Avg price/kg?`,cv,exp:`(${qA*pA}+${qB*pB})/${tq} = ₹${cv}`,sh:`Weighted average = ₹${cv}`}; },
      ],
      hard: [
        (_) => { const v=P(20,60,0), c=P(20,40,1), r=P(5,15,2), rc=P(0,10,3); const ts=((v-r)*c+r*rc)/100; const cv=Math.round(ts/v*100); return {qt:`${v}L ${c}% solution. ${r}L replaced with ${rc}%. New conc?`,cv,exp:`New conc = (${(v-r)*c/100}+${r*rc/100})/${v}×100 = ${cv}%`,sh:`(solute after replace)/total × 100`}; },
      ],
    },
    'Permutation and Combination': {
      easy: [
        (_) => { const n=P(4,7,0); const f=[1,2,6,24,120,720,5040]; const cv=f[n-1]; return {qt:`Ways to arrange ${n} distinct books?`,cv,exp:`${n}! = ${cv}`,sh:`${n}! = ${cv}`}; },
        (_) => { const n=P(5,10,0); const cv=n*(n-1); return {qt:`Ways to pick president & VP from ${n} candidates?`,cv,exp:`${n}P2 = ${n}×${n-1} = ${cv}`,sh:`${n}×${n-1}`}; },
      ],
      medium: [
        (_) => { const n=P(5,8,0), r=2; const cv=n*(n-1); return {qt:`Ways ${r} prizes awarded to ${n} students (max 1 each)?`,cv,exp:`${n}P${r} = ${n}×${n-1} = ${cv}`,sh:`${n}P${r} = ${cv}`}; },
        (_) => { const n=P(5,8,0), r=3; let cv=n; for(let i=0;i<r;i++)cv*=(n-i); return {qt:`Ways ${r} distinct prizes to ${n} students?`,cv,exp:`${n}P${r} = ${n}×${n-1}×${n-2} = ${cv}`,sh:`${n}P${r} = ${cv}`}; },
      ],
      hard: [
        (_) => { const n=P(5,7,0), r=P(2,3,1); let cv=n; for(let i=0;i<r;i++)cv*=(n-i); const d=[1,1,2,6][r]; cv=Math.round(cv/d); return {qt:`Ways to choose ${r} from ${n} candidates for a committee?`,cv,exp:`${n}C${r} = ${n}!/(${r}!(${n}-${r})!) = ${cv}`,sh:`${n}C${r} = ${cv}`}; },
        (_) => { const n=P(6,10,0), r=Math.round(n/2); let num=n; for(let i=0;i<r;i++)num*=(n-i); let den=1; for(let i=2;i<=r;i++)den*=i; const cv=Math.round(num/den); return {qt:`Ways to form ${r}-member team from ${n} people?`,cv,exp:`${n}C${r} = ${cv}`,sh:`${n}C${r} = ${cv}`}; },
      ],
    },
    'Probability': {
      easy: [
        (_) => { const t=P(6,12,0), f=P(2,5,1); const cv=Math.round(f/t*100); return {qt:`${t} balls, ${f} red. P(red) in %?`,cv,exp:`(${f}/${t})×100 = ${cv}%`,sh:`${f}/${t} = ${cv}%`}; },
        (_) => { const t=P(4,10,0), f=P(1,3,1); const cv=Math.round(f/t*100); return {qt:`Die rolled. P(${f} or less) in %?`,cv,exp:`(${f}/${t})×100 = ${cv}%`,sh:`${f}/${t}×100`}; },
      ],
      medium: [
        (_) => { const t=P(6,10,0), r=P(2,5,1); const b=t-r; const cv=Math.round((r/t+b/t)*100); return {qt:`${r} red, ${b} blue balls. P(red or blue) %?`,cv,exp:`(${r}+${b})/${t} = 1 = ${cv}%`,sh:`Certain event = 100%`}; },
        (_) => { const d=P(1,6,0), c=P(1,6,1); const cv=d/c; return {qt:`Die rolled. P(multiple of ${d})? Express as numerator.`,cv,exp:`Favorable = ${Math.floor(6/d)}. P = ${Math.floor(6/d)}/6`}; },
      ],
      hard: [
        (_) => { const t=P(6,10,0), r=P(2,4,1), b=P(2,4,2); const g=t-r-b; const cv=Math.round(r/t*(r-1)/(t-1)*100); return {qt:`${r}R, ${b}B${g>0?`, ${g}G`:''}. 2 drawn w/o replacement. P(both red) %?`,cv,exp:`(${r}/${t})×(${r-1}/${t-1})×100 = ${cv}%`,sh:`(${r}/${t})×(${r-1}/${t-1})`}; },
        (_) => { const t=P(6,10,0), r=P(2,4,1), b=t-r; const cv=Math.round(r/t*b/(t-1)*100); return {qt:`${r}R, ${b}B. Two drawn w/o replacement. P(one red, one blue) %?`,cv,exp:`2×(${r}/${t})×(${b}/${t-1})×100 = ${cv}%`,sh:`2×(${r}/${t})×(${b}/${t-1})`}; },
      ],
    },
    'Simple Interest': {
      easy: [
        (_) => { const p=P(1000,8000,0), r=P(5,12,1), t=P(2,5,2); const cv=Math.round(p*r*t/100); return {qt:`SI on ₹${p} at ${r}% for ${t}y?`,cv,exp:`(${p}×${r}×${t})/100 = ₹${cv}`,sh:`(${p}×${r}×${t})/100`}; },
        (_) => { const p=P(2000,6000,0), r=P(6,10,1), t=P(3,6,2); const cv=Math.round(p*r*t/100); return {qt:`₹${p} at ${r}% for ${t}y. Interest?`,cv,exp:`SI = (${p}×${r}×${t})/100 = ₹${cv}`,sh:`₹${cv}`}; },
      ],
      medium: [
        (_) => { const p=P(2000,9000,0), t=P(2,4,1), a=P(3000,12000,2); const si=a-p; const cv=Math.round(si*100/(p*t)); return {qt:`₹${p} → ₹${a} in ${t}y at SI. Rate %?`,cv,exp:`R = (${si}×100)/(${p}×${t}) = ${cv}%`,sh:`(SI×100)/(P×T)`}; },
        (_) => { const si=P(400,1500,0), r=P(6,12,1), t=P(2,5,2); const cv=Math.round(si*100/(r*t)); return {qt:`SI = ₹${si}, Rate = ${r}%, Time = ${t}y. Principal?`,cv,exp:`P = (${si}×100)/(${r}×${t}) = ₹${cv}`,sh:`(SI×100)/(R×T)`}; },
      ],
      hard: [
        (_) => { const si=P(500,2000,0), p=P(5000,15000,1), r=P(6,15,2); const cv=Math.round(si*100/(p*r)); return {qt:`SI = ₹${si} at ${r}% on ₹${p}. Time?`,cv,exp:`T = (${si}×100)/(${p}×${r}) = ${cv}y`,sh:`(SI×100)/(P×R)`}; },
        (_) => { const p=P(3000,10000,0), r=P(5,10,1), t=P(3,5,2); const cv=Math.round(p*r*t/100); return {qt:`SI on ₹${p} at ${r}% for ${t}y?`,cv,exp:`(${p}×${r}×${t})/100 = ₹${cv}`,sh:`₹${cv}`}; },
      ],
    },
    'Compound Interest': {
      easy: [
        (_) => { const p=P(2000,8000,0), r=P(5,10,1), t=P(2,3,2); const am=Math.round(p*((100+r)/100)**t); const cv=am-p; return {qt:`CI on ₹${p} at ${r}% for ${t}y?`,cv,exp:`A = ${p}×(${100+r}/100)^${t} = ₹${am}. CI = ₹${cv}`,sh:`P[(1+R/100)^T-1]`}; },
        (_) => { const p=P(3000,6000,0), r=P(8,12,1); const am=Math.round(p*((100+r)/100)**2); const cv=am-p; return {qt:`CI on ₹${p} at ${r}% for 2y?`,cv,exp:`A = ${p}×(${100+r}/100)² = ₹${am}. CI = ${cv}`,sh:`P[(1+R/100)²-1]`}; },
      ],
      medium: [
        (_) => { const p=P(5000,15000,0), r=P(8,12,1), t=2, n=2; const am=Math.round(p*(1+r/(100*n))**(n*t)); const cv=am-p; return {qt:`CI on ₹${p} at ${r}% compounded half-yearly for ${t}y?`,cv,exp:`A = ${p}×(1+${r}/200)^${n*t} = ₹${am}. CI = ₹${cv}`,sh:`₹${cv}`}; },
      ],
      hard: [
        (_) => { const p=P(3000,10000,0), t=P(2,3,1); const am=Math.round(p*1.1**t); const cv=Math.round((am/p)**(1/t)*100-100); return {qt:`₹${p} → ₹${am} in ${t}y at CI. Rate %?`,cv,exp:`R = (${am}/${p})^(1/${t}) - 1 = ${cv}%`,sh:`[(A/P)^(1/T)-1]×100`}; },
      ],
    },
    'Data Interpretation': {
      easy: [
        (_) => { const a=P(100,500,0), b=P(100,500,1); const cv=a+b; return {qt:`Q1=${a}, Q2=${b} units. Total sales?`,cv,exp:`${a}+${b} = ${cv}`,sh:`${a}+${b}`}; },
        (_) => { const a=P(200,600,0), b=P(100,500,1); const cv=Math.abs(a-b); return {qt:`Company A=${a}, B=${b} sales. Difference?`,cv,exp:`|${a}-${b}| = ${cv}`,sh:`|${a}-${b}|`}; },
      ],
      medium: [
        (_) => { const q1=P(200,600,0), q2=P(250,700,1); const cv=Math.round((q2-q1)/q1*100); return {qt:`Jan=${q1}, Feb=${q2} sales. % increase Jan→Feb?`,cv,exp:`(${q2-q1}/${q1})×100 = ${cv}%`,sh:`(${q2-q1}/${q1})×100`}; },
        (_) => { const v=P(300,800,0), c=P(200,500,1); const cv=Math.round((v-c)/c*100); return {qt:`Revenue ₹${v}, cost ₹${c}. Profit %?`,cv,exp:`(${v-c}/${c})×100 = ${cv}%`,sh:`(${v-c}/${c})×100`}; },
      ],
      hard: [
        (_) => { const r=P(50000,200000,0), c=P(30000,100000,1), tr=P(15,30,2); const p=r-c; const cv=Math.round(p*(100-tr)/100); return {qt:`Revenue ₹${r}, cost ₹${c}, tax ${tr}%. Net profit?`,cv,exp:`Profit = ${p}. Tax = ${Math.round(p*tr/100)}. Net = ${cv}`,sh:`(${p})×(${100-tr}/100) = ₹${cv}`}; },
        (_) => { const a=P(150,400,0), b=P(200,500,1); const cv=Math.round((b-a)/a*100); return {qt:`Year1=${a}, Year2=${b}. Growth %?`,cv,exp:`(${b-a}/${a})×100 = ${cv}%`,sh:`(${b-a}/${a})×100`}; },
      ],
    },
    'Logical Reasoning': {
      easy: [
        (_) => { const st=P(2,10,0), d=P(2,6,1); const cv=st+4*d; return {qt:`Series: ${st}, ${st+d}, ${st+2*d}, ${st+3*d}, ?`,cv,exp:`Diff = ${d}. Next = ${st+3*d}+${d} = ${cv}`,sh:`${st+3*d}+${d} = ${cv}`}; },
        (_) => { const st=P(3,15,0), r=P(2,5,1); const cv=st*r; const nxt=st*r*r; return {qt:`Series: ${st}, ${st*r}, ?, ${nxt}. Missing term?`,cv,exp:`Ratio = ${r}. So mid = ${st}×${r} = ${cv}`}; },
      ],
      medium: [
        (_) => { const a=P(20,40,0), b=P(5,15,1), y=P(5,12,2); const cv=(a+y)-(b+y); return {qt:`A=${a}, B=${b}. Age difference after ${y}y?`,cv,exp:`Diff = (${a}+${y}) - (${b}+${y}) = ${cv}`,sh:`Age diff constant: ${a}-${b} = ${cv}`}; },
        (_) => { const d=P(5,15,0), q=P(2,5,1); const cv=q*d; return {qt:`A is ${q}× age of B. B is ${d}. A's age?`,cv,exp:`A = ${q}×${d} = ${cv}`,sh:`${q}×${d} = ${cv}`}; },
      ],
      hard: [
        (_) => { const a=P(2,6,0), b=P(8,15,1), c=P(3,7,2), d=P(1,5,3); const ageA=a*d, ageB=b+d; const cv=ageA+ageB; return {qt:`A=${a}×D, B=${b}+D. D=${d}. Sum of A+B?`,cv,exp:`A=${ageA}, B=${ageB}. Sum=${cv}`,sh:`(${a}×${d})+(${b}+${d})`}; },
        (_) => { const x=P(1,9,0), y=P(1,9,1); const cv=x*10+y; const r=y*10+x; return {qt:`Two digits sum to ${x+y}, reversed less by ${Math.abs(cv-r)}. Original? (tens=${x})`,cv,exp:`Original = ${x}${y} = ${cv}`,sh:`${x}${y}`}; },
      ],
    },
    'Verbal Ability': {
      easy: [
        (_) => { const w=['BEAUTIFUL','EDUCATION','KNOWLEDGE','COMPUTER','SCIENCE'][P(0,4,0)]; const cv=w.replace(/[^AEIOU]/g,'').length; return {qt:`Vowels in "${w}"?`,cv,exp:`Vowels: ${w.replace(/[^AEIOU]/g,'').split('').join(',')}. Count = ${cv}`,sh:`Count vowels = ${cv}`}; },
        (_) => { const w=['HAPPY','SAD','BIG','SMALL','FAST'][P(0,4,0)]; const cv=w.length; return {qt:`How many letters in "${w}"?`,cv,exp:`"${w}" has ${w.length} letters. Answer = ${cv}`,sh:`${w}.length = ${cv}`}; },
        (_) => { const w=['HELLO','WORLD','PEACE'][P(0,2,0)]; const pos=l=>l.charCodeAt(0)-64; const cv=pos(w[0])+pos(w[w.length-1]); return {qt:`Sum of alphabet positions of first & last letter of "${w}"?`,cv,exp:`${w[0]}=${pos(w[0])}, ${w[w.length-1]}=${pos(w[w.length-1])}. Sum = ${cv}`,sh:`pos(${w[0]})+pos(${w[w.length-1]})`}; },
      ],
      medium: [
        (_) => { const p=[{w:'BRIEF',s:'SHORT',a:'LONG'},{w:'ABUNDANT',s:'PLENTIFUL',a:'SCARCE'},{w:'FAMOUS',s:'RENOWNED',a:'OBSCURE'}][P(0,2,0)]; const pos=l=>l.charCodeAt(0)-64; const cv=pos(p.s[0])+pos(p.a[0]); return {qt:`Sum of alphabet positions of synonym & antonym first letters of "${p.w}"?`,cv,exp:`${p.s[0]}=${pos(p.s[0])}, ${p.a[0]}=${pos(p.a[0])}. Sum=${cv}`,sh:`pos(${p.s[0]})+pos(${p.a[0]})`}; },
        (_) => { const p=[{w1:'HAPPY',w2:'JOYFUL'},{w1:'BIG',w2:'LARGE'},{w1:'FAST',w2:'QUICK'}][P(0,2,0)]; const cl=p.w1.split('').filter(l=>p.w2.includes(l)); const pos=l=>l.charCodeAt(0)-64; const cv=cl.length>0?pos(cl[0]):1; return {qt:`Synonym "${p.w1}" & "${p.w2}". Position of 1st common letter?`,cv,exp:`Common: ${cl.join(',')||'none'}. Position of ${cl[0]||'?'} = ${cv}`,sh:`pos(${cl[0]||'?'})`}; },
      ],
      hard: [
        (_) => { const w=['STRONG','WEAK','HARD','SOFT'][P(0,3,0)]; const t=w.split('').reverse().join(''); const cv=w.split('').filter((l,i)=>l===t[i]).length; return {qt:`How many letters in "${w}" are in the same position when reversed?`,cv,exp:`Reverse = "${t}". Same pos: ${w.split('').filter((l,i)=>l===t[i]).join(',')||'none'}. Count=${cv}`,sh:`Compare original and reverse`}; },
      ],
    },
    'Coding-Decoding': {
      easy: [
        (_) => { const w=['CAT','DOG','BAT','FAN','CUP'][P(0,4,0)]; const sh=P(1,3,1); const cd=w.split('').map(l=>String.fromCharCode(l.charCodeAt(0)+sh)).join(''); const pos=l=>l.charCodeAt(0)-64; const cv=cd.split('').reduce((a,l)=>a+pos(l),0); return {qt:`"${w}" shifted by ${sh} → "${cd}". Sum of alphabetical positions of coded?`,cv,exp:`${cd.split('').map(l=>`${l}=${pos(l)}`).join(', ')}. Sum = ${cv}`,sh:`${cv}`}; },
        (_) => { const w='CODE'[P(0,3,0)]; const sh=P(1,4,1); const cd=String.fromCharCode(w.charCodeAt(0)+sh); const pos=l=>l.charCodeAt(0)-64; const cv=pos(cd); return {qt:`"${w}" shifted by ${sh} → "${cd}". Position of "${cd}"?`,cv,exp:`pos(${w})+${sh} = ${pos(w)+sh} = ${cv}`,sh:`${pos(w)+sh}`}; },
      ],
      medium: [
        (_) => { const w=['APPLE','MANGO','GRAPE'][P(0,2,0)]; const cd=w.split('').map(l=>String.fromCharCode(155-l.charCodeAt(0))).join(''); const pos=l=>l.charCodeAt(0)-64; const cv=cd.split('').reduce((a,l)=>a+pos(l),0); return {qt:`A↔Z code: "${w}" → "${cd}". Sum of coded letter positions?`,cv,exp:`${cd.split('').map(l=>`${l}=${pos(l)}`).join(', ')}. Sum = ${cv}`,sh:`Each: 27 - original pos. Sum = ${cv}`}; },
      ],
      hard: [
        (_) => { const w=['TABLE','CHAIR','BENCH'][P(0,2,0)]; const sh=P(2,5,1); const cd=w.split('').map(l=>String.fromCharCode(l.charCodeAt(0)+sh)).join(''); const pos=l=>l.charCodeAt(0)-64; const cv=cd.split('').reduce((a,l)=>a+pos(l),0)-w.split('').reduce((a,l)=>a+pos(l),0); return {qt:`"${w}" → "${cd}" (shift ${sh}). Difference in sum of positions?`,cv,exp:`Original sum = ${w.split('').reduce((a,l)=>a+pos(l),0)}. Coded sum = ${cd.split('').reduce((a,l)=>a+pos(l),0)}. Diff = ${cv}`,sh:`${w.length}×${sh} = ${cv}`}; },
        (_) => { const w=['PINK','BLUE','GREY'][P(0,2,0)]; const cd=w.split('').reverse().join(''); const pos=l=>l.charCodeAt(0)-64; const cv=cd.split('').reduce((a,l)=>a+pos(l),0); return {qt:`"${w}" reversed → "${cd}". Sum of positions of reversed?`,cv,exp:`${cd.split('').map(l=>`${l}=${pos(l)}`).join(', ')}. Sum = ${cv}`,sh:`Sum of reversed = ${cv}`}; },
      ],
    },
    'Blood Relations': {
      easy: [
        (_) => { const f=[{g:70,p:40,c:12},{g:65,p:38,c:10},{g:75,p:45,c:15}][P(0,2,0)]; const cv=f.g-f.c; return {qt:`Grandfather ${f.g}, grandchild ${f.c}. Grandfather's age at grandchild's birth?`,cv,exp:`${f.g} - ${f.c} = ${cv}`,sh:`${f.g}-${f.c}`}; },
        (_) => { const f=[{g:70,p:40,c:12},{g:65,p:38,c:10},{g:75,p:45,c:15}][P(0,2,0)]; const cv=f.p-f.c; return {qt:`Parent ${f.p}, child ${f.c}. Parent's age at child's birth?`,cv,exp:`${f.p} - ${f.c} = ${cv}`,sh:`${f.p}-${f.c}`}; },
      ],
      medium: [
        (_) => { const m=P(30,45,0), d=P(5,15,1), y=P(5,10,2); const mf=m+y, df=d+y; const g=(a,b)=>b===0?a:g(b,a%b); const div=g(mf,df); const cv=Math.round((mf/div)/(df/div)*10); return {qt:`Mother ${m}, daughter ${d}. Age ratio after ${y}y?`,cv,exp:`(${m}+${y})/(${d}+${y}) = ${mf}/${df} = ${(mf/df).toFixed(1)}`,sh:`(M+${y})/(D+${y})`}; },
      ],
      hard: [
        (_) => { const dad=P(35,50,0), son=P(8,18,1), mom=dad-P(2,6,2); const cv=dad-mom; return {qt:`Father ${dad}, mother ${mom}, son ${son}. Father-mother age diff when son was 5?`,cv,exp:`Diff remains ${dad}-${mom} = ${cv}`,sh:`Age diff constant: ${dad}-${mom}`}; },
        (_) => { const a=P(20,40,0), b=P(5,15,1), r=P(3,10,2); const af=a+r, bf=b+r; const cv=Math.round(af/bf); return {qt:`A=${a}, B=${b}. Ratio of ages after ${r}y? (nearest integer)`,cv,exp:`(${a}+${r})/(${b}+${r}) = ${(af/bf).toFixed(1)} ≈ ${cv}`,sh:`(A+${r})/(B+${r})`}; },
      ],
    },
    'Seating Arrangement': {
      easy: [
        (_) => { const t=P(8,15,0), p=P(2,P(8,14,1),1); const cv=t-p+1; return {qt:`${t} students. X is ${p}th from left. Position from right?`,cv,exp:`${t} - ${p} + 1 = ${cv}`,sh:`${t}-${p}+1`}; },
        (_) => { const t=P(8,15,0), p=P(2,t-1,1); const cv=t-p+1; return {qt:`Row of ${t}. R is ${p}th from right. Position from left?`,cv,exp:`${t} - ${p} + 1 = ${cv}`,sh:`${t}-${p}+1`}; },
      ],
      medium: [
        (_) => { const t=P(8,12,0), a=P(3,t-2,1), b=P(3,t-2,2); const cv=a+b-t-2>0?a+b-t-2:0; return {qt:`${t} persons. A ${a}th from left, B ${b}th from right. Between them?`,cv,exp:`${a}+${b}-${t}-2 = ${cv}${cv<=0?' (no one)':''}`,sh:`${a}+${b}-${t}-2`}; },
        (_) => { const t=P(9,15,0), a=P(3,t-3,1), b=P(3,t-3,2); const cv=a+b-1< t?t-(a+b-1):0; return {qt:`${t} in row. A ${a}th from left, B ${b}th from left. People to right of B?`,cv,exp:`Right of B = ${t} - ${b} = ${cv}`,sh:`${t}-${b}`}; },
      ],
      hard: [
        (_) => { const t=P(10,18,0), a=P(3,6,1), b=P(3,6,2), bt=P(2,5,3); const cv=a+bt+b; return {qt:`${t} people. A ${a}th from left, B ${b}th from right, ${bt} between. Total from A's extreme left to B's extreme right?`,cv,exp:`${a}+${bt}+${b} = ${cv}`,sh:`${a}+${bt}+${b}`}; },
        (_) => { const t=P(8,14,0); const l=P(2,Math.floor(t/2),1); const r=P(2,t-l,2); const cv=l+r-1; return {qt:`${t} chairs. A sits ${l} from left, B sits ${r} from right. Chairs between them? (no overlap)`,cv,exp:`Chairs between = ${cv < t ? t-cv-l+1-r+1 : 0}`,sh:`${t}-${l}-${r}`}; },
      ],
    },
    'Puzzles': {
      easy: [
        (_) => { const a=P(1,9,0), b=P(1,9,1); const cv=a*10+b; return {qt:`Tens=${a}, units=${b}. The 2-digit number?`,cv,exp:`${a}×10+${b} = ${cv}`,sh:`${a}×10+${b}`}; },
        (_) => { const a=P(1,9,0), b=P(1,9,1); const cv=a+b; return {qt:`Sum of digits of number ${a}${b}?`,cv,exp:`${a}+${b} = ${cv}`,sh:`${a}+${b}`}; },
        (_) => { const a=P(1,9,0), b=P(1,9,1); const cv=Math.abs(a*10+b-(b*10+a)); return {qt:`Difference between ${a}${b} and its reverse?`,cv,exp:`|${a*10+b}-${b*10+a}| = ${Math.abs(a*10+b-(b*10+a))}`,sh:`9×|${a}-${b}| = ${cv}`}; },
      ],
      medium: [
        (_) => { const a=P(2,8,0), b=P(1,9,1); const s=a+b, p=a*b; const disc=s*s-4*p; const r1=Math.round((s+Math.sqrt(disc))/2); const cv=r1; return {qt:`Sum=${s}, product=${p}. Larger number?`,cv,exp:`Roots of t²-${s}t+${p}=0: ${r1} and ${s-r1}`,sh:`(${s}+√${disc})/2 = ${cv}`}; },
      ],
      hard: [
        (_) => { const a=P(1,4,0), b=P(1,4,1), c=P(0,9,2); const n=a*100+b*10+c; const r=c*100+b*10+a; const cv=Math.abs(n-r); return {qt:`${n} reversed. Positive difference?`,cv,exp:`|${n} - ${r}| = ${cv}`,sh:`|${n}-${r}| = ${cv}`}; },
        (_) => { const a=P(1,9,0), b=P(1,9,1), c=P(1,9,2); const abc=a*100+b*10+c, cba=c*100+b*10+a; const cv=Math.abs(abc-cba); return {qt:`3-digit ${abc} reversed. Difference?`,cv,exp:`|${abc}-${cba}| = ${cv}`,sh:`99×|${a}-${c}| = ${cv}`}; },
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
