'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { CaseStore, validId, safePath, writeJSON } = require('./lib/store');
const { TOOLS, getTool, validateTarget, resolveTool } = require('./lib/tools');
const { startProcess } = require('./lib/process');
const { createZip } = require('./lib/archive');
const { captureRunEvidence, listCaseEvidence } = require('./lib/evidence');

let mainWindow, store;
let clearing = false, quitting = false, mayQuit = false;
const active = new Map();
const caseLocks = new Set();
const INDEX = path.join(__dirname, 'src', 'index.html');
const INDEX_URL = pathToFileURL(INDEX).href;

function trusted(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame || event.senderFrame.url !== INDEX_URL) {
    throw new Error('Untrusted IPC sender.');
  }
}

function handle(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => { trusted(event); return handler(event, ...args); });
}

function idleCase(id) {
  validId(id);
  if (clearing || quitting || active.has(id) || caseLocks.has(id)) throw new Error('Case is busy. Wait for the current operation to finish.');
}

async function lockedCase(id, action) {
  idleCase(id);
  caseLocks.add(id);
  try { return await action(); }
  finally { caseLocks.delete(id); }
}

function sendProgress(event, data) {
  if (!event.sender.isDestroyed() && event.sender.mainFrame.url === INDEX_URL) event.sender.send('tool-progress', data);
}

async function runTool(event, request) {
  if (!request || typeof request !== 'object') throw new Error('Invalid run request.');
  const { tool, options = {} } = request;
  const config = getTool(tool);
  const target = validateTarget(config.type, request.target);
  const caseId = options.caseId || `case-${randomUUID()}`;
  idleCase(caseId);
  if (active.size >= 4) throw new Error('Four tools are already running.');
  const existing = store.read(caseId);
  if (existing?.target && validateTarget(existing.type || config.type, existing.target) !== target) throw new Error('This case belongs to another target. Create a new case.');
  if (existing?.type && existing.type !== config.type) throw new Error('Selected tool does not match this case’s target type.');
  const runId = `run-${randomUUID()}`;
  const entry = { task: null, cancelRequested: false, completion: null };
  active.set(caseId, entry);
  entry.completion = (async () => {
    let runDirectory, executable, args, result;
    let evidenceWarning = null;
    let evidenceStatus = 'not-captured';
    const started = Date.now();
    try {
      store.update(caseId, { title: existing?.title || `${config.name} investigation of ${target}`,
        target, type: config.type, tool, status: 'running', started, lastRunId: runId, error: null,
        evidenceStatus: 'pending', evidenceWarning: null });
      const resolved = await resolveTool(tool);
      if (entry.cancelRequested) result = { success: false, status: 'cancelled', error: 'Stopped by user.', duration: Date.now() - started };
      else {
        const directory = store.directory(caseId);
        runDirectory = safePath(directory, runId);
        fs.mkdirSync(runDirectory, { mode: 0o700 });
        executable = resolved.executable;
        args = config.args(target, runDirectory);
        writeJSON(path.join(runDirectory, 'run.json'), { tool, target, caseId, runId, executable, args, started,
          status: 'running', evidenceStatus: 'pending', evidenceWarning: null });
        entry.task = startProcess({ executable, args, cwd: runDirectory, env: resolved.env, timeout: config.timeout,
          onProgress: data => sendProgress(event, { ...data, tool, caseId, runId }) });
        result = await entry.task.result;
      }
    } catch (error) {
      result = { success: false, status: 'failed', error: error.message, duration: Date.now() - started };
    }
    try {
      const finished = Date.now();
      if (runDirectory) {
        const runMetadata = { tool, target, caseId, runId,
          executable, args, started, finished, status: result.status,
          exitCode: result.exitCode ?? null, signal: result.signal ?? null, duration: result.duration, error: result.error };
        writeJSON(safePath(runDirectory, 'run.json'), { ...runMetadata, evidenceStatus: 'pending', evidenceWarning: null });
        try {
          captureRunEvidence({ caseId, runId, runDirectory, tool, target, started, finished, status: result.status });
          evidenceStatus = 'captured';
        } catch (error) {
          evidenceStatus = 'failed';
          evidenceWarning = `Evidence manifest could not be captured: ${error.message}`;
        }
        writeJSON(safePath(runDirectory, 'run.json'), { ...runMetadata, evidenceStatus, evidenceWarning });
      }
      store.update(caseId, { status: result.status, finished, duration: result.duration,
        exitCode: result.exitCode ?? null, error: result.error || null, evidenceStatus, evidenceWarning });
    } catch (error) {
      result = { ...result, success: false, status: 'failed', error: `${result.error || ''} Could not save case state: ${error.message}`.trim() };
    } finally {
      if (active.get(caseId) === entry) active.delete(caseId);
    }
    return { ...result, caseId, runId, outputDirectory: runDirectory || null, evidenceStatus, evidenceWarning };
  })();
  return entry.completion;
}

function destinationOutsideResults(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('Invalid save destination.');
  const parent = fs.realpathSync(path.dirname(file));
  const destination = path.join(parent, path.basename(file));
  const relative = path.relative(fs.realpathSync(store.root), destination);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('Choose a destination outside the application’s results directory.');
  }
  try {
    const stat = fs.lstatSync(destination);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Destination must be a regular file.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return destination;
}

async function saveArtifact(options, writer) {
  const choice = await dialog.showSaveDialog(mainWindow, { ...options, properties: ['showOverwriteConfirmation', 'createDirectory'] });
  if (choice.canceled || !choice.filePath) return { success: false, canceled: true };
  const destination = destinationOutsideResults(choice.filePath);
  const temporary = path.join(path.dirname(destination), `.osint-${randomUUID()}.tmp`);
  try {
    await writer(temporary);
    fs.renameSync(temporary, destination);
    return { success: true, filePath: destination };
  } finally { fs.rmSync(temporary, { force: true }); }
}

