import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { TaskRouter } from '../src/router.js';
import { RunnerRegistry } from '../src/runners/registry.js';
import { cleanReviewOutput, readFileFromDisk } from '../src/tools/index.js';

describe('TaskRouter and 1-click convenience tools', () => {
  it('detects intent automatically based on task prompt', () => {
    const registry = RunnerRegistry.fromYaml();
    const router = new TaskRouter(registry);

    // 1. Code review intent
    const rReview = router.routeTask(
      'Please review this Python function for security vulnerabilities and race conditions.',
    );
    expect(rReview).not.toBeNull();
    expect(rReview?.id).toBe('code-review-agent');

    // 2. Test generation intent
    const rTest = router.routeTask(
      'Generate comprehensive pytest unit tests for authentication service.',
    );
    expect(rTest).not.toBeNull();
    expect(['test-generator-agent', 'gpt-4o']).toContain(rTest?.id);

    // 3. Explicit runner ID override
    const rExplicit = router.routeTask('Write a poem', 'claude-3-7-sonnet');
    expect(rExplicit).not.toBeNull();
    expect(rExplicit?.id).toBe('claude-3-7-sonnet');
  });

  it('handles dynamic model switching and mode reset', () => {
    const registry = RunnerRegistry.fromYaml();
    const router = new TaskRouter(registry);

    // 1. Switch to nvidia
    const { ok, message } = router.setActiveRunner('nvidia');
    expect(ok).toBe(true);
    expect(message).toContain('nemotron-3-super-120b-a12b');
    const activeRunner = router.routeTask('General question');
    expect(['nemotron-3-super-120b-a12b', 'nvidia-llama-70b', 'nvidia-llama-3.3-70b']).toContain(
      activeRunner?.id,
    );

    // 2. Switch to auto
    const resAuto = router.setActiveRunner('auto');
    expect(resAuto.ok).toBe(true);
    expect(router.activeRunnerId).toBeNull();
  });

  it('resolves provider shortcuts directly', () => {
    const registry = RunnerRegistry.fromYaml();
    const router = new TaskRouter(registry);

    // Shortcut 'nvidia'
    const rNv = router.routeTask('Hello', 'nvidia');
    expect(rNv).not.toBeNull();
    expect(['nemotron-3-super-120b-a12b', 'nvidia-llama-70b', 'nvidia-llama-3.3-70b']).toContain(
      rNv?.id,
    );

    // Shortcut 'ollama' / 'local'
    const rOl = router.routeTask('Hello', 'ollama');
    expect(rOl).not.toBeNull();
    expect(['ollama-qwen-coder', 'ollama-llama3.2']).toContain(rOl?.id);

    // Shortcut 'claude'
    const rCl = router.routeTask('Hello', 'claude');
    expect(rCl).not.toBeNull();
    expect(['openrouter-claude-sonnet-4.5', 'code-review-agent', 'claude-3-7-sonnet']).toContain(
      rCl?.id,
    );
  });

  it('loads external markdown prompt files into runner config', () => {
    const registry = RunnerRegistry.fromYaml();
    const reviewer = registry.get('code-review-agent');
    expect(reviewer).not.toBeNull();
    const reviewerPrompt = String(reviewer?.config.default_params['system_prompt'] ?? '');
    expect(reviewerPrompt).toContain('Resource Cleanup & Memory');
    expect(reviewerPrompt).toContain('Principal Code Reviewer');

    const planner = registry.get('planner-agent');
    expect(planner).not.toBeNull();
    const plannerPrompt = String(planner?.config.default_params['system_prompt'] ?? '');
    expect(plannerPrompt).toContain('Principal Software Architect');
  });

  it('loads all runners across modular included YAML files', () => {
    const registry = RunnerRegistry.fromYaml();
    const ids = registry.registeredIds();

    // From agents.yaml
    expect(ids).toContain('planner-agent');
    expect(ids).toContain('code-review-agent');
    expect(ids).toContain('test-generator-agent');

    // From nvidia.yaml
    expect(ids).toContain('nemotron-3-super-120b-a12b');
    expect(ids).toContain('nvidia-qwen-coder');

    // From openrouter.yaml
    expect(ids).toContain('openrouter-claude-sonnet-4.5');
    expect(ids).toContain('openrouter-deepseek-v3');

    // From ollama.yaml
    expect(ids).toContain('ollama-qwen-coder');

    // From anthropic.yaml
    expect(ids).toContain('claude-3-7-sonnet');

    // From openai.yaml
    expect(ids).toContain('gpt-4o');
  });

  it('cleans review output removing preambles', () => {
    const rawOutput = `
We are given a Dart/Flutter code snippet.
Let's break down the code:
1. Controller not disposed...

# 🛡️ Code Review Report
**Scope**: \`lib/login.dart\`
**Overall Health Score**: 72/100 (C)

## 📊 Summary of Findings
| Severity | Count | Status |
| :--- | :--- | :--- |
| 🚨 **Blockers** | 1 | Needs immediate fix |

## 🚨 Blockers (Must Fix)
- \`[L12]\`: \`_controller\` is never disposed.
`;
    const cleaned = cleanReviewOutput(rawOutput);
    expect(cleaned.startsWith('We are given')).toBe(false);
    expect(cleaned.startsWith('# 🛡️ Code Review Report')).toBe(true);
    expect(cleaned).toContain('## 📊 Summary of Findings');
    expect(cleaned).toContain('## 🚨 Blockers (Must Fix)');
  });

  describe('readFileFromDisk', () => {
    const tmpDir = path.join(os.tmpdir(), `smartrelay-test-${Date.now()}`);

    it('reads a valid file from disk', () => {
      mkdirSync(tmpDir, { recursive: true });
      const testFile = path.join(tmpDir, 'hello.dart');
      writeFileSync(testFile, 'void main() {}', 'utf-8');

      const { content, error } = readFileFromDisk(testFile);
      expect(error).toBeNull();
      expect(content).toBe('void main() {}');
    });

    it('returns error for missing file', () => {
      const { content, error } = readFileFromDisk('/nonexistent/path/fake.dart');
      expect(content).toBeNull();
      expect(error).toContain('File not found');
    });

    it('rejects files over 500KB', () => {
      mkdirSync(tmpDir, { recursive: true });
      const bigFile = path.join(tmpDir, 'huge.dart');
      writeFileSync(bigFile, 'x'.repeat(600 * 1024), 'utf-8');

      const { content, error } = readFileFromDisk(bigFile);
      expect(content).toBeNull();
      expect(error).toContain('too large');
    });

    it('rejects directories', () => {
      mkdirSync(tmpDir, { recursive: true });
      const { content, error } = readFileFromDisk(tmpDir);
      expect(content).toBeNull();
      expect(error).toContain('not a file');

      rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});
