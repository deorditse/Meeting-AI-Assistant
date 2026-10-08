const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildMeetingSessionSnapshot,
  buildMeetingSessionRestore,
  settingsPatchForChatParameters
} = require('../src/application/meeting-session-state');

test('captures only session chat parameters and restores the selected provider model', () => {
  const snapshot = buildMeetingSessionSnapshot({
    provider: 'openai',
    smart: true,
    aiRules: 'Отвечай кратко',
    models: { openai: { fast: 'gpt-fast', smart: 'gpt-smart' } },
    apiKeys: { openai: 'sk-secret' },
    sttProvider: 'local',
    opacity: 0.5
  }, {
    title: 'Собеседование',
    notes: 'Опыт с Flutter',
    files: [],
    links: []
  });

  assert.deepEqual(snapshot.chatParameters, {
    provider: 'openai',
    smart: true,
    aiRules: 'Отвечай кратко',
    models: { fast: 'gpt-fast', smart: 'gpt-smart' }
  });
  assert.equal(JSON.stringify(snapshot).includes('sk-secret'), false);

  const restored = buildMeetingSessionRestore(snapshot);
  assert.deepEqual(restored.settingsPatch, {
    provider: 'openai',
    smart: true,
    aiRules: 'Отвечай кратко',
    models: { openai: { fast: 'gpt-fast', smart: 'gpt-smart' } }
  });
  assert.equal(restored.sessionContext.title, 'Собеседование');
});

test('restores a custom endpoint without storing its API key', () => {
  const snapshot = buildMeetingSessionSnapshot({
    provider: 'custom',
    smart: false,
    aiRules: '',
    baseUrl: 'http://127.0.0.1:18789/v1',
    apiKeys: { custom: 'private-key' },
    models: { custom: { fast: 'local-fast', smart: 'local-smart' } }
  }, null);

  assert.equal(snapshot.chatParameters.baseUrl, 'http://127.0.0.1:18789/v1');
  assert.equal(JSON.stringify(snapshot).includes('private-key'), false);
  assert.equal(buildMeetingSessionRestore(snapshot).settingsPatch.baseUrl, 'http://127.0.0.1:18789/v1');
});

test('old meetings without chat parameters keep current global chat settings', () => {
  assert.equal(settingsPatchForChatParameters(null), null);
  const restored = buildMeetingSessionRestore({ transcript: [] });
  assert.equal(restored.settingsPatch, null);
  assert.deepEqual(restored.sessionContext, { title: '', notes: '', files: [], links: [] });
});
