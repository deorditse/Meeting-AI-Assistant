const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const markup = fs.readFileSync(path.join(root, 'frontend/src/pages/MeetingAssistant/components/MeetingAssistantView/meetingAssistantMarkup.html'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const sessionContextController = fs.readFileSync(path.join(root, 'frontend/src/features/session-context/createSessionContextController.js'), 'utf8');
const meetingHistoryController = fs.readFileSync(path.join(root, 'frontend/src/features/meeting-history/createMeetingHistoryController.js'), 'utf8');
const whisperRuntimeIpc = fs.readFileSync(path.join(root, 'src/infrastructure/electron/register-whisper-runtime-ipc.js'), 'utf8');
const whisperRuntimeService = fs.readFileSync(path.join(root, 'src/application/whisper-runtime-service.js'), 'utf8');

test('settings expose only the supported chat providers', () => {
  const visible = [...markup.matchAll(/<button data-provider="([^"]+)"(?![^>]*class="hidden")[^>]*>/g)].map((match) => match[1]);
  assert.deepEqual(visible, ['codex', 'claudeCode', 'openai', 'anthropic', 'custom']);
});

test('speech settings expose local Whisper, OpenAI API and custom server', () => {
  const visible = [...markup.matchAll(/data-stt-provider="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(visible, ['local', 'openai', 'custom']);
});

test('speech provider details are isolated into provider-specific panels', () => {
  const renderer = fs.readFileSync(path.join(root, 'frontend/src/pages/MeetingAssistant/model/mountMeetingAssistant.js'), 'utf8');
  assert.match(markup, /id="stt-local-settings"/);
  assert.match(markup, /id="stt-openai-settings"[^>]*hidden/);
  assert.match(markup, /id="stt-custom-settings"[^>]*hidden/);
  assert.match(renderer, /stt-local-settings.*provider !== 'local'/);
  assert.match(renderer, /stt-openai-settings.*provider !== 'openai'/);
  assert.match(renderer, /stt-custom-settings.*provider !== 'custom'/);
});

test('subscription providers hide API credentials while API providers reveal only their own fields', () => {
  const renderer = fs.readFileSync(path.join(root, 'frontend/src/pages/MeetingAssistant/model/mountMeetingAssistant.js'), 'utf8');
  assert.match(markup, /id="api-credentials-label"/);
  assert.match(renderer, /credentialsLabel\.classList\.toggle\('hidden', isCli\)/);
  assert.match(renderer, /el\.dataset\.keyFor !== provider/);
  assert.doesNotMatch(renderer.match(/function statusText\(\) \{[\s\S]*?\n  \}/)?.[0] || '', /распознавание:/);
});

test('screen capture failure requests access and opens the macOS permission pane', () => {
  assert.match(main, /requestAndOpenScreenPermission/);
  assert.match(main, /Privacy_ScreenCapture/);
  assert.match(main, /await requestAndOpenScreenPermission\(\)/);
  assert.match(main, /settingsTab: 'appearance'/);
  assert.match(main, /send\('llm:error', \{ message \}\);\s*return;/);
});

test('speech failures route the user to the Audio settings tab', () => {
  const renderer = fs.readFileSync(path.join(root, 'frontend/src/pages/MeetingAssistant/model/mountMeetingAssistant.js'), 'utf8');
  assert.match(main, /settingsTab: 'transcription'/);
  assert.match(renderer, /if \(settingsTab\) openSettings\(settingsTab\)/);
  assert.match(renderer, /\.s-tab\[data-tab="\$\{tabName\}"\]/);
});

test('local Whisper settings explain and prepare the runtime separately from the model', () => {
  const renderer = fs.readFileSync(path.join(root, 'frontend/src/pages/MeetingAssistant/model/mountMeetingAssistant.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  assert.match(markup, /id="whisper-runtime-help"/);
  assert.match(markup, /id="whisper-runtime-prepare"[^>]*>Подготовить движок</);
  assert.match(preload, /whisperRuntimePrepare:.*whisper:runtime-prepare/);
  assert.match(whisperRuntimeIpc, /ipcMain\.handle\('whisper:runtime-prepare'/);
  assert.match(renderer, /m2a\.whisperRuntimePrepare\(\)/);
  assert.match(whisperRuntimeService, /brew install cmake/);
});

test('chat context is a session panel and never a global settings tab', () => {
  const renderer = fs.readFileSync(path.join(root, 'frontend/src/pages/MeetingAssistant/model/mountMeetingAssistant.js'), 'utf8');
  const store = fs.readFileSync(path.join(root, 'src/store.js'), 'utf8');
  assert.doesNotMatch(markup, /class="s-tab" data-tab="context"/);
  assert.doesNotMatch(markup, /data-pane="context"/);
  assert.match(markup, /id="context-scrim"/);
  assert.match(markup, /Контекст текущей сессии/);
  assert.match(renderer, /createSessionContextController/);
  assert.match(sessionContextController, /bridge\.sessionContextSet\(draft\(\)\)/);
  const defaults = store.match(/const DEFAULTS = \{[\s\S]*?\n\};/)?.[0] || '';
  assert.doesNotMatch(defaults, /sessionContext/);
  assert.match(store, /removeLegacyContextFields\(out\)/);
  assert.match(store, /removeLegacyContextFields\(nextSettings\)/);
  assert.match(main, /createSessionContextService/);
  assert.match(main, /clearSessionContext\(\);[\s\S]*?stopSlideLoop\(\)/);
});

test('appearance settings expose a persisted chat font-size slider', () => {
  const renderer = fs.readFileSync(path.join(root, 'frontend/src/pages/MeetingAssistant/model/mountMeetingAssistant.js'), 'utf8');
  const store = fs.readFileSync(path.join(root, 'src/store.js'), 'utf8');
  assert.match(markup, /id="s-chat-font-size"[^>]*min="13"[^>]*max="24"/);
  assert.match(renderer, /applyChatFontSize\(settings\.chatFontSize, false\)/);
  assert.match(renderer, /settingsSet\(\{ chatFontSize: size \}\)/);
  assert.match(store, /chatFontSize: 17/);
});

test('saved meeting sessions are exposed through a dedicated history panel', () => {
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'frontend/src/pages/MeetingAssistant/model/mountMeetingAssistant.js'), 'utf8');
  assert.match(markup, /id="sessions-btn"/);
  assert.match(markup, /id="meetings-scrim"/);
  assert.match(markup, /id="meetings-search"/);
  assert.match(preload, /meetingsList:.*meetings:list/);
  assert.match(preload, /meetingsGet:.*meetings:get/);
  assert.match(preload, /meetingsResume:.*meetings:resume/);
  assert.match(preload, /meetingsRemove:.*meetings:remove/);
  assert.match(renderer, /transcript:replace/);
  assert.match(meetingHistoryController, /Продолжить сессию/);
  assert.match(renderer, /createMeetingHistoryController/);
});
