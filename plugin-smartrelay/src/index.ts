/**
 * SmartRelay MCPHub Plugin
 *
 * A fully-compliant MCPHub plugin that proxies requests to the SmartRelay
 * HTTP API (Fastify backend) over authenticated HTTP/JSON.
 *
 * Architecture:
 *   Claude Code → MCPHub Gateway → SmartRelayPlugin (this file) → SmartRelay HTTP API
 */

import { tools } from './tools.js';
import { handleToolCall } from './handlers.js';
import { configSchema, type SmartRelayConfig } from './config.schema.js';

// ---------------------------------------------------------------------------
// Minimal inline types so the plugin is self-contained and does NOT import
// from @mcphub/core internal paths (which fail in the MCPHub bundler/verifier).
// ---------------------------------------------------------------------------

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface McpContext {
  userId?: string;
  sessionId?: string;
  [key: string]: unknown;
}

export type HealthStatus =
  | { status: 'healthy'; message?: string }
  | { status: 'unhealthy'; message?: string };

export interface ConfigMeta {
  groups?: Array<{ key: string; label: string; order?: number }>;
  fields?: Record<string, {
    group?: string;
    label?: string;
    fieldType?: string;
    description?: string;
    placeholder?: string;
    [key: string]: unknown;
  }>;
}

export interface PluginPricing {
  tools?: {
    free?: string[];
    pro?: string[];
    enterprise?: string | string[];
  };
  limits?: {
    free?: Record<string, number>;
    pro?: Record<string, number>;
    enterprise?: Record<string, number>;
  };
}

export interface McpActionPlanStep {
  id: string;
  order: number;
  title: string;
  description?: string;
  tool_to_call: string;
  depends_on?: string[];
  expected_output?: string;
}

export interface McpActionPlanDefinition {
  name: string;
  display_name: string;
  description?: string;
  trigger_phrases?: string[];
  plugin_name: string;
  expected_outcome?: string;
  steps: McpActionPlanStep[];
}

// ---------------------------------------------------------------------------
// SmartRelayPlugin — default export class (required by MCPHub)
// ---------------------------------------------------------------------------

export default class SmartRelayPlugin {
  readonly name = 'smartrelay';
  readonly displayName = 'SmartRelay';
  readonly description =
    'Delegation, benchmarking, and multi-model orchestration for LLM coding tasks';
  readonly version = '1.0.0';
  readonly icon = 'Zap';
  readonly category = 'AI';
  readonly technologies = ['TypeScript', 'Fastify', 'LLM', 'MCP'];

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
      ],
      enterprise: '*',
    },
    limits: {
      free: { callsPerMonth: 100 },
      pro: { callsPerMonth: 5000 },
      enterprise: { callsPerMonth: -1 },
    },
  };

  private config: SmartRelayConfig = { apiUrl: '', apiKey: '' };

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
    return ['apiKey'];
  }

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.config = configSchema.parse(config);
  }

  async handleToolCall(toolName: string, args: unknown, context: McpContext): Promise<unknown> {
    return handleToolCall(toolName, args, context, this.config);
  }

  getConfigMeta(): ConfigMeta {
    return {
      groups: [{ key: 'general', label: 'SmartRelay Configuration', order: 0 }],
      fields: {
        apiUrl: {
          group: 'general',
          label: 'API URL',
          fieldType: 'text',
          description:
            'Base URL of the SmartRelay HTTP API (e.g., https://smartrelay.example.com/v1)',
          placeholder: 'https://smartrelay.example.com/v1',
        },
        apiKey: {
          group: 'general',
          label: 'API Key',
          fieldType: 'password',
          description: 'Bearer token for authenticating to the SmartRelay service',
        },
      },
    };
  }

  getActionPlans(): McpActionPlanDefinition[] {
    return [
      {
        name: 'smartrelay-setup',
        display_name: 'SmartRelay Setup',
        description:
          'Configure SmartRelay and verify the connection to your delegation service.',
        trigger_phrases: ['setup smartrelay', 'connect smartrelay', 'configure smartrelay'],
        plugin_name: this.name,
        expected_outcome:
          'Working SmartRelay connection with access to code review, testing, and planning tools.',
        steps: [
          {
            id: 'configure',
            order: 1,
            title: 'Configure SmartRelay API endpoint',
            description: 'Provide the SmartRelay HTTP API URL and authentication token.',
            tool_to_call: 'smartrelay_configure',
            expected_output: '{ "status": "configured" }',
          },
          {
            id: 'verify',
            order: 2,
            title: 'Verify connection is working',
            description: 'Check that the plugin can reach the SmartRelay service.',
            tool_to_call: 'smartrelay_health_check',
            depends_on: ['configure'],
            expected_output: '{ "status": "healthy" }',
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
    // If not configured yet, return unhealthy
    if (!this.config.apiUrl || !this.config.apiKey) {
      return { status: 'unhealthy', message: 'SmartRelay not configured' };
    }

    // Try to ping the remote SmartRelay service
    try {
      const response = await fetch(`${this.config.apiUrl}/health`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
      });

      if (!response.ok) {
        return {
          status: 'unhealthy',
          message: `SmartRelay service returned ${response.status}`,
        };
      }

      return { status: 'healthy', message: 'SmartRelay connected and healthy' };
    } catch (e) {
      return {
        status: 'unhealthy',
        message: `Failed to reach SmartRelay: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }
}
