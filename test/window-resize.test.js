const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
  assert.match(windowFeature, /m2a\.windowResizeStart\(handle\.dataset\.resizeEdge\)/);
  assert.match(windowFeature, /m2a\.windowResizeEnd\(\)/);
  assert.match(preload, /windowResizeStart: \(edge\) => ipcRenderer\.send\('window:resize-start', edge\)/);
  assert.match(windowInfrastructure, /ipcMain\.on\('window:resize-start'/);
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
  assert.match(css, /#panel-wrap[^\n]+width: calc\(100% - var\(--panel-inset\) - var\(--panel-inset\)\)/);
});
