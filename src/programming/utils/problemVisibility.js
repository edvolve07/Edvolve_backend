export const INVALID_PROBLEM_TITLE_PATTERN = /^#?\s*Topic\s+\d+\s*:|^(Easy|Medium|Hard)\s*\(/i;

export function isVisibleProblemTitle(title) {
  const value = String(title || '').trim();
  return Boolean(value) && !INVALID_PROBLEM_TITLE_PATTERN.test(value);
}

export function visibleProblemTitleFilter(field = 'title') {
  return { [field]: { $not: INVALID_PROBLEM_TITLE_PATTERN } };
}

export function visibleProblemFilter(extra = {}) {
  return {
    ...extra,
    ...visibleProblemTitleFilter(),
  };
}
