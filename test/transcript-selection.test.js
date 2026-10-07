const assert = require('node:assert/strict');
const test = require('node:test');
const { selectTranscript } = require('../src/domain/transcript-selection');

const turns = [
  { id: 'a', channel: 'them', text: 'Первый вопрос' },
  { id: 'b', channel: 'you', text: 'Ответ' },
  { id: 'c', channel: 'them', text: 'Второй вопрос' }
];

test('all recognized blocks enter the AI context by default', () => {
  assert.deepEqual(selectTranscript(turns), turns);
});

test('excluded blocks stay out until selected again', () => {
  assert.deepEqual(selectTranscript(turns, ['b']), [turns[0], turns[2]]);
  assert.deepEqual(selectTranscript(turns, []), turns);
});

test('legacy turns without ids remain included', () => {
  const legacy = { channel: 'them', text: 'Старая реплика' };
  assert.deepEqual(selectTranscript([legacy], ['missing']), [legacy]);
});
