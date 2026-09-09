# 🎬 MCP Delegation Server — Live Team Demo Script (Flutter Edition)

> **Audience**: Flutter & Mobile Engineering Team  
> **Duration**: ~20-25 minutes  
> **Pre-requisite**: MCP server is registered with Claude Code via `claude mcp add`  
> **Tip**: Copy-paste each prompt block directly into Claude Code. Pause after each to show the result to the team.  
> **Note on File Paths**: For tools that read files from disk (`review_file`, `explain_file`, `test_file`), replace the sample paths with the path to any `.dart` file in your Flutter project (e.g. `file_path='../my_flutter_app/lib/screens/login_screen.dart'` or an absolute path like `file_path='/Users/indianic/FLUTTER/my_project/lib/auth.dart'`).

---

## 🎯 Before You Start — Quick Setup Check

Run this in your terminal to verify the server is working:
```bash
cd /Users/indianic/FLUTTER/SmartRelay
.venv/bin/python scripts/quick_test.py --list
```
✅ You should see 19 runners listed across NVIDIA, OpenRouter, Anthropic, OpenAI, and Ollama.

---

## Act 1 — "What do we have?" (List All Runners)

> **🗣️ Say to team**: *"Let me first show you all the AI models and sub-agents we have connected in this server. One simple command."*

```
Call tool list_runners
```

🎯 **What the team sees**: A JSON list of all 19 registered runners with model names, cost per million tokens, authentication status, and providers (NVIDIA NIM, Claude Sonnet 4.5, GPT-4o, Ollama local, etc.).

---

## Act 2 — "Which model is active right now?"

> **🗣️ Say to team**: *"The server has intelligent auto-routing. Let's see what mode we're currently in."*

```
Call tool get_active_model
```

🎯 **What the team sees**: Current routing mode (`auto`), active runner, and intent-based routing description.

---

## Act 3 — ⭐ Flutter Code Review (Inline Code Snippet)

> **🗣️ Say to team**: *"Let's do a real Flutter code review on a StateNotifier / Cache snippet. The sub-agent inspects it against Dart/Flutter best practices — resource cleanup, null safety, security, and widget performance."*

```
Call tool review_code with code='
class UserSessionManager {
  static Map<String, dynamic> _sessionData = {};
  static Timer? _heartbeatTimer;

  static void init() {
    _heartbeatTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      syncSession();
    });
    syncSession();
  }

  static Future<void> syncSession() async {
    // Hardcoded production endpoint & auth token
    final res = await http.get(Uri.parse("https://api.myapp.com/session?token=sk-prod-live-9923847291"));
    final json = jsonDecode(res.body);
    _sessionData = json;
  }

  static dynamic getField(String key) {
    return _sessionData[key]!;
  }

  static void dispose() {
    _heartbeatTimer?.cancel();
  }
}
' and focus='security, memory leaks, null safety, async error handling'
```

🎯 **What the team sees**: A full **🛡️ Code Review Report** with:
- **Overall Health Score** (e.g. 52/100, Grade D)
- **🚨 Blockers**: Hardcoded secret token, unhandled async exceptions in timer
- **⚠️ Warnings**: Unsafe `!` null assertion on `_sessionData[key]!`
- **💡 Suggestions**: Strong typing instead of `dynamic`, proper DI instead of static state
- **🛠️ Verification Commands**: `flutter analyze`, `flutter test`

> **🗣️ Point out**: *"It caught the leaked secret, the dangerous `!` crash risk, and missing error guards — all computed with an objective, deterministic score."*

---

## Act 4 — ⭐ Zero-Token Flutter File Review (Direct From Disk!)

> **🗣️ Say to team**: *"Now the real power — the server reads the `.dart` file directly from disk. Claude Code never loads or reads the source code, resulting in **TRUE zero Claude token burn**."*

```
Call tool review_file with file_path='lib/screens/login_screen.dart' and focus='TextEditingController lifecycle, mounted checks, widget rebuilds'
```

🎯 **What the team sees**: Full code review of `lib/screens/login_screen.dart`:
- Catches un-disposed `TextEditingController` instances (memory leak)
- Catches `setState()` called across an `await` without `if (!mounted) return;`
- Suggests `const` constructors on immutable subtrees to avoid unnecessary widget rebuilds

> **🗣️ Point out**: *"Normally Claude would load the entire 120-line file into context, burning tokens. Here, the MCP server read it directly and delegated to NVIDIA Nemotron. Claude's context window stays 100% clean."*

