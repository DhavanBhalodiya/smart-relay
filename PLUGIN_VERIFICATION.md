# SmartRelay MCPHub Plugin — Verification Checklist

Use this checklist to verify the plugin is ready for publishing or deployment.

## Part A: HTTP API (`mcp_delegation_server/http_api.py`)

### File Structure
- [x] `mcp_delegation_server/http_api.py` exists and imports cleanly
- [x] `pyproject.toml` includes `fastapi` and `uvicorn` dependencies
- [x] `.env.example` includes `SMARTRELAY_HTTP_API_KEY`
- [x] Script entry point `smartrelay-http` added to `pyproject.toml`

### Functionality
- [ ] HTTP API starts without errors: `smartrelay-http --port 8000`
- [ ] Bearer auth works: `curl -H "Authorization: Bearer token" http://localhost:8000/v1/health` returns `{"status": "healthy", ...}`
- [ ] All 12 tool endpoints respond: `http://localhost:8000/v1/tools/{tool_name}`
- [ ] Invalid auth rejected: `curl http://localhost:8000/v1/health` returns 401
- [ ] Invalid token rejected: `curl -H "Authorization: Bearer wrong" ...` returns 401

### Tool Coverage
- [x] All 12 SmartRelay tools implemented in `_dispatch_tool()`
- [x] No duplication with MCP server logic (reuses existing implementations)
- [x] File reading tools work server-side (`_read_file_from_disk`)
- [x] Error handling and logging in place

### Configuration
- [ ] Loads existing `config.yaml` without errors
- [ ] Loads `config/runners/*.yaml` correctly
- [ ] Reads `.env` for API keys (ANTHROPIC_API_KEY, etc.)
- [ ] `SMARTRELAY_HTTP_API_KEY` env var respected for auth

---

## Part B: MCPHub Plugin (`plugin-smartrelay/`)

### File Structure
- [x] `plugin-smartrelay/` directory created
- [x] `package.json` with correct metadata
- [x] `src/index.ts` (SmartRelayPlugin class)
- [x] `src/tools.ts` (17 tool definitions)
- [x] `src/handlers.ts` (tool dispatch & HTTP proxy)
- [x] `src/config.schema.ts` (Zod schema)
- [x] `SKILL.md` (AI-readable description)
- [x] `README.md` (developer guide)

### L1 Conformance (16 checks)
- [x] Plugin class extends `BasePlugin`
- [x] All 6 contract methods implemented: `getTools()`, `getConfigSchema()`, `handleToolCall()`, `getSensitiveConfigFields()`, `getConfigMeta()`, `healthCheck()`
- [x] `getTools()` returns array of 17 `McpToolDefinition` objects
- [x] All tool names match `^[a-z][a-z0-9_]*$`
- [x] All tool names share single prefix: `smartrelay_`
- [x] Every tool has non-empty `description`
- [x] All inputSchema: `type: "object"`, explicit `properties`
- [x] All required fields: `required` is array (or empty `[]`)
- [x] All 5 settings tools present: configure, status, remove, health_check, get_logs
- [x] `handleToolCall()` throws on unknown tool (not return `{}`)
- [x] `getConfigSchema().parse({})` succeeds (all fields `.default()`)
- [x] `healthCheck()` returns object with `status` property

### Basic Compliance (18 checks)
- [x] Pricing defined: `free`, `pro`, `enterprise` tiers
- [x] All tools listed in at least one pricing tier
- [x] All 5 settings tools in `free` tier
- [x] Config schema uses Zod with `.default()` and `.passthrough()`
- [x] `getConfigMeta()` returns `{groups, fields}` (both keys required)
- [x] Config fields have proper `fieldType` and `description`
- [x] Sensitive fields declared: `['apiKey']`
- [x] Action plans defined with 3+ steps
- [x] Action plan step dependencies valid

