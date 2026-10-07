const { buildSessionContextBlock, normalizeSessionContext } = require('../session-context');

/** In-memory context for exactly one active chat/meeting session. */
function createSessionContextService({ onChange = () => {} } = {}) {
  let value = normalizeSessionContext(null);

  function publish() {
    const snapshot = structuredClone(value);
    onChange(snapshot);
    return snapshot;
  }

  return Object.freeze({
    get: () => structuredClone(value),
    set(next) {
      value = normalizeSessionContext(next);
      return publish();
    },
    clear() {
      value = normalizeSessionContext(null);
      return publish();
    },
    buildPromptBlock: () => buildSessionContextBlock(value)
  });
}

module.exports = { createSessionContextService };
