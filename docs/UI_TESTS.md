# Browser UI regressions

Run with Node >=22.12:

```sh
npm ci
npx playwright install --with-deps chromium --only-shell
npm run test:ui
```

The Playwright configuration starts a fresh Vite server on 127.0.0.1:5173.
Keep this port free. Each test has an isolated Chromium page, IPC state and settings.
No Electron binary, AI credentials, microphone, screen capture or external service
is needed. Existing unit tests remain available through `npm test`; type checking
and the production renderer build run through `npm run build`.

The fixture executes **production `preload.js`** against mocked Electron
`contextBridge`/`ipcRenderer` transports. Resize messages pass through production
`src/infrastructure/electron/window-controls.js`; its BrowserWindow double applies
bounds to the real browser viewport and records persisted geometry. Thus pointer
input, IPC payloads, flex layout, native ResizeObserver, scrolling and the React
root wrappers are exercised together. Unhandled renderer errors and unexpected
IPC channels fail tests. Provider responses and saved meetings are deterministic.

Coverage:

- Shrink height, width and both via real resize handles to the supported minimum
  (1080 × 420 including the two transparent 300px side margins); grow again.
- Preserve ordered message contents and a nonzero chat viewport after reflow.
- Send from a scrolled-up history at minimum size; show the question and follow
  incremental response tokens without scrolling document ancestors.
- Restore startup history, replace existing history without duplication, and
  resume a saved session through the sessions dialog.

Assertions measure scroll offsets and bounding rectangles. Playwright visibility
alone would not detect messages clipped by a zero-height chat container.
Long histories deliberately overflow so a missing scroll operation cannot pass
merely because every message already fits. Polling waits for layout conditions;
there are no fixed sleeps or source-pattern assertions in these browser tests.

Failures retain Playwright traces in `test-results/`:

```sh
npx playwright show-trace test-results/<test-directory>/trace.zip
```

GitHub Actions runs unit tests, the build and browser tests, and uploads failure
traces. These tests cover Chromium renderer behavior and mocked Electron IPC;
native OS windowing, macOS click-through and real disk persistence still require
Electron/platform checks.
