# SmartRelay MCPHub Plugin Setup Guide

This guide explains how to deploy SmartRelay as an MCPHub plugin and use it in Claude Code, Claude Desktop, or other MCPHub-compatible clients.

## Overview

SmartRelay has two parts:

1. **HTTP API Server** (`mcp_delegation_server/http_api.py`) — runs in your infrastructure (Docker, VM, or cloud)
2. **MCPHub Plugin** (`plugin-smartrelay/`) — installed via MCPHub, proxies calls to the HTTP API

The plugin is the client-facing MCP tool surface; the HTTP API is the backend that does the actual work.

---

## Part A: Deploy the SmartRelay HTTP API

The HTTP API serves all tool capabilities over an authenticated HTTP interface.

### Option 1: Local Development

```bash
# Set API key for authentication
export SMARTRELAY_HTTP_API_KEY="your-secure-token-here"

# Install dependencies (if not already done)
pip install -e .

# Start the HTTP API server on localhost:8000
smartrelay-http --host 127.0.0.1 --port 8000
```

Test it:
```bash
curl -H "Authorization: Bearer your-secure-token-here" \
  http://localhost:8000/v1/health

curl -H "Authorization: Bearer your-secure-token-here" \
  -X POST -H "Content-Type: application/json" \
  -d '{}' \
  http://localhost:8000/v1/tools/list_runners
```

### Option 2: Docker Deployment

Create a `Dockerfile`:

```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY . /app

RUN pip install -e .

EXPOSE 8000

ENV SMARTRELAY_HTTP_API_KEY=${SMARTRELAY_HTTP_API_KEY}

CMD ["smartrelay-http", "--host", "0.0.0.0", "--port", "8000"]
```

Build and run:
```bash
docker build -t smartrelay-http .
docker run -e SMARTRELAY_HTTP_API_KEY="your-token" \
  -e ANTHROPIC_API_KEY="sk-ant-..." \
  -e NVIDIA_API_KEY="nvapi-..." \
  -p 8000:8000 \
  smartrelay-http
```

### Option 3: Cloud Deployment (Render, Fly.io, AWS, etc.)

Configure environment variables:
- `SMARTRELAY_HTTP_API_KEY` — your bearer token for clients
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `NVIDIA_API_KEY`, etc. — LLM provider keys (from `config/runners/*.yaml`)
- `MCP_CONFIG_PATH` — (optional) path to `config.yaml` if not in default location

