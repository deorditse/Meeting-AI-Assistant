const { app, BrowserWindow, ipcMain, globalShortcut, screen, session, desktopCapturer, shell, dialog, systemPreferences } = require('electron');
const path = require('path');
const os = require('os');
const store = require('./src/store');
const { captureScreenshot } = require('./src/screen');
const { createSTT } = require('./src/stt');
const { parseDocumentFile } = require('./src/resume');
const { createLLM } = require('./src/llm');
const { getCliProviderStatus } = require('./src/cli-llm');
const { MODES } = require('./src/prompts');
const { rms16 } = require('./src/wav');
const { createStreamingSTT } = require('./src/stt-streaming');
const { AdaptiveVAD, AudioRingBuffer } = require('./src/vad');
const { detectCategory } = require('./src/domain/question-category');
const { selectTranscript } = require('./src/domain/transcript-selection');
const { createSessionContextService } = require('./src/application/session-context-service');
const { createWhisperRuntimeService } = require('./src/application/whisper-runtime-service');
const { registerSessionContextIpc } = require('./src/infrastructure/electron/register-session-context-ipc');
const { registerWhisperRuntimeIpc } = require('./src/infrastructure/electron/register-whisper-runtime-ipc');
const { startAppLink, stopAppLink, recordEvent, appLinkConsentState, revokeAppLinkCaller } = require('./src/applink');
const publik = require('./src/publik');
// The app token release.yml baked into src/publik-build.json (empty in a dev
// checkout → the publik option is simply absent from the provider picker).
const publikBuild = publik.loadBuildConfig();
const { createMeetingStore } = require('./src/meetings');
const { createMeetingMemory } = require('./src/meeting-memory');
const { createMeetingHistoryService } = require('./src/application/meeting-history-service');
const { registerMeetingHistoryIpc } = require('./src/infrastructure/electron/register-meeting-history-ipc');
const { createWindowControls } = require('./src/infrastructure/electron/window-controls');
const { migrateLegacyUserData } = require('./src/user-data-migration');
const {
  hashRGBA,
  shouldEmitSlide,
  createSlideStore,
  clampSlidesConfig,
  buildSlideSystem,
  buildSlideUser,
  DEFAULT_STABLE_REQUIRED
} = require('./src/slides');

// macOS system-audio loopback (the "them" channel via getDisplayMedia) does not
// start on Electron 31–38 unless these Chromium features are enabled; without
// them getDisplayMedia rejects with "Error starting capture" and meeting audio
// silently never works. Electron 39+ wires this up itself, where this is a
// harmless no-op. Must run before app is ready.
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('enable-features', 'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride');
}

// Linux Wayland / Ozone native rendering configuration. Without this, Electron
// falls back to XWayland even on a native Wayland session; 'auto' picks Wayland
// when available and X11 otherwise. Harmless no-op on X11-only sessions.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform,WaylandWindowDecorations');
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
}
const { WhisperModelManager } = require('./src/whisper-model-manager');
const { requireWhisperModel } = require('./src/whisper-model-catalog');
const { LocalWhisperTranscriber } = require('./src/local-whisper-transcriber');

let win = null;
// Which global shortcuts m2a actually holds. `globalShortcut.register` returns
// false when another application already owns the combination, and nothing used
// to look at that — so the only symptom was a key that did nothing. Iris reads
// this and can say which key is taken instead of guessing from a screenshot.
const shortcutState = { assist: false, say: false, leetcode: false, quit: false };
const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';
const isLinux = process.platform === 'linux';
const rendererDevUrl = process.env.M2A_VITE_DEV_SERVER_URL || '';
let lastScreenPermissionOpenAt = 0;

async function requestAndOpenScreenPermission() {
  // desktopCapturer is the closest macOS offers to a programmatic screen
  // permission request. If the OS does not show a prompt, open the exact pane.
  try { await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 16, height: 16 } }); } catch (_) {}
  const now = Date.now();
  if (now - lastScreenPermissionOpenAt < 3000) return;
  lastScreenPermissionOpenAt = now;
  const url = process.platform === 'darwin'
    ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    : process.platform === 'win32'
      ? 'ms-settings:privacy-screenrecorder'
      : '';
  if (url) await shell.openExternal(url).catch(() => {});
}

function loadRendererPage(browserWindow, page = 'index.html') {
  if (rendererDevUrl) {
    return browserWindow.loadURL(new URL(page, `${rendererDevUrl}/`).toString());
  }
  return browserWindow.loadFile(path.join(__dirname, 'renderer-dist', page));
}

// -------- Windows version helpers --------
// WDA_EXCLUDEFROMCAPTURE (setContentProtection) requires Windows 10 build 19041+.
// os.release() returns the NT kernel version e.g. "10.0.19041" or "10.0.22000" (Win11).
function getWindowsBuild() {
  if (!isWindows) return 0;
  const parts = os.release().split('.').map(Number);
  return parts[2] || 0; // third segment is the build number
}
const WIN_BUILD = getWindowsBuild();
const WIN_SUPPORTS_CONTENT_PROTECTION = !isWindows || WIN_BUILD >= 19041;

// WDA_EXCLUDEFROMCAPTURE (win.setContentProtection(true)) is documented to
// exclude a window's content from third-party capture surfaces (BitBlt,
// PrintWindow, DXGI Desktop Duplication, screen recording / screen share)
// WITHOUT touching the live composited image on an ordinary, physically
// scanned-out desktop session — the user still sees the window fine. But on
// a Windows session whose own visible surface is ITSELF a remoted or
// composited pipeline — a Remote Desktop (RDP) connection, a Windows 365 /
// Cloud PC session, most VM consoles, a CI runner's virtual desktop — the
// same flag has been observed to make the window render nothing at all, to
// the user as much as to any capture tool (see
// m2a-windows-overlay-not-visible-for-mic-grant: PrintWindow(PW_RENDERFULLCONTENT)
// sampled zero color variance, and a full-desktop screenshot showed the
// always-on-top window occluding nothing, only ever reproduced with
// protection on and never with it off). Windows sets the SESSIONNAME
// environment variable to exactly "Console" for a locally-attached
// interactive session; every remoted session gets a different value
// (e.g. "RDP-Tcp#3"), and a non-interactive/service context has none at
// all. Anything other than a confirmed local console session is treated as
// unsafe to protect: a window the user can see (even if a screen-share
// viewer also could) is strictly better than a window that is invisible to
// everyone, including the user trying to grant it microphone access.
const WIN_IS_LOCAL_CONSOLE_SESSION = !isWindows || process.env.SESSIONNAME === 'Console';

let permWin = null;
// Windows never blocks startup on an unresolved permission (see app.whenReady()
// below), so launchApp() can already have run once by the time the user grants
// access and clicks Continue in the gate window (permissions:continue also
// calls launchApp()). Without this guard the second call re-creates the main
// BrowserWindow (createWindow() has no existing-window check), re-registers
// global shortcuts and re-starts the applink server -- a real, reachable
// regression, not a hypothetical.
let appLaunched = false;

// -------- capture / transcript state --------
const state = { capturing: false, busy: false, transcribing: { you: false, them: false } };
let activeFeature = null;
let featureSequence = 0;
let transcriptSequence = 0;
let sttDisabled = false; // set when the key can't reach any speech model (stops retry spam)
const buffers = { you: [], them: [] };
const transcript = []; // { channel, text, ts } — capped at MAX_TRANSCRIPT_TURNS
const MAX_TRANSCRIPT_TURNS = 200; // ~30–40 minutes of conversation at normal pace
let meetingMemory = null; // persists the transcript per meeting + notes; see src/meeting-memory.js
let meetingStore = null;
let restoredTurns = []; // turns of an interrupted meeting resumed at launch, replayed to the renderer once
// -------- slides state (memory-only, never written to disk) --------
let slideStore = createSlideStore({ maxSlides: 50 });
let slideTimer = null;
let slideLastHash = null;
let slideStableCount = 0;
let slideBusy = false;
let slideDisabled = false; // set when the chat key rejects slide captions (stops cost spam)
let slideTxCursor = 0; // transcript.length at last emitted slide
const FLUSH_MS = 900;
const STREAM_INACTIVITY_MS = 25000; // abort a stalled LLM stream so state.busy can't wedge forever
const CLI_STREAM_INACTIVITY_MS = 120000;
const MIN_BYTES = Math.floor(16000 * 2 * 0.12); // ~0.12s
const RMS_GATE = 180;
let flushTimer = null;
let whisperModelManager = null;
let localWhisperTranscriber = null;
let activeWhisperModelId = null;
let desiredCaptureState = false;
let captureTransition = Promise.resolve(false);
// -------- streaming STT state --------
let streamingSTT = { you: null, them: null }; // streaming STT instances per channel
let streamingMode = false; // true when using WebSocket streaming STT
const vad = {
  you: new AdaptiveVAD({
    onsetThreshold: 220,
    offsetThreshold: 130,
    silenceFrames: 18,       // ~540ms silence before end
    onSpeechStart: () => send('vad:state', { channel: 'you', speaking: true }),
    onSpeechEnd: (dur) => send('vad:state', { channel: 'you', speaking: false, durationMs: dur })
  }),
  them: new AdaptiveVAD({
    onsetThreshold: 200,
    offsetThreshold: 120,
    silenceFrames: 20,       // ~600ms for remote audio (more forgiving)
    onSpeechStart: () => send('vad:state', { channel: 'them', speaking: true }),
    onSpeechEnd: (dur) => send('vad:state', { channel: 'them', speaking: false, durationMs: dur })
  })
};
// Pre-speech ring buffers (300ms) so we never clip the start of a word
const ringBuffers = {
  you: new AudioRingBuffer(300, 16000),
  them: new AudioRingBuffer(300, 16000)
};

