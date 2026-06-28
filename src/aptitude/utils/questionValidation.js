import { DIFFICULTIES } from './constants.js';

const optionKeys = ['A', 'B', 'C', 'D'];

function normalizeDifficulty(value, fallback = 'Medium') {
  const difficulty = String(value || fallback || 'Medium').trim().toLowerCase();
  return DIFFICULTIES.find((item) => item.toLowerCase() === difficulty) || fallback || 'Medium';
}

function readOption(options, key) {
  if (Array.isArray(options)) {
    const index = optionKeys.indexOf(key);
    const item = options[index];
    if (typeof item === 'string') return item;
    return item?.text || item?.value || item?.option || '';
  }

  return (
    options?.[key] ||
    options?.[key.toLowerCase()] ||
    options?.[`option_${key.toLowerCase()}`] ||
    options?.[`Option ${key}`] ||
    ''
  );
}

function normalizeCorrectOption(raw) {
  const value = String(raw || '').trim().toUpperCase();
  if (optionKeys.includes(value)) return value;
  const match = value.match(/[ABCD]/);
  return match ? match[0] : value;
}

export function normalizeQuestion(raw, defaults = {}) {
  const options = raw.options || {};
  const questionText = String(raw.question_text || raw.question || raw.text || '').trim();
  const explanation = String(raw.explanation || raw.solution || raw.reasoning || '').trim();

  return {
    question_text: questionText,
    option_a: String(raw.option_a || readOption(options, 'A')).trim(),
    option_b: String(raw.option_b || readOption(options, 'B')).trim(),
    option_c: String(raw.option_c || readOption(options, 'C')).trim(),
    option_d: String(raw.option_d || readOption(options, 'D')).trim(),
    correct_option: normalizeCorrectOption(raw.correct_option || raw.answer || raw.correct_answer),
    explanation,
    shortcut: String(raw.shortcut || '').trim(),
    concept: String(raw.concept || defaults.concept || '').trim(),
    difficulty: normalizeDifficulty(raw.difficulty, defaults.difficulty),
    marks: Number(raw.marks ?? defaults.marks ?? 1),
    negative_marks: Number(raw.negative_marks ?? defaults.negative_marks ?? 0.25),
  };
}

export function validateQuestions(rawQuestions, defaults = {}) {
  const errors = [];

  if (!Array.isArray(rawQuestions)) {
    return { valid: false, errors: ['Questions array is missing'], questions: [] };
  }

  const seen = new Set();
  const questions = rawQuestions.map((raw, index) => {
    const question = normalizeQuestion(raw, defaults);
    const number = index + 1;
    const normalizedText = question.question_text.toLowerCase().replace(/\s+/g, ' ').trim();

    if (!question.question_text) errors.push(`Question ${number}: question text is required`);
    if (seen.has(normalizedText)) {
      errors.push(`Question ${number}: duplicate question text — "${question.question_text.slice(0, 80)}"`);
    }
    seen.add(normalizedText);

    const values = [
      question.option_a,
      question.option_b,
      question.option_c,
      question.option_d,
    ];
    if (values.some((value) => !value)) {
      errors.push(`Question ${number}: exactly 4 non-empty options are required`);
    }
    if (!optionKeys.includes(question.correct_option)) {
      errors.push(`Question ${number}: correct answer must be A, B, C, or D`);
    }
    if (!question.explanation) errors.push(`Question ${number}: explanation is required`);
    if (!question.concept) errors.push(`Question ${number}: concept is required`);
    if (!DIFFICULTIES.includes(question.difficulty)) {
      errors.push(`Question ${number}: difficulty must be Easy, Medium, Hard, or Mixed`);
    }
    if (!Number.isFinite(question.marks)) errors.push(`Question ${number}: marks must be a number`);
    if (!Number.isFinite(question.negative_marks)) {
      errors.push(`Question ${number}: negative marks must be a number`);
    }

    return question;
  });

  return { valid: errors.length === 0, errors, questions };
}

export function checkForDuplicateIndices(questions, existingTexts = []) {
  const normalizedExisting = new Set(
    existingTexts.map((t) => t.toLowerCase().replace(/\s+/g, ' ').trim()),
  );

  const duplicateIndices = [];
  const normalizedSeen = new Set();

  questions.forEach((q, index) => {
    const normalized = (q.question_text || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) {
      duplicateIndices.push(index);
      return;
    }
    if (normalizedExisting.has(normalized) || normalizedSeen.has(normalized)) {
      duplicateIndices.push(index);
      return;
    }
    normalizedSeen.add(normalized);
  });

  return duplicateIndices;
}

export function toStudentQuestion(question) {
  return {
    id: question._id.toString(),
    question_text: question.question_text,
    options: {
      A: question.option_a,
      B: question.option_b,
      C: question.option_c,
      D: question.option_d,
    },
    concept: question.concept,
    difficulty: question.difficulty,
    marks: question.marks,
  };
}

export function toReviewQuestion(question) {
  return {
    id: question._id.toString(),
    question_text: question.question_text,
    option_a: question.option_a,
    option_b: question.option_b,
    option_c: question.option_c,
    option_d: question.option_d,
    correct_option: question.correct_option,
    explanation: question.explanation,
    shortcut: question.shortcut,
    concept: question.concept,
    difficulty: question.difficulty,
    marks: question.marks,
    negative_marks: question.negative_marks,
  };
}
