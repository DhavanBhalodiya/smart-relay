#!/usr/bin/env node
/**
 * Test script for testing Dynamic Language-Aware Code Review Profiles.
 * Usage:
 *   npx tsx scripts/test-review.ts --lang=python
 *   npx tsx scripts/test-review.ts --lang=typescript
 *   npx tsx scripts/test-review.ts --file=src/tools/handlers.ts
 */

import { parseArgs } from 'node:util';
import { TaskRouter } from '../src/router.js';
import { RunnerRegistry } from '../src/runners/registry.js';
import { reviewCode, reviewFile } from '../src/tools/handlers.js';
import { loadDotEnv } from '../src/util.js';

loadDotEnv();

const SAMPLE_SNIPPETS: Record<string, string> = {
  python: `
def fetch_user_data(user_id, cache={}):
    # Mutable default argument hazard
    query = "SELECT * FROM users WHERE id = '%s'" % user_id  # SQL injection
    if user_id in cache:
        return cache[user_id]
    result = execute_query(query)
    cache[user_id] = result
    return result
`,
  typescript: `
import { EventEmitter } from 'events';

const emitter = new EventEmitter();

export function registerListener(callback: any) {
  // Memory leak: listener added on every call without teardown
  emitter.on('data', async (payload) => {
    // Unhandled promise rejection hazard
    await callback(payload);
  });
}
`,
  flutter: `
import 'package:flutter/material.dart';

class ProfileScreen extends StatefulWidget {
  @override
  _ProfileScreenState createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  late TextEditingController _controller; // Hazard: Never disposed

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: TextField(controller: _controller),
    );
  }
}
`,
  go: `
package main

import (
	"fmt"
	"net/http"
)

func FetchStatus(url string) int {
	resp, err := http.Get(url)
	_ = err // Unchecked error return
	// Hazard: resp.Body is never closed (leak)
	return resp.StatusCode
}
`,
};

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      lang: { type: 'string', default: 'python' },
      file: { type: 'string' },
      runner: { type: 'string' },
      focus: { type: 'string', default: 'bugs, security, clean code, and performance' },
      config: { type: 'string', default: 'config.yaml' },
    },
  });

  const registry = RunnerRegistry.fromYaml(values.config);
  const router = new TaskRouter(registry);

  if (values.runner) {
    const customRunner = registry.get(values.runner);
    if (customRunner) {
      // Temporarily register as code-review-agent for this run
      (registry as any).runners.set('code-review-agent', customRunner);
    }
  }

  if (values.file) {
    console.log(`\n🔍 Reviewing file: ${values.file} (language: auto)...`);
    const report = await reviewFile(router, values.file, values.focus, 'auto');
    console.log('\n' + report);
    return;
  }

  const lang = values.lang.toLowerCase();
  const code = SAMPLE_SNIPPETS[lang] ?? SAMPLE_SNIPPETS['python']!;

  console.log(`\n🔍 Reviewing sample code for profile: [${lang.toUpperCase()}]`);
  console.log('--- Input Code ---' + code + '------------------\n');

  const report = await reviewCode(router, code, values.focus, lang);
  console.log(report);
}

main().catch((err) => {
  console.error('Error running test-review:', err);
  process.exitCode = 1;
});