---

## Act 5 — ⭐ Flutter Code Explanation (Tailored by Audience)

> **🗣️ Say to team**: *"When onboarding a junior engineer, or summarizing a complex BLoC architecture for a tech lead or product manager, one size doesn't fit all. Watch how the same tool adjusts explanation depth."*

### 5a. For a Junior Flutter Developer
```
Call tool explain_file with file_path='lib/blocs/cart_bloc.dart' and audience='junior'
```
🎯 **What the team sees**: Explains streams, the BLoC pattern, events vs states, immutability, and why `List.unmodifiable` is used.

### 5b. For a Senior Mobile Architect
```
Call tool explain_file with file_path='lib/services/auth_service.dart' and audience='senior'
```
🎯 **What the team sees**: Terse, high-level breakdown of stream lifecycle, client injection, concurrency considerations, and boundary contracts.

### 5c. For a Non-Technical Stakeholder (PM / Client)
```
Call tool explain_file with file_path='lib/screens/login_screen.dart' and audience='non-technical'
```
🎯 **What the team sees**: Plain English explanation — what the screen does for the end user, form validation flow, and loading indicators without confusing technical jargon.

> **🗣️ Point out**: *"Same codebase, three tailored perspectives — perfect for PR reviews, documentation, and sprint handoffs."*

---

## Act 6 — ⭐ Explain a Complex Flutter Pattern (BLoC / Streams)

> **🗣️ Say to team**: *"You can also explain raw Flutter snippets on the fly — like BLoC event transformers, Riverpod notifiers, or custom painters."*

```
Call tool explain_code with code='
class AuthBloc extends Bloc<AuthEvent, AuthState> {
  final AuthRepository _repo;
  StreamSubscription<User?>? _userSub;

  AuthBloc(this._repo) : super(AuthInitial()) {
    on<AuthCheckRequested>((event, emit) async {
      await _userSub?.cancel();
      _userSub = _repo.userStream.listen(
        (user) => add(user != null ? AuthAuthenticated(user) : AuthUnauthenticated()),
      );
    });
    on<AuthAuthenticated>((event, emit) => emit(Authenticated(event.user)));
    on<AuthUnauthenticated>((event, emit) => emit(Unauthenticated()));
    on<AuthLogoutRequested>((event, emit) async {
      await _repo.signOut();
    });
  }

  @override
  Future<void> close() {
    _userSub?.cancel();
    return super.close();
  }
}
' and audience='mid-level' and language='dart'
```

🎯 **What the team sees**: Structured walkthrough of stream subscription management, cancellation in `close()`, and state emission flow.

---

## Act 7 — ⭐ Generate Production `flutter_test` Suite

> **🗣️ Say to team**: *"Writing unit and widget tests takes hours. Let's have the test generator sub-agent generate complete, runnable `flutter_test` code for our AuthService."*

```
Call tool test_file with file_path='lib/services/auth_service.dart' and framework='flutter_test'
```

🎯 **What the team sees**: Ready-to-use `flutter_test` suite:
- Unit tests with `group()` and `test()`
- Mocking HTTP responses with 200 OK and error status codes
- Stream listener assertions for `userStream`
- Sign-out and session clearance validation

> **🗣️ Point out**: *"This doesn't output pseudo-code — it gives you real `flutter_test` test cases with mocks, stream expectations, and edge cases."*

---

## Act 8 — Architecture & Implementation Planning (Flutter Feature)

> **🗣️ Say to team**: *"Before writing code for a big feature, we need a technical design. The planner agent generates phased, step-by-step implementation plans."*

```
Call tool create_plan with goal='Implement offline-first SQLite synchronization with optimistic UI updates in Flutter' and context='Mobile app using flutter_bloc, Dio for REST API, drift (sqlite) for local storage, and connectivity_plus for network status listening.'
```

🎯 **What the team sees**:
- **Architecture Approach**: Repository sync orchestrator, Drift table schema, optimistic BLoC state updates
- **Phase 1 to Phase 4 breakdown**: Schema setup ➔ Local cache CRUD ➔ Sync queue with exponential backoff ➔ Conflict resolution
- **Specific files to create/modify**: Model converters, DAO layer, SyncBloc
- **Edge cases & risks**: Airplane mode, token expiry during sync, partial network drops

---

## Act 9 — Natural Language Model Switching

