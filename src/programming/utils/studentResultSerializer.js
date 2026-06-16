const GENERIC_MESSAGES = {
  runtime_error: 'Runtime error. Check your logic and input handling.',
  compilation_error: 'Compilation error. Check your syntax and language-specific structure.',
  time_limit_exceeded: 'Time limit exceeded. Try a more efficient approach.',
  wrong_answer: 'Wrong answer. Review the expected output format and edge cases.',
};

function statusMessage(status) {
  return GENERIC_MESSAGES[status] || 'This test case failed. Review your logic and edge cases.';
}

export function sanitizeStudentError(error, status = '') {
  const raw = String(error || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return statusMessage(status);

  const cleaned = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line)
    .filter((line) => !/^Traceback\b/i.test(line))
    .filter((line) => !/^File\s+["'].*["'],\s+line\s+\d+/i.test(line))
    .filter((line) => !/^at\s+.*\(?\/?(box|tmp|app|api)\//i.test(line))
    .filter((line) => !/\/box\/|\/tmp\/|script\.(py|js|ts|java|cpp|c|cs|go|rs|kt|rb|swift|php)\b/i.test(line));

  const bestLine = cleaned[cleaned.length - 1] || '';
  if (!bestLine) return statusMessage(status);

  return bestLine.length > 300 ? `${bestLine.slice(0, 300)}...` : bestLine;
}

export function hiddenTestErrorMessage(status = '') {
  if (status === 'time_limit_exceeded') return GENERIC_MESSAGES.time_limit_exceeded;
  if (status === 'compilation_error') return GENERIC_MESSAGES.compilation_error;
  return 'A hidden test case failed. Review edge cases, negative values, and input handling.';
}

export function serializeStudentTestResult(tr, { isSample = false, status = '' } = {}) {
  const failed = tr.passed === false || Boolean(tr.error);
  return {
    test_case_index: tr.test_case_index,
    passed: tr.passed,
    error: failed
      ? isSample
        ? sanitizeStudentError(tr.error, status)
        : hiddenTestErrorMessage(status)
      : '',
    execution_time_ms: tr.execution_time_ms,
    input: isSample ? tr.input || '' : '',
    expected_output: isSample ? tr.expected_output || '' : '',
    actual_output: isSample ? tr.actual_output || '' : '',
  };
}

export function sanitizeStudentSubmissionError(errorMessage, status = '') {
  return sanitizeStudentError(errorMessage, status);
}
