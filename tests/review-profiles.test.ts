import { describe, expect, it, vi } from 'vitest';
import {
  PROFILES,
  buildReviewPrompt,
  detectLanguage,
  getReviewProfile,
} from '../src/profiles/review-profiles.js';
import { reviewCode, reviewFile } from '../src/tools/handlers.js';
import { TaskRouter } from '../src/router.js';
import { RunnerRegistry } from '../src/runners/registry.js';
import { BaseRunner, RunnerConfig, RunnerResult, makeRunnerResult } from '../src/runners/base.js';

class MockReviewRunner extends BaseRunner {
  public lastTask: string = '';
  public lastParams: Record<string, unknown> | null | undefined = null;

  constructor(config: RunnerConfig) {
    super(config);
  }

  async execute(task: string, params?: Record<string, unknown> | null): Promise<RunnerResult> {
    this.lastTask = task;
    this.lastParams = params;
    return makeRunnerResult({
      runner_id: this.id,
      model: this.model,
      task,
      output: `# 🛡️ Code Review Report\n**Scope**: Test\n**Overall Health Score**: 95/100 (A)\n\n## 📊 Summary of Findings\n| Severity | Count | Status |\n| :--- | :--- | :--- |\n| 🚨 **Blockers** | 0 | None |\n\n## 🚨 Blockers (Must Fix)\nNone identified.\n`,
      success: true,
    });
  }
}

