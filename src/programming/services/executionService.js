import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { v4 as uuidv4 } from 'uuid';
import {
  evaluateJudge0Submission,
  getJudge0ExecutionHealth,
  getJudge0Health,
} from './judge0ExecutionService.js';

const TEMP_DIR = path.join(os.tmpdir(), 'edvolve-code-exec');

function ensureTempDir() {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
}

function createTempFile(code, extension) {
  ensureTempDir();
  const filename = `${uuidv4()}.${extension}`;
  const filepath = path.join(TEMP_DIR, filename);
  fs.writeFileSync(filepath, code, 'utf-8');
  return filepath;
}

function cleanupTempFile(filepath) {
  try {
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
  } catch {
  }
}

function runJavaScript(code, input, timeLimit) {
  const wrappedCode = `
const input = ${JSON.stringify(input)};
const lines = input.split('\\n').filter(l => l.length > 0);
const readline = () => lines.shift() || '';
${code}
`;
  const filepath = createTempFile(wrappedCode, 'js');
  try {
    const start = Date.now();
    const output = execSync(`node "${filepath}"`, {
      timeout: timeLimit * 1000,
      maxBuffer: 50 * 1024 * 1024,
      encoding: 'utf-8',
      shell: false,
    });
    const elapsed = Date.now() - start;
    return { output: output.trimEnd(), executionTime: elapsed };
  } catch (error) {
    if (error.killed || error.signal === 'SIGTERM') {
      return { error: 'Time limit exceeded', timeLimitExceeded: true };
    }
    const message = error.stderr?.trim() || error.message || 'Runtime error';
    return { error: message, runtimeError: true };
  } finally {
    cleanupTempFile(filepath);
  }
}

function runPython(code, input, timeLimit) {
  const filepath = createTempFile(code, 'py');
  try {
    const start = Date.now();
    const output = execSync(`python3 "${filepath}"`, {
      timeout: timeLimit * 1000,
      maxBuffer: 50 * 1024 * 1024,
      encoding: 'utf-8',
      input,
      shell: false,
    });
    const elapsed = Date.now() - start;
    return { output: output.trimEnd(), executionTime: elapsed };
  } catch (error) {
    if (error.killed || error.signal === 'SIGTERM') {
      return { error: 'Time limit exceeded', timeLimitExceeded: true };
    }
    const message = error.stderr?.trim() || error.message || 'Runtime error';
    return { error: message, runtimeError: true };
  } finally {
    cleanupTempFile(filepath);
  }
}

const WRAPPER_JAVA = `import java.util.*;
public class Main {
  public static void main(String[] args) {
    Scanner sc = new Scanner(System.in);
    StringBuilder input = new StringBuilder();
    while (sc.hasNextLine()) {
      input.append(sc.nextLine()).append("\\n");
    }
    // User code below
    SOLUTION_PLACEHOLDER
  }
}`;

function runJava(code, input, timeLimit) {
  const wrapped = WRAPPER_JAVA.replace('SOLUTION_PLACEHOLDER', code);
  const filepath = createTempFile(wrapped, 'java');
  try {
    const compileStart = Date.now();
    execSync(`javac "${filepath}"`, {
      timeout: 15000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf-8',
      shell: false,
    });
    const compileTime = Date.now() - compileStart;
    const dir = path.dirname(filepath);
    const execStart = Date.now();
    const output = execSync(`java -cp "${dir}" Main`, {
      timeout: timeLimit * 1000,
      maxBuffer: 50 * 1024 * 1024,
      encoding: 'utf-8',
      input,
      shell: false,
    });
    const elapsed = Date.now() - execStart;
    return { output: output.trimEnd(), executionTime: elapsed + compileTime };
  } catch (error) {
    if (error.killed || error.signal === 'SIGTERM') {
      return { error: 'Time limit exceeded', timeLimitExceeded: true };
    }
    const message = error.stderr?.trim() || error.message || 'Runtime/Compilation error';
    if (message.includes('error:')) {
      return { error: message, compilationError: true };
    }
    return { error: message, runtimeError: true };
  } finally {
    cleanupTempFile(filepath);
    try {
      const classFile = filepath.replace('.java', '.class');
      if (fs.existsSync(classFile)) fs.unlinkSync(classFile);
    } catch {
    }
  }
}