function pushTranscript(turn) {
  if (!turn.id) turn.id = `${Number(turn.ts) || Date.now()}-${++transcriptSequence}`;
  transcript.push(turn);
  if (transcript.length > MAX_TRANSCRIPT_TURNS) transcript.splice(0, transcript.length - MAX_TRANSCRIPT_TURNS);
  if (meetingMemory) meetingMemory.onTurn(turn);
}

function send(channel, data) { if (win && !win.isDestroyed()) win.webContents.send(channel, data); }

const sessionContextService = createSessionContextService({
  onChange: (value) => send('session-context:changed', value)
});
const whisperRuntimeService = createWhisperRuntimeService({ app, resourcesPath: process.resourcesPath });
const getWhisperRuntime = () => whisperRuntimeService.locate();
const clearSessionContext = () => sessionContextService.clear();
const meetingHistoryService = createMeetingHistoryService({
  getStore: () => meetingStore,
  getCurrentMeeting: () => meetingMemory?.current || null,
  isCapturing: () => state.capturing,
  endCurrentMeeting: () => { if (meetingMemory) meetingMemory.end().catch(() => {}); },
  resumeMeeting: (id) => {
    if (!meetingMemory) return null;
    const wasCurrent = meetingMemory.current?.id === id;
    const turns = meetingMemory.resume(id);
    if (!turns) return null;
    transcript.splice(0, transcript.length);
    const restored = turns.slice(-MAX_TRANSCRIPT_TURNS).map((turn) => ({
      ...turn,
      id: turn.id || `${Number(turn.ts) || Date.now()}-${++transcriptSequence}`
    }));
    transcript.push(...restored);
    resetSlidesSession();
    if (!wasCurrent) clearSessionContext();
    send('transcript:replace', { turns: restored, meetingId: id });
    send('status', { message: `Сессия продолжена; восстановлено реплик: ${restored.length}.` });
    return meetingMemory.current;
  }
});

function publishTranscript(channel, text) {
  if (!text || !text.trim()) return;
  const turn = { channel, text: text.trim(), ts: Date.now() };
  pushTranscript(turn);
  send('transcript', turn);
  send('stt:final', { channel, text: turn.text });
}

async function startLocalWhisper(settings) {
  if (!whisperModelManager) throw new Error('The local Whisper model manager is not ready.');
  const localSettings = settings.localWhisper || {};
  const model = requireWhisperModel(localSettings.modelId || 'base.en');
  const runtime = getWhisperRuntime();
  if (!runtime.available) throw new Error(runtime.message);
  activeWhisperModelId = model.id;
  let transcriber = null;
  try {
    const modelPath = await whisperModelManager.verifyInstalledModel(model.id).catch((error) => {
      if (error.code === 'ENOENT') {
        throw new Error(`Download the ${model.id} model in Settings → Audio before listening.`);
      }
      throw error;
    });

    transcriber = new LocalWhisperTranscriber({
      sessionOptions: {
        executablePath: runtime.executablePath,
        runtimeDirectory: runtime.runtimeDirectory,
        modelPath,
        language: model.englishOnly ? 'en' : (localSettings.language || 'auto'),
        threads: Number(localSettings.threads) || 0,
        tinydiarize: model.tinydiarize
      },
      onTranscript: publishTranscript,
      onSpeechState: (channel, speaking, durationMs) => {
        send('vad:state', { channel, speaking, durationMs });
      },
      onStatus: (status) => send('stt:status', { provider: 'local', ...status }),
      onError: (error) => {
        sttDisabled = true;
        console.log('[local-whisper] error', error && error.message);
        send('stt:status', { provider: 'local', status: 'error' });
        send('status', {
          message: `Ошибка локального распознавания: ${error.message}. Аудио не отправлялось в облако.`,
          settingsTab: 'transcription'
        });
      }
    });

    localWhisperTranscriber = transcriber;
    await transcriber.start();
  } catch (error) {
    if (localWhisperTranscriber === transcriber) localWhisperTranscriber = null;
    activeWhisperModelId = null;
    if (transcriber) await transcriber.forceStop().catch(() => {});
    throw error;
  }
}

async function getWhisperOverview() {
  if (!whisperModelManager) throw new Error('The local Whisper model manager is not ready.');
  const runtime = getWhisperRuntime();
  const models = await whisperModelManager.listModels();
  return {
    runtime: {
      available: runtime.available,
      version: runtime.version,
      target: runtime.target,
      message: runtime.message || null
    },
    models
  };
}