> **🗣️ Say to team**: *"We aren't locked into one AI model. We can switch backends on the fly using plain English."*

### 9a. Switch to NVIDIA NIM (Super Fast & Cost-Effective)
```
Call tool switch_model with model='nvidia'
```

### 9b. Ask a Flutter question on NVIDIA
```
Call tool ask_subagent with prompt='Write a Flutter custom RenderObject or CustomPainter that draws a smooth animated pulse ring around a profile avatar' and model='nvidia'
```

### 9c. Ask the same question to local Ollama ($0.00 Offline)
```
Call tool ask_subagent with prompt='Write a Flutter custom RenderObject or CustomPainter that draws a smooth animated pulse ring around a profile avatar' and model='ollama'
```

### 9d. Switch back to auto-routing
```
Call tool switch_model with model='auto'
```

🎯 **What the team sees**: The model latency and cost displayed in the header (`Latency: 820ms | Cost: $0.0003`).

---

## Act 10 — 🏆 Multi-Model Benchmark (The Grand Finale!)

> **🗣️ Say to team**: *"Which model writes the best Flutter code? Let's race NVIDIA Nemotron, Claude Sonnet, and Llama 3.3 concurrently on the same task."*

```
Call tool benchmark_run with task='Write a production-ready Flutter DebouncedSearchBar widget with animation, clear button, cancelable Future, and unit testable controller.' and runner_ids=['nemotron-3-super-120b-a12b', 'openrouter-claude-sonnet-4.5', 'nvidia-llama-3.3-70b']
```

🎯 **What the team sees**:
- Concurrent execution across 3 models
- Comparative Markdown table showing **Winner**, **Latency (ms)**, **Cost ($)**, and **Output Quality**
- Direct side-by-side code comparison

> **🗣️ Point out**: *"Instead of guessing which model is best, we run an automated benchmark with one command and pick the best trade-off of quality vs speed vs cost."*

---

## 🌐 Bonus Act — Show the Web UI (MCP Inspector)

> **🗣️ Say to team**: *"Prefer a graphical interface over the command line? We have a full web UI."*

Run in terminal:
```bash
cd /Users/indianic/FLUTTER/SmartRelay
npx -y @modelcontextprotocol/inspector .venv/bin/python -- -m mcp_delegation_server.server --config config.yaml
```

1. Open **http://localhost:6274** in browser
2. Click **"Connect"**
3. Click **"Tools"** tab
4. Click `review_file` → enter `lib/screens/login_screen.dart` → click **"Run Tool"**
5. Show the team the real-time response inside the web UI!

---

## 📊 Summary Slide for Your Team

| Capability | Flutter Use Case | Token Efficiency |
| :--- | :--- | :--- |
| `review_file` | Review Flutter Widgets, BLoCs, Repositories directly on disk | **Zero Claude token burn** |
| `test_file` | Generate complete `flutter_test` unit & widget tests | **Zero Claude token burn** |
| `explain_file` | Junior onboarding, Architecture reviews, PM feature breakdown | **Zero Claude token burn** |
| `create_plan` | Phased implementation plans for complex mobile features | Auto-delegated to Planner Agent |
| `benchmark_run`| Compare multiple LLMs for Flutter code generation | Concurrent execution & evaluation |
| `switch_model` | Instant switch between NVIDIA NIM, Claude, GPT, and local Ollama | Instant / Zero overhead |
| Web UI | Interactive visual testing for non-CLI team members | Official MCP Inspector |

---

## 🔥 Flutter Audience Q&A Prompts

If a teammate asks *"Can it do this for my Flutter code?"*, use these live prompts:

**"Can it find unnecessary widget rebuilds?"**
```
Call tool review_file with file_path='lib/screens/login_screen.dart' and focus='widget rebuilds, const constructors, State lifecycle'
```

**"Can it write tests with mocktail / mockito?"**
```
Call tool test_file with file_path='lib/services/auth_service.dart' and framework='flutter_test with mocktail'
```

**"Can it convert a StatefulWidget to Riverpod / BLoC?"**
```
Call tool ask_subagent with prompt='Refactor lib/screens/login_screen.dart from vanilla StatefulWidget to flutter_bloc with LoginCubit' and model='nvidia'
```

**"Can I run this completely offline during flights or bad internet?"**
```
Call tool switch_model with model='ollama'
Call tool ask_subagent with prompt='Explain the difference between Future.wait and StreamZip in Dart' and model='ollama'
```
