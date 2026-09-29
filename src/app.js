'use strict';

const api = window.electronAPI;
const $ = id => document.getElementById(id);
let currentCaseId = null;
let isRunning = false;
let creating = false;
let catalog = [];
let installed = new Set();
let progressCleanup = null;
let dashboardRequest = 0;
let detailRequest = 0;
const CONSOLE_LIMIT = 200000;
const STATUSES = new Set(['pending', 'running', 'complete', 'failed', 'cancelled', 'timed-out', 'interrupted']);
const DEFAULT_TOOLS = { username: 'sherlock', email: 'holehe', domain: 'subfinder', phone: 'phoneinfoga' };

document.addEventListener('DOMContentLoaded', initApp);

function node(tag, className = '', text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function button(text, className, action) {
  const element = node('button', className, text);
  element.type = 'button';
  element.addEventListener('click', () => Promise.resolve().then(action).catch(reportError));
  return element;
}

function reportError(error) {
  const message = error?.message || String(error);
  appendConsole(`\n[${new Date().toLocaleTimeString()}] ${message}\n`);
  alert(message);
}

function bind(id, action) {
  $(id)?.addEventListener('click', () => Promise.resolve().then(action).catch(reportError));
}

async function initApp() {
  setupBranding();
  if (!api) { $('outputText').textContent = 'Start this application with Electron: npm start'; return; }
  setupNav();
  setupModals();
  bindButtons();
  document.querySelectorAll('.module-card-active').forEach(card => card.addEventListener('click', () => {
    void openModule(card).catch(reportError);
  }));
  $('runBtn').disabled = true;
  $('saveCaseBtn').disabled = true;
  try {
    catalog = await api.getTools();
    await Promise.all([loadAppInfo(), checkAllTools(), loadDashboard()]);
    loadTools();
    $('runBtn').disabled = false;
    $('saveCaseBtn').disabled = false;
  } catch (error) { reportError(error); }
}

function setupBranding() {
  document.querySelectorAll('.brand-shell').forEach(image => {
    image.addEventListener('error', () => { image.hidden = true; });
    image.addEventListener('load', () => { image.hidden = false; });
    // A local image can finish loading before DOMContentLoaded fires.
    if (image.complete && image.naturalWidth === 0) image.hidden = true;
  });
}

async function openModule(card) {
  const view = card.dataset.go;
  if (view === 'new-case') {
    createNewCase(card.dataset.type);
    return;
  }
  const startsSearch = view === 'runner' && card.dataset.tool;
  if (startsSearch && !isRunning && !creating) {
    // A new pathway must not reuse another search's target or case.
    currentCaseId = null;
    $('runTarget').value = '';
    $('runCaseId').value = '';
    $('runTool').value = card.dataset.tool;
    $('outputText').textContent = 'Enter a username and click "Execute Tool" to start a new investigation.\n';
  }
  await showView(view);
  if (startsSearch && !isRunning && !creating) $('runTarget').focus();
}

function bindButtons() {
  ['quickInvestigationBtn', 'quickInvestigationBtn2', 'createNewCaseBtn'].forEach(id => bind(id, createNewCase));
  ['checkAllToolsBtn2', 'checkAllToolsBtnSettings'].forEach(id => bind(id, checkAllTools));
  bind('viewCasesBtn', () => showView('investigations'));
  bind('refreshDashboardBtn', loadDashboard);
  bind('loadCasesBtn', loadCases);
  bind('runBtn', runTool);
  bind('killBtn', killTool);
  bind('clearConsoleBtn', () => { $('outputText').textContent = 'Cleared.\n'; });
  bind('saveConsoleBtn', () => api.saveConsole($('outputText').textContent));
  bind('openResultsFolderBtn', () => currentCaseId ? api.openResultsFolder(currentCaseId) : undefined);
  bind('openResultsRootBtn', () => api.openResultsRoot());
  bind('clearAllDataBtn', clearAllData);
  bind('closeModalBtn', closeModal);
  bind('saveCaseBtn', saveCase);
  bind('closeDetailModalBtn', closeDetailModal);
}

function setupNav() {
  document.querySelectorAll('.nav-item').forEach(item => item.addEventListener('click', event => {
    event.preventDefault();
    void showView(item.dataset.view).catch(reportError);
  }));
}

async function showView(view) {
  if (!['dashboard', 'investigations', 'tools', 'runner', 'settings'].includes(view)) return;
  document.querySelectorAll('.view').forEach(element => element.classList.toggle('active', element.id === `${view}-view`));
  document.querySelectorAll('.nav-item').forEach(element => element.classList.toggle('active', element.dataset.view === view));
  if (view === 'investigations') await loadCases();
  if (view === 'tools') loadTools();
  if (view === 'dashboard') await loadDashboard();
  if (view === 'settings') await loadAppInfo();
}

async function checkAllTools() {
  const checks = await Promise.all(catalog.map(async tool => {
    try { return [tool.id, await api.checkTool(tool.id)]; } catch { return [tool.id, false]; }
  }));
  installed = new Set(checks.filter(([, ready]) => ready).map(([id]) => id));
  for (const [id, ready] of checks) {
    const element = $(`${id}Status`);
    if (element) {
      element.classList.toggle('installed', ready);
      element.title = ready ? 'Executable found; provider configuration may still be required.' : 'Executable not found on PATH.';
    }
  }
  $('toolsReady').textContent = installed.size;
}

function statusBadge(value, className) {
  const status = STATUSES.has(value) ? value : 'pending';
  return node('span', `${className} ${status}`, status.replaceAll('-', ' '));
}

function icon(tool) {
  return { sherlock: '🔍', maigret: '🕵️', holehe: '📧', phoneinfoga: '📞', theharvester: '🌐', subfinder: '🔎', amass: '🗺️' }[tool] || '🔧';
}

function fmt(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '—';
  const age = Date.now() - date.getTime();
  if (age >= 0 && age < 60000) return 'Just now';
  if (age >= 0 && age < 3600000) return `${Math.floor(age / 60000)}m ago`;
  if (age >= 0 && age < 86400000) return `${Math.floor(age / 3600000)}h ago`;
  return date.toLocaleDateString();
}

function accessibleCard(element, action) {
  element.tabIndex = 0;
  element.setAttribute('role', 'button');
  element.addEventListener('click', () => void action().catch(reportError));
  element.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void action().catch(reportError); }
  });
  return element;
}

