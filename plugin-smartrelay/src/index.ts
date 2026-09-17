/**
 * SmartRelay MCPHub Plugin
 *
 * Self-contained: the plugin runs SmartRelay's runner registry in-process using
 * the user's own provider API keys. There is no SmartRelay service to host and
 * no credential leaves the machine the plugin runs on.
 *
 * Architecture:
 *   Claude Code → MCPHub Gateway → SmartRelayPlugin (this file)
 *                                   → NVIDIA / OpenRouter / Anthropic / OpenAI
 *
 * Imports the `/dispatch` subpath rather than the package root on purpose: the
 * root re-exports `server.js`, which builds an McpServer and calls `loadDotEnv()`
 * as an import side effect — both wrong inside a host gateway.
 */

import { dispatchTool } from '@theone1345/smartrelay/dispatch';

import { tools } from './tools.js';
import { handleToolCall, type PluginState } from './handlers.js';
import { configSchema, missingRequired, type SmartRelayConfig } from './config.schema.js';
import { applyConfigToEnv } from './env.js';

// ---------------------------------------------------------------------------
// Minimal inline types so the plugin is self-contained and does NOT import
// from @mcphub/core internal paths (which fail in the MCPHub bundler/verifier).
// ---------------------------------------------------------------------------

export * from './types.js';

import type {
  ConfigMeta,
  HealthStatus,
  McpActionPlanDefinition,
  McpContext,
  McpToolDefinition,
  PluginPricing,
} from './types.js';

// ---------------------------------------------------------------------------
// SmartRelayPlugin — default export class (required by MCPHub)
// ---------------------------------------------------------------------------

export default class SmartRelayPlugin {
  readonly name = 'smartrelay';
  readonly displayName = 'SmartRelay';
  readonly description =
    'Delegation, benchmarking, and multi-model orchestration for LLM coding tasks — bring your own API keys';
  readonly version = '2.0.0';
  readonly icon = 'Zap';
  readonly category = 'AI';
  readonly technologies = ['TypeScript', 'LLM', 'MCP', 'NVIDIA NIM', 'OpenRouter'];

  readonly pricing: PluginPricing = {
    tools: {
      free: [
        'smartrelay_configure',
        'smartrelay_status',
        'smartrelay_remove',
        'smartrelay_health_check',
        'smartrelay_get_logs',
        'smartrelay_switch_model',
        'smartrelay_get_active_model',
        'smartrelay_list_runners',
      ],
      pro: [
        'smartrelay_create_plan',
        'smartrelay_review_code',
        'smartrelay_generate_tests',
        'smartrelay_ask_subagent',
        'smartrelay_review_file',
        'smartrelay_test_file',
        'smartrelay_explain_code',
        'smartrelay_explain_file',
        'smartrelay_delegate_task',
        'smartrelay_benchmark_run',
        'smartrelay_audit_security',
        'smartrelay_audit_file_security',
      ],
      enterprise: '*',
    },
    limits: {
      free: { callsPerMonth: 100 },
      pro: { callsPerMonth: 5000 },
      enterprise: { callsPerMonth: -1 },
    },
  };

  private readonly state: PluginState = { config: configSchema.parse({}) };
  private configError: string | null = null;

  // -------------------------------------------------------------------------
  // MCPHub contract methods
  // -------------------------------------------------------------------------

  getTools(): McpToolDefinition[] {
    return tools;
  }

  getConfigSchema() {
    return configSchema;
  }

  getSensitiveConfigFields(): string[] {
    return ['nvidiaApiKey', 'openrouterApiKey', 'anthropicApiKey', 'openaiApiKey'];
  }

  async initialize(config: Record<string, unknown>): Promise<void> {
    // `safeParse`, never `parse`: a throw here would leave the plugin dead on
    // load, with no way for the user to reach settings and correct the value.
    const parsed = configSchema.safeParse(config ?? {});
    this.state.config = parsed.success ? parsed.data : configSchema.parse({});
    this.configError = parsed.success ? null : parsed.error.message;
    applyConfigToEnv(this.state.config);
  }

  async handleToolCall(toolName: string, args: unknown, context: McpContext): Promise<unknown> {
    return handleToolCall(toolName, args, context, this.state);
  }

