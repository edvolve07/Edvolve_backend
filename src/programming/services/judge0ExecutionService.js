const DEFAULT_LANGUAGE_IDS = {
  c: 50,
  csharp: 51,
  cpp: 54,
  go: 60,
  java: 62,
  javascript: 63,
  kotlin: 78,
  php: 68,
  python: 71,
  ruby: 72,
  rust: 73,
  swift: 83,
  typescript: 74,
};

const DONE_STATUS_IDS = new Set([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);

function normalizeOutput(output) {
  return String(output || '').replace(/\r\n/g, '\n').replace(/\s+$/, '');
}

function encode(value) {
  return Buffer.from(String(value || ''), 'utf8').toString('base64');
}

function decode(value) {
  if (!value) return '';
  try {
    return Buffer.from(value, 'base64').toString('utf8');
  } catch {
    return String(value);
  }
}

function getBaseUrl() {
  return String(process.env.JUDGE0_BASE_URL || '').replace(/\/$/, '');
}

function getLanguageIds() {
  const raw = process.env.JUDGE0_LANGUAGE_IDS;
  if (!raw) return DEFAULT_LANGUAGE_IDS;

  try {
    return { ...DEFAULT_LANGUAGE_IDS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_LANGUAGE_IDS;
  }
}

function getHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const apiKey = process.env.JUDGE0_API_KEY;
  if (apiKey) {
    headers[process.env.JUDGE0_AUTH_HEADER || 'X-Auth-Token'] = apiKey;
  }
  return headers;
}

function prepareSourceCode(code, language, input) {
  if (!['javascript', 'typescript'].includes(language)) return code;

  return `
const input = ${JSON.stringify(input || '')};
const lines = input.split('\\n').filter((line) => line.length > 0);
const readline = () => lines.shift() || '';
${code}
`;
}

function getPollConfig() {
  return {
    intervalMs: Math.max(250, Number(process.env.JUDGE0_POLL_INTERVAL_MS || 1000)),
    attempts: Math.max(1, Number(process.env.JUDGE0_POLL_ATTEMPTS || 30)),
  };
}

function getRequestTimeoutMs() {
  return Math.max(1000, Number(process.env.JUDGE0_REQUEST_TIMEOUT_MS || 30000));
}

function getRequestRetries() {
  return Math.max(0, Number(process.env.JUDGE0_REQUEST_RETRIES || 2));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function judge0Fetch(path, options = {}) {
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    throw new Error('JUDGE0_BASE_URL is required when CODE_RUNNER_PROVIDER=judge0');
  }

  const timeoutMs = getRequestTimeoutMs();
  const attempts = getRequestRetries() + 1;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;

    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          ...getHeaders(),
          ...(options.headers || {}),
        },
      });
    } catch (error) {
      lastError = error.name === 'AbortError'
        ? new Error(`Judge0 request timed out after ${timeoutMs}ms`)
        : error;

      if (attempt < attempts) {
        await sleep(Math.min(1000 * attempt, 3000));
        continue;
      }

      throw lastError;
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      const message = data?.message || data?.error || text || `Judge0 request failed (${response.status})`;
      throw new Error(message);
    }

    return data;
  }

  throw lastError || new Error('Judge0 request failed');
}

function toJudge0Status(result, actual, expected) {
  const statusId = result.status?.id;
  const description = result.status?.description || '';
  const errorText = decode(result.compile_output) || decode(result.stderr) || decode(result.message) || description;

  if (statusId === 5) {
    return { status: 'time_limit_exceeded', passed: false, error: 'Time limit exceeded' };
  }

  if (statusId === 6) {
    return { status: 'compilation_error', passed: false, error: errorText || 'Compilation error' };
  }

  if ([7, 8, 9, 10, 11, 12, 14].includes(statusId)) {
    return { status: 'runtime_error', passed: false, error: errorText || 'Runtime error' };
  }

  if (statusId === 13) {
    return { status: 'runtime_error', passed: false, error: errorText || 'Judge0 internal error' };
  }

  if (statusId === 3) {
    const passed = normalizeOutput(actual) === normalizeOutput(expected);
    return {
      status: passed ? 'accepted' : 'wrong_answer',
      passed,
      error: '',
    };
  }

  return { status: 'runtime_error', passed: false, error: errorText || description || 'Execution failed' };
}

function mergeStatus(current, next) {
  if (current === 'compilation_error') return current;
  if (next === 'compilation_error') return next;
  if (current === 'accepted') return next;
  return current;
}