async function loadDashboard() {
  const request = ++dashboardRequest;
  const cases = await api.getAllCases();
  if (request !== dashboardRequest) return;
  $('activeCount').textContent = cases.filter(item => item.status === 'running').length;
  $('completedCount').textContent = cases.filter(item => item.status === 'complete').length;
  $('resultsCount').textContent = cases.reduce((sum, item) => sum + (item.resultCount || 0), 0);
  $('caseCount').textContent = cases.length;
  $('casesTotal').textContent = cases.length;
  const items = cases.slice(0, 10).map(item => {
    const card = node('div', 'activity-item');
    const info = node('div', 'activity-info');
    const meta = node('div', 'activity-meta');
    meta.append(node('span', '', `🎯 ${item.target || '—'}`), node('span', 'activity-time', fmt(item.created)), statusBadge(item.status, 'activity-status'));
    info.append(node('div', 'activity-title', item.title || item.id), meta);
    card.append(node('div', 'activity-icon', icon(item.tool)), info);
    return accessibleCard(card, () => openCaseDetail(item.id));
  });
  $('activityList').replaceChildren(...(items.length ? items : [node('div', 'empty-state', 'No investigations yet.')]));
}

function appendConsole(text) {
  const output = $('outputText');
  const clean = String(text).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  const combined = output.textContent + clean;
  output.textContent = combined.length > CONSOLE_LIMIT ? '[Earlier output omitted from view; full logs are in the case folder.]\n' + combined.slice(-CONSOLE_LIMIT) : combined;
  output.scrollTop = output.scrollHeight;
}

function runningControls(running) {
  $('runBtn').disabled = running;
  $('killBtn').disabled = !running;
  ['runTarget', 'runTool', 'runCaseId'].forEach(id => { $(id).disabled = running; });
}

