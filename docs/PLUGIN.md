# SmartRelay as an MCPHub plugin

`plugin-smartrelay/` wraps SmartRelay for MCPHub. It is **self-contained**: the
runner registry executes inside the plugin process using the user's own provider
API keys. There is no SmartRelay service to host, and no credential is sent to a
SmartRelay-operated endpoint.

```
Claude Code → MCPHub gateway → SmartRelayPlugin → NVIDIA / OpenRouter / Anthropic / OpenAI
```

## Configuration

MCPHub prompts for these through `getConfigMeta()`. The four key fields are
declared `fieldType: 'password'`, which is what makes the host mask the input.

| Field | Required | Environment variable |
|---|---|---|
| `nvidiaApiKey` | yes | `NVIDIA_API_KEY` |
| `openrouterApiKey` | yes | `OPENROUTER_API_KEY` |
| `anthropicApiKey` | no | `ANTHROPIC_API_KEY` |
| `openaiApiKey` | no | `OPENAI_API_KEY` |
| `configPath` | no | `MCP_CONFIG_PATH` |

`initialize()` publishes these into `process.env`, where the runners read them.
Note the precedence inversion against `loadDotEnv()`: a non-empty plugin config
value **overwrites** an ambient environment variable, because a value entered in
plugin settings is an explicit choice rather than a fallback. Empty values are
skipped so they cannot blank out a key that is already set.

## How a hosted user is asked for keys

There is no terminal to prompt on when MCPHub hosts the plugin, so the ask is
carried by four gates. Each one names the missing fields, so a user arriving from
any direction is told the same thing.

**1. The settings form.** `getConfigMeta()` declares `nvidiaApiKey` and
`openrouterApiKey` as `required: true`, all four key fields as
`fieldType: 'password'`. That is what makes MCPHub render a masked input and mark
the field mandatory — this is the plugin-side equivalent of the terminal wizard.

**2. `healthCheck()`** returns `unhealthy` with
`Missing required API keys: nvidiaApiKey, openrouterApiKey` until they are set, so
the plugin shows as misconfigured in any health view.

**3. Every non-settings tool call** short-circuits with a structured, actionable
error rather than a failed model call:

```json
{
  "error": "SmartRelay is not configured. Missing required API keys: nvidiaApiKey, openrouterApiKey.",
  "missing": ["nvidiaApiKey", "openrouterApiKey"],
  "how_to_fix": {
    "option_1": "Open the SmartRelay plugin settings and fill in the required keys.",
    "option_2": "Call smartrelay_configure with { \"nvidiaApiKey\": \"...\", \"openrouterApiKey\": \"...\" }",
    "get_keys": {
      "nvidiaApiKey": "https://build.nvidia.com",
      "openrouterApiKey": "https://openrouter.ai/keys"
    }
  }
}
```

An agent can act on that directly instead of only relaying the failure.

**4. The action plan.** `getActionPlans()` exposes `smartrelay-setup`, triggered by
phrases like *"setup smartrelay"* or *"add smartrelay keys"*, stepping through
`smartrelay_configure` → `smartrelay_health_check` → `smartrelay_list_runners`.

### Two rules these gates depend on

The five **settings** tools — `configure`, `status`, `remove`, `health_check`,
`get_logs` — are never gated. Blocking them would be circular: the host could not
find out *that* the plugin is unconfigured.

"Configured" is decided by the required provider keys, **not** by a count of
authenticated runners. Ollama runners need no credential and always report as
authenticated, so a count reads "3 of 25 ready, healthy" on an install where every
hosted model is unreachable.

## Build and verify

```bash
npm install            # links the workspace
npm run build          # root package — the plugin imports its ./dispatch subpath
npm run build:plugin   # plugin-smartrelay/dist
npm run test:plugin    # 40-check local conformance run, no network needed
```

`tests/dispatch.test.ts` asserts that every tool in `plugin-smartrelay/src/tools.ts`
is dispatchable. Add a tool to `src/tools/dispatch.ts` and that test tells you if
the plugin's advertised list has drifted.

## Publishing — current status

**There is no self-serve publish path.** Verified against the installed tooling:

- `mcphub --help` exposes no `publish`, `submit`, or `upload` command.
- `mcphub-dev` and `@mcphub/core` both 404 on npm. Earlier docs in this repo
  described `mcphub-dev verify && mcphub-dev test && mcphub-dev publish`; that
  workflow does not exist.
- MCPHub plugins execute server-side — `mcphub_execute` routes to MCPHub's own
  handler — so a listed BYOK plugin implies the user's keys are transmitted to
  MCPHub infrastructure rather than staying on their machine.

Getting listed therefore means asking the MCPHub team, via `mcphub report
--type feature` or the `mcphub_report` MCP tool. Two questions to settle with
them first, because both change how the plugin must ship:

1. **Does the gateway `npm install` a plugin's dependencies?** The plugin imports
   `@theone1345/smartrelay/dispatch`. If dependencies are not installed, that
   import fails at load and the plugin is dead on arrival. Fallback: bundle with
   `esbuild --bundle --platform=node --format=esm`, keeping `openai`,
   `@anthropic-ai/sdk`, and `yaml` external.
2. **What package name is required?** The plugin was `@mcphub/plugin-smartrelay`,
   a scope that cannot be published to from outside MCPHub. It is now
   `@theone1345/mcphub-plugin-smartrelay`.

Until then, the supported distribution is npm:

```bash
npx @theone1345/smartrelay init     # prompts for keys, then registers the MCP server
```

`init` collects credentials in the terminal rather than through MCP elicitation.
Elicitation would fit the "add the server, then it asks you" shape, and Claude
Code supports it — but the elicitation schema offers no masked field type, so the
key would be entered in plain text and carried through the client's transcript.

## Local development against Claude Code

`plugin-smartrelay/dist/index.js` exports the plugin class; it is not itself an
MCP server. To exercise SmartRelay directly, point your client at the stdio
server (`dist/server.js`) as described in the README.

## Note on `process.env`

`applyConfigToEnv()` mutates `process.env`, which is global to the host process.
If MCPHub runs several plugins in one process, they observe SmartRelay's values.
Isolating this means threading a credential map down to `BaseRunner.getApiKey()`
(`src/runners/openai.ts`) across all five runners — deliberately deferred.
