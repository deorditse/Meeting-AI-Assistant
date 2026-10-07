const path = require('path');
const { execFile } = require('child_process');
const { locateWhisperRuntime } = require('../whisper-runtime');
const { resolveCMakeExecutable } = require('../infrastructure/local-toolchain');

function runProcess(executable, args, options) {
  return new Promise((resolve, reject) => {
    execFile(executable, args, options, (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      const details = String(stderr || stdout || error.message).trim().split('\n').pop();
      reject(new Error(details || error.message));
    });
  });
}

function createWhisperRuntimeService({ app, resourcesPath, environment = process.env, platform = process.platform, architecture = process.arch }) {
  let preparation = null;

  function locate() {
    return locateWhisperRuntime({
      isPackaged: app.isPackaged,
      resourcesPath,
      appPath: app.getAppPath(),
      userDataPath: app.getPath('userData'),
      platform,
      architecture,
      environment
    });
  }

  function prepare() {
    if (preparation) return preparation;
    preparation = (async () => {
      if (platform === 'darwin') {
        const cmakeExecutable = resolveCMakeExecutable(environment);
        if (!cmakeExecutable) {
          return {
            ok: false,
            code: 'CMAKE_MISSING',
            message: 'Для сборки движка whisper.cpp на macOS нужен CMake. Установите его командой «brew install cmake», затем снова нажмите «Подготовить движок».'
          };
        }
        environment = { ...environment, M2A_CMAKE_PATH: cmakeExecutable };
      }

      const userDataPath = app.getPath('userData');
      const outputDirectory = path.join(userDataPath, 'whisper-runtime');
      const args = [
        path.join(app.getAppPath(), 'scripts', 'prepare-whisper-runtime.js'),
        '--platform', platform,
        '--arch', architecture,
        '--cache-root', path.join(userDataPath, 'whisper-runtime-cache'),
        '--output', outputDirectory
      ];
      try {
        await runProcess(process.execPath, args, {
          env: { ...environment, ELECTRON_RUN_AS_NODE: '1' },
          windowsHide: true,
          maxBuffer: 1024 * 1024
        });
        const runtime = locate();
        if (!runtime.available) throw new Error('Сборка завершилась, но исполняемый файл whisper-server не найден.');
        return { ok: true, runtime, message: `Движок whisper.cpp ${runtime.version} подготовлен и готов к работе.` };
      } catch (error) {
        return { ok: false, code: 'PREPARE_FAILED', message: `Не удалось подготовить whisper.cpp: ${error.message}` };
      }
    })().finally(() => { preparation = null; });
    return preparation;
  }

  return Object.freeze({ locate, prepare });
}

module.exports = { createWhisperRuntimeService };
