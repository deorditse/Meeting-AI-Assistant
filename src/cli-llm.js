const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI_TIMEOUT_MS = 115000;
const MAX_CAPTURE_BYTES = 1024 * 1024;

function executableCandidates(name) {
  const home = os.homedir();
  const candidates = (process.env.PATH || '').split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, name));
  candidates.push(path.join(home, '.local', 'bin', name));
  candidates.push(path.join(home, '.claude', 'local', name));
  for (const prefix of ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']) candidates.push(path.join(prefix, name));
  const nvmRoot = path.join(home, '.nvm', 'versions', 'node');
  try {
    for (const version of fs.readdirSync(nvmRoot).sort().reverse()) candidates.push(path.join(nvmRoot, version, 'bin', name));
  } catch { /* nvm is optional */ }
  return [...new Set(candidates)];
}

function findExecutable(name) {
  for (const candidate of executableCandidates(name)) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch { /* keep looking */ }
  }
  return null;
}

function subscriptionEnv(provider) {
  const env = { ...process.env };
  if (provider === 'codex') {
    // An OPENAI_API_KEY would make Codex use API billing instead of its saved
    // ChatGPT login. Authentication itself stays in Codex's own local store.
    delete env.OPENAI_API_KEY;
    delete env.OPENAI_BASE_URL;
  } else {
    // Force Claude Code to use its saved claude.ai login rather than an API or
    // a third-party cloud credential inherited from the parent process.
    for (const key of [
      'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN',
      'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'
    ]) delete env[key];
  }
  return env;
}

function abortError() {
  const error = new Error('Запрос отменён.');
  error.name = 'AbortError';
  return error;
}

function runChild(command, args, { cwd, input = '', env, timeoutMs = CLI_TIMEOUT_MS, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(abortError());
    const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const append = (current, chunk) => (current + chunk.toString('utf8')).slice(-MAX_CAPTURE_BYTES);
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(new Error(`Локальный CLI не ответил за ${Math.round(timeoutMs / 1000)} секунд.`));
    }, timeoutMs);
    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve(result);
    }
    function onAbort() {
      child.kill('SIGTERM');
      finish(abortError());
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    child.on('error', (error) => finish(error));
    child.on('close', (code, signal) => finish(null, { code, signal, stdout, stderr }));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

function promptFromTurns(system, turns, screenshotPath) {
  const transcript = (turns || []).map((turn) => `${turn.role === 'assistant' ? 'Ассистент' : 'Пользователь'}:\n${turn.text || ''}`).join('\n\n');
  const imageInstruction = screenshotPath
    ? `\n\nК запросу приложен снимок экрана: ${screenshotPath}. Проанализируй его как изображение и используй только для ответа на запрос.`
    : '';
  return `${system || ''}\n\n${transcript}${imageInstruction}`.trim();
}

function writeScreenshot(tempDir, imageDataUrl) {
  if (!imageDataUrl) return null;
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(imageDataUrl);
  if (!match) return null;
  const extension = match[1] === 'jpeg' ? 'jpg' : match[1];
  const target = path.join(tempDir, `screen.${extension}`);
  fs.writeFileSync(target, Buffer.from(match[2], 'base64'), { mode: 0o600 });
  return target;
}

async function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm2a-cli-'));
  try { return await fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function cliFailure(label, result) {
  const detail = (result.stderr || result.stdout || '').trim().split('\n').slice(-4).join(' ');
  if (/credit balance is too low/i.test(detail)) {
    return new Error(`${label}: закончился доступный лимит подписки или баланс аккаунта.`);
  }
  return new Error(`${label} завершился с ошибкой${result.code == null ? '' : ` (код ${result.code})`}.${detail ? ` ${detail}` : ''}`);
}

function isTransientCodexRoutingFailure(result) {
  const output = `${result.stderr || ''}\n${result.stdout || ''}`;
  return /workspace routing discovery failed|reconnecting\.\.\./i.test(output);
}

function waitForRetry(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(abortError());
    const finish = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    function onAbort() {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(abortError());
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function streamCodexSubscription({ system, turns, imageDataUrl, model, onToken = () => {}, signal }) {
  const command = findExecutable('codex');
  if (!command) throw new Error('Codex CLI не найден. Установите Codex и выполните codex login.');
  return withTempDir(async (dir) => {
    const outputFile = path.join(dir, 'answer.txt');
    const screenshotPath = writeScreenshot(dir, imageDataUrl);
    const args = ['exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--ignore-rules', '--ignore-user-config', '--color', 'never', '--output-last-message', outputFile];
    if (model) args.push('--model', model);
    if (screenshotPath) args.push('-i', screenshotPath);
    args.push('-');
    const input = promptFromTurns(system, turns);
    let result;
    for (let attempt = 0; attempt < 3; attempt++) {
      result = await runChild(command, args, { cwd: dir, input, env: subscriptionEnv('codex'), signal });
      if (result.code === 0 || !isTransientCodexRoutingFailure(result) || attempt === 2) break;
      // ChatGPT workspace routing can briefly fail before a session is assigned.
      // A bounded retry fixes that transient without repeating successful requests.
      await waitForRetry(700 * (attempt + 1), signal);
    }
    if (result.code !== 0) throw cliFailure('Codex CLI', result);
    const answer = (fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8') : result.stdout).trim();
    if (!answer) throw new Error('Codex CLI вернул пустой ответ.');
    onToken(answer);
    return answer;
  });
}

async function streamClaudeSubscription({ system, turns, imageDataUrl, model, onToken = () => {}, signal }) {
  const command = findExecutable('claude');
  if (!command) throw new Error('Claude Code CLI не найден. Установите Claude Code и выполните claude login.');
  return withTempDir(async (dir) => {
    const screenshotPath = writeScreenshot(dir, imageDataUrl);
    const args = ['-p', '--output-format', 'text', '--no-session-persistence', '--disable-slash-commands', '--permission-mode', 'dontAsk', '--tools', screenshotPath ? 'Read' : ''];
    if (model) args.push('--model', model);
    const result = await runChild(command, args, { cwd: dir, input: promptFromTurns(system || 'Отвечай по-русски.', turns, screenshotPath), env: subscriptionEnv('claudeCode'), signal });
    if (result.code !== 0) throw cliFailure('Claude Code', result);
    const answer = result.stdout.trim();
    if (!answer) throw new Error('Claude Code вернул пустой ответ.');
    onToken(answer);
    return answer;
  });
}

async function statusFor(name, args, provider, parser) {
  const command = findExecutable(name);
  if (!command) return { installed: false, loggedIn: false };
  try {
    const result = await runChild(command, args, { env: subscriptionEnv(provider), timeoutMs: 10000 });
    return { installed: true, loggedIn: result.code === 0 && parser(result) };
  } catch {
    return { installed: true, loggedIn: false };
  }
}

async function getCliProviderStatus() {
  const [codex, claudeCode] = await Promise.all([
    statusFor('codex', ['login', 'status'], 'codex', (result) => /logged in using chatgpt/i.test(`${result.stdout}\n${result.stderr}`)),
    statusFor('claude', ['auth', 'status'], 'claudeCode', (result) => {
      try {
        const value = JSON.parse(result.stdout);
        return value.loggedIn === true && value.authMethod === 'claude.ai';
      } catch { return false; }
    })
  ]);
  return { codex, claudeCode };
}

module.exports = {
  findExecutable,
  getCliProviderStatus,
  runChild,
  streamCodexSubscription,
  streamClaudeSubscription
};
