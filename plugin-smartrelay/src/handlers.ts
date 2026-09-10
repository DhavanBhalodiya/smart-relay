import type { SmartRelayConfig } from './config.schema.js';

// Inline McpContext to avoid importing from @mcphub/core internal paths
interface McpContext {
  userId?: string;
  sessionId?: string;
  [key: string]: unknown;
}

/**
 * Call a tool on the remote SmartRelay HTTP API.
 */
async function callSmartRelay(
  toolSuffix: string,
  args: Record<string, unknown>,
  config: SmartRelayConfig,
): Promise<unknown> {
  if (!config.apiUrl || !config.apiKey) {
    return { error: 'SmartRelay not configured. Call smartrelay_configure first.' };
  }

  const url = `${config.apiUrl}/tools/${toolSuffix}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });

  if (!response.ok) {
    const error = await response.text();
    return { error: `HTTP ${response.status}: ${error}` };
  }

  // SmartRelay returns either JSON or plain text depending on the tool
  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    return response.json();
  }
  return response.text();
}

export async function handleToolCall(
  toolName: string,
  args: unknown,
  context: McpContext,
  config: SmartRelayConfig,
): Promise<unknown> {
  const a = args as Record<string, unknown>;

  switch (toolName) {
    // Settings tools
    case 'smartrelay_configure':
      return { status: 'configured' };
    case 'smartrelay_status':
      return callSmartRelay('status', {}, config);
    case 'smartrelay_remove':
      return { status: 'removed' };
    case 'smartrelay_health_check':
      return callSmartRelay('health_check', {}, config);
    case 'smartrelay_get_logs':
      return callSmartRelay('get_logs', { limit: a.limit ?? 50 }, config);

    // Model switching
    case 'smartrelay_switch_model':
      return callSmartRelay('switch_model', { model: a.model }, config);
    case 'smartrelay_get_active_model':
      return callSmartRelay('get_active_model', {}, config);

    // Delegation tools
    case 'smartrelay_create_plan':
      return callSmartRelay('create_plan', { goal: a.goal, context: a.context ?? '' }, config);
    case 'smartrelay_review_code':
      return callSmartRelay('review_code', { code: a.code, focus: a.focus }, config);
    case 'smartrelay_generate_tests':
      return callSmartRelay('generate_tests', { code: a.code, framework: a.framework }, config);
    case 'smartrelay_ask_subagent':
      return callSmartRelay('ask_subagent', { prompt: a.prompt, model: a.model }, config);
    case 'smartrelay_review_file':
      return callSmartRelay('review_file', { file_path: a.file_path, focus: a.focus }, config);
    case 'smartrelay_test_file':
      return callSmartRelay('test_file', { file_path: a.file_path, framework: a.framework }, config);
    case 'smartrelay_explain_code':
      return callSmartRelay('explain_code', {
        code: a.code,
        audience: a.audience,
        language: a.language,
      }, config);
    case 'smartrelay_explain_file':
      return callSmartRelay('explain_file', { file_path: a.file_path, audience: a.audience }, config);
    case 'smartrelay_list_runners':
      return callSmartRelay('list_runners', {}, config);
    case 'smartrelay_delegate_task':
      return callSmartRelay('delegate_task', {
        task: a.task,
        runner_id: a.runner_id,
        params: a.params,
      }, config);
    case 'smartrelay_benchmark_run':
      return callSmartRelay('benchmark_run', {
        task: a.task,
        runner_ids: a.runner_ids,
        params: a.params,
        reference_answer: a.reference_answer,
        judge_runner_id: a.judge_runner_id,
        eval_criteria: a.eval_criteria,
      }, config);

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