// -------- window --------
// The window has a transparent, click-through strip on each side of the main column so
// the history sidebar can slide out left or right. Must match --main-w/--side-w in
// frontend/src/app/styles/global.css. Saved windowX is the main column's x, not the window's.
const MAIN_W = 700, SIDE_W = 300;
const MIN_MAIN_W = 480, MIN_H = 420;
const windowControls = createWindowControls({
  ipcMain,
  screen,
  store,
  getWindow: () => win,
  sideWidth: SIDE_W,
  minimumMainWidth: MIN_MAIN_W,
  minimumHeight: MIN_H
});

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const savedSettings = store.getSettings();
  const mainWidth = Math.max(MIN_MAIN_W, Math.min(Number(savedSettings.windowWidth) || MAIN_W, workArea.width));
  const H = Math.max(MIN_H, Math.min(Number(savedSettings.windowHeight) || 600, workArea.height));
  const W = SIDE_W + mainWidth + SIDE_W;
  let startX = Math.round(workArea.x + (workArea.width - mainWidth) / 2);
  let startY = workArea.y + 6;

  if (savedSettings.windowX !== null && savedSettings.windowY !== null) {
    const clampedX = Math.max(workArea.x - mainWidth + 100, Math.min(savedSettings.windowX, workArea.x + workArea.width - 100));
    // Keep the whole window on screen, not just a 40px sliver of it. The old
    // `- 40` let a 600px-tall window sit at y=607 on a 960px display, pushing
    // the composer and action row off the bottom edge with no way to reach them.
    const clampedY = Math.max(workArea.y, Math.min(savedSettings.windowY, workArea.y + workArea.height - H));
    startX = clampedX;
    startY = clampedY;
  }

  const winOptions = {
    width: W,
    height: H,
    x: startX - SIDE_W,
    y: startY,
    enableLargerThanScreen: true,
    // The window is shown inactive and never takes focus, so without this macOS spends the
    // first click only activating it and a press on the drag handle does nothing.
    acceptFirstMouse: true,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    minWidth: SIDE_W * 2 + MIN_MAIN_W,
    minHeight: MIN_H,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  };

  // Fix 1: On Windows, set type:'toolbar' which sets WS_EX_TOOLWINDOW.
  // This removes the window from Alt+Tab AND the taskbar entirely.
  // On macOS, this is not needed (dock hiding + Mission Control handle it).
  if (isWindows) {
    winOptions.type = 'toolbar';
  }

  win = new BrowserWindow(winOptions);

  // Fix 2: Only call setContentProtection if the OS supports it, and only on
  // a session where it will not blank the window out for the user themself
  // (see WIN_IS_LOCAL_CONSOLE_SESSION above — RDP/VM/Cloud-PC-style sessions
  // render a WDA_EXCLUDEFROMCAPTURE window fully invisible, not just hidden
  // from capture). On older builds, or a non-local-console Windows session,
  // we skip it silently and send a warning to the renderer instead.
  const shouldProtect = !process.env.M2A_NO_PROTECT && WIN_IS_LOCAL_CONSOLE_SESSION;
  if (shouldProtect) {
    if (isLinux) {
      // setContentProtection has no effect on Linux (no windowing-system-level
      // capture-exclusion primitive it can map to) — skip the no-op call and
      // say so, rather than pretending the window is hidden from screen shares.
      console.log('[m2a] Running on Linux: native screen protection (setContentProtection) is not supported and has been skipped.');
    } else if (WIN_SUPPORTS_CONTENT_PROTECTION) {
      win.setContentProtection(true);
    } else {
      // Will notify the renderer after it loads
      console.log(`[m2a] Windows build ${WIN_BUILD} < 19041 — setContentProtection not supported. Window may appear in screen shares.`);
    }
  } else if (isWindows && !WIN_IS_LOCAL_CONSOLE_SESSION && !process.env.M2A_NO_PROTECT) {
    console.log(`[m2a] Windows session is not a local console session (SESSIONNAME=${process.env.SESSIONNAME}) — skipping setContentProtection so the window stays visible to you. Window may appear in screen shares.`);
  }

  win.setAlwaysOnTop(true, 'screen-saver', 1);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (isMac && typeof win.setHiddenInMissionControl === 'function') win.setHiddenInMissionControl(true);

  loadRendererPage(win);

  windowControls.attachPersistence(win);

  win.setTitle('M2A - Meeting AI Assistant');

  win.webContents.on('did-finish-load', () => {
    win.showInactive();
    win.setTitle('M2A - Meeting AI Assistant');
    if (restoredTurns.length) {
      // A meeting was in progress when m2a last exited: put its transcript back
      // in the sidebar so Recap / Follow-up pick up where the conversation was.
      const turns = restoredTurns;
      restoredTurns = [];
      send('transcript:restore', { turns });
      const ageMin = Math.max(1, Math.round((Date.now() - turns[turns.length - 1].ts) / 60000));
      send('status', { message: `Встреча продолжена с момента ${ageMin} мин назад; восстановлено реплик: ${turns.length}.` });
    }
    // Warn about missing content protection on old Windows builds
    if (isWindows && shouldProtect && !WIN_SUPPORTS_CONTENT_PROTECTION) {
      send('status', {
        message: `Ваша версия Windows (сборка ${WIN_BUILD}) не поддерживает скрытие при демонстрации экрана. Обновитесь до Windows 10 build 19041+ или Windows 11.`
      });
    }
    // Warn when protection was skipped because this is not a local console
    // session (RDP / Cloud PC / VM console) — see WIN_IS_LOCAL_CONSOLE_SESSION.
    if (isWindows && !process.env.M2A_NO_PROTECT && !WIN_IS_LOCAL_CONSOLE_SESSION) {
      send('status', {
        message: 'Скрытие при демонстрации экрана выключено для удалённого рабочего стола, Cloud PC или виртуальной машины. Окно будет видно участникам демонстрации.'
      });
    }
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    console.log('[m2a] renderer gone', JSON.stringify(d));
    recordEvent({ level: 'fatal', event: 'renderer_gone', code: d && d.reason, msg: 'renderer process ended: ' + JSON.stringify(d), frame: 'BrowserWindow' });
  });
}

// -------- STT flushing (batch mode fallback) --------
async function flushChannel(channel) {
  if (state.transcribing[channel]) return;
  const chunks = buffers[channel];
  if (!chunks.length) return;
  const pcm = Buffer.concat(chunks);
  buffers[channel] = [];
  if (pcm.length < MIN_BYTES) return;
  if (rms16(pcm) < RMS_GATE) return; // silence gate

  state.transcribing[channel] = true;
  try {
    const settings = store.getSettings();
    const stt = createSTT(settings);
    if (!stt.available) {
      if (!sttDisabled) {
        sttDisabled = true;
        send('status', {
          message: 'Выбранный способ распознавания речи недоступен. Проверьте состояние Local Whisper или настройте OpenAI API/свой сервер.',
          settingsTab: 'transcription'
        });
      }
      return;
    }
    const res = await stt.transcribe(pcm);
    if (res.error) {
      handleSttError(res.error, settings);
      return;
    }
    if (res.text && res.text.trim() && res.text.trim().length > 1 && !/^[?!.,;:\-…]+$/.test(res.text.trim())) {
      const turn = { channel, text: res.text.trim(), ts: Date.now() };
      pushTranscript(turn);
      send('transcript', turn);
    }
  } catch (e) {
    console.log('[stt] error', e && e.message);
    recordEvent({ level: 'error', event: 'stt_failed', msg: e && e.message ? e.message : String(e), frame: 'flushChannel', context: { channel } });
  } finally {
    state.transcribing[channel] = false;
  }
}

function handleSttError(err, settings) {
  console.log('[stt] error', err.provider, err.status, err.code, err.message);
  // Recorded before the early return, because the second and hundredth
  // occurrence still tell you the state m2a is stuck in.
  recordEvent({
    level: 'error',
    event: 'stt_rejected',
    code: err.code || (err.status ? 'http_' + err.status : null),
    msg: err.message,
    frame: 'handleSttError',
    context: { provider: err.provider, status: err.status || null, alreadyDisabled: sttDisabled },
  });
  if (sttDisabled) return;
  const isQuota = err.status === 429 || err.code === 'RESOURCE_EXHAUSTED' || (err.message && err.message.includes('Quota exceeded'));
  const noAccess = err.status === 403 || err.status === 401 || err.code === 'model_not_found' || isQuota;
  sttDisabled = true; // stop hammering the API every few seconds
  if (noAccess) {
    send('status', {
      message: `Распознавание выключено: ключ ${err.provider} отклонён или исчерпан лимит. Обновите ключ в настройках.`,
      settingsTab: 'transcription'
    });
  } else {
    send('status', {
      message: 'Ошибка распознавания (' + err.provider + '): ' + err.message,
      settingsTab: 'transcription'
    });
  }
}

function startFlushLoop() {
  if (flushTimer) return;
  flushTimer = setInterval(() => { flushChannel('you'); flushChannel('them'); }, FLUSH_MS);
}
function stopFlushLoop() { if (flushTimer) { clearInterval(flushTimer); flushTimer = null; } }

// -------- streaming STT setup --------
function initStreamingSTT() {
  const settings = store.getSettings();
  streamingMode = false;

  ['you', 'them'].forEach((channel) => {
    let instance = null; // set below; lets the callbacks tell a stale instance from the live one
    const sttInstance = createStreamingSTT(settings, channel, {
      onTranscript: (ch, text) => {
        if (instance && streamingSTT[ch] !== instance) return; // stale instance after a stop/start

        const turn = { channel: ch, text, ts: Date.now() };
        pushTranscript(turn);
        send('transcript', turn);
        send('stt:final', { channel: ch, text });
      },
      onInterim: (ch, text) => {
        if (instance && streamingSTT[ch] !== instance) return;
        send('stt:interim', { channel: ch, text });
      },
      onError: (err) => {
        // A socket torn down by a quick stop/start can still report an error a
        // moment later; acting on it would kill the sessions that replaced it
        // and start the batch loop alongside them (double transcription).
        if (instance && streamingSTT[channel] !== instance) return;
        console.log('[streaming-stt] error', err.provider, err.message);
        const batchFallbackAvailable = createSTT(settings).available;
        stopStreamingSTT(); // close WebSockets and clear keep-alive intervals
        if (batchFallbackAvailable) {
          send('status', { message: `Ошибка потокового распознавания (${err.provider}): ${err.message}. Переключаюсь в пакетный режим.` });
          startFlushLoop();
        } else if (!sttDisabled) {
          sttDisabled = true;
          send('status', { message: `Распознавание остановлено (${err.provider}): ${err.message}. Для выбранного провайдера нет резервного режима.` });
        }
        streamingMode = false;
      },
      onStatusChange: (ch, status) => {
        send('stt:status', { channel: ch, status });
        if (status === 'connected') {
          console.log(`[streaming-stt] ${ch} channel connected`);
        }
      }
    });

    if (sttInstance.type === 'streaming' && sttInstance.instance) {
      instance = sttInstance.instance;
      streamingMode = true;
      streamingSTT[channel] = instance;
      instance.connect();
    }
  });

  return streamingMode;
}

function stopStreamingSTT() {
  ['you', 'them'].forEach((channel) => {
    if (streamingSTT[channel]) {
      streamingSTT[channel].disconnect();
      streamingSTT[channel] = null;
    }
  });
  streamingMode = false;
}

