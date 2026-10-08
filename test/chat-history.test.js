const test = require('node:test');
const assert = require('node:assert/strict');
const { appendChatMessage, normalizeChatMessage, MAX_CHAT_MESSAGES } = require('../src/application/chat-history');

test('stores chat questions, markdown answers and a small local screenshot thumbnail', () => {
  const message = normalizeChatMessage({
    id: 'answer-1',
    ts: 123,
    mode: 'screen',
    userBubble: 'Снимок экрана',
    assistantText: '```dart\nvoid main() {}\n```',
    userImageDataUrl: 'data:image/jpeg;base64,YWJj'
  });
  assert.equal(message.userBubble, 'Снимок экрана');
  assert.match(message.assistantText, /void main/);
  assert.equal(message.userImageDataUrl, 'data:image/jpeg;base64,YWJj');
});

test('keeps restored chat history bounded and replaces duplicate ids', () => {
  let history = [];
  for (let i = 0; i < MAX_CHAT_MESSAGES + 5; i++) history = appendChatMessage(history, { id: String(i), assistantText: String(i) });
  assert.equal(history.length, MAX_CHAT_MESSAGES);
  history = appendChatMessage(history, { id: String(MAX_CHAT_MESSAGES + 4), assistantText: 'updated' });
  assert.equal(history.length, MAX_CHAT_MESSAGES);
  assert.equal(history.at(-1).assistantText, 'updated');
});
