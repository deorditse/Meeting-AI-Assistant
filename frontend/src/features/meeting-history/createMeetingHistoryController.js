function asList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

function formatDate(timestamp) {
  if (!timestamp) return 'Дата не указана';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp));
}

export function createMeetingHistoryController({ bridge, select }) {
  const scrim = select('#meetings-scrim');
  const listHost = select('#meetings-list');
  const detailHost = select('#meeting-detail');
  const search = select('#meetings-search');
  let selectedId = null;
  let searchTimer = null;

  function setEmpty(message) {
    listHost.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'meetings-empty';
    empty.textContent = message;
    listHost.append(empty);
  }

  function section(title, values, className = '') {
    const items = asList(values).map((value) => String(value || '').trim()).filter(Boolean);
    if (!items.length) return null;
    const block = document.createElement('section');
    block.className = `meeting-section ${className}`.trim();
    const heading = document.createElement('h3');
    heading.textContent = title;
    block.append(heading);
    if (items.length === 1) {
      const paragraph = document.createElement('p');
      paragraph.textContent = items[0];
      block.append(paragraph);
    } else {
      const list = document.createElement('ul');
      for (const item of items) {
        const row = document.createElement('li');
        row.textContent = item;
        list.append(row);
      }
      block.append(list);
    }
    return block;
  }

  function renderDetail(meeting) {
    detailHost.innerHTML = '';
    if (!meeting) {
      detailHost.innerHTML = '<div class="meetings-empty">Выберите сессию слева.</div>';
      return;
    }
    const header = document.createElement('div');
    header.className = 'meeting-detail-head';
    const heading = document.createElement('div');
    const title = document.createElement('h2');
    title.textContent = meeting.title || 'Сессия без названия';
    const meta = document.createElement('div');
    meta.className = 'meeting-meta';
    meta.textContent = `${formatDate(meeting.startedAt)} · ${meeting.transcript?.length || 0} реплик · ${meeting.chatHistory?.length || 0} ответов AI${meeting.active ? ' · идёт сейчас' : ''}`;
    heading.append(title, meta);
    const actions = document.createElement('div');
    actions.className = 'meeting-detail-actions';
    const resume = document.createElement('button');
    resume.type = 'button';
    resume.className = 's-action primary';
    resume.textContent = meeting.current ? 'Продолжить работу' : 'Продолжить сессию';
    resume.title = meeting.current ? 'Вернуться к этой сессии' : 'Открыть расшифровку и продолжить эту сессию';
    resume.addEventListener('click', async () => {
      const result = await bridge.meetingsResume(meeting.id);
      if (!result?.ok) return window.alert(result?.message || 'Не удалось продолжить сессию.');
      close();
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 's-action danger';
    remove.textContent = 'Удалить';
    remove.disabled = !!meeting.active;
    remove.title = meeting.active ? 'Сначала завершите текущую сессию' : 'Удалить сохранённую сессию';
    remove.addEventListener('click', async () => {
      if (!window.confirm('Удалить эту сессию и её расшифровку?')) return;
      const result = await bridge.meetingsRemove(meeting.id);
      if (!result?.ok) return window.alert(result?.message || 'Не удалось удалить сессию.');
      selectedId = null;
      await refresh();
    });
    actions.append(resume, remove);
    header.append(heading, actions);
    detailHost.append(header);

    for (const block of [
      section('Краткое содержание', meeting.summary),
      section('Ключевые моменты', meeting.keyPoints),
      section('Решения', meeting.decisions),
      section('Задачи', meeting.actionItems),
      section('Продолжение', meeting.followUp)
    ]) if (block) detailHost.append(block);

    if (meeting.chatHistory?.length) {
      const chatSection = document.createElement('section');
      chatSection.className = 'meeting-section meeting-chat-history';
      const chatTitle = document.createElement('h3');
      chatTitle.textContent = 'История чата';
      chatSection.append(chatTitle);
      for (const message of meeting.chatHistory) {
        const row = document.createElement('div');
        row.className = 'meeting-turn meeting-chat-turn';
        const question = document.createElement('span');
        question.textContent = message.userBubble || 'Запрос';
        const answer = document.createElement('p');
        answer.textContent = message.assistantText || (message.cancelled ? 'Ответ остановлен.' : '');
        row.append(question, answer);
        chatSection.append(row);
      }
      detailHost.append(chatSection);
    }

    const transcriptSection = document.createElement('section');
    transcriptSection.className = 'meeting-section meeting-transcript';
    const transcriptTitle = document.createElement('h3');
    transcriptTitle.textContent = 'Расшифровка';
    transcriptSection.append(transcriptTitle);
    if (!meeting.transcript?.length) {
      const empty = document.createElement('p');
      empty.className = 'meetings-empty';
      empty.textContent = 'В этой сессии нет распознанных реплик.';
      transcriptSection.append(empty);
    } else {
      for (const turn of meeting.transcript) {
        const row = document.createElement('div');
        row.className = `meeting-turn meeting-turn-${turn.channel === 'them' ? 'them' : 'you'}`;
        const label = document.createElement('span');
        label.textContent = turn.channel === 'them' ? 'Собеседник' : 'Вы';
        const text = document.createElement('p');
        text.textContent = turn.text || '';
        row.append(label, text);
        transcriptSection.append(row);
      }
    }
    detailHost.append(transcriptSection);
  }

  async function selectMeeting(id) {
    selectedId = id;
    listHost.querySelectorAll('.meeting-list-item').forEach((item) => item.classList.toggle('selected', item.dataset.id === id));
    renderDetail(await bridge.meetingsGet(id));
  }

  async function refresh() {
    try {
      const meetings = await bridge.meetingsList(search.value);
      if (!meetings.length) {
        setEmpty(search.value.trim() ? 'По этому запросу сессии не найдены.' : 'Сохранённых сессий пока нет.');
        renderDetail(null);
        return;
      }
      listHost.innerHTML = '';
      for (const meeting of meetings) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'meeting-list-item';
        button.dataset.id = meeting.id;
        const title = document.createElement('strong');
        title.textContent = meeting.title || 'Сессия без названия';
        const meta = document.createElement('span');
        meta.textContent = `${formatDate(meeting.startedAt)} · ${meeting.transcript?.length || 0} реплик · ${meeting.chatHistory?.length || 0} ответов AI${meeting.active ? ' · активна' : ''}`;
        button.append(title, meta);
        button.addEventListener('click', () => { void selectMeeting(meeting.id); });
        listHost.append(button);
      }
      const nextId = meetings.some((meeting) => meeting.id === selectedId) ? selectedId : meetings[0].id;
      await selectMeeting(nextId);
    } catch (error) {
      setEmpty(error?.message || 'Не удалось загрузить историю сессий.');
      renderDetail(null);
    }
  }

  async function open() {
    scrim.classList.remove('hidden');
    await refresh();
    search.focus();
  }

  function close() { scrim.classList.add('hidden'); }

  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { void refresh(); }, 180);
  });
  select('#meetings-close').addEventListener('click', close);
  scrim.addEventListener('click', (event) => { if (event.target === scrim) close(); });

  return Object.freeze({ open, close, refresh });
}
