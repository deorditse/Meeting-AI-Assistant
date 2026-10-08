const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const { MAX_DOCUMENT_BYTES, extractDocxText, parseDocumentFile } = require('../src/resume');
const {
  MAX_CONTEXT_ITEM_CHARS,
  normalizeSessionContext,
  buildSessionContextBlock,
  extractPageText
} = require('../src/session-context');
const { createSessionContextService } = require('../src/application/session-context-service');

test('session context combines topic, notes, files and fetched links', () => {
  const block = buildSessionContextBlock({
    title: 'Интервью Backend-разработчика',
    notes: 'Отвечать с примерами на Go.',
    files: [{ id: 'f1', name: 'вакансия.md', text: 'Нужен опыт с PostgreSQL.' }],
    links: [{ id: 'l1', name: 'О компании', url: 'https://example.com', text: 'Компания делает B2B SaaS.' }]
  });
  assert.match(block, /КОНТЕКСТ ТЕКУЩЕЙ СЕССИИ/);
  assert.match(block, /Backend-разработчика/);
  assert.match(block, /вакансия\.md/);
  assert.match(block, /example\.com/);
  assert.match(block, /B2B SaaS/);
});

test('empty session context produces no prompt block', () => {
  assert.equal(buildSessionContextBlock(null), null);
  assert.equal(buildSessionContextBlock({ title: ' ', notes: '', files: [], links: [] }), null);
});

test('session context is bounded before persistence and prompting', () => {
  const normalized = normalizeSessionContext({
    notes: 'n'.repeat(20000),
    files: Array.from({ length: 20 }, (_, index) => ({ name: `f${index}`, text: 'x'.repeat(20000) }))
  });
  assert.equal(normalized.notes.length, 10000);
  assert.equal(normalized.files.length, 12);
  assert.equal(normalized.files[0].text.length, MAX_CONTEXT_ITEM_CHARS);
  assert.ok(buildSessionContextBlock(normalized).length <= 24000);
});

test('HTML extraction removes scripts and keeps visible title and text', () => {
  const result = extractPageText('<html><head><title>Документация &amp; примеры</title><style>.x{}</style></head><body><h1>API</h1><script>secret()</script><p>Первый пример</p></body></html>');
  assert.equal(result.title, 'Документация & примеры');
  assert.match(result.text, /API/);
  assert.match(result.text, /Первый пример/);
  assert.doesNotMatch(result.text, /secret/);
});

test('plain text and markdown files can be loaded as session context', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm2a-context-'));
  try {
    const txt = path.join(dir, 'notes.txt');
    const md = path.join(dir, 'example.md');
    fs.writeFileSync(txt, '\uFEFFПривет из заметок');
    fs.writeFileSync(md, '# Пример\n\nОтвет');
    assert.equal(await parseDocumentFile(txt), 'Привет из заметок');
    assert.equal(await parseDocumentFile(md), '# Пример\n\nОтвет');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('DOCX files are converted to bounded plain text without an XML DOM', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm2a-docx-'));
  const file = path.join(dir, 'example.docx');
  const zip = new JSZip();
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Первый</w:t></w:r><w:tab/><w:r><w:t>пример &amp; тест</w:t></w:r></w:p><w:p><w:r><w:t>Вторая строка</w:t></w:r><w:br/><w:r><w:t>после переноса</w:t></w:r></w:p></w:body></w:document>');
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));
  try {
    assert.equal(await parseDocumentFile(file), 'Первый\tпример & тест\nВторая строка\nпосле переноса');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('document parsing rejects oversized files before reading them into memory', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm2a-document-limit-'));
  const file = path.join(dir, 'large.txt');
  fs.writeFileSync(file, Buffer.alloc(1));
  fs.truncateSync(file, MAX_DOCUMENT_BYTES + 1);
  try {
    await assert.rejects(() => parseDocumentFile(file), /Файл слишком большой/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('DOCX XML extraction decodes numeric entities', () => {
  assert.equal(extractDocxText('<w:p><w:t>&#1052;&#x32;A</w:t></w:p>'), 'М2A');
});

test('application service owns an isolated in-memory session and publishes snapshots', () => {
  const changes = [];
  const service = createSessionContextService({ onChange: (value) => changes.push(value) });
  const saved = service.set({ title: 'Текущий чат', notes: 'Только эта сессия' });
  saved.title = 'Попытка изменить снимок';

  assert.equal(service.get().title, 'Текущий чат');
  assert.match(service.buildPromptBlock(), /Только эта сессия/);
  assert.equal(changes.length, 1);
  assert.deepEqual(service.clear(), { title: '', notes: '', files: [], links: [] });
  assert.equal(service.buildPromptBlock(), null);
});
