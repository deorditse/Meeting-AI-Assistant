# Architecture audit

Audit baseline: 2026-10-08. The production codebase contains about 12,000 lines of JavaScript, TypeScript, HTML and CSS excluding tests, generated output and vendored App Link code.

## Changes completed during the audit

- Window geometry became a deterministic domain operation in `src/domain/window-geometry.js`.
- Electron window drag, resize and persistence moved from `main.js` to `src/infrastructure/electron/window-controls.js`.
- Renderer click-through, drag and resize behavior moved from the page controller to `frontend/src/features/window-controls`.
- Context documents are read asynchronously with a 20 MB input limit. DOCX text extraction no longer depends on Mammoth's vulnerable legacy XML stack.
- Production dependencies report zero known npm vulnerabilities (`npm audit --omit=dev`).
- Both BrowserWindow renderers use Chromium sandboxing.
- Production source maps are disabled unless `M2A_SOURCE_MAPS=1` is set.

## Current architecture risks

### 1. Oversized composition modules

`main.js` remains roughly 1,570 lines and `mountMeetingAssistant.js` roughly 2,350 lines. Both own several unrelated state machines. This makes lifecycle bugs likely and forces many tests to assert source text rather than observable behavior.

Split `main.js` next into these injected application services and Electron adapters:

1. capture session coordinator (start/stop, VAD, buffers and STT lifecycle);
2. answer coordinator (prompt assembly, cancellation and stream timeout);
3. slide tracking service;
4. permissions adapter;
5. publik account adapter.

Split the renderer by user capability: capture controls, transcript, assistant chat, settings, onboarding and consent. Each feature should expose `mount()` and `dispose()` until the imperative page is fully replaced with React components.

### 2. Mixed provider generations

The visible settings support Codex, Claude Code, OpenAI API, Anthropic API and a custom server, while `llm.js`, `stt.js`, settings defaults and tests still carry Cerebras, Gemini, Groq, Ollama, MiniMax, DeepSeek, Azure and publik paths. Decide which providers are product requirements, then remove unreachable adapters, credentials, SDKs and tests together. This will reduce package size and the number of network/security paths.

### 3. Weak static analysis coverage

TypeScript is strict only for the small React shell. Most application code is JavaScript with `checkJs: false`; there is no lint command. Add JSDoc types to extracted services, enable `checkJs` one directory at a time and add ESLint rules for floating promises, unused branches and unsafe optional values.

### 4. Renderer lifecycle and integration tests

The renderer registers about 90 DOM/IPC listeners without a unified cleanup path. Current source-pattern tests protect wiring but do not prove complete browser behavior. Feature controllers should return `dispose()` functions. Add Playwright tests against the Vite renderer with a typed mock preload bridge for settings, session history, streaming responses and capture state.

### 5. Packaging and runtime upgrades

The app currently uses Electron 33 while the npm registry exposes Electron 44. Upgrade through a compatibility branch, testing microphone, ScreenCaptureKit, content protection, transparent click-through and signing on macOS and Windows at each supported major boundary.

`asar` is disabled, so the packaged application contains thousands of loose Node files (about 121 MB in the current macOS app). Enable `asar` after moving the runtime preparation script and any executable assets into `asarUnpack`; verify local Whisper preparation and all child processes in a packaged smoke test.

### 6. Persistence and secrets

Settings writes are atomic but synchronous on Electron's main thread. Move writes behind a serialized asynchronous repository before settings volume grows. API keys are delivered to the renderer so settings inputs can display them; replace that with masked secret status plus explicit main-process update channels to reduce exposure if renderer content is compromised.

## Recommended order

1. Extract capture and answer coordinators with behavioral tests.
2. Add a typed preload contract and browser-level renderer harness.
3. Remove providers outside the supported product list.
4. Hide secrets from renderer state.
5. Enable ASAR and add packaged smoke tests.
6. Upgrade Electron with platform permission and capture checks.
