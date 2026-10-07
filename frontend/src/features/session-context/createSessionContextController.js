const EMPTY_CONTEXT = Object.freeze({ title: '', notes: '', files: [], links: [] });

export function createSessionContextController({ bridge, select }) {
  let context = { ...EMPTY_CONTEXT, files: [], links: [] };
  const scrim = select('#context-scrim');

  function setStatus(message, error = false) {
    const status = select('#session-context-status');
    if (!status) return;
    status.textContent = message || '';
    status.classList.toggle('error', !!error);
  }

  function draft() {
    context.title = (select('#session-context-title')?.value || '').trim();
    context.notes = (select('#session-context-notes')?.value || '').trim();
    if (!Array.isArray(context.files)) context.files = [];
    if (!Array.isArray(context.links)) context.links = [];
    return context;
  }

  function render() {
    select('#session-context-title').value = context.title || '';
    select('#session-context-notes').value = context.notes || '';
    const renderList = (selector, items, kind) => {
      const host = select(selector);
      host.innerHTML = '';
      for (const item of items || []) {
        const row = document.createElement('div');
        row.className = 'context-source';
        const label = document.createElement('span');
        label.className = 'context-source-label';
        label.textContent = item.name || item.url || 'Материал';
        label.title = item.url || item.name || '';
        const size = document.createElement('span');
        size.className = 'context-source-size';
        const count = String(item.text || '').length;
        size.textContent = count >= 1000 ? `${(count / 1000).toFixed(1)} тыс. знаков` : `${count} знаков`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'context-source-remove';
        remove.setAttribute('aria-label', 'Удалить материал');
        remove.textContent = '×';
        remove.addEventListener('click', async () => {
          const next = draft();
          next[kind] = next[kind].filter((candidate) => candidate.id !== item.id);
          context = await bridge.sessionContextSet(next);
          render();
        });
        row.append(label, size, remove);
        host.append(row);
      }
    };
    renderList('#session-context-files', context.files, 'files');
    renderList('#session-context-links', context.links, 'links');
  }

  async function refresh() {
    try {
      context = await bridge.sessionContextGet();
      render();
    } catch (error) {
      setStatus(error?.message || String(error), true);
    }
  }

  async function open() {
    await refresh();
    scrim.classList.remove('hidden');
  }

  async function close() {
    try {
      context = await bridge.sessionContextSet(draft());
      scrim.classList.add('hidden');
    } catch (error) {
      setStatus(error?.message || String(error), true);
    }
  }

  select('#session-context-add-files').addEventListener('click', async () => {
    const button = select('#session-context-add-files');
    button.disabled = true;
    setStatus('Читаю файлы…');
    try {
      const result = await bridge.pickSessionContextFiles();
      if (result?.error) throw new Error(result.error);
      if (!result || result.canceled) return setStatus('');
      const next = draft();
      const additions = (result.files || []).slice(0, Math.max(0, 12 - next.files.length)).map((file) => ({
        id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        text: file.text
      }));
      next.files.push(...additions);
      context = await bridge.sessionContextSet(next);
      render();
      setStatus(additions.length ? `Добавлено файлов: ${additions.length}.` : 'Не найден текст для добавления.');
    } catch (error) {
      setStatus(error?.message || String(error), true);
    } finally {
      button.disabled = false;
    }
  });

  async function addUrl() {
    const input = select('#session-context-url');
    const button = select('#session-context-add-url');
    const value = input.value.trim();
    if (!value) return input.focus();
    button.disabled = true;
    setStatus('Загружаю материал по ссылке…');
    try {
      const result = await bridge.fetchSessionContextUrl(value);
      if (!result || result.error) throw new Error(result?.error || 'Не удалось загрузить ссылку.');
      const next = draft();
      if (next.links.length >= 12) throw new Error('Можно добавить не больше 12 ссылок.');
      next.links.push({ id: `link-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, url: result.url, name: result.name, text: result.text });
      context = await bridge.sessionContextSet(next);
      input.value = '';
      render();
      setStatus('Материал по ссылке добавлен.');
    } catch (error) {
      setStatus(error?.message || String(error), true);
    } finally {
      button.disabled = false;
    }
  }

  select('#session-context-add-url').addEventListener('click', () => { void addUrl(); });
  select('#session-context-url').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); void addUrl(); }
  });
  select('#session-context-clear').addEventListener('click', async () => {
    context = await bridge.sessionContextClear();
    select('#session-context-url').value = '';
    render();
    setStatus('Контекст текущей сессии очищен.');
  });
  select('#session-context-close').addEventListener('click', () => { void close(); });
  scrim.addEventListener('click', (event) => { if (event.target === scrim) void close(); });
  bridge.on('session-context:changed', (next) => {
    context = next || { ...EMPTY_CONTEXT, files: [], links: [] };
    if (!scrim.classList.contains('hidden')) render();
  });

  return Object.freeze({ open, close, refresh });
}