### Security Scanner
- [x] No `eval()`, `child_process`, `subprocess`, `spawn`
- [x] No hardcoded secrets (all from config)
- [x] No `fs.writeFileSync`, `fs.rmSync`, or other filesystem writes
- [x] No `require()` with variable paths or `__dirname` tricks
- [x] No `dangerouslySetInnerHTML` (N/A for non-React plugin)
- [x] All URLs use `https://` (or `http://` for localhost only)
- [x] Response size within limits (proxies, so inherits SmartRelay's 500KB limit)

### API Correctness
- [x] Bearer token handled correctly in `callSmartRelay()`
- [x] HTTP error handling (404, 401, 500) returns error object
- [x] JSON response parsing handles both JSON and text responses
- [x] All tool parameters mapped correctly to HTTP payload
- [x] Config validation on `initialize()` (via Zod)

---

## Pre-Publishing Checklist

### Testing

#### Local Testing
- [ ] HTTP API runs locally without errors
- [ ] HTTP API responds to health checks and tool calls
- [ ] Plugin TypeScript compiles (if using TS build)
- [ ] All tool schemas are valid JSON Schema
- [ ] Config schema parses empty object: `configSchema.parse({})`

#### Integration Testing
- [ ] Plugin configured with local HTTP API endpoint
- [ ] `smartrelay_configure` tool call succeeds
- [ ] `smartrelay_health_check` returns healthy
- [ ] `smartrelay_list_runners` returns runner list
- [ ] `smartrelay_review_code` with sample code works
- [ ] `smartrelay_create_plan` with sample goal works

### Compliance Verification

```bash
cd plugin-smartrelay

# Run MCPHub's compliance checker
mcphub-dev verify

# Expected output: all 18 checks pass
# Run MCPHub's tool tester
mcphub-dev test

# Expected output: all tools callable and return non-error response
```

### Code Quality

- [ ] No TypeScript errors: `tsc --noEmit`
- [ ] No ESLint warnings (if configured)
- [ ] All imports use `.js` extensions (ESM requirement)
- [ ] Package.json `"type": "module"` present
- [ ] Package.json `"main"` points to `src/index.ts`

### Documentation

- [ ] `SKILL.md` includes all 17 tools
- [ ] `SKILL.md` has usage examples
- [ ] `SKILL.md` ends with Silent Completion Report section
- [ ] `README.md` explains structure and development
- [ ] `MCPHUB_PLUGIN_SETUP.md` has deployment instructions

---

## Publishing Steps

### 1. Verify
```bash
cd plugin-smartrelay
mcphub-dev verify
```
✓ All 18 basic compliance checks pass

### 2. Test
```bash
mcphub-dev test
```
✓ All 17 tools respond without errors

### 3. Publish
```bash
mcphub-dev publish
```
✓ Plugin uploaded to MCPHub registry

### 4. Monitor
```bash
mcphub-dev status
```
Watch for security scan results, compliance audit, and admin review.

---

## Post-Publishing

### After Approval
- [ ] Plugin appears in MCPHub marketplace
- [ ] Users can install via `mcphub install smartrelay`
- [ ] Monitor analytics: `mcphub-dev status`
- [ ] Watch error rate (auto-disable if > 50%)

### Maintenance
- [ ] Update version in `package.json` for any changes
- [ ] Keep HTTP API dependencies updated
- [ ] Monitor for security advisories
- [ ] Bump plugin version and republish when HTTP API changes

---

## Troubleshooting

### Plugin Fails L1 Conformance

**Check:**
1. All 5 settings tools present with correct names
2. All tool names use single prefix: `smartrelay_`
3. All inputSchema have `type: "object"` and `properties`
4. Config schema: `configSchema.parse({})` doesn't throw

**See:** `PLUGIN-DEV-KIT.md` section 21 (MCP Conformance)

### HTTP API Unreachable

**Check:**
1. HTTP API is running: `curl http://localhost:8000/v1/health`
2. Bearer token is correct: `SMARTRELAY_HTTP_API_KEY` matches plugin config
3. URL is reachable: no firewall blocks, HTTPS valid cert (in production)

**See:** `MCPHUB_PLUGIN_SETUP.md` Troubleshooting section

### Tools Return Errors

**Check:**
1. HTTP API has runners configured and authenticated (LLM keys set)
2. SmartRelay `config.yaml` loads without errors
3. Tool arguments match expected types (string, array, object)

**Debug:**
```bash
# Check runner status
curl -H "Authorization: Bearer $SMARTRELAY_HTTP_API_KEY" \
  http://localhost:8000/v1/tools/list_runners

# Check if a runner is authenticated
jq '.[] | select(.runner_id=="claude") | .is_authenticated' < runners.json
```

---

## Sign-Off

- [ ] All L1 conformance checks pass
- [ ] All basic compliance checks pass
- [ ] Security scanner score >= 80
- [ ] HTTP API tests pass
- [ ] Integration tests pass
- [ ] Documentation complete
- [ ] Ready to publish

**Published:** _______ (date)
**Version:** _______ (e.g., 1.0.0)
**Approved by:** _______ (name)
