'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');

test('dashboard shows exactly six categories and no misleading dead buttons', () => {
  assert.equal((html.match(/class="module-card /g) || []).length, 6);
  assert.equal((html.match(/<button[^>]*class="module-card module-card-active"[^>]*data-go="new-case"/g) || []).length, 2);
  assert.equal((html.match(/<div class="module-card module-card-planned">/g) || []).length, 4);
  assert.ok(!html.includes('data-go="tools"'));
});

test('category launchers select working target types', () => {
  assert.match(html, /data-category="people"/);
  assert.match(html, /data-category="web"/);
  assert.match(app, /createNewCase\(card\.dataset\.type\)/);
  assert.match(app, /\['username', 'email', 'phone', 'domain'\]\.includes\(preferredType\)/);
});

test('integration health is only in Settings, not sidebar', () => {
  const settings = html.indexOf('id="settings-view"');
  const health = html.indexOf('id="toolStatusList"');
  const paths = html.indexOf('id="resultsPath"');
  assert.ok(settings >= 0 && health > settings && paths > health);
  assert.ok(html.indexOf('id="platformInfo"') < settings);
  assert.match(html, /id="checkAllToolsBtnSettings"/);
  assert.match(styles, /\.module-card-active:hover/);
  assert.match(app, /\$\('casesTotal'\)\.textContent = cases\.length/);
});

test('transparent branding asset exists and is a PNG', () => {
  assert.match(html, /src="assets\/approved-emblem-transparent\.png"/);
  const png = fs.readFileSync(path.join(root, 'src', 'assets', 'approved-emblem-transparent.png'));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});
