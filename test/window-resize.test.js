const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createWindowControls } = require('../src/infrastructure/electron/window-controls');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('frameless overlay resizes from every visible edge and corner', () => {
  const markup = read('frontend/src/pages/MeetingAssistant/components/MeetingAssistantView/meetingAssistantMarkup.html');
  const renderer = read('frontend/src/pages/MeetingAssistant/model/mountMeetingAssistant.js');
  const windowFeature = read('frontend/src/features/window-controls/createWindowControls.js');
  const preload = read('preload.js');
  const windowInfrastructure = read('src/infrastructure/electron/window-controls.js');

  for (const edge of ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw']) {
    assert.match(markup, new RegExp(`data-resize-edge="${edge}"`));
  }
  assert.match(renderer, /createWindowControls\(\{ m2a \}\)/);
  assert.match(windowFeature, /m2a\.windowResizeStart\(handle\.dataset\.resizeEdge, pointerScreenPoint\(event\)\)/);
  assert.match(windowFeature, /setIgnore\(false\);/);
  assert.match(windowFeature, /m2a\.windowResizeMove\(pointerScreenPoint\(event\)\)/);
  assert.match(windowFeature, /m2a\.windowResizeEnd\(\)/);
  assert.match(windowFeature, /handle\.addEventListener\('pointerup', finishResize\)/);
  assert.match(windowFeature, /handle\.addEventListener\('pointercancel', finishResize\)/);
  assert.match(windowFeature, /windowRef\.addEventListener\('blur'/);
  assert.match(preload, /windowResizeStart: \(edge, point\) => ipcRenderer\.send\('window:resize-start', edge, point\)/);
  assert.match(preload, /windowResizeMove: \(point\) => ipcRenderer\.send\('window:resize-move', point\)/);
  assert.match(windowInfrastructure, /ipcMain\.on\('window:resize-start'/);
  assert.match(windowInfrastructure, /ipcMain\.on\('window:resize-move'/);
  assert.match(windowInfrastructure, /point\.y - startCursor\.y/);
  const css = read('frontend/src/app/styles/global.css');
  assert.match(css, /\.resize-n, \.resize-s \{[\s\S]*height:\s*16px;[\s\S]*cursor:\s*ns-resize;/);
  assert.match(css, /\.resize-e, \.resize-w \{[\s\S]*width:\s*16px;[\s\S]*cursor:\s*ew-resize;/);
  assert.match(css, /#panel-wrap \{[\s\S]*flex:\s*1;[\s\S]*min-height:\s*0;/);
  assert.match(css, /#panel \{[\s\S]*flex:\s*1;[\s\S]*min-height:\s*0;/);
  assert.match(css, /#messages \{[^}]*flex:\s*1;[^}]*overflow-y:\s*auto;/);
  assert.match(css, /#root,[\s\S]*\.meeting-assistant-root \{[\s\S]*height:\s*100%;/);
  assert.match(read('frontend/src/pages/MeetingAssistant/components/MeetingAssistantView/MeetingAssistantView.tsx'), /className="meeting-assistant-root"/);
});

test('resized window geometry is persisted and restored', () => {
  const main = read('main.js');
  const windowInfrastructure = read('src/infrastructure/electron/window-controls.js');
  const store = read('src/store.js');
  const css = read('frontend/src/app/styles/global.css');

  assert.match(store, /windowWidth: 700/);
  assert.match(store, /windowHeight: 600/);
  assert.match(windowInfrastructure, /windowWidth: Math\.max\(minimumMainWidth, width - sideWidth \* 2\)/);
  assert.match(main, /Number\(savedSettings\.windowWidth\)/);
  assert.match(main, /windowControls\.attachPersistence\(win\)/);
  assert.match(css, /--main-w: calc\(100vw - var\(--side-w\) - var\(--side-w\)\)/);
  assert.match(css, /#panel-wrap \{[\s\S]*?width: calc\(100% - var\(--panel-inset\) - var\(--panel-inset\)\)/);
});

test('renderer pointer movement changes window height and persists it', () => {
  const listeners = new Map();
  const saved = [];
  let bounds = { x: 100, y: 200, width: 1300, height: 600 };
  const window = {
    isDestroyed: () => false,
    getBounds: () => ({ ...bounds }),
    setBounds: (next) => { bounds = { ...next }; }
  };
  const controls = createWindowControls({
    ipcMain: { on: (channel, listener) => listeners.set(channel, listener) },
    screen: { getCursorScreenPoint: () => ({ x: 700, y: 800 }) },
    store: { setSettings: (patch) => saved.push(patch) },
    getWindow: () => window,
    sideWidth: 300,
    minimumMainWidth: 480,
    minimumHeight: 420
  });

  listeners.get('window:resize-start')({}, 's', { x: 700, y: 800 });
  listeners.get('window:resize-move')({}, { x: 700, y: 950 });
  assert.deepEqual(bounds, { x: 100, y: 200, width: 1300, height: 750 });
  listeners.get('window:resize-end')();
  assert.equal(saved.at(-1).windowHeight, 750);
  controls.dispose();
});
