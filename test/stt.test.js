const test = require('node:test');
const assert = require('node:assert/strict');

const { createSTT } = require('../src/stt');

test('keeps Custom chat credentials separate from speech-to-text providers', async () => {
  const speechToText = createSTT({
    apiKeys: {
      custom: 'gateway-token'
    }
  });

  assert.equal(speechToText.available, false);
  assert.deepEqual(speechToText.providers, []);
  assert.deepEqual(await speechToText.transcribe(Buffer.alloc(6400)), { text: '' });
});

test('uses only dedicated Custom speech credentials for transcription', () => {
  const speechToText = createSTT({
    sttProvider: 'custom',
    apiKeys: { custom: 'chat-token' },
    baseUrl: 'https://chat.example/v1',
    sttApiKeys: { custom: 'speech-token' },
    sttBaseUrl: 'https://speech.example/v1'
  });
  assert.equal(speechToText.available, true);
  assert.deepEqual(speechToText.providers, ['custom']);
});
