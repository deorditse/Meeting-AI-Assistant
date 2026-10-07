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
  assert.match(main, /activeFeature\.controller\.abort\(\)/);
  assert.match(main, /activeFeature === request/);
  assert.match(main, /onToken: \(t\) => \{ if \(streamSettled \|\| !isCurrent\(\)\) return;/);
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
