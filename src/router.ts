/** Intelligent router that selects a runner from task intent, explicit IDs, or provider shortcuts. */

import type { BaseRunner } from './runners/base.js';
import type { RunnerRegistry } from './runners/registry.js';

/** Provider shortcut groups, tried in order until a configured runner is found. */
const PROVIDER_SHORTCUTS: ReadonlyArray<{ match: readonly string[]; candidates: readonly string[] }> = [
  {
    match: ['nvidia', 'nemotron'],
    candidates: ['nemotron-3-super-120b-a12b', 'nvidia-llama-70b', 'nvidia-qwen-coder', 'nvidia-deepseek-r1'],
  },
  {
    match: ['ollama', 'local', 'free'],
    candidates: ['ollama-qwen-coder', 'ollama-llama3.2', 'ollama-deepseek-r1', 'openrouter-qwen-coder-free'],
  },
  {
    match: ['claude', 'sonnet'],
    candidates: ['openrouter-claude-sonnet-4.5', 'code-review-agent', 'claude-3-7-sonnet'],
  },
  {
    match: ['openai', 'gpt'],
    candidates: ['gpt-4o', 'gpt-4o-mini', 'test-generator-agent'],
  },
];

/** Role shortcuts mapping a keyword to a single specialized agent. */
const ROLE_SHORTCUTS: ReadonlyArray<readonly [keyword: string, runnerId: string]> = [
  ['plan', 'planner-agent'],
  ['review', 'code-review-agent'],
  ['test', 'test-generator-agent'],
  ['explain', 'explain-agent'],
];

/** Preferred defaults, in priority order, when no `default_runner` is configured. */
const PREFERRED_DEFAULTS = [
  'nemotron-3-super-120b-a12b',
  'openrouter-claude-sonnet-4.5',
  'code-review-agent',
  'claude-3-7-sonnet',
  'gpt-4o',
  'gpt-4o-mini',
  'ollama-qwen-coder',
] as const;

const PLAN_KEYWORDS = [
  'plan', 'roadmap', 'architecture', 'break down', 'design plan',
  'implementation plan', 'strategy', 'phases', 'step-by-step plan',
] as const;

const REVIEW_KEYWORDS = [
  'review', 'audit', 'critique', 'vulnerability', 'security',
  'edge case', 'smell', 'refactor', 'race condition', 'memory leak',
  'optimize', 'performance issue', 'bug in', 'check this code',
] as const;

const EXPLAIN_KEYWORDS = [
  'explain', 'what does this do', 'how does this work',
  'walk me through', 'help me understand', 'document this',
  'what is this', 'describe this', 'break down', 'annotate',
  'summarize this code', 'help me read', 'what does it do',
] as const;

const TEST_KEYWORDS = [
  'generate test', 'unit test', 'widget test', 'integration test',
  'pytest', 'mock', 'assert', 'coverage', 'test case', 'tdd',
  'write test', 'add test',
] as const;

/** Information about the currently active runner and routing mode. */
export interface ActiveRunnerInfo {
  mode: 'auto' | 'pinned';
  active_runner_id: string | null;
  model: string | null;
  description: string;
}

/** Routes tasks to the most suitable runner automatically, via shortcuts, or by explicit ID. */
export class TaskRouter {
  activeRunnerId: string | null = null;

  constructor(public readonly registry: RunnerRegistry) {}

  /** Resolve a shortcut or provider name (e.g. 'nvidia', 'ollama', 'claude') to a runner. */
  resolveShortcut(target: string): BaseRunner | null {
    const targetClean = target.trim().toLowerCase();

    // 1. Exact match in the registry (which itself handles aliases).
    const exact = this.registry.get(target);
    if (exact) return exact;

    // 2. Provider and model shortcuts.
    for (const { match, candidates } of PROVIDER_SHORTCUTS) {
      if (!match.some((keyword) => targetClean.includes(keyword))) continue;
      for (const candidate of candidates) {
        const runner = this.registry.get(candidate);
        if (runner) return runner;
      }
    }

    // 3. Role shortcuts.
    for (const [keyword, runnerId] of ROLE_SHORTCUTS) {
      if (targetClean.includes(keyword)) {
        const runner = this.registry.get(runnerId);
        if (runner) return runner;
      }
    }

    return null;
  }