// -------- slides: auto tracking (opt-in, memory-only) --------
// Cheap hash poll (32px thumbnail) every intervalMs; full-res VLM caption only
// on stable change. Never blocks runFeature (own slideBusy flag). Images are
// never stored — only hash + caption + transcript window.
function getSlidesConfig() {
  return clampSlidesConfig(store.getSettings().slides || {});
}

async function captureHashFrame() {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 32, height: 32 }
  });
  if (!sources.length) return null;
  const img = sources[0].thumbnail;
  if (!img || img.isEmpty()) return null;
  const size = img.getSize();
  const bmp = img.toBitmap();
  if (!bmp || !size.width || !size.height) return null;
  return { width: size.width, height: size.height, data: bmp };
}

async function captionSlide(imageDataUrl, transcriptSlice) {
  const settings = store.getSettings();
  const llm = createLLM(settings);
  if (!llm.ready) throw new Error(llm.configurationError || 'Завершите настройку AI-провайдера.');
  let watchdog = null;
  const stalled = new Promise((_res, reject) => {
    watchdog = setTimeout(() => reject(new Error('slide caption timed out')), STREAM_INACTIVITY_MS);
  });
  try {
    return await Promise.race([
      llm.stream({
        system: buildSlideSystem(),
        turns: [{ role: 'user', text: buildSlideUser(transcriptSlice) }],
        imageDataUrl,
        maxTokens: 300,
        onToken: () => {}
      }),
      stalled
    ]);
  } finally {
    clearTimeout(watchdog);
  }
}

async function pollSlides() {
  if (!state.capturing || slideBusy || slideDisabled) return;
  const cfg = getSlidesConfig();
  if (!cfg.enabled) return;
  if (slideStore.count() >= cfg.maxSlides) return;
  let frame = null;
  try {
    frame = await captureHashFrame();
  } catch {
    return;
  }
  if (!frame) return;
  const newHash = hashRGBA(frame.width, frame.height, frame.data);
  if (!newHash) return;
  const decision = shouldEmitSlide(slideLastHash, newHash, {
    threshold: cfg.threshold,
    stableCount: slideStableCount,
    requiredStable: DEFAULT_STABLE_REQUIRED
  });
  slideStableCount = decision.stableCount;
  if (!decision.emit) {
    if (slideLastHash && decision.distance != null && decision.distance <= cfg.threshold) slideLastHash = slideLastHash;
    return;
  }
  slideLastHash = newHash;
  slideStableCount = decision.stableCount;
  // Stable change: take one full-res frame and caption it.
  slideBusy = true;
  try {
    const imageDataUrl = await captureScreenshot();
    if (!imageDataUrl) return;
    const txStart = slideTxCursor;
    const txEnd = transcript.length;
    const slice = transcript.slice(txStart, txEnd).slice(-8);
    const caption = (await captionSlide(imageDataUrl, slice) || '').trim();
    if (!caption) return;
    const slide = slideStore.add({ hash: newHash, caption, txStart, txEnd });
    slideTxCursor = txEnd;
    send('slides:update', { count: slideStore.count(), last: slide });
    recordEvent({ level: 'info', event: 'slide_captured', msg: 'slide ' + slideStore.count() + ' captioned' });
  } catch (e) {
    const msg = (e && e.message) || String(e);
    if (/429|quota|401|403|model_not_found/i.test(msg)) {
      slideDisabled = true;
      send('status', { message: 'Описание слайдов приостановлено: ' + msg });
    } else {
      console.log('[slides] caption failed', msg);
    }
  } finally {
    slideBusy = false;
  }
}

function startSlideLoop() {
  stopSlideLoop();
  // Screen capture is manual-only: no background polling or automatic slide
  // screenshots. The explicit "Снимок экрана" action is the sole entry point.
}

function stopSlideLoop() {
  if (slideTimer) { clearInterval(slideTimer); slideTimer = null; }
}

function resetSlidesSession() {
  slideStore.clear();
  slideLastHash = null;
  slideStableCount = 0;
  slideBusy = false;
  slideDisabled = false;
  slideTxCursor = transcript.length;
}

// -------- audio routing (streaming or batch) --------
// Per-channel level report every few seconds while capturing, so "m2a never
// hears me" reports can be told apart: no chunks (capture never reached the
// main process), chunks but rms≈0 (a silent/muted device), or healthy audio
// that the transcriber is dropping.
const AUDIO_LEVEL_LOG_MS = 5000;
const audioLevels = { you: { chunks: 0, peakRms: 0 }, them: { chunks: 0, peakRms: 0 }, lastLog: 0 };
function noteAudioLevel(channel, buf) {
  const lv = audioLevels[channel];
  lv.chunks++;
  if (buf.length >= 2) lv.peakRms = Math.max(lv.peakRms, rms16(buf));
  const now = Date.now();
  if (now - audioLevels.lastLog < AUDIO_LEVEL_LOG_MS) return;
  audioLevels.lastLog = now;
  const fmt = (c) => `${c}: chunks=${audioLevels[c].chunks} peakRms=${Math.round(audioLevels[c].peakRms)}`;
  console.log(`[audio] ${fmt('you')} | ${fmt('them')} (gate=${RMS_GATE}, mode=${localWhisperTranscriber ? 'local' : streamingMode ? 'streaming' : 'batch'})`);
  audioLevels.you = { chunks: 0, peakRms: 0 };
  audioLevels.them = { chunks: 0, peakRms: 0 };
}

function routeAudio(channel, pcmBuffer) {
  const buf = Buffer.from(pcmBuffer);
  noteAudioLevel(channel, buf);

  if (localWhisperTranscriber) {
    localWhisperTranscriber.push(channel, buf);
    return;
  }

  // Always run through VAD for speech state detection
  vad[channel].processChunk(buf);

  // Keep pre-speech buffer
  ringBuffers[channel].write(buf);

  if (streamingMode && streamingSTT[channel]) {
    // Streaming mode: send raw PCM directly to the WebSocket
    streamingSTT[channel].sendAudio(pcmBuffer);
  } else {
    // Batch mode: accumulate in buffers for periodic flush
    buffers[channel].push(buf);
  }
}

// -------- capture toggle --------
// Mic + system audio are both captured in the RENDERER (getUserMedia for the mic,
// getDisplayMedia loopback for system audio) so they run inside m2a's own process
// and use m2a's own Screen-Recording grant — no separate helper binary to authorize.
async function setCapturing(active) {
  if (active === state.capturing) return state.capturing;

  if (active) {
    sttDisabled = false; // reset on re-enable
    const settings = store.getSettings();
    if ((settings.sttProvider || 'auto') === 'local') {
      try {
        await startLocalWhisper(settings);
        state.capturing = true;
        console.log('[m2a] capture started, mode: local');
        slideDisabled = false;
        slideTxCursor = transcript.length;
        slideStore = createSlideStore({ maxSlides: getSlidesConfig().maxSlides });
        slideLastHash = null;
        slideStableCount = 0;
        startSlideLoop();
        send('capture:state', { active: true, streaming: false, mode: 'local' });
        send('slides:update', { count: 0, last: null });
        return true;
      } catch (error) {
        state.capturing = false;
        desiredCaptureState = false;
        if (error.code === 'STARTUP_CANCELLED') {
          send('stt:status', { provider: 'local', status: 'off' });
          send('capture:state', { active: false, streaming: false, mode: 'local' });
          return false;
        }
        send('stt:status', { provider: 'local', status: 'error' });
        const runtime = getWhisperRuntime();
        const model = settings.localWhisper?.modelId || 'large-v3';
        const message = !runtime.available
          ? `Модель ${model} установлена, но движок whisper.cpp отсутствует в сборке. Откройте вкладку «Аудио» и подготовьте локальный движок.`
          : `Не удалось запустить локальное распознавание: ${error.message} Аудио не отправлялось в облако.`;
        send('status', { message, settingsTab: 'transcription' });
        send('capture:state', { active: false, streaming: false, mode: 'local' });
        return false;
      }
    }

    state.capturing = true;
    // Try streaming first, fall back to batch
    const streaming = initStreamingSTT();
    if (!streaming) {
      startFlushLoop();
    }
    slideDisabled = false;
    slideTxCursor = transcript.length;
    const slideCfg = getSlidesConfig();
    slideStore = createSlideStore({ maxSlides: slideCfg.maxSlides });
    slideLastHash = null;
    slideStableCount = 0;
    startSlideLoop();
    console.log('[m2a] capture started, mode:', streaming ? 'streaming' : 'batch');
    send('capture:state', { active: true, streaming: streamingMode, mode: streaming ? 'streaming' : 'batch' });
    send('slides:update', { count: 0, last: null });
    return true;
  }

  state.capturing = false;
  stopFlushLoop();
  stopStreamingSTT();
  if (meetingMemory) {
    // Write/refresh the notes for this meeting in the background so the
    // summary survives even if m2a is closed before the meeting formally ends.
    meetingMemory.refreshNotes().then((notes) => {
      if (notes) send('status', { message: `Заметки встречи сохранены; реплик: ${transcript.length}.` });
    }).catch(() => {});
  }
  clearSessionContext();
  stopSlideLoop();
  buffers.you = []; buffers.them = [];
  vad.you.reset(); vad.them.reset();
  ringBuffers.you.clear(); ringBuffers.them.clear();
  const stoppingLocalTranscriber = localWhisperTranscriber;
  localWhisperTranscriber = null;
  send('capture:state', { active: false, streaming: false, mode: stoppingLocalTranscriber ? 'local' : 'off' });
  if (stoppingLocalTranscriber) {
    send('stt:status', { provider: 'local', status: 'stopping' });
    try {
      await stoppingLocalTranscriber.stop();
    } catch (error) {
      console.log('[local-whisper] stop error', error && error.message);
    } finally {
      activeWhisperModelId = null;
    }
  }
  return false;
}

