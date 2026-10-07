// Run with Electron: electron scripts/smoke-quit.cjs
// Exercise a real mouse click through the renderer, preload, and quit IPC.
const { app, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.on('uncaughtException', error => {
  console.error(error);
  app.exit(1);
});

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'm2a-quit-smoke-'));
app.setPath('userData', profile);
// Keep app-link discovery separate from any installed m2a instance.
process.env.LOCALAPPDATA = profile;
process.env.M2A_SMOKE_TEST = '1';
const appLink = require('../vendor/app-link');
const { AppLinkServer } = appLink;
appLink.AppLinkServer = class extends AppLinkServer {
  constructor(options) {
    super({ ...options, appId: `${options.appId}.quit-smoke-${process.pid}` });
  }
};
let clickedQuit = false;
let receivedQuit = false;
const timeout = setTimeout(() => {
  console.error('FAIL: m2a did not exit after clicking Quit.');
  app.exit(1);
}, 15000);

ipcMain.on('app:quit', () => { receivedQuit = true; });
app.on('quit', (_event, exitCode) => {
  clearTimeout(timeout);
  if (clickedQuit && receivedQuit && exitCode === 0) {
    console.log('PASS: clicking Quit exits m2a with no API keys configured.');
  } else {
    console.error('FAIL: m2a exited without the expected button/IPC path.');
    process.exitCode = 1;
  }
});

app.on('browser-window-created', (_event, win) => {
  const contents = win.webContents;
  contents.once('did-finish-load', async () => {
    try {
      await contents.executeJavaScript(`new Promise((resolve, reject) => {
        const deadline = Date.now() + 5000;
        const timer = setInterval(() => {
          if (!document.querySelector('#onboard-scrim').classList.contains('hidden')) {
            clearInterval(timer); resolve();
          } else if (Date.now() > deadline) {
            clearInterval(timer); reject(new Error('First-run UI did not initialize'));
          }
        }, 50);
      })`);
      const noKeys = await contents.executeJavaScript(
        'window.m2a.settingsGet().then(s => Object.values(s.apiKeys).every(v => !v))'
      );
      assert.equal(noKeys, true, 'Smoke profile must not contain API keys');

      async function click(selector) {
        const point = await contents.executeJavaScript(`(() => {
          const button = document.querySelector(${JSON.stringify(selector)});
          const rect = button.getBoundingClientRect();
          const x = Math.round(rect.x + rect.width / 2);
          const y = Math.round(rect.y + rect.height / 2);
          if (!button.contains(document.elementFromPoint(x, y))) throw new Error('Button is obstructed');
          return { x, y };
        })()`);
        win.focus();
        contents.sendInputEvent({ type: 'mouseMove', ...point });
        contents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
        contents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
      }

      await click('#ob-skip');
      await new Promise(resolve => setTimeout(resolve, 150));
      clickedQuit = true;
      await click('#quit-btn');
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  });
});

require('../main.js');
