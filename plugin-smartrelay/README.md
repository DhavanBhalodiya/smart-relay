# SmartRelay — MCPHub plugin

Delegate code review, test generation, planning, security audits, and multi-model
benchmarking to LLM backends, using **your own provider API keys**.

## Architecture

Self-contained. The plugin runs SmartRelay's runner registry in-process and calls
the providers directly — there is no SmartRelay-operated service in the path.

```
AI agent → MCPHub gateway → SmartRelayPlugin → NVIDIA / OpenRouter / Anthropic / OpenAI
```

## Where your API keys go

Read this before entering a key.

- Keys you enter are **stored by the host** (MCPHub) and held in the plugin
  process's environment while it runs.
- They are used to call NVIDIA, OpenRouter, Anthropic, and OpenAI **directly**.
  Nothing is sent to any endpoint operated by SmartRelay's author.
- **If MCPHub hosts this plugin, the plugin process runs on MCPHub's
  infrastructure — so your keys are transmitted to and used on their servers, not
  on your own machine.** That is a property of hosted plugins generally, not of
  SmartRelay specifically. If you would rather your keys never leave your
  computer, install the npm package instead and run
  `npx @theone1345/smartrelay init`, which prompts in your terminal and writes
  `~/.smartrelay/.env` locally.
- The plugin never writes to your home directory and never persists keys itself;
  the host owns that storage.
- Provider spend is billed to **your** accounts. Set limits at each provider's
  console.

## Configuration

| Field | Required | Used for |
|---|---|---|
| `nvidiaApiKey` | yes | `code-review`, `test-generator`, `security` agents + NVIDIA runners |
| `openrouterApiKey` | yes | `planner`, `explain` agents + OpenRouter runners |
| `anthropicApiKey` | no | Claude runners |
| `openaiApiKey` | no | GPT runners |
| `configPath` | no | A `config.yaml` defining a custom runner set |

Get keys at [build.nvidia.com](https://build.nvidia.com) (free tier) and
[openrouter.ai/keys](https://openrouter.ai/keys).

Until both required keys are set, the plugin reports `unhealthy`, and every tool
except the settings tools returns a structured error naming what is missing and
how to supply it.

## Tools

20 total. Five settings tools (`configure`, `status`, `remove`, `health_check`,
`get_logs`) always respond, even unconfigured — otherwise the host could never
discover *that* the plugin needs setup.

The rest: `switch_model`, `get_active_model`, `create_plan`, `review_code`,
`generate_tests`, `ask_subagent`, `review_file`, `test_file`, `explain_code`,
`explain_file`, `audit_security`, `audit_file_security`, `list_runners`,
`delegate_task`, `benchmark_run`.

## Development

```bash
npm install            # from the repo root; links the workspace
npm run build          # root package — this plugin imports its ./dispatch subpath
npm run build:plugin
npm run test:plugin    # 40-check conformance run, no network needed
```

See [`../docs/PLUGIN.md`](../docs/PLUGIN.md) for the publishing status and the
open questions with the MCPHub team.
