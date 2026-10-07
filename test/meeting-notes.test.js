const test = require('node:test');
const assert = require('node:assert/strict');
const { buildNotesPrompt, parseNotes } = require('../src/domain/meeting-notes');

test('meeting notes format speakers and parse structured model output', () => {
  const prompt = buildNotesPrompt([
    { channel: 'them', text: 'Запуск в пятницу.' },
    { channel: 'you', text: 'Я подготовлю API.' }
  ]);
  assert.match(prompt, /Them: Запуск в пятницу/);
  assert.match(prompt, /You: Я подготовлю API/);

  const notes = parseNotes('Meeting Summary:\nЗапуск в пятницу.\n\nAction Items:\n- Подготовить API');
  assert.equal(notes.summary, 'Запуск в пятницу.');
  assert.deepEqual(notes.actionItems, ['Подготовить API']);
});

test('meeting notes use plain text as a summary fallback', () => {
  assert.equal(parseNotes('Краткое резюме без разделов.').summary, 'Краткое резюме без разделов.');
});
