#!/usr/bin/env npx tsx
/**
 * Local plugin conformance test — no MCPHub, no network required.
 * Run: npx tsx scripts/test-plugin.ts
 */

// Built output, not src: the plugin resolves '@theone1345/smartrelay/dispatch'
// through its package exports, so run `npm run build && npm run build:plugin` first.
import SmartRelayPlugin from '../plugin-smartrelay/dist/index.js';

// ─── Colors ────────────────────────────────────────────────────────────────
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ${GREEN}✓${RESET} ${label}`);
    passed++;
  } else {
    console.log(`  ${RED}✗${RESET} ${label}${detail ? `: ${RED}${detail}${RESET}` : ''}`);
    failed++;
  }
}

async function main() {
  console.log(`\n${BOLD}SmartRelay MCPHub Plugin — Local Conformance Test${RESET}`);
  console.log('═'.repeat(52));

  // ── 1. Class structure ─────────────────────────────────────────────────
  console.log(`\n${YELLOW}1. Class structure${RESET}`);
  check('default export is a class/function', typeof SmartRelayPlugin === 'function');
  check('class name is SmartRelayPlugin', SmartRelayPlugin.name === 'SmartRelayPlugin');

  const p = new SmartRelayPlugin();
  check('can instantiate without args', p !== null);
  check('has name property', p.name === 'smartrelay');
  check('has displayName property', typeof p.displayName === 'string');
  check('has version property', typeof p.version === 'string');

  // ── 2. Required contract methods ───────────────────────────────────────
  console.log(`\n${YELLOW}2. Required contract methods (MCPHub L1)${RESET}`);
  check('getTools() exists', typeof p.getTools === 'function');
  check('getConfigSchema() exists', typeof p.getConfigSchema === 'function');
  check('getSensitiveConfigFields() exists', typeof p.getSensitiveConfigFields === 'function');
  check('initialize() exists', typeof p.initialize === 'function');
  check('handleToolCall() exists', typeof p.handleToolCall === 'function');
  check('healthCheck() exists', typeof p.healthCheck === 'function');
  check('getConfigMeta() exists', typeof p.getConfigMeta === 'function');
  check('getActionPlans() exists', typeof p.getActionPlans === 'function');

  // ── 3. Tools list ──────────────────────────────────────────────────────
  console.log(`\n${YELLOW}3. Tools${RESET}`);
  const tools = p.getTools();
  check('getTools() returns an array', Array.isArray(tools));
  check('at least 5 settings tools declared', tools.length >= 5);
  console.log(`     → ${tools.length} tools total`);

  const REQUIRED_SETTINGS_TOOLS = [
    'smartrelay_configure',
    'smartrelay_status',
    'smartrelay_remove',
    'smartrelay_health_check',
    'smartrelay_get_logs',
  ];
  for (const name of REQUIRED_SETTINGS_TOOLS) {
    const found = tools.find((t: any) => t.name === name);
    check(`settings tool '${name}' exists`, !!found);
  }

  const toolNames: string[] = tools.map((t: any) => t.name);
  const allHavePrefix = toolNames.every(n => n.startsWith('smartrelay_'));
  check('all tools use smartrelay_ prefix', allHavePrefix,
    allHavePrefix ? undefined : toolNames.filter(n => !n.startsWith('smartrelay_')).join(', '));

  // ── 4. Config schema ───────────────────────────────────────────────────
  console.log(`\n${YELLOW}4. Config schema${RESET}`);
  const schema = p.getConfigSchema();
  check('getConfigSchema() returns an object', typeof schema === 'object' && schema !== null);
  const emptyParsed = schema.safeParse({});
  check('schema.safeParse({}) succeeds (handles empty config)', emptyParsed.success);
  if (emptyParsed.success) {
    check('parsed config has nvidiaApiKey field', 'nvidiaApiKey' in emptyParsed.data);
    check('parsed config has openrouterApiKey field', 'openrouterApiKey' in emptyParsed.data);
  }

  const sensitiveFields = p.getSensitiveConfigFields();
  check('getSensitiveConfigFields() returns array', Array.isArray(sensitiveFields));
  check('every provider key is marked sensitive',
    ['nvidiaApiKey', 'openrouterApiKey', 'anthropicApiKey', 'openaiApiKey']
      .every((f) => sensitiveFields.includes(f)));

  // ── 5. initialize() ─────────────────────────────────────────────────────
  console.log(`\n${YELLOW}5. initialize()${RESET}`);
  try {
    await p.initialize({});
    check('initialize({}) does not throw', true);
  } catch (e) {
    check('initialize({}) does not throw', false, String(e));
  }
  try {
    await p.initialize({ nvidiaApiKey: 'nvapi-test', openrouterApiKey: 'sk-or-v1-test' });
    check('initialize() with config does not throw', true);
  } catch (e) {
    check('initialize() with config does not throw', false, String(e));
  }

  // ── 6. handleToolCall() — unknown tool must throw ──────────────────────
  console.log(`\n${YELLOW}6. handleToolCall()${RESET}`);
  try {
    await p.handleToolCall('smartrelay_configure', {}, {});
    check('smartrelay_configure returns without throw', true);
  } catch (e) {
    check('smartrelay_configure returns without throw', false, String(e));
  }
  try {
    await p.handleToolCall('unknown_tool_xyz', {}, {});
    check('unknown tool throws an error', false, 'should have thrown');
  } catch {
    check('unknown tool throws an error', true);
  }

  // ── 7. healthCheck() ───────────────────────────────────────────────────
  console.log(`\n${YELLOW}7. healthCheck()${RESET}`);
  const health = await p.healthCheck();
  check('healthCheck() returns an object', typeof health === 'object' && health !== null);
  check("healthCheck() has 'status' field", 'status' in health);
  check("status is 'healthy' or 'unhealthy'",
    health.status === 'healthy' || health.status === 'unhealthy');
  // `p` was configured in section 5, so it should now report healthy.
  check("status is 'healthy' once keys are configured", health.status === 'healthy');
  console.log(`     → message: "${health.message}"`);

  const unconfigured = new SmartRelayPlugin();
  await unconfigured.initialize({});
  const blocked = await unconfigured.healthCheck();
  check("status is 'unhealthy' before any keys are set", blocked.status === 'unhealthy');
  console.log(`     → message: "${blocked.message}"`);

  // ── 8. getActionPlans() ────────────────────────────────────────────────
  console.log(`\n${YELLOW}8. Action plans${RESET}`);
  const plans = p.getActionPlans();
  check('getActionPlans() returns an array', Array.isArray(plans));
  check('at least 1 action plan defined', plans.length >= 1);
  if (plans[0]) {
    check('plan has at least 3 steps', plans[0].steps.length >= 3);
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log('\n' + '═'.repeat(52));
  if (failed === 0) {
    console.log(`${GREEN}${BOLD}✅ All ${total} checks passed! Plugin is MCPHub-conformant.${RESET}`);
  } else {
    console.log(`${RED}${BOLD}❌ ${failed}/${total} checks failed.${RESET}`);
  }
  console.log('');

  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch(err => {
  console.error(`${RED}Fatal error:${RESET}`, err);
  process.exitCode = 1;
});
