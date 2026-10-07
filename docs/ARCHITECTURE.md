# M2A architecture

M2A follows four dependency layers:

1. **Domain** (`src/domain`) contains deterministic rules and text transformations. It has no Electron, filesystem, network, or process dependencies.
2. **Application** (`src/application`) owns use-case state and orchestration. It depends on domain modules and receives external capabilities through constructor arguments.
3. **Infrastructure** (`src/infrastructure`) adapts Electron IPC, dialogs, files, processes, and HTTP to application services.
4. **Presentation** (`frontend/src/features`, `frontend/src/pages`) renders UI and talks only through the preload bridge. Feature controllers own one UI capability; pages compose them.

`main.js` is the composition root. It creates services, injects infrastructure dependencies, owns the Electron lifecycle, and should not contain feature-specific parsing or persistence rules.

## Session context

`createSessionContextService` is the only owner of the current chat context. It stores normalized data in memory, publishes snapshots, and builds the prompt block. Electron IPC only transports data. The frontend controller only edits and displays it.

Session context is never part of settings or meeting history. It is cleared when the session ends, history is cleared, or the process exits. Previous meeting summaries are stored for the history UI but are never injected into a new chat.

## Whisper runtime

`createWhisperRuntimeService` locates and prepares the native runtime. The Electron adapter exposes one IPC command and publishes completion. The UI does not know filesystem paths, child-process details, or platform build commands.

## Dependency rules

- Domain modules cannot import Electron or infrastructure.
- Application modules cannot import Electron or infrastructure.
- Renderer modules cannot import Electron directly; all privileged operations use `window.m2a`.
- Settings contain durable product preferences only. Per-session materials never enter the settings schema.

These constraints are enforced by `test/architecture-boundaries.test.js`.