async function createSubmission({ code, languageId, input, timeLimit, memoryLimitMb, wait = false }) {
  const body = {
    language_id: languageId,
    source_code: encode(code),
    stdin: encode(input),
    cpu_time_limit: Math.max(1, Number(timeLimit || 2)),
    wall_time_limit: Math.max(3, Number(timeLimit || 2) + 2),
    memory_limit: Math.max(16384, Number(memoryLimitMb || 256) * 1024),
  };

  const data = await judge0Fetch(`/submissions?base64_encoded=true&wait=${wait ? 'true' : 'false'}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (wait) return data;

  if (!data?.token) {
    throw new Error('Judge0 did not return a submission token');
  }

  return data.token;
}

async function getSubmissionResult(token) {
  const fields = [
    'stdout',
    'time',
    'memory',
    'stderr',
    'token',
    'compile_output',
    'message',
    'status',
  ].join(',');
  const path = `/submissions/${token}?base64_encoded=true&fields=${encodeURIComponent(fields)}`;
  const { intervalMs, attempts } = getPollConfig();

  for (let i = 0; i < attempts; i++) {
    const data = await judge0Fetch(path);
    if (DONE_STATUS_IDS.has(data.status?.id)) return data;
    await sleep(intervalMs);
  }

  return {
    stdout: '',
    stderr: '',
    compile_output: '',
    message: encode('Judge0 result polling timed out'),
    status: { id: 5, description: 'Time Limit Exceeded' },
    time: null,
  };
}

async function runTestCase({ code, language, languageId, testCase, index, timeLimit, memoryLimitMb }) {
  const input = testCase.input || '';
  const expected = normalizeOutput(testCase.output || '');
  const token = await createSubmission({
    code: prepareSourceCode(code, language, input),
    languageId,
    input,
    timeLimit,
    memoryLimitMb,
  });
  const result = await getSubmissionResult(token);
  const actual = normalizeOutput(decode(result.stdout));
  const mapped = toJudge0Status(result, actual, expected);

  return {
    status: mapped.status,
    result: {
      test_case_index: index,
      input,
      expected_output: expected,
      actual_output: actual,
      passed: mapped.passed,
      error: mapped.error,
      execution_time_ms: Math.round(Number(result.time || 0) * 1000),
    },
  };
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

  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), items.length) },
    () => runNext(),
  );
  await Promise.all(workers);
  return results;
}

export async function evaluateJudge0Submission(
  code,
  language,
  testCases,
  timeLimit,
  memoryLimitMb = 256,
) {
  const languageIds = getLanguageIds();
  const languageId = languageIds[language];
  if (!languageId) {
    return {
      status: 'compilation_error',
      passed_test_cases: 0,
      total_test_cases: testCases.length,
      test_results: testCases.map((testCase, index) => ({
        test_case_index: index,
        input: testCase.input || '',
        expected_output: normalizeOutput(testCase.output || ''),
        actual_output: '',
        passed: false,
        error: `Unsupported Judge0 language: ${language}`,
        execution_time_ms: 0,
      })),
      execution_time_ms: 0,
    };
  }

  const concurrency = Math.max(1, Number(process.env.JUDGE0_CONCURRENCY || 2));
  const evaluated = await runWithConcurrency(testCases, concurrency, (testCase, index) =>
    runTestCase({
      code,
      language,
      languageId,
      testCase,
      index,
      timeLimit,
      memoryLimitMb,
    }),
  );

  let status = 'accepted';
  let totalTime = 0;
  const testResults = [];

  for (const item of evaluated) {
    status = mergeStatus(status, item.status);
    totalTime += item.result.execution_time_ms || 0;
    testResults.push(item.result);
    if (item.status === 'compilation_error') break;
  }

  return {
    status,
    passed_test_cases: testResults.filter((result) => result.passed).length,
    total_test_cases: testCases.length,
    test_results: testResults,
    execution_time_ms: Math.round(totalTime),
  };
}

export async function getJudge0Health() {
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    return {
      provider: 'judge0',
      configured: false,
      healthy: false,
      base_url: '',
      message: 'JUDGE0_BASE_URL is not configured',
    };
  }

  try {
    const [about, languages] = await Promise.all([
      judge0Fetch('/about'),
      judge0Fetch('/languages'),
    ]);

    return {
      provider: 'judge0',
      configured: true,
      healthy: true,
      base_url: baseUrl,
      version: about?.version || about?.system_info || '',
      language_count: Array.isArray(languages) ? languages.length : 0,
    };
  } catch (error) {
    return {
      provider: 'judge0',
      configured: true,
      healthy: false,
      base_url: baseUrl,
      message: error.message || 'Judge0 is not reachable',
    };
  }
}

export async function getJudge0ExecutionHealth() {
  const base = await getJudge0Health();
  if (!base.healthy) return base;

  try {
    const result = await createSubmission({
      code: 'print("edvolve")',
      languageId: DEFAULT_LANGUAGE_IDS.python,
      input: '',
      timeLimit: 2,
      memoryLimitMb: 128,
      wait: true,
    });

    const stdout = normalizeOutput(decode(result.stdout));
    const message = decode(result.message);
    const healthy = result.status?.id === 3 && stdout === 'edvolve';

    return {
      ...base,
      execution_healthy: healthy,
      execution_status: result.status?.description || '',
      execution_message: healthy ? '' : message || decode(result.stderr) || decode(result.compile_output),
    };
  } catch (error) {
    return {
      ...base,
      execution_healthy: false,
      execution_message: error.message || 'Judge0 execution probe failed',
    };
  }
}
