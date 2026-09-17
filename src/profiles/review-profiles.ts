/**
 * Dynamic, Language-Aware Review Profiles.
 *
 * Provides specialized personas, inspection vectors, and verification commands
 * tailored to specific programming languages and frameworks (Flutter/Dart,
 * TypeScript/JavaScript, Python, Go, Rust, and Universal).
 */

import path from 'path';

export interface ReviewProfile {
  id: string;
  name: string;
  aliases: string[];
  extensions: string[];
  systemPersona: string;
  inspectionVectors: string[];
  verificationCommands: string[];
}

export const PROFILES: Record<string, ReviewProfile> = {
  flutter: {
    id: 'flutter',
    name: 'Flutter / Dart',
    aliases: ['flutter', 'dart'],
    extensions: ['.dart'],
    systemPersona: 'You are a Principal Code Reviewer & Systems Architect specializing in Flutter/Dart.',
    inspectionVectors: [
      'Resource Cleanup & Memory: Un-disposed controllers (TextEditingController, ScrollController, AnimationController), uncancelled StreamSubscriptions/Timers, or setState() called after dispose without `if (mounted)`.',
      'Security & Secrets: Hardcoded API keys, private tokens, credentials, sensitive URLs, injection flaws, or insecure local storage.',
      'Null Safety & Type Robustness: Dangerous null assertion operators (`!`), unsafe dynamic JSON casting (e.g. use `(json[\'key\'] as num?)?.toDouble() ?? 0.0`), and unhandled nullable values. Do NOT flag `!` where nullability is already provably eliminated by a prior guard.',
      'State & Error Resilience: Unhandled async Future/Stream exceptions, missing BLoC/StateNotifier error states, or UI missing failure/retry mechanisms.',
      'Performance & Widget Efficiency: Missing `const` constructors on immutable subtrees, heavy allocations/computations inside build(), and unnecessary widget rebuilds.',
    ],
    verificationCommands: ['flutter analyze', 'flutter test'],
  },

  typescript: {
    id: 'typescript',
    name: 'TypeScript / JavaScript',
    aliases: ['typescript', 'javascript', 'ts', 'js', 'tsx', 'jsx', 'node'],
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
    systemPersona: 'You are a Principal Code Reviewer & Systems Architect specializing in TypeScript, Node.js, and Modern Web Architecture.',
    inspectionVectors: [
      'Resource Cleanup & Memory: Unclosed database connections, dangling event listeners / event emitters, uncleared setInterval/setTimeout, and memory leaks from unbounded closures or caches.',
      'Security & Secrets: Hardcoded secrets / tokens, SQL / NoSQL / Command injection, prototype pollution, cross-site scripting (XSS), path traversal, and unvalidated user input.',
      'Type Safety & Contracts: Loose or unnecessary use of `any`, unsafe type assertions (`as unknown as T`), missing runtime schema validation (Zod/Valibot) at network boundaries, and dangerous non-null assertions (`!`).',
      'Async & Concurrency: Unhandled Promise rejections, unawaited async operations in loops, race conditions in shared state, missing try/catch around network/IO, and unhandled AbortSignals.',
      'Performance & Clean Architecture: Event loop blocking synchronous calls, unnecessary heavy imports/bundle bloat, inefficient array iterations (N+1 operations), and violation of separation of concerns.',
    ],
    verificationCommands: ['npm run typecheck # or: npx tsc --noEmit', 'npm test'],
  },

  python: {
    id: 'python',
    name: 'Python',
    aliases: ['python', 'py'],
    extensions: ['.py', '.pyw', '.pyi'],
    systemPersona: 'You are a Principal Code Reviewer & Systems Architect specializing in Python, High-Performance Backends, and Modern Data Systems.',
    inspectionVectors: [
      'Resource Management: Unclosed file handles, database connections, or HTTP client sessions (prefer context managers `with ...:`).',
      'Security & Secrets: Hardcoded credentials, SQL injection (string concatenation in queries), insecure deserialization (`pickle.loads`), command injection (`shell=True`), and weak hashing algorithms.',
      'Language Pitfalls & Idioms: Mutable default arguments (`def func(items=[])`), broad exception handling (`except Exception:` or bare `except:` masking system exits), and improper mutable class attributes.',
      'Async & Concurrency: Blocking I/O or CPU-bound loops in `asyncio` event loops, race conditions with shared variables, and unawaited coroutines.',
      'Type Safety & Code Quality: Missing or inconsistent type annotations (`typing`), inefficient list/dict comprehension patterns, and failure to leverage generator streams for large datasets.',
    ],
    verificationCommands: ['pytest', 'ruff check .', 'mypy .'],
  },

  go: {
    id: 'go',
    name: 'Go (Golang)',
    aliases: ['go', 'golang'],
    extensions: ['.go'],
    systemPersona: 'You are a Principal Code Reviewer & Systems Architect specializing in Go, Distributed Systems, and High-Throughput Microservices.',
    inspectionVectors: [
      'Resource Cleanup & Goroutines: Goroutine leaks (launching goroutines without lifecycle management or exit channels), unclosed `resp.Body` or file descriptors (`defer resp.Body.Close()`), and unbounded channels.',
      'Concurrency & Synchronization: Data races on shared memory without proper `sync.Mutex` / atomic primitives, deadlocks from mutex lock ordering, and incorrect wait group (`sync.WaitGroup`) usage.',
      'Error Handling: Ignored or unchecked error returns (`_ = err`), improper error wrapping (missing `%w` in `fmt.Errorf`), and premature panics instead of returning errors.',
      'Security & Input: SQL injection, unvalidated external endpoints, path traversal, and hardcoded secrets or environment variables.',
      'Performance & Allocations: Unnecessary heap allocations escaping the stack, missing capacity pre-allocation in slices (`make([]T, 0, cap)`), and excessive synchronization overhead.',
    ],
    verificationCommands: ['go vet ./...', 'go test -race ./...'],
  },

  rust: {
    id: 'rust',
    name: 'Rust',
    aliases: ['rust', 'rs'],
    extensions: ['.rs'],
    systemPersona: 'You are a Principal Code Reviewer & Systems Architect specializing in Rust, Systems Programming, and Memory Safety.',
    inspectionVectors: [
      'Safety & Unsafe Code: Unsound or unjustified `unsafe` blocks, missing safety invariant comments, dereferencing raw pointers, and undefined behavior.',
      'Error & Panic Resilience: Unhandled `.unwrap()` / `.expect()` calls in production paths that could panic, inadequate custom error types using `thiserror` / `anyhow`.',
      'Memory & Allocations: Excessive `.clone()` calls, unnecessary heap allocations (`Box`, `Vec`) where borrowing or stack allocation is sufficient, and reference cycle memory leaks with `Rc`/`Arc`.',
      'Concurrency: Lock contention on `Mutex`/`RwLock`, potential deadlocks, and cross-thread sync correctness.',
      'Security & Secrets: Sensitive data left unzeroed in memory, hardcoded secrets, and unsafe FFI bindings.',
    ],
    verificationCommands: ['cargo clippy -- -D warnings', 'cargo test'],
  },

  java: {
    id: 'java',
    name: 'Java / JVM',
    aliases: ['java', 'jvm'],
    extensions: ['.java'],
    systemPersona: 'You are a Principal Code Reviewer & Systems Architect specializing in Java, Spring Boot, and Enterprise JVM Architecture.',
    inspectionVectors: [
      'Resource & Memory Management: Unclosed `InputStream`, `Connection`, or `Statement` (enforce try-with-resources `try (...)`), uncancelled ExecutorService threads, and ThreadLocal memory leaks.',
      'Concurrency & Thread Safety: Unsynchronized mutations of shared state, improper use of `volatile`, race conditions, and thread pool exhaustion.',
      'Null Safety & Contracts: NullPointerException hazards, lack of `@NonNull`/`@Nullable` annotations, improper use of `Optional.get()` without `isPresent()`.',
      'Security: SQL injection (string concatenation in JDBC/JPQL), unsafe reflection/deserialization, hardcoded credentials, and path traversal.',
      'Performance: Inefficient JPA/Hibernate N+1 query patterns, excessive object creation in high-throughput loops, and string concatenation inside loops (use `StringBuilder`).',
    ],
    verificationCommands: ['mvn clean test-compile test', 'mvn spotbugs:check', './gradlew test'],
  },

  kotlin: {
    id: 'kotlin',
    name: 'Kotlin / Android',
    aliases: ['kotlin', 'kt', 'kts', 'android'],
    extensions: ['.kt', '.kts'],
    systemPersona: 'You are a Principal Code Reviewer & Systems Architect specializing in Kotlin, Coroutines, and Modern Android Architecture.',
    inspectionVectors: [
      'Coroutines & Scopes: Leaked coroutines using `GlobalScope`, unhandled `CancellationException`, improper Dispatchers (blocking I/O on `Dispatchers.Main`), and unhandled supervisor jobs.',
      'Android Lifecycle & Memory: Leaking Context/Activity/View in static singletons or background callbacks, missing observer teardown in `onDestroyView`.',
      'Null Safety & Types: Dangerous non-null assertions (`!!`), unsafe platform type handling, and unhandled `null` from Java interoperability.',
      'State & Compose: Unstable composable parameters triggering recomposition storms, missing `remember` / `derivedStateOf`, and ViewModel state exposure as mutable state.',
      'Security & Storage: Unencrypted SharedPreferences, insecure PendingIntent flags, exported components without permissions, and hardcoded secrets.',
    ],
    verificationCommands: ['./gradlew test', './gradlew lint'],
  },

  swift: {
    id: 'swift',
    name: 'Swift / iOS',
    aliases: ['swift', 'ios'],
    extensions: ['.swift'],
    systemPersona: 'You are a Principal Code Reviewer & Systems Architect specializing in Swift, Modern Concurrency, and iOS Architecture.',
    inspectionVectors: [
      'Memory & Retain Cycles: Strong reference cycles in closures (missing `[weak self]`), delegate properties not marked `weak`, and unmanaged timers.',
      'Concurrency & Actors: Thread race conditions, blocking main thread with sync calls, misuse of `Task.detached`, actor isolation violations, and `Task` lifecycle leaks.',
      'Safety & Optionals: Dangerous forced unwrapping (`!`), forced downcasting (`as!`), and unhandled `try!` in non-test production code.',
      'SwiftUI / UIKit Lifecycle: Heavy allocations in `View.body`, missing `@MainActor` on UI classes/view models, and uncancelled Combine cancellables (`Set<AnyCancellable>`).',
      'Security & Keychain: Insecure UserDefaults storage of sensitive tokens (must use Keychain), missing App Transport Security configuration, and hardcoded secrets.',
    ],
    verificationCommands: ['swift test', 'xcodebuild test -scheme YourApp -destination "platform=iOS Simulator,name=iPhone 16"'],
  },

  cpp: {
    id: 'cpp',
    name: 'C / C++',
    aliases: ['cpp', 'c', 'cxx', 'cc', 'c++'],
    extensions: ['.cpp', '.c', '.cc', '.cxx', '.h', '.hpp', '.hxx'],
    systemPersona: 'You are a Principal Code Reviewer & Systems Architect specializing in C/C++, Systems Engineering, and Memory Safety.',
    inspectionVectors: [
      'Memory Safety: Buffer overflows, off-by-one errors, use-after-free, double free, and memory leaks (enforce RAII, `std::unique_ptr`, `std::shared_ptr`).',
      'Undefined Behavior: Uninitialized variables, signed integer overflow, null pointer dereferences, out-of-bounds pointer arithmetic, and strict aliasing violations.',
      'Concurrency & Multi-Threading: Data races on shared memory without `std::atomic` or `std::mutex`, deadlocks from lock ordering, and condition variable spurious wakeups.',
      'Resource Management: Leaked sockets/file descriptors, improper destructor exception throwing (destructors must be `noexcept`).',
      'Modern Idioms & Performance: Pass-by-value of heavy objects (use `const T&` or `std::move`), virtual destructor omissions in base classes, and cache-unfriendly data layouts.',
    ],
    verificationCommands: ['cmake --build build --target test', 'clang-tidy -p build', 'valgrind --leak-check=full ./build/test_runner'],
  },

  general: {
    id: 'general',
    name: 'General / Multi-Language',
    aliases: ['general', 'generic', 'universal', 'auto'],
    extensions: [],
    systemPersona: 'You are a Principal Code Reviewer & Systems Architect with deep expertise across modern programming languages.',
    inspectionVectors: [
      'Resource Cleanup & Memory: Leaked connections, unclosed handles, uncancelled background tasks, and unmanaged memory allocations.',
      'Security & Secrets: Hardcoded API keys, credentials, sensitive URLs, injection flaws (SQL/Command/XSS), and insecure data storage.',
      'Type Safety & Boundary Contracts: Loose typing, unhandled null/undefined values, and lack of defensive boundary validation on external inputs.',
      'Error Resilience: Unhandled exceptions, silent failures, missing retry or fallback mechanisms, and ambiguous error propagation.',
      'Performance & Clean Architecture: High algorithmic complexity (O(N^2) or worse where O(N) is feasible), unneeded heavy allocations, and coupling violations.',
    ],
    verificationCommands: ['Run project linter (e.g. linter / analyze)', 'Run project test suite (e.g. test runner)'],
  },
};

