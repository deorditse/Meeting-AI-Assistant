const assert = require('node:assert/strict');
const test = require('node:test');
const { createMeetingHistoryService } = require('../src/application/meeting-history-service');

function fixture() {
  const meetings = [
    { id: 'old', title: 'Первая встреча', startedAt: 10, transcript: [{ text: 'бюджет', channel: 'you' }] },
    { id: 'new', title: 'Новая встреча', startedAt: 20, transcript: [{ text: 'план', channel: 'them' }] }
  ];
  const store = {
    list: () => meetings,
    search: (query) => meetings.filter((meeting) => JSON.stringify(meeting).toLowerCase().includes(query.toLowerCase())),
    get: (id) => meetings.find((meeting) => meeting.id === id) || null,
    remove: (id) => { const at = meetings.findIndex((meeting) => meeting.id === id); if (at < 0) return false; meetings.splice(at, 1); return true; }
  };
  return { meetings, store };
}

test('lists newest sessions first and returns detached renderer data', () => {
  const { meetings, store } = fixture();
  const service = createMeetingHistoryService({ getStore: () => store });
  const result = service.list();
  assert.deepEqual(result.map((meeting) => meeting.id), ['new', 'old']);
  result[0].title = 'changed';
  assert.equal(meetings[1].title, 'Новая встреча');
});

test('searches meetings and protects the active session from deletion', () => {
  const { meetings, store } = fixture();
  const service = createMeetingHistoryService({ getStore: () => store, getCurrentMeeting: () => meetings[1], isCapturing: () => true });
  assert.deepEqual(service.list('бюджет').map((meeting) => meeting.id), ['old']);
  assert.equal(service.remove('new').code, 'ACTIVE_MEETING');
  assert.equal(service.remove('old').ok, true);
  assert.equal(service.get('old'), null);
});

test('allows deletion of a restored session while capture is stopped', () => {
  const { meetings, store } = fixture();
  let ended = false;
  const service = createMeetingHistoryService({
    getStore: () => store,
    getCurrentMeeting: () => meetings[1],
    isCapturing: () => false,
    endCurrentMeeting: () => { ended = true; }
  });
  assert.equal(service.get('new').active, false);
  assert.equal(service.remove('new').ok, true);
  assert.equal(ended, true);
});

test('resumes a selected saved session but refuses to switch during another active recording', () => {
  const { meetings, store } = fixture();
  let current = meetings[1];
  let capturing = false;
  const service = createMeetingHistoryService({
    getStore: () => store,
    getCurrentMeeting: () => current,
    isCapturing: () => capturing,
    resumeMeeting: (id) => { current = store.get(id); return current; }
  });

  assert.equal(service.resume('old').ok, true);
  assert.equal(current.id, 'old');
  capturing = true;
  assert.equal(service.resume('new').code, 'CAPTURING');
  assert.equal(current.id, 'old');
});
