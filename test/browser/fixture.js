const fs = require('node:fs');
const path = require('node:path');
const { test: base, expect } = require('@playwright/test');
const { createWindowControls } = require('../../src/infrastructure/electron/window-controls');
const preload = fs.readFileSync(path.join(__dirname, '../../preload.js'), 'utf8');

const history = Array.from({ length: 12 }, (_, index) => ({
  ts: 1791712800000 + index * 1000,
  userBubble: `Saved question ${index + 1}`,
  assistantText: `Saved answer ${index + 1}. ` + 'A detailed response with enough text to wrap across lines. '.repeat(4)
}));
const meeting = { id: 'saved-session', title: 'Regression session', startedAt: 1791712800000,
  transcript: [{ id: 'turn-1', channel: 'them', text: 'A saved transcript turn' }], chatHistory: history };

const test = base.extend({
  app: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // Only the Electron transport is mocked: execute the production preload and
    // window-controls so channel names, payloads and geometry remain under test.
    const calls = [];
    const listeners = new Map();
    const saved = [];
    let bounds = { x: 0, y: 0, width: 1300, height: 600 };
    let resizeQueue = Promise.resolve();
    const controls = createWindowControls({
      ipcMain: { on: (channel, listener) => listeners.set(channel, listener) },
      screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }) },
      store: { setSettings: (patch) => saved.push(patch) },
      getWindow: () => ({
        isDestroyed: () => false,
        getBounds: () => ({ ...bounds }),
        setBounds: (next) => {
          bounds = { ...next };
          resizeQueue = resizeQueue.then(() => page.setViewportSize({ width: next.width, height: next.height }));
        }
      }),
      sideWidth: 300, minimumMainWidth: 480, minimumHeight: 420
    });
    let settings = { provider: 'codex', sttProvider: 'local', onboarded: true,
      smart: false, opacity: 1, chatFontSize: 17, models: {}, apiKeys: {}, sttApiKeys: {},
      localWhisper: {}, slides: {}, screenCapture: { displayId: 'cursor' } };
    const emit = (channel, data) => page.evaluate(({ channel, data }) => window.__ipc.emit(channel, data), { channel, data });
    await page.exposeFunction('__ipcInvoke', async (channel, ...args) => {
      calls.push({ channel, args });
      switch (channel) {
        case 'settings:get': return settings;
        case 'settings:set': settings = { ...settings, ...args[0] }; return settings;
        case 'platform:info': return { platform: 'darwin' };
        case 'publik:state': return { available: false };
        case 'cli-providers:status': return {};
        case 'capture:state': return { active: false };
        case 'meetings:list': return [meeting];
        case 'meetings:get': return meeting;
        case 'meetings:resume': return { ok: true, meeting };
        default: throw new Error(`Unmocked IPC invoke: ${channel}`);
      }
    });
    await page.exposeFunction('__ipcSend', async (channel, ...args) => {
      calls.push({ channel, args });
      if (listeners.has(channel)) listeners.get(channel)({}, ...args);
      else if (channel === 'ask') {
        await emit('llm:start', { userBubble: args[0].text });
      } else if (!['mouse:ignore', 'log'].includes(channel)) {
        throw new Error(`Unmocked IPC send: ${channel}`);
      }
      await resizeQueue;
    });
    await page.addInitScript(({ preload }) => {
      const listeners = new Map();
      window.__ipc = {
        emit(channel, data) {
          if (!listeners.has(channel)) throw new Error(`No renderer listener: ${channel}`);
          for (const listener of listeners.get(channel)) listener({}, data);
        }
      };
      const electron = {
        contextBridge: { exposeInMainWorld: (name, value) => { window[name] = value; } },
        ipcRenderer: {
          invoke: (...args) => window.__ipcInvoke(...args),
          send: (...args) => { window.__ipcSend(...args).catch((error) => { setTimeout(() => { throw error; }); }); },
          on(channel, callback) {
            if (!listeners.has(channel)) listeners.set(channel, []);
            listeners.get(channel).push(callback);
          }
        }
      };
      new Function('require', 'process', preload)(() => electron, { platform: 'darwin' });
    }, { preload });
    await page.goto('/');
    await expect.poll(() => calls.some((call) => call.channel === 'capture:state')).toBe(true);
    await expect(page.locator('#onboard-scrim')).toBeHidden();
    try {
      await use({ page, calls, saved, emit, history, meeting, bounds: () => bounds });
    } finally {
      await resizeQueue;
      controls.dispose();
      expect(errors, 'renderer and mocked IPC must not throw').toEqual([]);
    }
  }
});

// Unlike toBeVisible(), these assertions detect a zero-height flex viewport,
// clipping by its scroll container, off-screen content and ancestor scrolling.
async function expectChatAtBottom(page) {
  await expect.poll(() => page.locator('#messages').evaluate((element) => {
    const box = element.getBoundingClientRect();
    const last = element.lastElementChild?.getBoundingClientRect();
    return box.height > 40 && box.width > 100 && box.top >= 0 && box.bottom <= innerHeight
      && last && last.bottom <= box.bottom + 2 && last.bottom > box.top
      && Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop) <= 2
      && scrollX === 0 && scrollY === 0;
  })).toBe(true);
}

module.exports = { test, expect, expectChatAtBottom };