async function runTool() {
  if (isRunning) return;
  const target = $('runTarget').value.trim();
  const tool = $('runTool').value;
  const caseId = $('runCaseId').value.trim() || `case-${crypto.randomUUID()}`;
  if (!target) throw new Error('Enter a target.');
  if (!installed.has(tool)) throw new Error(`${catalog.find(item => item.id === tool)?.name || tool} is not installed or was not found. Install it, then click Check Tools.`);
  isRunning = true;
  runningControls(true);
  currentCaseId = caseId;
  $('runCaseId').value = caseId;
  $('outputText').textContent = `[${new Date().toLocaleTimeString()}] Starting ${tool} on "${target}"...\n\n`;
  try {
    progressCleanup = api.onToolProgress(data => {
      if (data.caseId !== caseId) return;
      const time = new Date(data.timestamp).toLocaleTimeString();
      if (data.output) appendConsole(`[${time}] ${data.output}`);
      if (data.error) appendConsole(`[${time}] [stderr] ${data.error}`);
    });
    const pending = api.runTool({ tool, target, options: { caseId } });
    void loadDashboard().catch(() => {});
    const result = await pending;
    if (result.success) appendConsole(`\n✅ Done in ${(result.duration / 1000).toFixed(1)}s\n`);
    else if (result.status === 'cancelled') appendConsole('\n⏹️ Stopped\n');
    else appendConsole(`\n❌ ${result.error || `Tool exited with code ${result.exitCode}.`}\n`);
    if (result.outputDirectory) appendConsole(`Saved: ${result.outputDirectory}\n`);
  } catch (error) { appendConsole(`\n❌ ${error.message}\n`); }
  finally {
    progressCleanup?.();
    progressCleanup = null;
    isRunning = false;
    runningControls(false);
    await loadDashboard();
  }
}

async function killTool() {
  if (!isRunning || !currentCaseId) return;
  $('killBtn').disabled = true;
  try {
    const result = await api.killTool({ caseId: currentCaseId });
    if (!result.success && isRunning) throw new Error(result.error);
  } catch (error) { if (isRunning) $('killBtn').disabled = false; throw error; }
}

async function loadCases() {
  const cases = await api.getAllCases();
  $('caseCount').textContent = cases.length;
  const cards = cases.map(item => {
    const card = node('div', 'case-card');
    const header = node('div', 'case-header');
    header.append(node('span', 'case-title', item.title || item.id), statusBadge(item.status, 'case-status'));
    const meta = node('div', 'case-meta');
    meta.append(node('span', '', `🎯 ${item.target || '—'}`), node('span', '', `🔧 ${item.tool || '—'}`), node('span', '', `📅 ${fmt(item.created)}`));
    card.append(header, meta);
    return accessibleCard(card, () => openCaseDetail(item.id));
  });
  $('casesList').replaceChildren(...(cards.length ? cards : [node('div', 'empty-state', 'No cases yet.')]));
}

function createNewCase(preferredType) {
  if (isRunning) throw new Error('Wait for the current tool to finish, or stop it first.');
  $('caseType').value = ['username', 'email', 'phone', 'domain'].includes(preferredType) ? preferredType : 'username';
  $('newCaseModal').classList.add('active');
  $('caseTitle').focus();
}

function closeModal() {
  if (creating) return;
  $('newCaseModal').classList.remove('active');
  ['caseTitle', 'caseTarget', 'caseNotes'].forEach(id => { $(id).value = ''; });
}

async function saveCase() {
  if (creating || isRunning) return;
  const title = $('caseTitle').value.trim();
  const target = $('caseTarget').value.trim();
  const type = $('caseType').value;
  const notes = $('caseNotes').value.trim();
  if (!title || !target) throw new Error('Fill in the case title and target.');
  const preferred = DEFAULT_TOOLS[type];
  const selected = installed.has(preferred) ? preferred : catalog.find(tool => tool.type === type && installed.has(tool.id))?.id;
  if (!selected) throw new Error(`No installed tool can process a ${type} target. Install the appropriate tool and click Check Tools.`);
  const caseId = `case-${crypto.randomUUID()}`;
  creating = true;
  $('saveCaseBtn').disabled = true;
  try {
    await api.saveCaseMeta({ caseId, meta: { title, target, type, notes } });
    creating = false;
    closeModal();
    $('runTarget').value = target;
    $('runTool').value = selected;
    $('runCaseId').value = caseId;
    await showView('runner');
    await runTool();
  } finally { creating = false; $('saveCaseBtn').disabled = false; }
}