const WRAPPER_CPP = `#include <iostream>
#include <string>
#include <sstream>
using namespace std;

int main() {
    string line;
    string input;
    while (getline(cin, line)) {
        input += line + "\\n";
    }
    // User code below
    SOLUTION_PLACEHOLDER
    return 0;
}`;

function runCpp(code, input, timeLimit) {
  const wrapped = WRAPPER_CPP.replace('SOLUTION_PLACEHOLDER', code);
  const filepath = createTempFile(wrapped, 'cpp');
  const binaryPath = filepath.replace('.cpp', '');
  try {
    const compileStart = Date.now();
    execSync(`g++ -std=c++17 -O2 "${filepath}" -o "${binaryPath}"`, {
      timeout: 15000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf-8',
      shell: false,
    });
    const compileTime = Date.now() - compileStart;
    const execStart = Date.now();
    const output = execSync(`"${binaryPath}"`, {
      timeout: timeLimit * 1000,
      maxBuffer: 50 * 1024 * 1024,
      encoding: 'utf-8',
      input,
      shell: false,
    });
    const elapsed = Date.now() - execStart;
    return { output: output.trimEnd(), executionTime: elapsed + compileTime };
  } catch (error) {
    if (error.killed || error.signal === 'SIGTERM') {
      return { error: 'Time limit exceeded', timeLimitExceeded: true };
    }
    const message = error.stderr?.trim() || error.message || 'Runtime/Compilation error';
    if (message.includes('error:')) {
      return { error: message, compilationError: true };
    }
    return { error: message, runtimeError: true };
  } finally {
    cleanupTempFile(filepath);
    try {
      if (fs.existsSync(binaryPath)) fs.unlinkSync(binaryPath);
    } catch {
    }
  }
}

const WRAPPER_C = `#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main() {
    char *input = NULL;
    size_t input_size = 0;
    size_t len = 0;
    char buf[4096];
    size_t total = 0;

    // Read all stdin
    while (fgets(buf, sizeof(buf), stdin) != NULL) {
        size_t buflen = strlen(buf);
        char *new_input = realloc(input, total + buflen + 1);
        if (!new_input) { if (input) free(input); return 1; }
        input = new_input;
        memcpy(input + total, buf, buflen);
        total += buflen;
        if (total > 1000000) break;
    }
    if (input) input[total] = '\\0';

    // Replace stdin for user code
    if (input && strlen(input) > 0) {
        FILE *tmp = fopen("/tmp/stdin_input.txt", "w");
        if (tmp) { fprintf(tmp, "%s", input); fclose(tmp); }
        freopen("/tmp/stdin_input.txt", "r", stdin);
    }

    // Call user solution
    SOLUTION_CALL

    if (input) free(input);
    return 0;
}`;

const WRAPPER_GO = `package main

import (
    "bufio"
    "fmt"
    "os"
    "strings"
)

func main() {
    var lines []string
    scanner := bufio.NewScanner(os.Stdin)
    for scanner.Scan() {
        lines = append(lines, scanner.Text())
    }
    stdinContent := strings.Join(lines, "\\n")
    os.Stdin.Write([]byte(stdinContent))

    SOLUTION_CALL
}`;

const WRAPPER_RUST = `use std::io::{self, BufRead};

fn main() {
    let stdin = io::stdin();
    let mut lines = vec![];
    for line in stdin.lock().lines() {
        if let Ok(l) = line { lines.push(l); }
    }
    let input = lines.join("\\n");
    let _ = input;

    SOLUTION_CALL
}`;

