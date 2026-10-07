const MAX_SESSION_CONTEXT_CHARS = 24000;
const MAX_CONTEXT_ITEM_CHARS = 8000;
const MAX_CONTEXT_ITEMS = 12;

function cleanText(value, limit = MAX_CONTEXT_ITEM_CHARS) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, limit);
}

function normalizeSessionContext(value) {
  const source = value && typeof value === 'object' ? value : {};
  const normalizeItems = (items, kind) => (Array.isArray(items) ? items : [])
    .slice(0, MAX_CONTEXT_ITEMS)
    .map((item, index) => ({
      id: cleanText(item && item.id, 100) || `${kind}-${index}`,
      name: cleanText(item && item.name, 240),
      url: kind === 'link' ? cleanText(item && item.url, 2000) : '',
      text: cleanText(item && item.text)
    }))
    .filter((item) => item.text || item.url);

  return {
    title: cleanText(source.title, 300),
    notes: cleanText(source.notes, 10000),
    files: normalizeItems(source.files, 'file'),
    links: normalizeItems(source.links, 'link')
  };
}

function buildSessionContextBlock(value, limit = MAX_SESSION_CONTEXT_CHARS) {
  const context = normalizeSessionContext(value);
  const sections = [];
  if (context.title) sections.push(`Тема и цель:\n${context.title}`);
  if (context.notes) sections.push(`Заметки, инструкции и примеры:\n${context.notes}`);
  for (const file of context.files) {
    sections.push(`Файл «${file.name || 'без названия'}»:\n${file.text}`);
  }
  for (const link of context.links) {
    const label = link.name || link.url || 'ссылка';
    sections.push(`Материал по ссылке «${label}»${link.url ? ` (${link.url})` : ''}:\n${link.text}`);
  }
  if (!sections.length) return null;
  return [
    '=== КОНТЕКСТ ТЕКУЩЕЙ СЕССИИ ===',
    'Учитывай эти материалы при ответе. Если текущий вопрос противоречит материалам, укажи противоречие; не выдумывай отсутствующие факты.',
    sections.join('\n\n')
  ].join('\n\n').slice(0, Math.max(0, limit));
}

function decodeHtmlEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(text || '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_m, entity) => {
    if (entity[0] === '#') {
      const hex = entity[1].toLowerCase() === 'x';
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : ' ';
    }
    return named[entity.toLowerCase()] || ' ';
  });
}

function extractPageText(html, limit = MAX_CONTEXT_ITEM_CHARS) {
  const source = String(html || '');
  const titleMatch = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = cleanText(decodeHtmlEntities((titleMatch && titleMatch[1]) || ''), 240);
  const text = decodeHtmlEntities(source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|article|section|main|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]{2,}/g, ' ');
  return { title, text: cleanText(text, limit) };
}

module.exports = {
  MAX_SESSION_CONTEXT_CHARS,
  MAX_CONTEXT_ITEM_CHARS,
  MAX_CONTEXT_ITEMS,
  normalizeSessionContext,
  buildSessionContextBlock,
  extractPageText
};