async function openDirectory(directory) {
  if (!fs.existsSync(directory)) throw new Error('Folder not found.');
  const error = await shell.openPath(directory);
  if (error) throw new Error(error);
  return { success: true };
}

function registerIPC() {
  handle('check-tool', async (_event, id) => {
    getTool(id);
    try { await resolveTool(id); return true; } catch { return false; }
  });
  handle('get-tools', () => Object.entries(TOOLS).map(([id, definition]) => ({ id,
    name: definition.name, type: definition.type, description: definition.description, tags: definition.tags, risk: definition.risk })));
  handle('run-tool', runTool);
  handle('kill-tool', async (_event, request) => {
    const caseId = validId(request?.caseId);
    const entry = active.get(caseId);
    if (!entry) return { success: false, error: 'No active process.' };
    entry.cancelRequested = true;
    if (entry.task) await entry.task.cancel();
    await entry.completion;
    return { success: true };
  });
  handle('get-all-cases', () => store.list());
  handle('get-results', (_event, id) => store.files(validId(id)));
  handle('get-case-evidence', (_event, id) => listCaseEvidence(store.directory(validId(id)), id));
  handle('save-case-meta', (_event, request) => {
    const caseId = validId(request?.caseId);
    idleCase(caseId);
    const meta = request.meta;
    if (meta?.type && meta?.target) validateTarget(meta.type, meta.target);
    return store.saveUserMetadata(caseId, meta);
  });
  handle('delete-case', (_event, id) => lockedCase(id, async () => {
    const response = await dialog.showMessageBox(mainWindow, { type: 'warning', title: 'Delete case',
      message: `Delete ${store.read(id)?.title || id} and all its results?`, buttons: ['Cancel', 'Delete'], defaultId: 0, cancelId: 0, noLink: true });
    if (response.response !== 1) return { success: false, canceled: true };
    store.delete(id);
    return { success: true };
  }));
  handle('clear-all-results', async () => {
    if (clearing || quitting || active.size || caseLocks.size) throw new Error('Stop running tools and finish case operations before clearing results.');
    clearing = true;
    try {
      const response = await dialog.showMessageBox(mainWindow, { type: 'warning', title: 'Clear all results',
        message: 'Delete ALL cases and results? This cannot be undone.', buttons: ['Cancel', 'Delete All'], defaultId: 0, cancelId: 0, noLink: true });
      if (response.response !== 1) return { success: false, canceled: true };
      safePath(store.root);
      fs.rmSync(store.root, { recursive: true, force: true });
      fs.mkdirSync(store.root, { mode: 0o700 });
      return { success: true };
    } finally { clearing = false; }
  });
  handle('open-results-folder', (_event, id) => openDirectory(store.directory(validId(id))));
  handle('open-results-root', () => openDirectory(safePath(store.root)));
  handle('save-console', (_event, text) => {
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 2 * 1024 * 1024) throw new Error('Console text is too large.');
    return saveArtifact({ defaultPath: `console-${Date.now()}.txt`, filters: [{ name: 'Text', extensions: ['txt'] }] },
      file => fs.promises.writeFile(file, text, { flag: 'wx', mode: 0o600 }));
  });
  handle('copy-result-path', (_event, request) => {
    clipboard.writeText(store.file(validId(request?.caseId), request.name));
    return { success: true };
  });
  handle('save-result', (_event, request) => lockedCase(request?.caseId, async () => {
    const source = store.file(request.caseId, request.name);
    return saveArtifact({ defaultPath: path.basename(source) },
      file => fs.promises.copyFile(store.file(request.caseId, request.name), file, fs.constants.COPYFILE_EXCL));
  }));
  handle('export-case', (_event, request) => lockedCase(request?.caseId, () => {
    if (!store.read(request.caseId)) throw new Error('Case not found.');
    return saveArtifact({ defaultPath: `${request.caseId}.zip`, filters: [{ name: 'ZIP', extensions: ['zip'] }] },
      file => createZip(store.files(request.caseId), file));
  }));
  handle('get-app-info', () => ({ platform: process.platform, arch: process.arch, versions: process.versions,
    resultsDir: store.root, appVersion: app.getVersion() }));
}

function createWindow() {
  mainWindow = new BrowserWindow({ width: 1400, height: 900, minWidth: 1000, minHeight: 700,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
      preload: path.join(__dirname, 'preload.js') },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default', show: false, backgroundColor: '#0f172a' });
  const window = mainWindow;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => { if (mainWindow === window) mainWindow = null; });
  window.loadFile(INDEX).catch(error => dialog.showErrorBox('Unable to load application', error.message));
  if (process.argv.includes('--dev')) window.webContents.openDevTools({ mode: 'detach' });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.whenReady().then(() => {
    store = new CaseStore(path.join(app.getPath('userData'), 'results'));
    store.recover();
    registerIPC();
    createWindow();
  }).catch(error => { dialog.showErrorBox('Startup failed', error.message); app.quit(); });
  app.on('activate', () => { if (store && !mainWindow) createWindow(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', event => {
    if (mayQuit || active.size === 0) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    const entries = [...active.values()];
    Promise.all(entries.map(async entry => {
      entry.cancelRequested = true;
      if (entry.task) await entry.task.cancel();
      await entry.completion;
    })).then(() => { mayQuit = true; app.quit(); }).catch(error => {
      quitting = false;
      dialog.showErrorBox('Unable to stop a running tool', error.message);
    });
  });
}