// -------- feature runner --------
function cancelActiveFeature() {
  if (!activeFeature) return false;
  const request = activeFeature;
  activeFeature = null;
  request.controller.abort();
  state.busy = false;
  send('llm:done', { cancelled: true });
  return true;
}

async function runFeature(mode, userText, excludedTranscriptIds = []) {
  const def = MODES[mode];
  if (!def) return;
  cancelActiveFeature();
  const request = { id: ++featureSequence, controller: new AbortController() };
  activeFeature = request;
  const isCurrent = () => activeFeature === request && !request.controller.signal.aborted;
  state.busy = true;
  let streamSettled = false; // drop stray tokens from a stream we've already abandoned
  try {
    const settings = store.getSettings();
    const llm = createLLM(settings);
    // A screenshot action is deliberately isolated from live transcription.
    // Text in the composer is often auto-filled from STT and is sent only by
    // the explicit Send action, never as an accidental screenshot caption.
    const effectiveUserText = mode === 'screen' ? '' : (userText || '');
    const userBubble = mode === 'screen'
      ? null
      : def.userBubble !== null
      ? def.userBubble
      : (mode === 'ask' ? effectiveUserText : mode === 'answerThis' ? `"${effectiveUserText.slice(0, 60)}${effectiveUserText.length > 60 ? '…' : ''}"` : null);
    const contextTranscript = mode === 'screen' ? [] : selectTranscript(transcript, excludedTranscriptIds);
    const category = !['screen', 'leetcode'].includes(mode) ? detectCategory(contextTranscript) : null;
    if (!llm.ready) {
      const message = llm.configurationError || ('Завершите настройку провайдера ' + settings.provider + '. Модель: ' + (llm.model || 'не выбрана') + '.');
      if (settings.provider === publik.PUBLIK_PROVIDER) {
        // No key yet: either the disclosure was never accepted (open it — the
        // mint happens only on "Continue"), or the install was revoked or the
        // last mint failed (offer Reconnect). The app never silently spends.
        const action = !settings.publik.disclosureAccepted
          ? { kind: 'disclosure' }
          : { kind: 'reconnect', label: 'Reconnect' };
        send('llm:error', { message, action });
        return;
      }
      send('llm:error', { message });
      return;
    }
    // Never a silent starter (CONTRACT §12.4): the first-run card — balance,
    // justification, "Link this computer & pick a plan" / "Later" — is shown
    // at least once before any starter usage is spent. Normally it appears
    // right after provisioning; this gate catches a card that was never
    // acknowledged (e.g. an install provisioned by an earlier release).
    if (settings.provider === publik.PUBLIK_PROVIDER && settings.apiKeys.publik && !settings.publik.cardShown) {
      send('llm:error', { message: 'publik API настроен. Просмотрите карточку и повторите запрос.', action: { kind: 'card' } });
      return;
    }

    let imageDataUrl = null;
    if (def.needsScreen) {
      try {
        imageDataUrl = await captureScreenshot(settings.screenCapture && settings.screenCapture.displayId);
        if (!isCurrent()) return;
        if (!imageDataUrl) throw new Error('Не найден доступный экран.');
      }
      catch (e) {
        recordEvent({ level: 'error', event: 'screen_capture_failed', msg: e && e.message ? e.message : String(e), frame: 'captureScreenshot', context: { mode } });
        await requestAndOpenScreenPermission();
        const message = process.platform === 'darwin'
          ? 'Нужно разрешение на запись экрана. Системные настройки открыты — включите M2A и перезапустите приложение.'
          : process.platform === 'win32'
            ? 'Не удалось захватить экран. Проверьте настройки конфиденциальности и защитное ПО Windows.'
            : 'Не удалось захватить экран. Проверьте разрешения рабочего окружения.';
        send('status', { message, settingsTab: 'appearance' });
        send('llm:error', { message });
        return;
      }
    }

    // Follow-up / Recap have nothing to work with before anything was heard —
    // sent to the model anyway, it fabricates plausible generic output that
    // looks like a canned preset. Say so instead, and log how much context
    // every feature actually ran with.
    console.log(`[llm] mode=${mode} transcriptTurns=${contextTranscript.length}/${transcript.length} capturing=${state.capturing}`);
    if (def.transcriptRequired && contextTranscript.length === 0) {
      const hasTranscript = transcript.length > 0;
      send('llm:error', { message: hasTranscript
        ? 'Все блоки расшифровки исключены из контекста. Нажмите на нужные блоки в истории и повторите запрос.'
        : state.capturing
          ? 'Речь пока не распознана. Скажите что-нибудь или дождитесь реплики собеседника и повторите запрос.'
          : 'Разговор ещё не записан. Нажмите «Начать сессию», чтобы M2A услышал встречу.' });
      return;
    }

    send('llm:start', {
      userBubble,
      userImageDataUrl: def.needsScreen ? imageDataUrl : null,
      small: !!def.small,
      category
    });

    const settingsForPrompt = store.getSettings();
    let contextBlock = sessionContextService.buildPromptBlock();
    const system = def.buildSystem ? def.buildSystem(contextBlock, settingsForPrompt.aiRules || '') : (def.system || '');
    const built = def.build({ transcript: contextTranscript, userText: effectiveUserText });

    // Watchdog: a provider that stalls mid-stream would otherwise hang the await forever,
    // leaving state.busy = true and wedging every later question until an app restart.
    let watchdog = null;
    let rearm = () => {};
    const stalled = new Promise((_res, reject) => {
      rearm = () => {
        clearTimeout(watchdog);
        const inactivityMs = ['codex', 'claudeCode'].includes(settings.provider) ? CLI_STREAM_INACTIVITY_MS : STREAM_INACTIVITY_MS;
        watchdog = setTimeout(() => reject(new Error('Модель слишком долго не отвечает. Попробуйте ещё раз.')), inactivityMs);
      };
      rearm();
    });
    const cancelled = new Promise((_res, reject) => {
      request.controller.signal.addEventListener('abort', () => {
        reject(Object.assign(new Error('Запрос отменён.'), { name: 'AbortError' }));
      }, { once: true });
    });
    try {
      await Promise.race([
        llm.stream({
          system,
          turns: [{ role: 'user', text: built }],
          imageDataUrl,
          signal: request.controller.signal,
          onToken: (t) => { if (streamSettled || !isCurrent()) return; rearm(); send('llm:token', { text: t }); },
          onResponse: settings.provider === publik.PUBLIK_PROVIDER ? (res) => publikNoteHeaders(res && res.headers) : undefined
        }),
        stalled,
        cancelled
      ]);
    } finally {
      streamSettled = true;
      clearTimeout(watchdog);
    }
    if (!isCurrent()) return;
    send('llm:done', {});
    // Streams settle after their headers, so the charge is reconciled from
    // GET /wallet shortly after the answer — one request per answer, debounced.
    if (settings.provider === publik.PUBLIK_PROVIDER) publikScheduleWalletRefresh();
  } catch (e) {
    if (!isCurrent() || (e && e.name === 'AbortError')) return;
    recordEvent({ level: 'error', event: 'llm_failed', msg: e && e.message ? e.message : String(e), frame: 'runFeature', context: { mode, provider: store.getSettings().provider } });
    const action = e && e.action ? e.action : null;
    send('llm:error', { message: e && e.message ? e.message : String(e), action });
    if (action) publikHandleErrorAction(action);
  } finally {
    streamSettled = true;
    if (activeFeature === request) {
      activeFeature = null;
      state.busy = false;
    }
  }
}

