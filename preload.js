const { contextBridge, ipcRenderer } = require('electron');
const platform = process.platform;

contextBridge.exposeInMainWorld('m2a', {
  platform,
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSet: (patch) => ipcRenderer.invoke('settings:set', patch),
  cliProviderStatus: () => ipcRenderer.invoke('cli-providers:status'),
  screenList: () => ipcRenderer.invoke('screen:list'),
  whisperModels: () => ipcRenderer.invoke('whisper:models'),
  whisperRuntimePrepare: () => ipcRenderer.invoke('whisper:runtime-prepare'),
  whisperModelDownload: (modelId) => ipcRenderer.invoke('whisper:model-download', modelId),
  whisperModelCancel: (modelId) => ipcRenderer.invoke('whisper:model-cancel', modelId),
  whisperModelDelete: (modelId) => ipcRenderer.invoke('whisper:model-delete', modelId),
  whisperModelImport: (modelId) => ipcRenderer.invoke('whisper:model-import', modelId),
  platformInfo: () => ipcRenderer.invoke('platform:info'),
  ask: (payload) => ipcRenderer.send('ask', payload),
  cancelAnswer: () => ipcRenderer.send('llm:cancel'),
  captureToggle: () => ipcRenderer.invoke('capture:toggle').catch((err) => {
    console.error('[m2a] captureToggle error', err);
    return false;
  }),
  captureState: () => ipcRenderer.invoke('capture:state'),
  micPcm: (arrayBuffer) => ipcRenderer.send('mic:pcm', arrayBuffer),
  systemPcm: (arrayBuffer) => ipcRenderer.send('system:pcm', arrayBuffer),
  setIgnoreMouse: (v) => ipcRenderer.send('mouse:ignore', v),
  windowDragStart: () => ipcRenderer.send('window:drag-start'),
  windowDragEnd: () => ipcRenderer.send('window:drag-end'),
  windowResizeStart: (edge) => ipcRenderer.send('window:resize-start', edge),
  windowResizeEnd: () => ipcRenderer.send('window:resize-end'),
  clearTranscript: () => ipcRenderer.invoke('transcript:clear'),
  meetingsList: (query = '') => ipcRenderer.invoke('meetings:list', query),
  meetingsGet: (id) => ipcRenderer.invoke('meetings:get', id),
  meetingsResume: (id) => ipcRenderer.invoke('meetings:resume', id),
  meetingsRemove: (id) => ipcRenderer.invoke('meetings:remove', id),
  slidesList: () => ipcRenderer.invoke('slides:list'),
  slidesState: () => ipcRenderer.invoke('slides:state'),
  slidesClear: () => ipcRenderer.invoke('slides:clear'),
  openPane: (url) => ipcRenderer.send('open-pane', url),
  publikState: () => ipcRenderer.invoke('publik:state'),
  publikAcceptDisclosure: () => ipcRenderer.invoke('publik:accept-disclosure'),
  publikReconnect: () => ipcRenderer.invoke('publik:reconnect'),
  publikRefresh: () => ipcRenderer.invoke('publik:refresh'),
  publikDisconnect: () => ipcRenderer.invoke('publik:disconnect'),
  publikCardSeen: () => ipcRenderer.invoke('publik:card-seen'),
  publikOpen: (url) => ipcRenderer.send('publik:open', url),
  appLinkState: () => ipcRenderer.invoke('applink:state'),
  appLinkRevoke: (callerId) => ipcRenderer.invoke('applink:revoke', callerId),
  appLinkConsentRespond: (id, allowed) => ipcRenderer.send('applink:consent-response', { id, allowed }),
  pickSessionContextFiles: () => ipcRenderer.invoke('session-context:pick-files'),
  fetchSessionContextUrl: (url) => ipcRenderer.invoke('session-context:fetch-url', url),
  sessionContextGet: () => ipcRenderer.invoke('session-context:get'),
  sessionContextSet: (value) => ipcRenderer.invoke('session-context:set', value),
  sessionContextClear: () => ipcRenderer.invoke('session-context:clear'),
  quit: () => ipcRenderer.send('app:quit'),
  permissionsCheck: () => ipcRenderer.invoke('permissions:check'),
  permissionsRequest: () => ipcRenderer.invoke('permissions:request'),
  permissionsContinue: () => ipcRenderer.send('permissions:continue'),
  log: (msg) => ipcRenderer.send('log', msg),
  on: (channel, cb) => {
    const allowed = ['capture:state', 'llm:start', 'llm:token', 'llm:done', 'llm:error', 'status', 'transcript', 'transcript:restore', 'transcript:replace', 'stt:interim', 'stt:final', 'stt:status', 'vad:state', 'applink:consent-request', 'hide:toggle', 'whisper:download-progress', 'whisper:models-changed', 'publik:state', 'slides:update', 'session-context:changed'];
    if (!allowed.includes(channel)) return;
    ipcRenderer.on(channel, (_e, data) => cb(data));
  }
});
