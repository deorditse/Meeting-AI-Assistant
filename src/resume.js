// Extracts plain text from documents used as session context.
// PDF files need a text layer; image-only documents are intentionally not OCRed.
const fs = require('fs/promises');
const path = require('path');
const JSZip = require('jszip');

const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const MAX_DOCX_XML_BYTES = 12 * 1024 * 1024;

function decodeXmlEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_match, entity) => {
    if (entity[0] !== '#') return named[entity.toLowerCase()] || '';
    const hexadecimal = entity[1].toLowerCase() === 'x';
    const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : '';
  });
}

function extractDocxText(xml) {
  return decodeXmlEntities(String(xml || '')
    .replace(/<(?:\w+:)?tab\b[^>]*\/?\s*>/gi, '\t')
    .replace(/<(?:\w+:)?(?:br|cr)\b[^>]*\/?\s*>/gi, '\n')
    .replace(/<\/(?:\w+:)?(?:p|tr)>/gi, '\n')
    .replace(/<\/(?:\w+:)?tc>/gi, '\t')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function readDocument(filePath) {
  const stat = await fs.stat(filePath);
  if (stat.size > MAX_DOCUMENT_BYTES) {
    throw new Error(`Файл слишком большой: максимум ${MAX_DOCUMENT_BYTES / 1024 / 1024} МБ.`);
  }
  return fs.readFile(filePath);
}

async function parseDocumentFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const buf = await readDocument(filePath);
  if (ext === '.pdf') {
    const pdfParse = require('pdf-parse');
    const res = await pdfParse(buf);
    return (res.text || '').trim();
  }
  if (ext === '.docx') {
    const archive = await JSZip.loadAsync(buf);
    const document = archive.file('word/document.xml');
    if (!document) throw new Error('DOCX не содержит основного документа.');
    const declaredSize = Number(document._data && document._data.uncompressedSize) || 0;
    if (declaredSize > MAX_DOCX_XML_BYTES) throw new Error('Текст внутри DOCX слишком большой.');
    const xml = await document.async('string');
    if (Buffer.byteLength(xml, 'utf8') > MAX_DOCX_XML_BYTES) throw new Error('Текст внутри DOCX слишком большой.');
    return extractDocxText(xml);
  }
  if (['.txt', '.md', '.markdown', '.csv', '.json', '.html', '.htm'].includes(ext)) {
    return buf.toString('utf8').replace(/^\uFEFF/, '').trim();
  }
  throw new Error('Неподдерживаемый тип файла: ' + (ext || '(без расширения)') + '. Используйте PDF, DOCX, TXT, MD, CSV, JSON или HTML.');
}

module.exports = { MAX_DOCUMENT_BYTES, extractDocxText, parseDocumentFile };