Deploy the app with `smartrelay-http --host 0.0.0.0 --port 8000` (or let your cloud platform's startup command handle it).

### Configuration

The HTTP API loads all existing SmartRelay configuration:
- `config.yaml` — server defaults, runner list, concurrency limits
- `config/runners/*.yaml` — LLM backend definitions (NVIDIA, OpenAI, Ollama, etc.)
- `prompts/*.md` — specialized agent system prompts
- `.env` — API keys for external services

No changes needed to any of these files. The HTTP layer is thin and purely proxies the existing tool logic.

---

## Part B: Install the MCPHub Plugin

### Prerequisites

1. **MCPHub CLI** installed and logged in:
   ```bash
   mcphub login --web
   mcphub status
   ```

2. **SmartRelay HTTP API** running and reachable from your machine (with HTTPS in production):
   ```
   https://smartrelay.example.com/v1/
   ```

3. **API key** for the HTTP service:
   ```
   SMARTRELAY_HTTP_API_KEY=your-secure-token
   ```

### Install via MCPHub CLI (When Plugin is Published)

Once the SmartRelay plugin is published to MCPHub:

```bash
mcphub install smartrelay
```

Then configure it:
```bash
mcphub exec smartrelay smartrelay_configure --args '{
  "apiUrl": "https://smartrelay.example.com/v1",
  "apiKey": "your-secure-token"
}'
```

### Local Development: Load Plugin Directly

For testing before publishing to MCPHub:

```bash
# In Claude Code settings.json (or via /config)
"mcp_servers": {
  "smartrelay-dev": {
    "command": "node",
    "args": [
      "/path/to/plugin-smartrelay/dist/index.js"
    ],
    "env": {
      "SMARTRELAY_API_URL": "http://localhost:8000/v1",
      "SMARTRELAY_API_KEY": "your-secure-token"
    }
  }
}
```

---

## Part C: Use the Plugin

### In Claude Code / Claude Desktop

Once installed, you have access to all SmartRelay tools:

1. **Set up** the plugin:
   ```
   @smartrelay configure api-url: https://smartrelay.example.com/v1 api-key: your-token
   ```

2. **Check health**:
   ```
   @smartrelay health-check
   ```

3. **List available models**:
   ```
   @smartrelay list-runners
   ```

4. **Review a file** (zero token cost):
   ```
   @smartrelay review-file file-path: lib/screens/home.dart focus: Flutter widget performance
   ```

5. **Generate tests**:
   ```
   @smartrelay generate-tests code: "def add(a, b): return a + b" framework: pytest
   ```

6. **Create a plan**:
   ```
   @smartrelay create-plan goal: "Add two-factor authentication to the auth service" context: "Django backend, Twilio SMS"
   ```

7. **Delegate a task**:
   ```
   @smartrelay delegate-task task: "Optimize this SQL query..." runner-id: auto
   ```

8. **Benchmark across models**:
   ```
   @smartrelay benchmark-run task: "What's the best way to cache this?" runner-ids: ["claude", "gpt-4o", "ollama"]
   ```

---

## Troubleshooting

### "Connection refused" when calling a tool

**Issue:** The plugin can't reach the HTTP API.

**Fix:**
- Verify the HTTP API is running: `curl -H "Authorization: Bearer token" https://smartrelay.example.com/v1/health`
- Check the `apiUrl` in plugin config: `mcphub plugin smartrelay` → Overview → Configuration
- Ensure the URL is reachable (HTTPS in production, no firewall blocks)
- Confirm the API key is correct

### "Invalid API key" errors

**Issue:** The bearer token doesn't match the server's `SMARTRELAY_HTTP_API_KEY`.

**Fix:**
- Reconfigure: `mcphub exec smartrelay smartrelay_configure --args '{"apiUrl":"...","apiKey":"correct-token"}'`
- Verify the server's `SMARTRELAY_HTTP_API_KEY` env var is set correctly

### Tools return empty/error responses

**Issue:** The HTTP API is up, but runners aren't available.

**Fix:**
- Check that LLM provider keys are set: `ANTHROPIC_API_KEY`, `NVIDIA_API_KEY`, etc.
- List runners: `mcphub exec smartrelay smartrelay_list_runners`
- If no runners are authenticated, configure those env vars and restart the HTTP API

### "File not found" on `review_file`

**Issue:** The HTTP API server can't find the file you specified.

**Fix:**
- The file path is resolved on the **server machine**, not your local machine
- Use an absolute path or a path relative to where the HTTP API was started
- For local development with `smartrelay-http` running on your machine, relative paths work

---

## Publishing to MCPHub

When ready to publish the plugin:

```bash
cd plugin-smartrelay

# Verify compliance
mcphub-dev verify

# Test all tools (requires a configured SmartRelay instance)
mcphub-dev test

# Publish for review
mcphub-dev publish
```

The MCPHub team will review security, compliance, and the plugin code. Once approved, it appears in the MCPHub marketplace and can be installed by any user.

---

## Architecture Diagram

```
┌─────────────────────────────────────────┐
│   Claude Code / Claude Desktop          │
│   (or any MCPHub client)                │
└────────────────┬────────────────────────┘
                 │
                 │ MCP JSON-RPC
                 │ (via MCPHub gateway)
                 ▼
┌─────────────────────────────────────────┐
│   SmartRelay MCPHub Plugin               │
│   (plugin-smartrelay)                   │
│   - Handles tool dispatch                │
│   - Validates configs                    │
│   - Manages pricing tiers                │
└────────────────┬────────────────────────┘
                 │
                 │ HTTP/JSON
                 │ Bearer token auth
                 ▼
┌─────────────────────────────────────────┐
│   SmartRelay HTTP API                   │
│   (mcp_delegation_server/http_api.py)   │
│   - Proxies to runner implementations    │
│   - Reads files server-side              │
│   - Manages concurrency, benchmarking    │
└────────────────┬────────────────────────┘
                 │
   ┌─────┬─────┬─────┬──────┐
   │     │     │     │      │
   ▼     ▼     ▼     ▼      ▼
 NVIDIA Claude OpenAI OpenRouter Ollama
  NIM  Sonnet  GPT  (Free)  (Local)
```

---

## Security Notes

1. **Bearer Token**: The `SMARTRELAY_HTTP_API_KEY` protects your HTTP API. Use a strong, random token in production.
2. **HTTPS**: Always use HTTPS in production. The plugin sends the API key in the `Authorization` header.
3. **File Access**: The HTTP API server has access to files on its local filesystem. Restrict file paths appropriately.
4. **LLM Keys**: The HTTP API server holds all LLM provider keys (ANTHROPIC_API_KEY, etc.). Run it in a secure, restricted environment.

---

## Next Steps

1. Deploy the HTTP API (local, Docker, or cloud)
2. Install the MCPHub plugin
3. Configure the plugin with your HTTP API URL and bearer token
4. Start delegating coding tasks!

For questions or issues, check the [SmartRelay README](./README.md) and [PLUGIN-DEV-KIT.md](../PLUGIN-DEV-KIT.md).
