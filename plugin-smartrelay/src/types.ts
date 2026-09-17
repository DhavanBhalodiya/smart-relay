/**
 * Types MCPHub would otherwise supply.
 *
 * Declared here rather than imported from `@mcphub/core`: that package is not
 * resolvable, and importing its internal paths breaks the MCPHub bundler. Kept in
 * one file so `tools.ts` and `index.ts` cannot drift apart on the same shape —
 * they previously each declared their own `McpToolDefinition`.
 */

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