function runC(code, input, timeLimit) {
    const wrapped = WRAPPER_C.replace('SOLUTION_CALL', code);
    const filepath = createTempFile(wrapped, 'c');
    const binaryPath = filepath.replace('.c', '');
    try {
        const compileStart = Date.now();
        execSync(`gcc -O2 -std=c11 "${filepath}" -o "${binaryPath}"`, {
            timeout: 15000,
            maxBuffer: 10 * 1024 * 1024,
            encoding: 'utf-8',
            shell: false,
        });
        const compileTime = Date.now() - compileStart;
        const execStart = Date.now();
        const output = execSync(`"${binaryPath}"`, {
            timeout: timeLimit * 1000,
            maxBuffer: 50 * 1024 * 1024,
            encoding: 'utf-8',
            input,
            shell: false,
        });
        const elapsed = Date.now() - execStart;
        return { output: output.trimEnd(), executionTime: elapsed + compileTime };
    } catch (error) {
        if (error.killed || error.signal === 'SIGTERM') {
            return { error: 'Time limit exceeded', timeLimitExceeded: true };
        }
        const message = error.stderr?.trim() || error.message || 'Runtime/Compilation error';
        if (message.includes('error:')) {
            return { error: message, compilationError: true };
        }
        return { error: message, runtimeError: true };
    } finally {
        cleanupTempFile(filepath);
        try { if (fs.existsSync(binaryPath)) fs.unlinkSync(binaryPath); } catch {}
    }
}

function runGo(code, input, timeLimit) {
    const wrapped = WRAPPER_GO.replace('SOLUTION_CALL', code);
    const filepath = createTempFile(wrapped, 'go');
    try {
        const compileStart = Date.now();
        execSync(`go build -o "${filepath}_bin" "${filepath}"`, {
            timeout: 15000,
            maxBuffer: 10 * 1024 * 1024,
            encoding: 'utf-8',
            shell: false,
        });
        const compileTime = Date.now() - compileStart;
        const execStart = Date.now();
        const output = execSync(`"${filepath}_bin"`, {
            timeout: timeLimit * 1000,
            maxBuffer: 50 * 1024 * 1024,
            encoding: 'utf-8',
            input,
            shell: false,
        });
        const elapsed = Date.now() - execStart;
        return { output: output.trimEnd(), executionTime: elapsed + compileTime };
    } catch (error) {
        if (error.killed || error.signal === 'SIGTERM') {
            return { error: 'Time limit exceeded', timeLimitExceeded: true };
        }
        const message = error.stderr?.trim() || error.message || 'Runtime/Compilation error';
        if (message.includes('error:') || message.includes('Error:')) {
            return { error: message, compilationError: true };
        }
        return { error: message, runtimeError: true };
    } finally {
        cleanupTempFile(filepath);
        try { if (fs.existsSync(`${filepath}_bin`)) fs.unlinkSync(`${filepath}_bin`); } catch {}
    }
}

function runRust(code, input, timeLimit) {
    const wrapped = WRAPPER_RUST.replace('SOLUTION_CALL', code);
    const filepath = createTempFile(wrapped, 'rs');
    const projectDir = filepath.replace('.rs', '_rust_proj');
    try {
        fs.mkdirSync(projectDir, { recursive: true });
        const mainRsPath = path.join(projectDir, 'src', 'main.rs');
        fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
        fs.writeFileSync(mainRsPath, wrapped, 'utf-8');

        const compileStart = Date.now();
        execSync(`rustc "${mainRsPath}" -o "${filepath}_bin"`, {
            timeout: 15000,
            maxBuffer: 10 * 1024 * 1024,
            encoding: 'utf-8',
            shell: false,
        });
        const compileTime = Date.now() - compileStart;
        const execStart = Date.now();
        const output = execSync(`"${filepath}_bin"`, {
            timeout: timeLimit * 1000,
            maxBuffer: 50 * 1024 * 1024,
            encoding: 'utf-8',
            input,
            shell: false,
        });
        const elapsed = Date.now() - execStart;
        return { output: output.trimEnd(), executionTime: elapsed + compileTime };
    } catch (error) {
        if (error.killed || error.signal === 'SIGTERM') {
            return { error: 'Time limit exceeded', timeLimitExceeded: true };
        }
        const message = error.stderr?.trim() || error.message || 'Runtime/Compilation error';
        if (message.includes('error:')) {
            return { error: message, compilationError: true };
        }
        return { error: message, runtimeError: true };
    } finally {
        cleanupTempFile(filepath);
        try { if (fs.existsSync(`${filepath}_bin`)) fs.unlinkSync(`${filepath}_bin`); } catch {}
        try { if (fs.existsSync(projectDir)) fs.rmSync(projectDir, { recursive: true }); } catch {}
    }
}

