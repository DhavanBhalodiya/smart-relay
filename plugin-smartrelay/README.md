# SmartRelay MCPHub Plugin

This is an **MCPHub plugin** (TypeScript) that wraps the SmartRelay HTTP API, allowing AI coding agents to delegate tasks (code review, testing, planning, benchmarking) to external LLM backends.

## Structure

```
plugin-smartrelay/
├── package.json              # Plugin metadata & dependencies
├── SKILL.md                  # AI-readable plugin description
├── README.md                 # This file
└── src/
    ├── index.ts              # Main plugin class (SmartRelayPlugin)
    ├── tools.ts              # Tool definitions (17 tools total)
    ├── handlers.ts           # Tool call router & HTTP proxy
    └── config.schema.ts      # Zod configuration schema
```

## Key Files

### `src/index.ts`
The plugin class that extends `BasePlugin`. Handles:
- Tool registration
- Configuration schema
- Pricing tiers (free/pro/enterprise)
- Action plans for setup workflow
- Health checks

### `src/tools.ts`
Declares all 17 MCP tools with JSON schema definitions:
- 5 required settings tools (configure, status, remove, health_check, get_logs)
- 2 model switching tools (switch_model, get_active_model)
- 8 delegation tools (create_plan, review_code, generate_tests, ask_subagent, review_file, test_file, explain_code, explain_file)
- 1 utility tool (list_runners)
- 2 advanced tools (delegate_task, benchmark_run)

### `src/handlers.ts`
Routes tool calls to the remote SmartRelay HTTP API:
- `callSmartRelay()` — makes authenticated HTTP POST requests
- `handleToolCall()` — switch statement dispatching each tool by name
- Throws on unknown tools (required by MCPHub L1 conformance)

### `src/config.schema.ts`
Zod schema for plugin configuration:
- `apiUrl` — base URL of the HTTP API (e.g., `https://smartrelay.example.com/v1`)
- `apiKey` — bearer token for authentication
- All fields have `.default('')`, so config parsing always succeeds

### `SKILL.md`
Describes the plugin for AI agents:
- What it does (delegation, benchmarking, zero-token file reading)
- All 17 tools with one-line descriptions
- Usage examples
- Required "Silent Completion Report" section for telemetry

### `package.json`
MCPHub-compliant package metadata:
- `name: "@mcphub/plugin-smartrelay"` — required format
- `main: "src/index.ts"` — plugin entrypoint
- `type: "module"` — required for ESM
- Minimal dependencies: only `@mcphub/core` and `zod`

## Compliance Checklist

### L1 Conformance (16 checks)
- ✅ All 6 contract methods implemented
- ✅ `getTools()` returns array
- ✅ Tool names match `^[a-z][a-z0-9_]*$` (lowercase snake_case)
- ✅ All tool names share one prefix: `smartrelay_`
- ✅ Every tool has a non-empty `description`
- ✅ All inputSchema are `type: "object"` with explicit `properties`
- ✅ All 5 settings tools present (configure, status, remove, health_check, get_logs)
- ✅ `handleToolCall()` throws on unknown tool
- ✅ `getConfigSchema().parse({})` succeeds (all fields have defaults)
- ✅ `healthCheck()` returns object with `status` property

### Basic Compliance (18 checks)
- ✅ All pricing tiers defined (free/pro/enterprise)
- ✅ Zod schema with `.default()` and `.passthrough()`
- ✅ Config metadata (UI hints) via `getConfigMeta()`
- ✅ Sensitive fields marked (`apiKey`)
- ✅ Action plans with 3+ steps
- ✅ `healthCheck()` implemented
- ✅ Tool naming (consistent `smartrelay_` prefix)
- ✅ Tool categories (settings/core/service)
- ✅ Tool coverage in pricing tiers
- ✅ Config defaults

### Security Scanner
- ✅ No `eval()`, subprocess spawning, or `fs.write` operations
- ✅ No hardcoded secrets (all come from config)
- ✅ No filesystem writes (pure HTTP client)
- ✅ Response size within limits (proxies SmartRelay's 500KB file limit)

## Development & Testing

### Prerequisites
- Node.js 18+ with `pnpm`
- Access to a running SmartRelay HTTP API instance

### Build
```bash
pnpm install
pnpm build  # If using TypeScript compilation
```

### Test (via MCPHub CLI)
```bash
# Verify compliance (18 checks)
mcphub-dev verify

# Test all tools (requires configured SmartRelay)
mcphub-dev test

# Or test a specific tool
mcphub-dev test smartrelay_list_runners
```

### Local Development
```bash
# Start SmartRelay HTTP API locally
cd ..
export SMARTRELAY_HTTP_API_KEY="dev-token"
.venv/bin/smartrelay-http --port 8000

# In Claude Code, configure the plugin:
# - apiUrl: http://localhost:8000/v1
# - apiKey: dev-token

# Test a tool
curl -H "Authorization: Bearer dev-token" \
  -X POST -H "Content-Type: application/json" \
  -d '{}' \
  http://localhost:8000/v1/tools/list_runners
```

## Publishing to MCPHub

Once tested locally:

```bash
# Verify all checks pass
mcphub-dev verify

# Publish for review
mcphub-dev publish

# Monitor status
mcphub-dev status
```

The MCPHub team reviews:
1. Security scan (no dangerous patterns, dependencies OK)
2. Compliance audit (18 basic checks)
3. L1 conformance (16 MCP standard checks)
4. Code quality and description accuracy

Typical review time: 1–3 business days for first submission.

## Architecture

The plugin is a **thin HTTP proxy**:
1. User calls a tool via MCPHub/Claude Code
2. Plugin validates input and config
3. Plugin makes authenticated HTTP POST to SmartRelay API
4. SmartRelay API runs the actual task (delegates to LLM runners)
5. Plugin returns the result

**Why this design?**
- Avoids subprocess spawning (security flag in MCPHub)
- Keeps LLM provider keys server-side (SmartRelay HTTP API)
- Enables deployment flexibility (HTTP API can run anywhere reachable via HTTPS)
- Reuses all existing SmartRelay logic (no duplication)

## Links

- [SmartRelay Main README](../README.md)
- [MCPHub Plugin Dev Kit](../PLUGIN-DEV-KIT.md)
- [SmartRelay HTTP API Setup Guide](../MCPHUB_PLUGIN_SETUP.md)