function row(label, value) {
  const element = node('div', 'detail-row');
  const content = node('span', 'detail-value');
  if (value instanceof Node) content.append(value);
  else content.textContent = value == null || value === '' ? '—' : String(value);
  element.append(node('span', 'detail-label', label), content);
  return element;
}

function fileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

async function openCaseDetail(id) {
  const request = ++detailRequest;
  const [cases, files] = await Promise.all([api.getAllCases(), api.getResults(id)]);
  if (request !== detailRequest) return;
  const item = cases.find(record => record.id === id);
  if (!item) throw new Error('Case not found.');
  $('detailTitle').textContent = item.title || id;
  const grid = node('div', 'detail-grid');
  const info = node('div', 'detail-section');
  info.append(node('h4', '', 'Case Info'));
  for (const [label, value] of [['Case ID', id], ['Title', item.title], ['Target', item.target], ['Type', item.type], ['Tool', item.tool],
    ['Status', statusBadge(item.status, 'case-status')], ['Created', item.created ? new Date(item.created).toLocaleString() : '—'], ['Notes', item.notes], ['Error', item.error]]) info.append(row(label, value));
  const results = node('div', 'detail-section');
  results.append(node('h4', '', `Results (${files.length})`));
  const list = node('div', 'results-list');
  for (const file of files) {
    const line = node('div', 'result-file');
    const actions = node('div', 'result-file-actions');
    actions.append(button('Copy Path', 'result-btn', () => api.copyResultPath({ caseId: id, name: file.name })),
      button('Download', 'result-btn', () => api.saveResult({ caseId: id, name: file.name })));
    line.append(node('span', 'result-file-name', file.name), node('span', 'result-file-size', fileSize(file.size)), actions);
    list.append(line);
  }
  if (!files.length) list.append(node('div', 'empty-state', 'No files'));
  results.append(list);
  const actions = node('div', 'detail-section full');
  const buttons = node('div', 'detail-actions');
  buttons.append(button('📁 Open Folder', 'btn btn-primary', () => api.openResultsFolder(id)),
    button('📦 Export ZIP', 'btn btn-secondary', () => api.exportCase({ caseId: id })),
    button('🗑️ Delete', 'btn btn-danger', async () => {
      const result = await api.deleteCase(id);
      if (result.success) { closeDetailModal(); await Promise.all([loadCases(), loadDashboard()]); }
    }));
  actions.append(node('h4', '', 'Actions'), buttons);
  grid.append(info, results, actions);
  $('caseDetailContent').replaceChildren(grid);
  $('caseDetailModal').classList.add('active');
  $('closeDetailModalBtn').focus();
}

function closeDetailModal() { detailRequest++; $('caseDetailModal').classList.remove('active'); }

function loadTools() {
  $('toolsGrid').replaceChildren(...catalog.map(tool => {
    const card = node('div', 'tool-card');
    const header = node('div', 'tool-header');
    header.append(node('h4', '', tool.name), node('span', `risk-badge ${tool.risk}`, tool.risk));
    const tags = node('div', 'tool-tags');
    tags.append(...tool.tags.map(tag => node('span', 'tag', tag)));
    card.append(header, node('p', '', tool.description), tags);
    return card;
  }));
}

async function loadAppInfo() {
  const info = await api.getAppInfo();
  $('platformInfo').textContent = info.platform;
  $('platformInfo2').textContent = `${info.platform} (${info.arch})`;
  $('electronVersion').textContent = info.versions.electron;
  $('nodeVersion').textContent = info.versions.node;
  $('resultsPath').textContent = info.resultsDir;
  $('appVersion').textContent = info.appVersion;
}

function setupModals() {
  document.querySelectorAll('.modal').forEach(modal => modal.addEventListener('click', event => {
    if (event.target === modal) modal.id === 'newCaseModal' ? closeModal() : closeDetailModal();
  }));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeModal(); closeDetailModal(); }
  });
}

async function clearAllData() {
  const result = await api.clearAllResults();
  if (result.success) {
    currentCaseId = null;
    $('runCaseId').value = '';
    closeDetailModal();
    await Promise.all([loadDashboard(), loadCases()]);
  }
}

window.addEventListener('beforeunload', () => progressCleanup?.());