describe('Dynamic Language Review Profiles', () => {
  describe('detectLanguage', () => {
    it('detects language from file extensions', () => {
      expect(detectLanguage('', 'lib/main.dart')).toBe('flutter');
      expect(detectLanguage('', 'src/index.ts')).toBe('typescript');
      expect(detectLanguage('', 'src/App.tsx')).toBe('typescript');
      expect(detectLanguage('', 'scripts/build.js')).toBe('typescript');
      expect(detectLanguage('', 'backend/app.py')).toBe('python');
      expect(detectLanguage('', 'cmd/server/main.go')).toBe('go');
      expect(detectLanguage('', 'src/main.rs')).toBe('rust');
      expect(detectLanguage('', 'src/Main.java')).toBe('java');
      expect(detectLanguage('', 'app/MainActivity.kt')).toBe('kotlin');
      expect(detectLanguage('', 'ios/AppDelegate.swift')).toBe('swift');
      expect(detectLanguage('', 'native/core.cpp')).toBe('cpp');
      expect(detectLanguage('', 'native/header.hpp')).toBe('cpp');
      expect(detectLanguage('', 'unknown/file.xyz')).toBe('general');
    });

    it('detects language from Flutter/Dart code heuristics', () => {
      const code = `
        import 'package:flutter/material.dart';
        class MyWidget extends StatelessWidget {
          @override
          Widget build(BuildContext context) => Container();
        }
      `;
      expect(detectLanguage(code)).toBe('flutter');
    });

    it('detects language from Python code heuristics', () => {
      const code = `
        import os
        def fetch_data(items=[]):
            return [x for x in items]
      `;
      expect(detectLanguage(code)).toBe('python');
    });

    it('detects language from Go code heuristics', () => {
      const code = `
        package main
        import "fmt"
        func Calculate(x int) int {
            return x * 2
        }
      `;
      expect(detectLanguage(code)).toBe('go');
    });

    it('detects language from Rust code heuristics', () => {
      const code = `
        use std::collections::HashMap;
        pub fn process_event(id: u64) -> Result<(), String> {
            Ok(())
        }
      `;
      expect(detectLanguage(code)).toBe('rust');
    });

    it('detects language from TypeScript code heuristics', () => {
      const code = `
        interface UserConfig {
          timeout: number;
        }
        export async function loadConfig(): Promise<UserConfig> {
          return { timeout: 1000 };
        }
      `;
      expect(detectLanguage(code)).toBe('typescript');
    });

    it('detects language from Swift code heuristics', () => {
      const code = `
        import SwiftUI
        struct ContentView: View {
          @State private var count = 0
          var body: some View { Text("Count: \\(count)") }
        }
      `;
      expect(detectLanguage(code)).toBe('swift');
    });

    it('detects language from Kotlin code heuristics', () => {
      const code = `
        package com.example.app
        data class User(val id: String, val name: String)
        suspend fun fetchUser(): User = User("1", "Alice")
      `;
      expect(detectLanguage(code)).toBe('kotlin');
    });

    it('detects language from Java code heuristics', () => {
      const code = `
        package com.example.service;
        public class UserService {
            @Override
            public String toString() { return "UserService"; }
        }
      `;
      expect(detectLanguage(code)).toBe('java');
    });

    it('detects language from C++ code heuristics with header comments', () => {
      const code = `
        /*
         * Copyright (c) 2026 Enterprise Systems Inc.
         * All rights reserved.
         */
        #include <iostream>
        #include <vector>
        int main(int argc, char** argv) {
            std::cout << "Hello" << std::endl;
            return 0;
        }
      `;
      expect(detectLanguage(code)).toBe('cpp');
    });

    it('falls back to general when code is ambiguous', () => {
      const code = `hello world this is plain text without any code structure`;
      expect(detectLanguage(code)).toBe('general');
    });
  });

  describe('getReviewProfile', () => {
    it('resolves profile by ID', () => {
      expect(getReviewProfile('flutter').id).toBe('flutter');
      expect(getReviewProfile('typescript').id).toBe('typescript');
      expect(getReviewProfile('python').id).toBe('python');
      expect(getReviewProfile('go').id).toBe('go');
      expect(getReviewProfile('rust').id).toBe('rust');
      expect(getReviewProfile('java').id).toBe('java');
      expect(getReviewProfile('kotlin').id).toBe('kotlin');
      expect(getReviewProfile('swift').id).toBe('swift');
      expect(getReviewProfile('cpp').id).toBe('cpp');
      expect(getReviewProfile('general').id).toBe('general');
    });

    it('resolves profile by aliases', () => {
      expect(getReviewProfile('dart').id).toBe('flutter');
      expect(getReviewProfile('ts').id).toBe('typescript');
      expect(getReviewProfile('js').id).toBe('typescript');
      expect(getReviewProfile('py').id).toBe('python');
      expect(getReviewProfile('golang').id).toBe('go');
      expect(getReviewProfile('rs').id).toBe('rust');
      expect(getReviewProfile('kt').id).toBe('kotlin');
      expect(getReviewProfile('ios').id).toBe('swift');
      expect(getReviewProfile('c++').id).toBe('cpp');
    });

    it('resolves profile by file extension string', () => {
      expect(getReviewProfile('.dart').id).toBe('flutter');
      expect(getReviewProfile('.py').id).toBe('python');
      expect(getReviewProfile('.ts').id).toBe('typescript');
      expect(getReviewProfile('.kt').id).toBe('kotlin');
      expect(getReviewProfile('.swift').id).toBe('swift');
      expect(getReviewProfile('.cpp').id).toBe('cpp');
    });

    it('defaults to general for auto or unknown', () => {
      expect(getReviewProfile('auto').id).toBe('general');
      expect(getReviewProfile('unknown_lang').id).toBe('general');
      expect(getReviewProfile(undefined).id).toBe('general');
    });
  });

  describe('buildReviewPrompt', () => {
    it('generates language-tailored systemPrompt and taskPrompt', () => {
      const profile = PROFILES['typescript'];
      const { taskPrompt, systemPrompt } = buildReviewPrompt(
        profile,
        'const x: any = 1;',
        'type safety',
        'handler.ts',
      );

      expect(taskPrompt).toContain('Perform a comprehensive code review of **`handler.ts`**');
      expect(taskPrompt).toContain('Language Profile: TypeScript / JavaScript');
      expect(taskPrompt).toContain('const x: any = 1;');

      expect(systemPrompt).toContain('Principal Code Reviewer');
      expect(systemPrompt).toContain('TypeScript, Node.js');
      expect(systemPrompt).toContain('CRITICAL INSPECTION VECTORS (TypeScript / JavaScript):');
      expect(systemPrompt).toContain('Loose or unnecessary use of `any`');
      expect(systemPrompt).toContain('npm run typecheck');
    });

    it('includes Python-specific vectors for Python profile', () => {
      const profile = PROFILES['python'];
      const { systemPrompt } = buildReviewPrompt(profile, 'def f(x=[]): pass', 'idioms');
      expect(systemPrompt).toContain('Python, High-Performance Backends');
      expect(systemPrompt).toContain('Mutable default arguments');
      expect(systemPrompt).toContain('pytest');
      expect(systemPrompt).toContain('ruff check');
    });
  });

  describe('reviewCode handler with dynamic language profiles', () => {
    it('passes language-tailored system prompt to the runner', async () => {
      const registry = RunnerRegistry.fromYaml();
      const router = new TaskRouter(registry);

      const mockRunner = new MockReviewRunner({
        id: 'code-review-agent',
        type: 'test',
        model: 'test-model',
        api_key_env: null,
        base_url: null,
        cost_per_million_input_tokens: 0,
        cost_per_million_output_tokens: 0,
        default_params: {},
        timeout_seconds: 30,
      });

      vi.spyOn(router, 'routeTask').mockReturnValue(mockRunner);

      const pythonSnippet = `
def process_data(records=[]):
    for r in records:
        print(r)
      `;

      const result = await reviewCode(
        router,
        pythonSnippet,
        'bugs and performance',
        'python',
      );

      expect(result).toContain('# 🛡️ Code Review Report');
      expect(mockRunner.lastTask).toContain('Language Profile: Python');
      expect(mockRunner.lastParams?.['system_prompt']).toContain('Python, High-Performance Backends');
      expect(mockRunner.lastParams?.['system_prompt']).toContain('Mutable default arguments');
    });

    it('auto-detects language when language is auto', async () => {
      const registry = RunnerRegistry.fromYaml();
      const router = new TaskRouter(registry);

      const mockRunner = new MockReviewRunner({
        id: 'code-review-agent',
        type: 'test',
        model: 'test-model',
        api_key_env: null,
        base_url: null,
        cost_per_million_input_tokens: 0,
        cost_per_million_output_tokens: 0,
        default_params: {},
        timeout_seconds: 30,
      });

      vi.spyOn(router, 'routeTask').mockReturnValue(mockRunner);

      const tsSnippet = `
interface ResponseData {
  id: string;
}
export async function handleRequest(): Promise<ResponseData> {
  return { id: "1" };
}
      `;

      await reviewCode(router, tsSnippet, 'clean code', 'auto');
      expect(mockRunner.lastTask).toContain('Language Profile: TypeScript / JavaScript');
      expect(mockRunner.lastParams?.['system_prompt']).toContain('TypeScript, Node.js');
    });
  });
});
