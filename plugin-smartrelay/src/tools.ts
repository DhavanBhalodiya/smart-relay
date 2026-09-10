// Inline McpToolDefinition to avoid importing from @mcphub/core internal paths
type McpToolDefinition = Record<string, unknown>;

export const tools: McpToolDefinition[] = [
  // =========================================================================
  // REQUIRED SETTINGS TOOLS (every plugin must have all 5)
  // =========================================================================

  {
    name: 'smartrelay_configure',
    description: 'Configure the SmartRelay plugin with API endpoint and authentication',
    category: 'settings',
    inputSchema: {
      type: 'object',
      properties: {
        apiUrl: {
          type: 'string',
          description: 'Base URL of the SmartRelay HTTP API (e.g., https://smartrelay.example.com/v1)',
        },
        apiKey: {
          type: 'string',
          description: 'Bearer token for authentication',
        },
      },
      required: ['apiUrl', 'apiKey'],
      additionalProperties: false,
    },
  },

  {
    name: 'smartrelay_status',
    description: 'Check plugin health and configuration status',
    category: 'settings',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },

  {
    name: 'smartrelay_remove',
    description: 'Uninstall the SmartRelay plugin and clean up',
    category: 'settings',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },

  {
    name: 'smartrelay_health_check',
    description: 'Deep health check of the SmartRelay service',
    category: 'settings',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },

  {
    name: 'smartrelay_get_logs',
    description: 'Retrieve plugin activity logs',
    category: 'settings',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of log entries to return',
          default: 50,
        },
      },
      additionalProperties: false,
    },
  },

  // =========================================================================
  // MODEL SWITCHING TOOLS
  // =========================================================================

  {
    name: 'smartrelay_switch_model',
    description: 'Switch the active LLM model or provider for task routing',
    category: 'core',
    inputSchema: {
      type: 'object',
      properties: {
        model: {
          type: 'string',
          description: 'Target model or provider (e.g., "nvidia", "claude", "ollama", "auto")',
        },
      },
      required: ['model'],
      additionalProperties: false,
    },
  },

  {
    name: 'smartrelay_get_active_model',
    description: 'Get the currently active LLM model and routing mode',
    category: 'core',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },

  // =========================================================================
  // DELEGATION TOOLS (Core functionality)
  // =========================================================================

  {
    name: 'smartrelay_create_plan',
    description: 'Create a structured, phased implementation plan for any feature or project',
    category: 'core',
    inputSchema: {
      type: 'object',
      properties: {
        goal: {
          type: 'string',
          description: 'The feature, requirement, bug fix, or refactoring goal to plan',
        },
        context: {
          type: 'string',
          description: 'Optional background context, existing codebase details, or constraints',
          default: '',
        },
      },
      required: ['goal'],
      additionalProperties: false,
    },
  },

  {
    name: 'smartrelay_review_code',
    description: 'Perform an in-depth, expert code review on any function or code snippet',
    category: 'core',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'The source code, diff, or function to review',
        },
        focus: {
          type: 'string',
          description: 'Optional review focus areas (e.g., "security", "performance")',
          default: 'bugs, security, clean code, and performance',
        },
      },
      required: ['code'],
      additionalProperties: false,
    },
  },

  {
    name: 'smartrelay_generate_tests',
    description: 'Generate production-ready unit and integration tests with 100% edge case coverage',
    category: 'core',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'The source code or function that needs test coverage',
        },
        framework: {
          type: 'string',
          description: 'Optional testing framework (e.g., "pytest", "flutter_test", "jest")',
          default: 'standard unit test framework (pytest, flutter_test, etc.)',
        },
      },
      required: ['code'],
      additionalProperties: false,
    },
  },

  {
    name: 'smartrelay_ask_subagent',
    description: 'Ask any programming or reasoning question directly to an external sub-agent model',
    category: 'core',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Your natural language question, instruction, or coding problem',
        },
        model: {
          type: 'string',
          description: 'Target model or provider ("nvidia", "claude", "ollama", "openai", "auto")',
          default: 'auto',
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },

  {
    name: 'smartrelay_review_file',
    description: 'Review a source code file directly from disk (zero token cost for file reading)',
    category: 'core',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute or relative path to the source file to review',
        },
        focus: {
          type: 'string',
          description: 'Optional review focus areas',
          default: 'bugs, security, clean code, and performance',
        },
      },
      required: ['file_path'],
      additionalProperties: false,
    },
  },

  {
    name: 'smartrelay_test_file',
    description: 'Generate tests for a source code file directly from disk (zero token cost)',
    category: 'core',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute or relative path to the source file to generate tests for',
        },
        framework: {
          type: 'string',
          description: 'Optional testing framework',
          default: 'standard unit test framework (pytest, flutter_test, etc.)',
        },
      },
      required: ['file_path'],
      additionalProperties: false,
    },
  },

  {
    name: 'smartrelay_explain_code',
    description: 'Get a clear, structured plain-English explanation of any code snippet',
    category: 'core',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'The source code, function, class, or snippet to explain',
        },
        audience: {
          type: 'string',
          description: 'Explanation depth level ("junior", "mid-level", "senior", "non-technical")',
          default: 'mid-level engineer',
        },
        language: {
          type: 'string',
          description: 'Optional language hint (e.g., "dart", "python", "typescript", "auto")',
          default: 'auto',
        },
      },
      required: ['code'],
      additionalProperties: false,
    },
  },

  {
    name: 'smartrelay_explain_file',
    description: 'Get a plain-English explanation of a source file directly from disk (zero token cost)',
    category: 'core',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute or relative path to the source file to explain',
        },
        audience: {
          type: 'string',
          description: 'Explanation depth level ("junior", "mid-level", "senior", "non-technical")',
          default: 'mid-level engineer',
        },
      },
      required: ['file_path'],
      additionalProperties: false,
    },
  },

  {
    name: 'smartrelay_list_runners',
    description: 'List all registered external LLM runners and specialized sub-agents',
    category: 'core',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },

  {
    name: 'smartrelay_delegate_task',
    description: 'Delegate a task to an external runner or use auto-routing for intelligent assignment',
    category: 'service',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'The natural language prompt, instruction, code, or query',
        },
        runner_id: {
          type: 'string',
          description: 'Specific runner ID or "auto" for intelligent routing',
          default: 'auto',
        },
        params: {
          type: 'object',
          description: 'Optional parameter overrides (max_tokens, temperature, system_prompt)',
          default: {},
        },
      },
      required: ['task'],
      additionalProperties: false,
    },
  },

  {
    name: 'smartrelay_benchmark_run',
    description: 'Fan out a task across multiple runners concurrently and produce a benchmark report',
    category: 'service',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'The natural language prompt or problem to execute',
        },
        runner_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of runners. If omitted, all authenticated runners are evaluated',
          default: [],
        },
        params: {
          type: 'object',
          description: 'Optional inference parameters',
        },
        reference_answer: {
          type: 'string',
          description: 'Optional ground-truth answer for similarity scoring',
        },
        judge_runner_id: {
          type: 'string',
          description: 'Optional runner ID to evaluate candidate answers',
        },
        eval_criteria: {
          type: 'object',
          description: 'Optional custom evaluation rubric',
        },
      },
      required: ['task'],
      additionalProperties: false,
    },
  },
];
