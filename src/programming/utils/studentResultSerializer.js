const GENERIC_MESSAGES = {
  runtime_error: 'something went wrong while execution please try again',
  compilation_error: 'something went wrong while execution please try again',
  time_limit_exceeded: 'Time limit exceeded. Try a more efficient approach.',
  wrong_answer: 'Wrong answer. Review the expected output format and edge cases.',
};

const EXECUTION_SYSTEM_PATTERNS = [
  /execution service/i,
  /code execution/i,
  /submission token/i,
  /polling timed out/i,
  /execution request/i,
  /execution internal/i,
  /execution probe/i,
  /execution polling/i,
];

function statusMessage(status) {
  return GENERIC_MESSAGES[status] || 'This test case failed. Review your logic and edge cases.';
}

function cleanFilePath(line) {
  return line
    .replace(/\/box\/script\.\w+/gi, 'script')
    .replace(/\/box\//gi, '')
    .replace(/\/tmp\//gi, '')
    .replace(/File\s+"[^"]+",\s*/gi, '')
    .replace(/at\s+.*\(?\/?(?:box|tmp|app|api)\/[^)]*\)?/gi, 'at <eval>')
    .trim();
}

const SYSTEM_ERROR_PATTERNS = [
  /no such file/i,
  /rb_sysopen/i,
  /internal error/i,
  /segmentation fault/i,
  /isolate/i,
  /cgroup/i,
  /signal \d+/i,
  /core dumped/i,
  /\^@/,
];

function isSystemError(text) {
  return SYSTEM_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

export function sanitizeStudentError(error, status = '') {
  const raw = String(error || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return '';

  if (isSystemError(raw)) return '';

  if (EXECUTION_SYSTEM_PATTERNS.some((p) => p.test(raw))) {
    return GENERIC_MESSAGES.runtime_error;
  }

  const lines = raw.split('\n').map((line) => line.trim()).filter((line) => line);

  const cleaned = lines
    .filter((line) => !/^Traceback\b/i.test(line))
    .filter((line) => !/^\^+$/.test(line))
    .map(cleanFilePath);

  const meaningful = cleaned.filter((line) => {
    if (isSystemError(line)) return false;
    if (/^\w+Error\b/.test(line)) return true;
    if (/^Error\b/.test(line)) return true;
    if (/^Uncaught\b/i.test(line)) return true;
    if (/Exception/.test(line)) return true;
    if (/failed|error/i.test(line) && line.length < 200) return true;
    return false;
  });

  const result = meaningful.length > 0 ? meaningful.join('\n') : cleaned[cleaned.length - 1] || '';
  if (!result || isSystemError(result)) return '';
  return result.length > 500 ? `${result.slice(0, 500)}...` : result;
}

export function serializeStudentTestResult(tr, { isSample = false, status = '' } = {}) {
  const failed = tr.passed === false || Boolean(tr.error);
  const isExecutionError = status === 'runtime_error' || status === 'compilation_error';

  let error = '';
  if (failed) {
    if (isExecutionError) {
      error = sanitizeStudentError(tr.error, status) || statusMessage(status);
    } else {
      error = statusMessage(status);
    }
  }

  return {
    test_case_index: tr.test_case_index,
    passed: tr.passed,
    error,
    execution_time_ms: tr.execution_time_ms,
    input: isSample ? tr.input || '' : '',
    expected_output: isSample ? tr.expected_output || '' : '',
    actual_output: isSample ? tr.actual_output || '' : '',
  };
}

export function sanitizeStudentSubmissionError(errorMessage, status = '') {
  if (status === 'runtime_error' || status === 'compilation_error') {
    return sanitizeStudentError(errorMessage, status) || statusMessage(status);
  }
  return statusMessage(status);
}