  getConfigMeta(): ConfigMeta {
    // `fieldType: 'password'` is what makes the host prompt with a masked input —
    // the plugin-side equivalent of what `smartrelay setup` does in a terminal.
    return {
      groups: [
        { key: 'providers', label: 'Provider API Keys', order: 0 },
        { key: 'advanced', label: 'Advanced', order: 1 },
      ],
      fields: {
        nvidiaApiKey: {
          group: 'providers',
          label: 'NVIDIA API Key',
          fieldType: 'password',
          required: true,
          description:
            'Required. Free keys at https://build.nvidia.com. Stored by the host and used ' +
            'to call NVIDIA directly from wherever this plugin runs.',
          placeholder: 'nvapi-...',
        },
        openrouterApiKey: {
          group: 'providers',
          label: 'OpenRouter API Key',
          fieldType: 'password',
          required: true,
          description:
            'Required. Get one at https://openrouter.ai/keys. Stored by the host and used ' +
            'to call OpenRouter directly from wherever this plugin runs.',
          placeholder: 'sk-or-v1-...',
        },
        anthropicApiKey: {
          group: 'providers',
          label: 'Anthropic API Key',
          fieldType: 'password',
          required: false,
          description: 'Optional — unlocks the Claude runners. Stored by the host.',
          placeholder: 'sk-ant-...',
        },
        openaiApiKey: {
          group: 'providers',
          label: 'OpenAI API Key',
          fieldType: 'password',
          required: false,
          description: 'Optional — unlocks the GPT runners. Stored by the host.',
          placeholder: 'sk-proj-...',
        },
        configPath: {
          group: 'advanced',
          label: 'config.yaml path',
          fieldType: 'text',
          required: false,
          description: 'Optional path to a config.yaml defining a custom runner set.',
        },
      },
    };
  }

  getActionPlans(): McpActionPlanDefinition[] {
    return [
      {
        name: 'smartrelay-setup',
        display_name: 'SmartRelay Setup',
        description: 'Add your provider API keys and verify the runners they unlock.',
        trigger_phrases: [
          'setup smartrelay',
          'connect smartrelay',
          'configure smartrelay',
          'smartrelay api keys',
          'add smartrelay keys',
        ],
        plugin_name: this.name,
        expected_outcome:
          'SmartRelay running in-process with authenticated runners for code review, testing, ' +
          'planning, and security audits.',
        steps: [
          {
            id: 'configure',
            order: 1,
            title: 'Add your provider API keys',
            description:
              'Enter your NVIDIA and OpenRouter API keys. Anthropic and OpenAI are optional.',
            tool_to_call: 'smartrelay_configure',
            expected_output: '{ "status": "configured", "keys_set": ["NVIDIA_API_KEY", "OPENROUTER_API_KEY"] }',
          },
          {
            id: 'verify',
            order: 2,
            title: 'Verify the keys resolve to working runners',
            description: 'Check that the configured credentials authenticate at least one runner.',
            tool_to_call: 'smartrelay_health_check',
            depends_on: ['configure'],
            expected_output: '{ "status": "healthy", "message": "N/M runners authenticated" }',
          },
          {
            id: 'list',
            order: 3,
            title: 'List available runners',
            description: 'Verify access to registered LLM runners and sub-agents.',
            tool_to_call: 'smartrelay_list_runners',
            depends_on: ['verify'],
            expected_output: 'JSON array of runner metadata',
          },
        ],
      },
    ];
  }

  async healthCheck(): Promise<HealthStatus> {
    if (this.configError) {
      return { status: 'unhealthy', message: `Invalid plugin configuration: ${this.configError}` };
    }

    const missing = missingRequired(this.state.config);
    if (missing.length) {
      return {
        status: 'unhealthy',
        message: `Missing required API keys: ${missing.join(', ')}. Add them in plugin settings.`,
      };
    }

    // Deliberately local: no model is called. Health checks run often and a
    // round trip to a provider would cost real money every time.
    try {
      const raw = await dispatchTool('smartrelay_list_runners');
      const runners = JSON.parse(raw as string) as Array<{ is_authenticated: boolean }>;
      const ready = runners.filter((r) => r.is_authenticated).length;

      return ready > 0
        ? { status: 'healthy', message: `${ready}/${runners.length} runners authenticated` }
        : {
            status: 'unhealthy',
            message: 'Runners loaded but no credentials resolved — check the keys in plugin settings',
          };
    } catch (e) {
      return {
        status: 'unhealthy',
        message: `Runner registry failed to load: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }
}
