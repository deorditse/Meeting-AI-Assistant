// Extracts plain text from documents used as profile or session context.
// PDF files need a text layer; image-only documents are intentionally not OCRed.
const fs = require('fs');
const path = require('path');

async function parseDocumentFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const buf = fs.readFileSync(filePath);
  if (ext === '.pdf') {
    const pdfParse = require('pdf-parse');
    const res = await pdfParse(buf);
    return (res.text || '').trim();
  }
  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const res = await mammoth.extractRawText({ buffer: buf });
    return (res.value || '').trim();
  }
  if (['.txt', '.md', '.markdown', '.csv', '.json', '.html', '.htm'].includes(ext)) {
    return buf.toString('utf8').replace(/^\uFEFF/, '').trim();
  }
  throw new Error('Неподдерживаемый тип файла: ' + (ext || '(без расширения)') + '. Используйте PDF, DOCX, TXT, MD, CSV, JSON или HTML.');
}

module.exports = { parseDocumentFile };