  /** Switch the active runner. Accepts an exact ID, a provider name, 'auto', or 'direct'. */
  setActiveRunner(target: string): { ok: boolean; message: string } {
    const targetClean = target.trim().toLowerCase();

    if (['auto', 'default', 'reset'].includes(targetClean)) {
      this.activeRunnerId = null;
      return {
        ok: true,
        message:
          "Switched to 'auto' mode. TaskRouter will automatically pick the best agent for each task.",
      };
    }

    if (['direct', 'claude-direct', 'native'].includes(targetClean)) {
      this.activeRunnerId = 'direct';
      return { ok: true, message: "Switched to 'direct' mode. Claude Code will handle tasks natively." };
    }

    const runner = this.resolveShortcut(target);
    if (runner) {
      this.activeRunnerId = runner.id;
      return { ok: true, message: `Active model switched to: '${runner.id}' (${runner.model})` };
    }

    return {
      ok: false,
      message: `Could not find runner matching '${target}'. Available runners: ${this.formatAvailable()}`,
    };
  }

  /** Information about the currently active runner and mode. */
  getActiveRunnerInfo(): ActiveRunnerInfo {
    if (this.activeRunnerId === null) {
      const fallback = this.getDefaultRunner();
      return {
        mode: 'auto',
        active_runner_id: fallback ? fallback.id : null,
        model: fallback ? fallback.model : null,
        description: 'Auto-routing active based on task keywords',
      };
    }

    const runner = this.registry.get(this.activeRunnerId);
    return {
      mode: 'pinned',
      active_runner_id: this.activeRunnerId,
      model: runner ? runner.model : 'unknown',
      description: `Pinned to ${this.activeRunnerId}`,
    };
  }

  /** The configured default runner, the first available preferred runner, or any runner. */
  getDefaultRunner(): BaseRunner | null {
    const configuredId = this.registry.serverConfig['default_runner'];
    if (typeof configuredId === 'string' && configuredId) {
      const runner = this.registry.get(configuredId);
      if (runner) return runner;
    }

    for (const preferredId of PREFERRED_DEFAULTS) {
      const runner = this.registry.get(preferredId);
      if (runner) return runner;
    }

    const first = this.registry.listRunners().values().next();
    return first.done ? null : first.value;
  }

  /** Pick the best runner for a task: explicit ID, pinned runner, then intent classification. */
  routeTask(task: string, explicitRunnerId?: string | null): BaseRunner | null {
    // 1. Explicit runner ID or shortcut supplied with the request.
    if (explicitRunnerId && !['default', 'auto', ''].includes(explicitRunnerId)) {
      const runner = this.resolveShortcut(explicitRunnerId);
      if (runner) return runner;
      return this.registry.get(explicitRunnerId);
    }

    // 2. Pinned active runner.
    if (this.activeRunnerId && !['auto', 'direct'].includes(this.activeRunnerId)) {
      const pinned = this.registry.get(this.activeRunnerId);
      if (pinned) return pinned;
    }

    const taskLower = task.toLowerCase();
    const matches = (keywords: readonly string[]): boolean =>
      keywords.some((keyword) => taskLower.includes(keyword));

    // 3. Planning / architecture intent.
    if (matches(PLAN_KEYWORDS)) {
      const runner = this.registry.get('planner-agent');
      if (runner) return runner;
    }

    // 4. Code review intent.
    if (matches(REVIEW_KEYWORDS)) {
      const runner = this.registry.get('code-review-agent');
      if (runner) return runner;
    }

    // 5. Explanation / documentation intent.
    if (matches(EXPLAIN_KEYWORDS)) {
      const runner = this.registry.get('explain-agent');
      if (runner) return runner;
    }

    // 6. Test generation intent.
    if (matches(TEST_KEYWORDS)) {
      const runner = this.registry.get('test-generator-agent') ?? this.registry.get('gpt-4o');
      if (runner) return runner;
    }

    // 7. Default primary runner.
    return this.getDefaultRunner();
  }

  /** Render the registered ID list the way Python's list repr did, for error messages. */
  private formatAvailable(): string {
    return `[${this.registry.registeredIds().map((id) => `'${id}'`).join(', ')}]`;
  }
}