// -------- IPC --------
// Redact on the way out, strip on the way in: the publik key never enters the
// renderer, and the renderer's whole-object Save can never clobber it.
ipcMain.handle('settings:get', () => store.redactForRenderer(store.getSettings()));
ipcMain.handle('cli-providers:status', () => getCliProviderStatus());
ipcMain.handle('screen:list', () => {
  const primaryId = String(screen.getPrimaryDisplay().id);
  return screen.getAllDisplays().map((display, index) => ({
    id: String(display.id),
    label: display.label || `Экран ${index + 1}`,
    width: display.size.width,
    height: display.size.height,
    primary: String(display.id) === primaryId
  }));
});
ipcMain.handle('settings:set', (_e, patch) => {
  sttDisabled = false;
  const next = store.setSettings(store.stripRendererPatch(patch));
  // Restart slide polling with the new interval when capturing (keeps slides).
  if (state.capturing) startSlideLoop();
  return store.redactForRenderer(next);
});

// -------- publik API --------
// Contract: ~/publik-api-research/CONTRACT.md. The key is minted only after
// the disclosure is accepted (publik:accept-disclosure); the balance line is
// fed by the x-publik-* headers on every answer and reconciled from GET /wallet.
let publikWalletTimer = null;
let publikProvisioning = null;

function publikDevice() {
  let deviceName = '';
  try { deviceName = os.hostname(); } catch { /* optional */ }
  return { appVersion: app.getVersion(), platform: process.platform, osVersion: os.release(), arch: process.arch, deviceName };
}

function publikState() {
  const s = store.getSettings();
  const p = s.publik || {};
  const connected = !!s.apiKeys.publik;
  const wallet = p.wallet || null;
  const claimState = (wallet && wallet.claimState) || p.claimState || 'anonymous';
  const view = {
    available: publikBuild.available,
    selected: s.provider === publik.PUBLIK_PROVIDER,
    connected,
    revoked: !!p.revoked,
    disconnected: !!p.disconnected,
    keyId: p.keyId || '',
    claimState,
    claimUrl: p.claimUrl || (wallet && wallet.claimUrl) || '',
    addCreditUrl: (wallet && wallet.addCreditUrl) || '',
    topUpUrl: (wallet && wallet.topUpUrl) || p.claimUrl || '',
    starterMicros: p.starterMicros || 0,
    balanceMicros: p.balanceMicros,
    balanceAt: p.balanceAt || 0,
    balanceLabel: publik.formatMicros(p.balanceMicros),
    wallet,
    disclosureAccepted: p.disclosureAccepted || 0,
    disclosureVersion: publikBuild.disclosureVersion,
    lastError: p.lastError || '',
    cardShown: !!p.cardShown,
    copy: publik.COPY,
    links: publik.LINKS
  };
  view.line = publik.balanceLine(view);
  // CONTRACT §12: the first-run card (shown while connected && !cardShown),
  // the settings button, and the low-starter banner — all computed here so
  // the renderer only paints.
  view.card = publik.ctaView(view);
  view.settingsCta = publik.settingsCta(view);
  view.lowStarter = publik.lowStarterNotice(view);
  return view;
}
function publikPush() { send('publik:state', publikState()); }

async function publikProvision() {
  if (publikProvisioning) return publikProvisioning;
  publikProvisioning = publik.provisionInstall({
    build: publikBuild,
    store,
    device: publikDevice(),
    log: (e) => recordEvent({ level: e.level, event: e.event, msg: e.msg, frame: 'publikProvision', context: e.context || {} })
  }).then((r) => {
    if (r.ok && r.minted) store.setPublik({ disconnected: false });
    publikPush();
    return publikState();
  }).finally(() => { publikProvisioning = null; });
  return publikProvisioning;
}

// x-publik-* headers from a streamed answer: the balance after admission
// (the hold is included), the claim state, the week. Settlement follows.
function publikNoteHeaders(headers) {
  const h = publik.readGatewayHeaders(headers);
  if (!h) return;
  const s = store.getSettings();
  const wallet = { ...(s.publik.wallet || {}) };
  if (h.balanceMicros !== null) wallet.balanceMicros = h.balanceMicros;
  if (h.claimState) wallet.claimState = h.claimState;
  if (h.weekUsedMicros !== null) wallet.weekUsedMicros = h.weekUsedMicros;
  if (h.weekBudgetMicros !== null || h.weekResetsAt) wallet.weekBudgetMicros = h.weekBudgetMicros;
  if (h.weekResetsAt) wallet.weekResetsAt = h.weekResetsAt;
  if (h.starterRemainingMicros !== null) wallet.starterRemainingMicros = h.starterRemainingMicros;
  store.setPublik({
    balanceMicros: h.balanceMicros !== null ? h.balanceMicros : s.publik.balanceMicros,
    balanceAt: Date.now(),
    claimState: h.claimState || s.publik.claimState,
    wallet,
    revoked: false
  });
  publikPush();
}

async function publikRefreshWallet() {
  const s = store.getSettings();
  if (!s.apiKeys.publik) return publikState();
  try {
    const w = await publik.fetchWallet({ baseUrl: s.publik.baseUrl || publikBuild.baseUrl, apiKey: s.apiKeys.publik });
    store.setPublik({
      wallet: w, balanceMicros: w.balanceMicros, balanceAt: Date.now(), claimState: w.claimState,
      claimUrl: w.claimUrl || (w.claimState === 'claimed' ? '' : s.publik.claimUrl), revoked: false, disconnected: false, lastError: ''
    });
  } catch (e) {
    if (e.status === 401) publikHandleRevoked(e);
    else recordEvent({ level: 'warn', event: 'publik_wallet_failed', msg: e.message, frame: 'publikRefreshWallet', context: { status: e.status || null } });
  }
  publikPush();
  return publikState();
}
function publikScheduleWalletRefresh() {
  clearTimeout(publikWalletTimer);
  publikWalletTimer = setTimeout(() => { publikRefreshWallet().catch(() => {}); }, 1500);
}

// 401 key_revoked: reprovision:true (idle sweep) → re-mint on our own with the
// same install_id; reprovision:false (removed from the dashboard) → stay
// disconnected until the user presses Reconnect.
function publikHandleRevoked(e) {
  const revokedType = !!(e && e.type === 'key_revoked');
  const silent = revokedType && e.reprovision === true;
  // "disconnected" is the dashboard/uninstaller removal only; a plain 401
  // (invalid_api_key) just asks for Reconnect.
  store.setPublik({ revoked: true, disconnected: revokedType && !silent, lastError: '' });
  if (silent) publikProvision().catch(() => {});
}
function publikHandleErrorAction(action) {
  if (!action || action.kind !== 'reprovision') return;
  publikHandleRevoked({ type: 'key_revoked', reprovision: true });
}

