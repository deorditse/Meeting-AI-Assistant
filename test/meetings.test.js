const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { createMeetingStore } = require('../src/meetings');

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm2a-meetings-'));
  return createMeetingStore({ file: path.join(dir, 'meetings.json') });
}

test('add creates a meeting with a unique id', () => {
  const s = tmpStore();
  const a = s.add();
  const b = s.add();
  assert.notStrictEqual(a.id, b.id);
  assert.strictEqual(a.transcript.length, 0);
  assert.deepStrictEqual(a.chatHistory, []);
  assert.strictEqual(a.chatHistoryMigratedFromTranscript, false);
});

test('migrates legacy meetings so transcript history and future AI chat can coexist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm2a-meetings-legacy-'));
  const file = path.join(dir, 'meetings.json');
  fs.writeFileSync(file, JSON.stringify([{
    id: 'legacy',
    startedAt: 1,
    transcript: [{ channel: 'them', text: 'Старый вопрос', ts: 2 }],
    summary: 'Старые итоги'
  }]));

  const store = createMeetingStore({ file });
  const meeting = store.get('legacy');
  assert.deepStrictEqual(meeting.chatHistory, []);
  assert.strictEqual(meeting.chatHistoryMigratedFromTranscript, true);

  const reloaded = JSON.parse(fs.readFileSync(file, 'utf8'))[0];
  assert.deepStrictEqual(reloaded.chatHistory, []);
  assert.strictEqual(reloaded.chatHistoryMigratedFromTranscript, true);
});

test('addTurn appends and persists to disk', () => {
  const s = tmpStore();
  const m = s.add();
  s.addTurn(m.id, { channel: 'them', text: 'hello', ts: 1 });
  const reloaded = createMeetingStore({ file: s.file });
  const found = reloaded.get(m.id);
  assert.strictEqual(found.transcript.length, 1);
  assert.strictEqual(found.transcript[0].text, 'hello');
});

test('update writes summary/actionItems', () => {
  const s = tmpStore();
  const m = s.add();
  s.update(m.id, { summary: 'Done deal', actionItems: ['Email client'] });
  assert.strictEqual(s.get(m.id).summary, 'Done deal');
  assert.deepStrictEqual(s.get(m.id).actionItems, ['Email client']);
});

test('search matches title/summary/transcript', () => {
  const s = tmpStore();
  const a = s.add();
  s.update(a.id, { title: 'Client kickoff', summary: 'Discuss pricing tiers' });
  s.addTurn(a.id, { channel: 'them', text: 'quarterly review', ts: 1 });
  assert.strictEqual(s.search('pricing').length, 1);
  assert.strictEqual(s.search('review').length, 1);
  assert.strictEqual(s.search('zzz-nothing').length, 0);
});

test('remove deletes a meeting', () => {
  const s = tmpStore();
  const m = s.add();
  assert.strictEqual(s.remove(m.id), true);
  assert.strictEqual(s.remove(m.id), false);
  assert.strictEqual(s.list().length, 0);
});
