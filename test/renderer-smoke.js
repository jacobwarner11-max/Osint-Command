'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-ui-smoke-'));
app.setPath('userData', profile);
app.disableHardwareAcceleration();
app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true }));
const deadline = setTimeout(() => { console.error('UI smoke check timed out.'); app.exit(1); }, 30000);

function contrast(fg, bg) {
  const luminance = color => {
    const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const a = luminance(fg), b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1366, height: 768, show: false,
    webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true,
      sandbox: true, preload: path.join(__dirname, 'fixtures', 'renderer-preload.js') } });
  const ui = code => window.webContents.executeJavaScript(code);
  const waitFor = condition => ui(`new Promise((resolve, reject) => {
    const end = Date.now() + 5000;
    const poll = () => {
      if (${condition}) resolve();
      else if (Date.now() > end) reject(new Error('UI condition timed out'));
      else setTimeout(poll, 25);
    }; poll();
  })`);
  await window.loadFile(path.join(root, 'src', 'index.html'));
  await waitFor("!document.getElementById('runBtn').disabled");

  const bytes = fs.readFileSync(path.join(root, 'src', 'assets', 'approved-emblem-transparent.png'));
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  await waitFor("document.querySelector('.brand-shell').complete");
  assert.equal(await ui("document.querySelector('.brand-shell').naturalWidth > 0 && !document.querySelector('.brand-shell').hidden"), true);
  console.log('PASS approved transparent PNG loads');
  const desk = await ui(`({
    categories: document.querySelectorAll('.module-grid > .module-card').length,
    enabled: document.querySelectorAll('.module-card-active[data-go="new-case"]').length,
    planned: document.querySelectorAll('.module-card-planned:not(button)').length,
    healthView: document.getElementById('toolStatusList').closest('.view').id,
    statusOnSidebar: Boolean(document.querySelector('.sidebar #toolStatusList')),
    savedCases: document.getElementById('casesTotal').textContent
  })`);
  assert.deepEqual(desk, { categories: 6, enabled: 2, planned: 4,
    healthView: 'settings-view', statusOnSidebar: false, savedCases: '7' });
  console.log('PASS six categories, honest in-development cards and settings-only tool status');

  for (const [width, height] of [[1366, 768], [1000, 700]]) {
    window.setContentSize(width, height);
    await waitFor(`innerWidth === ${width} && innerHeight === ${height}`);
    const layout = await ui(`(() => {
      const rect = selector => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      };
      return { header: rect('.dashboard-top'), title: rect('.dashboard-top h2'),
        subtitle: rect('.dashboard-subtitle'), button: rect('#quickInvestigationBtn'),
        text: rect('.dashboard-top > div'),
        pseudo: getComputedStyle(document.querySelector('.dashboard-top'), '::before').content };
    })()`);
    assert.ok(['none', 'normal', '""'].includes(layout.pseudo), 'No duplicate generated subtitle');
    assert.ok(layout.title.bottom <= layout.subtitle.top, 'Title and subtitle must not overlap');
    const { button, text, header } = layout;
    assert.ok(button.left >= text.right || button.top >= text.bottom || text.top >= button.bottom,
      'Button and heading must not overlap');
    for (const rect of [layout.title, layout.subtitle, button]) {
      assert.ok(rect.left >= header.left && rect.right <= header.right &&
        rect.top >= header.top && rect.bottom <= header.bottom, 'Header content stays inside its border');
    }
    if (process.env.OSINT_UI_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.OSINT_UI_SCREENSHOT_DIR, { recursive: true });
      // Give the offscreen compositor a frame at the new size before capture.
      await new Promise(resolve => setTimeout(resolve, 150));
      const capture = await window.webContents.capturePage();
      fs.writeFileSync(path.join(process.env.OSINT_UI_SCREENSHOT_DIR, `dashboard-${width}.png`), capture.toPNG());
    }
    console.log(`PASS header at ${width}x${height}`);
  }

  const colors = await ui(`Array.from(document.querySelectorAll('.activity-status, #killBtn')).map(element => {
    const style = getComputedStyle(element);
    return { label: element.textContent, foreground: style.color, background: style.backgroundColor };
  })`);
  for (const color of colors) assert.ok(contrast(color.foreground, color.background) >= 4.5,
    `${color.label} needs readable text contrast`);
  console.log('PASS status and Stop text contrast');

  await ui("document.querySelector('#activityList .activity-item').click()");
  await waitFor("document.getElementById('caseDetailModal').classList.contains('active')");
  const evidenceText = await ui("document.getElementById('caseDetailContent').textContent");
  assert.match(evidenceText, /Run provenance \(1\)/);
  assert.match(evidenceText, /unreviewed/);
  assert.match(evidenceText, /not independently verified identities/);
  assert.match(evidenceText, /stdout\.log/);
  assert.match(evidenceText, /Case files \(4\)/);
  await ui("document.getElementById('closeDetailModalBtn').click()");
  console.log('PASS case details show local provenance without treating matches as verified');

  for (const [id, expected] of [['fixture-failed', /Provenance unavailable: Simulated evidence read failure/],
    ['fixture-cancelled', /Evidence manifest could not be captured: simulated output read error/]]) {
    await ui(`openCaseDetail('${id}')`);
    const text = await ui("document.getElementById('caseDetailContent').textContent");
    assert.match(text, expected);
    assert.match(text, /Case files \(4\)/);
    assert.match(text, /stdout\.log/);
    assert.match(text, /Export ZIP/);
    assert.equal(await ui("document.getElementById('caseDetailModal').classList.contains('active')"), true);
    await ui("document.getElementById('closeDetailModalBtn').click()");
  }
  console.log('PASS unavailable provenance and saved capture warnings preserve case file access');

  await ui("document.querySelector('#activityList .activity-item').click()");
  await waitFor("document.getElementById('caseDetailModal').classList.contains('active')");
  assert.equal(await ui("Array.from(document.querySelectorAll('#caseDetailContent button')).some(button => button.textContent.includes('Add tool run'))"), true);
  await ui("Array.from(document.querySelectorAll('#caseDetailContent button')).find(button => button.textContent.includes('Add tool run')).click()");
  await waitFor("document.getElementById('runner-view').classList.contains('active')");
  const followUp = await ui(`({
    caseId: document.getElementById('runCaseId').value,
    target: document.getElementById('runTarget').value,
    locked: document.getElementById('runCaseId').readOnly && document.getElementById('runTarget').readOnly,
    options: Array.from(document.getElementById('runTool').options).map(option => option.value),
    tool: document.getElementById('runTool').value
  })`);
  assert.deepEqual(followUp, { caseId: 'fixture-complete', target: 'example.com', locked: true,
    options: ['theharvester', 'subfinder', 'amass'], tool: 'theharvester' });
  await ui("document.querySelector('[data-view=runner]').click()");
  const freshRunner = await ui(`({
    caseId: document.getElementById('runCaseId').value,
    target: document.getElementById('runTarget').value,
    editable: !document.getElementById('runCaseId').readOnly && !document.getElementById('runTarget').readOnly,
    options: document.getElementById('runTool').options.length
  })`);
  assert.deepEqual(freshRunner, { caseId: '', target: '', editable: true, options: 7 });
  console.log('PASS compatible follow-up tool keeps case context; normal Runner resets it');


  await ui("document.querySelector('[data-view=runner]').click()");
  await ui(`document.getElementById('runTarget').value = 'example.com';
    document.getElementById('runCaseId').value = 'fixture-domain';
    document.getElementById('runTool').value = 'subfinder';
    document.getElementById('runBtn').click();`);
  await waitFor("document.getElementById('runTool').disabled");
  await ui("document.querySelector('[data-view=dashboard]').click()");
  await ui("document.querySelector('[data-view=runner]').click()");
  const active = await ui(`({ tool: document.getElementById('runTool').value,
    target: document.getElementById('runTarget').value, caseId: document.getElementById('runCaseId').value,
    locked: document.getElementById('runTool').disabled })`);
  assert.deepEqual(active, { tool: 'subfinder', target: 'example.com', caseId: 'fixture-domain', locked: true });
  console.log('PASS switching views during active run keeps tool, target and case');

  await ui("document.getElementById('killBtn').click()");
  await waitFor("!document.getElementById('runTool').disabled");
  await ui("document.querySelector('[data-view=dashboard]').click()");
  await ui("document.querySelector('[data-category=people]').click()");
  await waitFor("document.getElementById('newCaseModal').classList.contains('active')");
  assert.equal(await ui("document.getElementById('caseType').value"), 'username');
  await ui("document.getElementById('closeModalBtn').click()");
  await ui("document.querySelector('[data-category=web]').click()");
  assert.equal(await ui("document.getElementById('caseType').value"), 'domain');
  await ui("document.getElementById('closeModalBtn').click()");
  await ui("document.getElementById('quickInvestigationBtn').click()");
  assert.equal(await ui("document.getElementById('caseType').value"), 'username');
  await ui("document.getElementById('closeModalBtn').click()");
  console.log('PASS category shortcuts open investigation with correct target type');

  await ui("document.querySelector('.brand-shell').src = 'assets/missing-test-emblem.png'");
  await waitFor("document.querySelector('.brand-shell').hidden");
  assert.equal(await ui("getComputedStyle(document.querySelector('.brand-shell')).display"), 'none');
  await ui("document.querySelector('.brand-shell').src = 'assets/approved-emblem-transparent.png'");
  await waitFor("document.querySelector('.brand-shell').naturalWidth > 0 && !document.querySelector('.brand-shell').hidden");
  console.log('PASS failed image hides and recovered image returns');

  clearTimeout(deadline);
  window.destroy();
  app.quit();
}).catch(error => {
  console.error(error);
  clearTimeout(deadline);
  app.exit(1);
});