ipcMain.handle('publik:state', () => publikState());
ipcMain.handle('publik:accept-disclosure', async () => {
  // Consent precedes mint: this is the only path that calls POST /installs
  // for a fresh install. It also selects publik if the user had moved away.
  if (!publikBuild.available) return publikState();
  store.setPublik({ disclosureAccepted: publikBuild.disclosureVersion });
  store.setSettings({ provider: publik.PUBLIK_PROVIDER });
  return publikProvision();
});
ipcMain.handle('publik:reconnect', async () => {
  const s = store.getSettings();
  if (!s.publik.disclosureAccepted) return publikState();
  if (s.apiKeys.publik && !s.publik.revoked) return publikRefreshWallet();
  store.setPublik({ revoked: true });
  return publikProvision();
});
ipcMain.handle('publik:refresh', () => publikRefreshWallet());
ipcMain.handle('publik:disconnect', async () => {
  const s = store.getSettings();
  if (s.apiKeys.publik) {
    try { await publik.revokeInstall({ baseUrl: s.publik.baseUrl || publikBuild.baseUrl, apiKey: s.apiKeys.publik }); } catch (e) { /* the key is dropped locally regardless */ }
  }
  store.setPublik({ apiKey: '', keyId: '', revoked: false, disconnected: true, balanceMicros: null, wallet: null, lastError: '' });
  publikPush();
  return publikState();
});
// "Later" or the primary button on the first-run card: the card was shown for
// this starter grant. Touches publik.cardShown only — the key stays in place
// and the balance is kept (§12.1).
ipcMain.handle('publik:card-seen', () => {
  try { publik.markCardSeen(store); } catch (e) { recordEvent({ level: 'error', event: 'publik_card_seen_failed', msg: e.message, frame: 'publik:card-seen', context: {} }); }
  publikPush();
  return publikState();
});
// The only path a gateway-supplied URL can take out of the app: publikhq.com
// only. A link off that origin is dropped (the stored claim link stands in
// when it is safe); nothing else is ever handed to the system browser.
ipcMain.on('publik:open', (_e, url) => {
  const s = store.getSettings();
  const target = publik.resolveOpenTarget(url, s.publik.claimUrl);
  if (!target) { recordEvent({ level: 'warn', event: 'publik_open_dropped', msg: '', frame: 'publik:open', context: {} }); return; }
  shell.openExternal(target).catch(() => {});
});
ipcMain.handle('capture:toggle', () => {
  const targetState = !desiredCaptureState;
  desiredCaptureState = targetState;
  if (!targetState && !state.capturing && localWhisperTranscriber) {
    localWhisperTranscriber.forceStop().catch(() => {});
  }
  captureTransition = captureTransition
    .catch(() => state.capturing)
    .then(() => setCapturing(targetState));
  return captureTransition;
});
ipcMain.handle('capture:state', () => ({ active: state.capturing }));
ipcMain.handle('whisper:models', () => getWhisperOverview());
registerWhisperRuntimeIpc({
  ipcMain,
  service: whisperRuntimeService,
  onPrepared: () => send('whisper:models-changed', { runtime: true })
});
ipcMain.handle('whisper:model-download', async (_event, modelId) => {
  if (!whisperModelManager) throw new Error('The local Whisper model manager is not ready.');
  const result = await whisperModelManager.download(modelId, (progress) => send('whisper:download-progress', progress));
  send('whisper:models-changed', { modelId });
  return result;
});
ipcMain.handle('whisper:model-cancel', (_event, modelId) => {
  if (!whisperModelManager) return false;
  return whisperModelManager.cancelDownload(modelId);
});
ipcMain.handle('whisper:model-delete', async (_event, modelId) => {
  requireWhisperModel(modelId);
  if (activeWhisperModelId === modelId) {
    throw new Error('Stop listening before deleting the active model.');
  }
  const result = await whisperModelManager.deleteModel(modelId);
  send('whisper:models-changed', { modelId });
  return result;
});
ipcMain.handle('whisper:model-import', async (_event, modelId) => {
  if (!whisperModelManager) throw new Error('The local Whisper model manager is not ready.');
  requireWhisperModel(modelId);
  if (activeWhisperModelId === modelId) {
    throw new Error('Stop listening before replacing the active model.');
  }
  const selection = await dialog.showOpenDialog(win, {
    title: `Import ggml-${modelId}.bin`,
    properties: ['openFile'],
    filters: [{ name: 'whisper.cpp model', extensions: ['bin'] }]
  });
  if (selection.canceled || !selection.filePaths[0]) return { cancelled: true };
  const result = await whisperModelManager.importModel(modelId, selection.filePaths[0]);
  send('whisper:models-changed', { modelId });
  return result;
});
ipcMain.handle('platform:info', () => ({
  platform: process.platform,
  winBuild: WIN_BUILD,
  winSupportsContentProtection: WIN_SUPPORTS_CONTENT_PROTECTION
}));
ipcMain.handle('transcript:clear', () => {
  if (meetingMemory) meetingMemory.end().catch(() => {}); // it stays in history with its notes
  transcript.splice(0, transcript.length);
  resetSlidesSession();
  clearSessionContext();
  send('slides:update', { count: 0, last: null });
  return { ok: true };
});
ipcMain.handle('slides:list', () => slideStore.list());
ipcMain.handle('slides:state', () => ({
  ...getSlidesConfig(),
  count: slideStore.count(),
  polling: !!slideTimer,
  disabled: slideDisabled
}));
ipcMain.handle('slides:clear', () => {
  resetSlidesSession();
  send('slides:update', { count: 0, last: null });
  return { ok: true };
});
ipcMain.on('ask', (_e, payload = {}) => runFeature(payload.mode, payload.text, payload.excludedTranscriptIds));
ipcMain.on('llm:cancel', () => cancelActiveFeature());
ipcMain.on('mic:pcm', (_e, arrayBuffer) => { if (state.capturing) routeAudio('you', arrayBuffer); });
ipcMain.on('system:pcm', (_e, arrayBuffer) => { if (state.capturing) routeAudio('them', arrayBuffer); });
ipcMain.on('mouse:ignore', (_e, v) => { if (win) win.setIgnoreMouseEvents(!!v, { forward: true }); });
ipcMain.on('open-pane', (_e, url) => { shell.openExternal(url).catch(() => {}); });
ipcMain.on('app:quit', () => app.quit());
ipcMain.on('log', (_e, msg) => console.log('[renderer]', msg));
registerSessionContextIpc({
  ipcMain,
  dialog,
  getWindow: () => win,
  service: sessionContextService,
  parseDocumentFile
});
registerMeetingHistoryIpc({ ipcMain, service: meetingHistoryService });
ipcMain.handle('applink:state', () => appLinkConsentState());
ipcMain.handle('applink:revoke', (_e, callerId) => {
  // Forgetting a caller also clears its separate slide-caption consent decision,
  // so a caller the user re-approves later is asked about slides again too,
  // rather than silently inheriting whatever it was granted or denied before.
  store.clearSlidesConsent(callerId);
  return revokeAppLinkCaller(callerId);
});

// -------- permissions IPC --------
ipcMain.handle('permissions:check', () => getPermissionStatus());
ipcMain.handle('permissions:request', () => requestPermissions());
ipcMain.on('permissions:continue', async () => {
  const status = await getPermissionStatus();
  if (status.mic === 'granted' && status.screen === 'granted') {
    if (permWin) { permWin.close(); permWin = null; }
    launchApp();
  }
});

// -------- shortcuts --------
function registerShortcuts() {
  shortcutState.say = globalShortcut.register('CommandOrControl+Return', () => runFeature('say', ''));
  shortcutState.assist = globalShortcut.register('CommandOrControl+Shift+Return', () => runFeature('assist', ''));
  shortcutState.leetcode = globalShortcut.register('CommandOrControl+H', () => runFeature('screen', ''));
  shortcutState.hide = globalShortcut.register('CommandOrControl+Shift+/', () => send('hide:toggle', {}));
  shortcutState.quit = globalShortcut.register('CommandOrControl+Shift+X', () => app.quit());
  for (const [name, wasRegistered] of Object.entries(shortcutState)) {
    if (!wasRegistered) {
      recordEvent({ level: 'warn', event: 'shortcut_unavailable', msg: 'another application holds the ' + name + ' shortcut', frame: 'registerShortcuts', context: { shortcut: name } });
    }
  }
}

// -------- permissions --------
// systemPreferences.getMediaAccessStatus('screen') is unreliable: it can return
// 'not-determined' or 'denied' even after the user has granted Screen Recording,
// especially in dev mode (unsigned / no proper app bundle).  As a fallback we
// actually attempt a capture and inspect the thumbnail — if it contains any
// non-zero pixel data, macOS is giving us real screen content, i.e. granted.
async function verifyScreenAccess() {
  const sysStatus = systemPreferences.getMediaAccessStatus('screen');
  if (sysStatus === 'granted') return 'granted';

  // Fallback: try an actual capture and check the thumbnail for real pixels.
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 16, height: 16 },
    });
    if (sources.length > 0) {
      const bmp = sources[0].thumbnail.toBitmap();
      // toBitmap() returns raw RGBA bytes; any non-zero byte means real content
      if (bmp && bmp.some(byte => byte !== 0)) return 'granted';
    }
  } catch (_) {}

  return sysStatus;  // return the original system status if fallback didn't help
}

async function getPermissionStatus() {
  // systemPreferences.getMediaAccessStatus('microphone') is also implemented on
  // Windows (it reads the Settings > Privacy > Microphone toggle); 'screen' has
  // no per-app gate on Windows so verifyScreenAccess() falls straight through to
  // 'granted' there. Only genuinely ungated platforms (e.g. Linux) keep the old
  // hard-coded "granted" fallback.
  if (process.platform === 'darwin' || process.platform === 'win32') {
    return {
      mic: systemPreferences.getMediaAccessStatus('microphone'),
      screen: await verifyScreenAccess(),
    };
  }
  return { mic: 'granted', screen: 'granted' };
}

