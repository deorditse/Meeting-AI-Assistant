const test = require('node:test');
const assert = require('node:assert/strict');
const { detectCategory } = require('../src/domain/question-category');

test('detects common meeting question categories from the other participant', () => {
  assert.equal(detectCategory([{ channel: 'them', text: 'Tell me about a time you failed.' }]), 'behavioral');
  assert.equal(detectCategory([{ channel: 'them', text: 'Why do you want to work here?' }]), 'motivation');
  assert.equal(detectCategory([{ channel: 'them', text: 'Walk me through your role at PayCo.' }]), 'experience');
  assert.equal(detectCategory([{ channel: 'them', text: 'What are your salary expectations?' }]), 'compensation');
  assert.equal(detectCategory([{ channel: 'them', text: 'How would you design a distributed cache?' }]), 'technical');
});

test('ignores the local participant and defaults empty input to general', () => {
  assert.equal(detectCategory([{ channel: 'you', text: 'Tell me about a time you failed.' }]), 'general');
  assert.equal(detectCategory([]), 'general');
  assert.equal(detectCategory(null), 'general');
});
