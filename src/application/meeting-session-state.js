const { normalizeSessionContext } = require('../session-context');
const { MAX_AI_RULES_CHARS } = require('../domain/prompt-rules');

const CHAT_PROVIDERS = new Set(['codex', 'claudeCode', 'openai', 'anthropic', 'custom']);

function clean(value, limit = 2000) {
  return String(value || '').trim().slice(0, limit);
}

function captureChatParameters(settings) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const provider = CHAT_PROVIDERS.has(source.provider) ? source.provider : 'codex';
  const models = source.models?.[provider] || {};
  return {
    provider,
    smart: Boolean(source.smart),
    aiRules: clean(source.aiRules, MAX_AI_RULES_CHARS),
    models: {
      fast: clean(models.fast, 240),
      smart: clean(models.smart, 240)
    },
    ...(provider === 'custom' ? { baseUrl: clean(source.baseUrl) } : {})
  };
}

function settingsPatchForChatParameters(value) {
  if (!value || typeof value !== 'object' || !CHAT_PROVIDERS.has(value.provider)) return null;
  const provider = value.provider;
  const models = value.models && typeof value.models === 'object' ? value.models : {};
  return {
    provider,
    smart: Boolean(value.smart),
    aiRules: clean(value.aiRules, MAX_AI_RULES_CHARS),
    models: {
      [provider]: {
        fast: clean(models.fast, 240),
        smart: clean(models.smart, 240)
      }
    },
    ...(provider === 'custom' ? { baseUrl: clean(value.baseUrl) } : {})
  };
}

function buildMeetingSessionSnapshot(settings, sessionContext) {
  return {
    chatParameters: captureChatParameters(settings),
    sessionContext: normalizeSessionContext(sessionContext)
  };
}

function buildMeetingSessionRestore(meeting) {
  const source = meeting && typeof meeting === 'object' ? meeting : {};
  return {
    settingsPatch: settingsPatchForChatParameters(source.chatParameters),
    sessionContext: normalizeSessionContext(source.sessionContext)
  };
}

module.exports = {
  CHAT_PROVIDERS,
  captureChatParameters,
  settingsPatchForChatParameters,
  buildMeetingSessionSnapshot,
  buildMeetingSessionRestore
};