async function requestPermissions({ includeScreen = true } = {}) {
  if (process.env.M2A_SMOKE_TEST === '1') return true;
  if (process.platform !== 'darwin' && process.platform !== 'win32') return true;

  if (process.platform === 'darwin') {
    // Trigger the macOS microphone permission dialog (first-use only)
    const micStatus = systemPreferences.getMediaAccessStatus('microphone');
    if (micStatus !== 'granted') {
      await systemPreferences.askForMediaAccess('microphone');
    }

    // Trigger the macOS screen-recording permission dialog (first-use only).
    // There is no askForMediaAccess('screen'), but attempting to enumerate
    // sources via desktopCapturer will cause macOS to prompt the user.
    if (includeScreen) {
      const screenStatus = await verifyScreenAccess();
      if (screenStatus !== 'granted') {
        try { await desktopCapturer.getSources({ types: ['screen'] }); } catch (_) {}
      }
    }
  }
  // Windows has no OS-level "ask" dialog (systemPreferences.askForMediaAccess is
  // macOS-only) — mic access is governed entirely by the Settings toggle the user
  // flips themselves, which getPermissionStatus() below reads directly.

  if (!includeScreen) {
    return systemPreferences.getMediaAccessStatus('microphone') === 'granted';
  }
  const status = await getPermissionStatus();
  return status.mic === 'granted' && status.screen === 'granted';
}

function createPermissionsWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const W = 500, H = 540;
  permWin = new BrowserWindow({
    width: W,
    height: H,
    x: Math.round(workArea.x + (workArea.width - W) / 2),
    y: Math.round(workArea.y + (workArea.height - H) / 2),
    frame: false,
    transparent: true,
    hasShadow: true,
    resizable: false,
    skipTaskbar: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    }
  });
  loadRendererPage(permWin, 'permissions.html');
  permWin.webContents.on('did-finish-load', () => permWin.show());
}

// -------- launch (called after permissions are confirmed) --------
function launchApp() {
  if (appLaunched) {
    // Already launched once (Windows startup runs launchApp() unconditionally
    // even while the permission gate is still showing). Just dismiss the gate
    // and bring the existing main window forward instead of building a second
    // one on top of it.
    if (permWin && !permWin.isDestroyed()) { permWin.close(); permWin = null; }
    if (win && !win.isDestroyed()) { win.showInactive(); }
    return;
  }
  appLaunched = true;

  migrateLegacyUserData(app.getPath('userData'));

  if (isMac && app.dock) app.dock.hide();

  // The streamlined provider list defaults to the signed-in Codex CLI.

  whisperModelManager = new WhisperModelManager({ userDataPath: app.getPath('userData') });

  meetingStore = createMeetingStore({ file: path.join(app.getPath('userData'), 'meetings.json'), debounceMs: 1500 });
  meetingMemory = createMeetingMemory({
    store: meetingStore,
    llmFactory: () => createLLM(store.getSettings()),
    log: (msg) => console.log('[meetings]', msg)
  });
  restoredTurns = meetingMemory.resumeOpen().map((turn) => {
    if (!turn.id) turn.id = `${Number(turn.ts) || Date.now()}-${++transcriptSequence}`;
    return turn;
  });
  if (restoredTurns.length) transcript.push(...restoredTurns.slice(-MAX_TRANSCRIPT_TURNS));
  meetingMemory.catchUp().then((n) => { if (n) console.log(`[meetings] wrote notes for ${n} earlier meeting(s)`); }).catch(() => {});

  const allowMedia = (permission) => permission === 'media' || permission === 'microphone' || permission === 'audioCapture' || permission === 'display-capture' || permission === 'screen';
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowMedia(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowMedia(permission));

  // System-audio loopback for getDisplayMedia: hand back a screen source with 'loopback'
  // audio so the renderer can capture what's playing (Zoom/Meet) using m2a's own grant.
  //
  // Two things are true here and both must hold.
  //
  // 1. `audio` must be the string 'loopback' or 'loopbackWithMute' (or a WebFrameMain).
  // Electron's native binding for this callback rejects anything else, including a
  // plain boolean. Windows used to get `true`, which threw synchronously and surfaced
  // to the renderer as AbortError "Error starting capture" ("Meeting audio could not be
  // started"), and also invoked this one-time `callback` a SECOND time. Never pass a
  // boolean on any platform, and invoke `callback` from exactly one place.
  //
  // 2. On macOS the grant is not free: the only route to system audio is a
  // ScreenCaptureKit session over a real display, so while it is held open macOS paints
  // its screen-recording indicator and names m2a under Control Center's "Currently
  // Sharing" — pixels every screen-share viewer sees. Nothing app-side suppresses it
  // (an audio-only grant is rejected by Chromium; a window source lights the same
  // indicator), so the honest answer is consent: never open that session on macOS
  // unless the user switched Meeting audio on in Settings > Audio. This guard is the
  // enforcement point and holds even if another renderer path calls getDisplayMedia.
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    // The macOS consent gate resolves to an empty source list instead of invoking the
    // one-time reply itself, so this handler keeps exactly one invocation site.
    // test/display-media-audio.test.js counts them, because a second site is how the
    // "One-time callback was called more than once" bug happened before.
    const allowed = !isMac || Boolean(store.getSettings().meetingAudio);
    (allowed ? desktopCapturer.getSources({ types: ['screen'] }) : Promise.resolve([]))
      .then((sources) => (sources.length ? { video: sources[0], audio: 'loopback' } : undefined))
      .catch((err) => {
        console.error('[main] system audio: desktopCapturer.getSources failed:', err);
        return undefined;
      })
      .then((request) => callback(request));
  }, { useSystemPicker: false });

  // Started before the shortcuts so their registration failures are recorded.
  startAppLink({
    snapshot: () => ({
      state,
      transcript,
      settings: store.getSettings(),
      sttDisabled,
      shortcuts: { ...shortcutState },
      windowAlive: !!(win && !win.isDestroyed()),
      slides: slideStore.list(),
    }),
    setCapturing,
    getSlides: () => slideStore.list(),
    getSlidesConsent: (callerId) => store.getSlidesConsent(callerId),
    setSlidesConsent: (callerId, decision) => store.setSlidesConsent(callerId, decision),
    // Looked up rather than captured: the window is recreated on 'activate',
    // so a reference taken at startup goes stale.
    getWindow: () => win,
  });

  createWindow();
  registerShortcuts();
}

// -------- lifecycle --------
app.whenReady().then(async () => {
  app.setName('M2A - Meeting AI Assistant');
  if (isWindows) {
    process.title = 'M2A';
  }

  if (isMac) {
    // Screen permission is deliberately lazy: startup asks only for the
    // microphone. macOS sees a screen-capture request only after the user
    // presses the explicit screenshot button (or opts into meeting audio).
    await requestPermissions({ includeScreen: false });
  } else if (isWindows) {
    // Windows has no OS-level modal permission dialog to block startup on —
    // there is no askForMediaAccess() equivalent, and the only way to change
    // the mic toggle is to leave the app and use Settings — so unlike macOS
    // this never withholds the main window. It surfaces the same in-app
    // gate as an informational window alongside the app instead of leaving
    // the user with no option at all to see or act on the permission state
    // ("not able to give permission ... coz there is no option").
    await requestPermissions({ includeScreen: false });
  }

  launchApp();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  windowControls.dispose();
  // Quitting mid-meeting is a pause, not an end: the meeting stays open on disk
  // so a relaunch within the resume window picks it back up (a stale one is
  // closed and its notes written at the next launch). Just get the bytes down.
  if (meetingMemory) meetingMemory.flush();
  // Best effort, deliberately not blocking the quit: the library also removes
  // the instance file from a `process.on('exit')` handler, and a file left
  // behind is harmless anyway because readers check whether the PID is alive.
  // Delaying shutdown to tidy a directory would be the wrong trade.
  stopAppLink();
  stopSlideLoop();
  if (whisperModelManager?.activeDownload) {
    whisperModelManager.cancelDownload(whisperModelManager.activeDownload.modelId);
  }
  if (localWhisperTranscriber) localWhisperTranscriber.forceStop().catch(() => {});
});
app.on('window-all-closed', (e) => {
  // Don't quit while the permissions window is open — the user may be in System Settings
  if (permWin) { e.preventDefault(); return; }
  app.quit();
});