function normalizeOutput(output) {
  return output.replace(/\r\n/g, '\n').replace(/\s+$/, '');
}

async function evaluateLocalSubmission(code, language, testCases, timeLimit) {
  const results = [];
  let allPassed = true;
  let totalTime = 0;
  let overallStatus = 'accepted';

  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    const input = testCase.input || '';
    const expected = normalizeOutput(testCase.output || '');

    let result;

    switch (language) {
      case 'javascript':
        result = runJavaScript(code, input, timeLimit);
        break;
      case 'python':
        result = runPython(code, input, timeLimit);
        break;
      case 'java':
        result = runJava(code, input, timeLimit);
        break;
      case 'cpp':
        result = runCpp(code, input, timeLimit);
        break;
      case 'c':
        result = runC(code, input, timeLimit);
        break;
      case 'go':
        result = runGo(code, input, timeLimit);
        break;
      case 'rust':
        result = runRust(code, input, timeLimit);
        break;
      default:
        results.push({
          test_case_index: i,
          input,
          expected_output: expected,
          actual_output: '',
          passed: false,
          error: `Unsupported language: ${language}`,
          execution_time_ms: 0,
        });
        allPassed = false;
        overallStatus = 'compilation_error';
        continue;
    }

    if (result.timeLimitExceeded) {
      results.push({
        test_case_index: i,
        input,
        expected_output: expected,
        actual_output: '',
        passed: false,
        error: 'Time limit exceeded',
        execution_time_ms: timeLimit * 1000,
      });
      allPassed = false;
      if (overallStatus === 'accepted') overallStatus = 'time_limit_exceeded';
    } else if (result.compilationError) {
      results.push({
        test_case_index: i,
        input,
        expected_output: expected,
        actual_output: '',
        passed: false,
        error: result.error,
        execution_time_ms: 0,
      });
      allPassed = false;
      overallStatus = 'compilation_error';
      break;
    } else if (result.runtimeError) {
      results.push({
        test_case_index: i,
        input,
        expected_output: expected,
        actual_output: '',
        passed: false,
        error: result.error,
        execution_time_ms: 0,
      });
      allPassed = false;
      if (overallStatus === 'accepted') overallStatus = 'runtime_error';
    } else {
      const actual = normalizeOutput(result.output || '');
      const passed = actual === expected;

      results.push({
        test_case_index: i,
        input,
        expected_output: expected,
        actual_output: actual,
        passed,
        error: '',
        execution_time_ms: Math.round(result.executionTime || 0),
      });
      totalTime += result.executionTime || 0;
      if (!passed) {
        allPassed = false;
        if (overallStatus === 'accepted') overallStatus = 'wrong_answer';
      }
    }
  }

  const passedCount = results.filter((r) => r.passed).length;

  if (allPassed && overallStatus === 'accepted') {
    overallStatus = 'accepted';
  }

  return {
    status: overallStatus,
    passed_test_cases: passedCount,
    total_test_cases: testCases.length,
    test_results: results,
    execution_time_ms: Math.round(totalTime),
  };
}

export async function evaluateSubmission(
  code,
  language,
  testCases,
  timeLimit,
  memoryLimitMb = 256,
) {
  if (process.env.CODE_RUNNER_PROVIDER === 'judge0') {
    return evaluateJudge0Submission(code, language, testCases, timeLimit, memoryLimitMb);
  }

  return evaluateLocalSubmission(code, language, testCases, timeLimit);
}

export async function getCodeRunnerHealth({ deep = false } = {}) {
  if (process.env.CODE_RUNNER_PROVIDER === 'judge0') {
    return deep ? getJudge0ExecutionHealth() : getJudge0Health();
  }

  return {
    provider: 'local',
    configured: true,
    healthy: true,
    message: 'Using local child-process runner',
  };
}