/**
 * Detect language from file path extension or source code heuristics.
 */
export function detectLanguage(code: string, filePath?: string): string {
  if (filePath) {
    const ext = path.extname(filePath).toLowerCase();
    for (const profile of Object.values(PROFILES)) {
      if (profile.extensions.includes(ext)) {
        return profile.id;
      }
    }
  }

  // Code heuristic detection (scanning up to 5000 chars, stripping initial comment headers)
  let sample = code.slice(0, 5000);
  // Strip leading multiline or single line comments if dominant at file head
  sample = sample.replace(/^\s*\/\*[\s\S]*?\*\//, '').replace(/^\s*(\/\/[^\n]*\n)+/, '');

  // Flutter / Dart heuristics
  if (
    /import\s+['"]package:(flutter|[a-zA-Z0-9_]+)\//.test(sample) ||
    /\b(Widget|StatelessWidget|StatefulWidget|BuildContext|StateNotifier|TextEditingController)\b/.test(sample) ||
    (/void\s+main\(\s*\)\s*\{/.test(sample) && /\b(runApp|WidgetsFlutterBinding)\b/.test(sample))
  ) {
    return 'flutter';
  }

  // Go heuristics (Go packages are single identifiers, no dots, no semicolons, followed by func/import)
  if (
    (/^\s*package\s+[a-zA-Z0-9_]+\s*$/m.test(sample) && /\bfunc\b/.test(sample)) ||
    /\bfunc\s+(\([a-zA-Z0-9_* ]+\)\s+)?[a-zA-Z0-9_]+\(.*\)\s*(\([a-zA-Z0-9_*, ]+\)|[a-zA-Z0-9_*]+)?\s*\{/.test(sample)
  ) {
    return 'go';
  }

  // Rust heuristics
  if (
    /\b(fn\s+[a-zA-Z0-9_]+|impl(\s+<.*>)?|pub\s+fn|use\s+std::|match\s+[a-zA-Z0-9_]+)\b/.test(sample) &&
    /->\s*[a-zA-Z0-9_&<>]/.test(sample)
  ) {
    return 'rust';
  }

  // Swift heuristics
  if (
    /\bimport\s+(UIKit|SwiftUI|Foundation|Combine|AppKit)\b/.test(sample) ||
    /\b(guard\s+let\s+[a-zA-Z0-9_]+\s*=|@State|@Binding|@Published|struct\s+[a-zA-Z0-9_]+\s*:\s*View)\b/.test(sample)
  ) {
    return 'swift';
  }

  // Java heuristics (Java packages end with semicolon, public class/interface, Spring annotations)
  if (
    /^\s*package\s+[a-zA-Z0-9_.]+\s*;/m.test(sample) ||
    /\b(public\s+(class|interface|enum|record)\s+[a-zA-Z0-9_]+|public\s+static\s+void\s+main|@Override|@SpringBootApplication)\b/.test(sample)
  ) {
    return 'java';
  }

  // Kotlin heuristics (fun, val/var, data class, suspend fun)
  if (
    /\b(fun\s+[a-zA-Z0-9_]+\(|val\s+[a-zA-Z0-9_]+\s*[:=]|suspend\s+fun|data\s+class)\b/.test(sample) ||
    /^\s*package\s+[a-zA-Z0-9_.]+\s*$/m.test(sample)
  ) {
    return 'kotlin';
  }

  // C / C++ heuristics
  if (
    /^\s*#include\s+[<"][a-zA-Z0-9_./]+[>"]/m.test(sample) ||
    /\b(std::(cout|vector|string|unique_ptr|shared_ptr)|int\s+main\s*\(\s*(int\s+argc)?)/.test(sample)
  ) {
    return 'cpp';
  }

  // Python heuristics
  if (
    /^\s*(def\s+[a-zA-Z0-9_]+\(|import\s+[a-zA-Z0-9_]+|from\s+[a-zA-Z0-9_.]+\s+import)/m.test(sample) ||
    /\bself\.[a-zA-Z0-9_]+/.test(sample) ||
    /if\s+__name__\s*==\s*['"]__main__['"]/.test(sample)
  ) {
    return 'python';
  }

  // TypeScript / JavaScript heuristics
  if (
    /\b(interface|type|export\s+(default\s+)?(class|function|const)|import\s+.*\s+from\s+['"].*['"]|const\s+[a-zA-Z0-9_]+\s*:\s*[A-Z][a-zA-Z0-9_<>]+)\b/.test(sample) ||
    /\b(async\s+function|Promise<|console\.log|function\s*\()/m.test(sample)
  ) {
    return 'typescript';
  }

  return 'general';
}

/**
 * Resolve the appropriate ReviewProfile by identifier, alias, or file extension.
 */
export function getReviewProfile(identifier?: string): ReviewProfile {
  const defaultProfile = PROFILES['general']!;
  if (!identifier || identifier.toLowerCase() === 'auto') {
    return defaultProfile;
  }

  const normalized = identifier.toLowerCase().trim();

  // Match by id or alias
  for (const profile of Object.values(PROFILES)) {
    if (profile.id === normalized || profile.aliases.includes(normalized)) {
      return profile;
    }
  }

  // Match by extension
  const ext = normalized.startsWith('.') ? normalized : `.${normalized}`;
  for (const profile of Object.values(PROFILES)) {
    if (profile.extensions.includes(ext)) {
      return profile;
    }
  }

  return defaultProfile;
}

/**
 * Assemble a complete, language-tailored review prompt and dynamic system prompt.
 */
export function buildReviewPrompt(
  profile: ReviewProfile,
  code: string,
  focus: string,
  targetName?: string,
): { taskPrompt: string; systemPrompt: string } {
  const scopeName = targetName ? `**\`${targetName}\`**` : 'the provided code';
  const scopeHeader = targetName
    ? `${targetName} (${profile.name} Profile)`
    : `${profile.name} Code Snippet`;

  const vectorsFormatted = profile.inspectionVectors
    .map((v, i) => `${i + 1}. ${v}`)
    .join('\n');

  const verificationFormatted = profile.verificationCommands.join('\n');

  const systemPrompt =
    `${profile.systemPersona}\n\n` +
    `CRITICAL INSPECTION VECTORS (${profile.name}):\n` +
    `${vectorsFormatted}\n\n` +
    'GROUNDING & FALSE-POSITIVE SUPPRESSION RULES:\n' +
    '1. Only report issues you can point to directly in the provided code.\n' +
    '2. NEVER flag missing imports, missing functions, or truncated dependencies when reviewing an isolated snippet or partial file.\n' +
    '3. If an issue is uncertain without broader project context, downgrade it to a 💡 Suggestion or omit it entirely.\n' +
    '4. Diffs MUST include 1-2 lines of unchanged surrounding context so developers or automated patch tools can cleanly locate the fix.\n' +
    '5. Diffs must be syntactically valid code. NEVER use placeholder comments like `// ... rest of code` inside replacement lines.\n\n' +
    'OUTPUT TEMPLATE:\n' +
    'You MUST format your entire response strictly following this structure:\n\n' +
    '# 🛡️ Code Review Report\n' +
    `**Scope**: ${scopeHeader}\n` +
    '**Overall Health Score**: [SCORE]/100 ([GRADE])\n\n' +
    '> **How the score is computed (deterministic rubric):**\n' +
    '> Start at **100**, then subtract per finding:\n' +
    '> - 🚨 Blocker: **−20** each\n' +
    '> - ⚠️ Warning: **−8** each\n' +
    '> - 💡 Suggestion: **−2** each\n' +
    '> - ✅ Commendation: **0** (no effect on score)\n' +
    '>\n' +
    '> Clamp the result to the range **0–100**.\n' +
    '> **Grade mapping:** `A+` = 97–100, `A` = 90–96, `B` = 80–89, `C` = 70–79, `D` = 60–69, `F` = 0–59.\n\n' +
    '---\n\n' +
    '## 📊 Summary of Findings\n' +
    '| Severity | Count | Status |\n' +
    '| :--- | :--- | :--- |\n' +
    '| 🚨 **Blockers** | [Count] | [e.g. Needs immediate fix / None] |\n' +
    '| ⚠️ **Warnings** | [Count] | [e.g. Action required / None] |\n' +
    '| 💡 **Suggestions** | [Count] | Optional improvements |\n' +
    '| ✅ **Commendations** | [Count] | Clean Architecture patterns |\n\n' +
    '---\n\n' +
    '## 🚨 Blockers (Must Fix)\n' +
    '- `[Category] [Line / Anchor]`: One-sentence problem description.\n' +
    '  ```diff\n' +
    '    // 1-2 lines of unchanged surrounding context\n' +
    '  - old bad line\n' +
    '  + new fixed line\n' +
    '    // 1-2 lines of unchanged surrounding context\n' +
    '  ```\n' +
    '(If none, write: `None identified.`)\n\n' +
    '---\n\n' +
    '## ⚠️ Warnings (Potential Bugs / Edge Cases)\n' +
    '- `[Category] [Line / Anchor]`: One-sentence problem description.\n' +
    '  ```diff\n' +
    '    // 1-2 lines of unchanged surrounding context\n' +
    '  - old bad line\n' +
    '  + new fixed line\n' +
    '    // 1-2 lines of unchanged surrounding context\n' +
    '  ```\n' +
    '(If none, write: `None identified.`)\n\n' +
    '---\n\n' +
    '## 💡 Suggestions & Minor Optimizations\n' +
    '- `[Category] [Line / Anchor]`: One-sentence improvement recommendation.\n' +
    '  ```diff\n' +
    '    // 1-2 lines of unchanged surrounding context\n' +
    '  - old line\n' +
    '  + improved line\n' +
    '    // 1-2 lines of unchanged surrounding context\n' +
    '  ```\n' +
    '(If none, write: `None identified.`)\n\n' +
    '---\n\n' +
    '## ✅ Commendations & Best Practices\n' +
    '- `[Category] [Line / Anchor]`: Positive architectural pattern or clean coding practice observed.\n' +
    '(If none, write: `Standard implementation.`)\n\n' +
    '---\n\n' +
    '## 🛠️ Verification Commands\n' +
    '```bash\n' +
    `${verificationFormatted}\n` +
    '```\n\n' +
    'CRITICAL RULES:\n' +
    '- Output ONLY the template above starting directly with `# 🛡️ Code Review Report`.\n' +
    '- NEVER echo, reproduce, or rewrite the full source code file.\n' +
    '- NEVER include internal thinking process, conversational greetings, intro text, or closing fluff.\n' +
    '- Accurately compute the score and grade based on the findings count.';

  const taskPrompt =
    `Perform a comprehensive code review of ${scopeName} focusing on: ${focus}.\n\n` +
    `Language Profile: ${profile.name}\n\n` +
    'Format the output strictly using the `# 🛡️ Code Review Report` template with Health Score, ' +
    'Summary Table, 🚨 Blockers, ⚠️ Warnings, 💡 Suggestions, ✅ Commendations, and 🛠️ Verification Commands.\n\n' +
    'STRICT RULES:\n' +
    '- Begin directly with `# 🛡️ Code Review Report`.\n' +
    '- NEVER output or rewrite the entire source code file.\n' +
    '- NEVER include internal thinking process, conversational greetings, or closing text.\n\n' +
    `\`\`\`\n${code}\n\`\`\``;

  return { taskPrompt, systemPrompt };
}
