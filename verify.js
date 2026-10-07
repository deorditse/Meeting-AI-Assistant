const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'frontend', 'src', 'pages', 'MeetingAssistant', 'model', 'mountMeetingAssistant.js'), 'utf8');

const defPos = src.indexOf('function getOrCreateInterimEl');
const handlerPos = src.indexOf("m2a.on('stt:interim'");
const r1 = defPos !== -1 && handlerPos !== -1 && defPos < handlerPos;
console.log('1. interim renderer defined before stt:interim:', r1);

const clearDefPos = src.indexOf('function clearTranscriptInterim');
const finalHandlerPos = src.indexOf("m2a.on('stt:final'");
const r2 = clearDefPos !== -1 && finalHandlerPos !== -1 && clearDefPos < finalHandlerPos;
console.log('2. clearTranscriptInterim defined before stt:final:', r2);

const toastDefPos = src.indexOf('function showToast');
const clearBtnHandlerPos = src.indexOf("clearTranscriptBtn.addEventListener");
const r3 = toastDefPos !== -1 && clearBtnHandlerPos !== -1 && toastDefPos < clearBtnHandlerPos;
console.log('3. showToast defined before clear btn addEventListener:', r3, '(toast:', toastDefPos, 'handler:', clearBtnHandlerPos, ')');

const llmStartIdx = src.indexOf("m2a.on('llm:start'");
const llmTokenIdx = src.indexOf("m2a.on('llm:token'");
const llmStartBlock = src.substring(llmStartIdx, llmTokenIdx);
const r4 = !llmStartBlock.includes('clearMessages()');
console.log('4. llm:start does NOT call clearMessages():', r4);

const tabHandlerPos = src.indexOf('if (!(await saveSettings())) return;');
const tabClickPos = src.indexOf("querySelectorAll('.s-tab').forEach");
const r5 = tabHandlerPos > 0 && tabHandlerPos > tabClickPos;
console.log('5. tab handler calls saveSettings:', r5);

const allPass = r1 && r2 && r3 && r4 && r5;
console.log('\nAll checks passed:', allPass);
process.exit(allPass ? 0 : 1);
