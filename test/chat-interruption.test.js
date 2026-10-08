const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { runChild } = require('../src/cli-llm');

test('a new chat action is allowed while the previous answer is streaming', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'frontend/src/pages/MeetingAssistant/model/mountMeetingAssistant.js'), 'utf8');
  const start = renderer.indexOf('function runMode(mode, text)');
  const end = renderer.indexOf('\n  }', start);
  const runMode = renderer.slice(start, end);
  assert.doesNotMatch(runMode, /if \(busy\) return/);

  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /function cancelActiveFeature\(\)/);
  assert.match(main, /request\.controller\.abort\(\)/);
  assert.match(main, /activeFeature === request/);
  assert.match(main, /onToken: \(t\) => \{ if \(streamSettled \|\| !isCurrent\(\)\) return;/);
});

test('the UI can explicitly stop generation and renders screenshot thumbnails', () => {
  const root = path.join(__dirname, '..');
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'frontend/src/pages/MeetingAssistant/model/mountMeetingAssistant.js'), 'utf8');
  const markup = fs.readFileSync(path.join(root, 'frontend/src/pages/MeetingAssistant/components/MeetingAssistantView/meetingAssistantMarkup.html'), 'utf8');

  assert.match(preload, /cancelAnswer: \(\) => ipcRenderer\.send\('llm:cancel'\)/);
  assert.match(main, /ipcMain\.on\('llm:cancel', \(\) => cancelActiveFeature\(\)\)/);
  assert.match(markup, /id="stop-generation-btn"/);
  assert.match(renderer, /userImageDataUrl/);
  assert.match(renderer, /user-screen-thumbnail/);
});

test('screenshot capture does not attach auto-filled transcription text', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'frontend/src/pages/MeetingAssistant/model/mountMeetingAssistant.js'), 'utf8');

  assert.match(main, /const effectiveUserText = mode === 'screen' \? ''/);
  assert.match(main, /const contextTranscript = mode === 'screen' \? \[\]/);
  assert.match(renderer, /runMode\(btn\.dataset\.mode, ''\)/);
});

test('aborting a subscription request terminates its CLI process promptly', async () => {
  const controller = new AbortController();
  const startedAt = Date.now();
  const pending = runChild(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], {
    signal: controller.signal,
    timeoutMs: 15000
  });
  controller.abort();
  await assert.rejects(pending, (error) => error && error.name === 'AbortError');
  assert.ok(Date.now() - startedAt < 1000, 'cancellation should not wait for the child timeout');
});
