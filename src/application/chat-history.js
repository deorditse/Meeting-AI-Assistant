const MAX_CHAT_MESSAGES = 50;
const MAX_TEXT_CHARS = 50000;
const MAX_THUMBNAIL_CHARS = 350000;

function cleanText(value, limit = MAX_TEXT_CHARS) {
  return String(value || '').slice(0, limit);
}

function normalizeChatMessage(value) {
  const source = value && typeof value === 'object' ? value : {};
  const thumbnail = String(source.userImageDataUrl || '');
  return {
    id: cleanText(source.id, 120),
    ts: Number(source.ts) || Date.now(),
    mode: cleanText(source.mode, 40),
    userBubble: cleanText(source.userBubble, 4000),
    assistantText: cleanText(source.assistantText),
    small: Boolean(source.small),
    category: cleanText(source.category, 80),
    cancelled: Boolean(source.cancelled),
    userImageDataUrl: /^data:image\/(?:jpeg|png|webp);base64,/.test(thumbnail) && thumbnail.length <= MAX_THUMBNAIL_CHARS
      ? thumbnail
      : ''
  };
}

function appendChatMessage(history, message, max = MAX_CHAT_MESSAGES) {
  const current = Array.isArray(history) ? history.map(normalizeChatMessage) : [];
  const next = normalizeChatMessage(message);
  return [...current.filter((item) => item.id !== next.id), next].slice(-max);
}

module.exports = { MAX_CHAT_MESSAGES, normalizeChatMessage, appendChatMessage };
