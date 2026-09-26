'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CaseStore, validId, safePath } = require('../lib/store');
const { getTool, validateTarget } = require('../lib/tools');
const { startProcess } = require('../lib/process');

function temp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'osint-command-')); }
function cleanup(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

test('validId accepts normal case IDs', () => assert.equal(validId('case-123_ABC'), 'case-123_ABC'));
test('validId rejects traversal', () => assert.throws(() => validId('../case'), /Case ID/));
test('validId rejects Windows reserved names', () => assert.throws(() => validId('CON'), /Case ID/));

test('safePath accepts a nested relative path', () => {
  const root = temp();
  try { assert.equal(safePath(root, 'case/run/file.txt'), path.join(root, 'case', 'run', 'file.txt')); }
  finally { cleanup(root); }
});
test('safePath rejects parent traversal', () => {
  const root = temp();
  try { assert.throws(() => safePath(root, '../outside'), /Invalid results path/); }
  finally { cleanup(root); }
});
test('safePath rejects absolute paths', () => {
  const root = temp();
  try { assert.throws(() => safePath(root, path.resolve(root, 'outside')), /Invalid results path/); }
  finally { cleanup(root); }
});

test('CaseStore update and read round-trip metadata', () => {
  const root = temp();
  try {
    const store = new CaseStore(root);
    store.update('case-1', { title: 'Example', target: 'alice', status: 'complete' });
    const row = store.read('case-1');
    assert.equal(row.title, 'Example');
    assert.equal(row.target, 'alice');
    assert.equal(row.status, 'complete');
  } finally { cleanup(root); }
});

test('CaseStore saveUserMetadata trims values and creates pending case', () => {
  const root = temp();
  try {
    const store = new CaseStore(root);
    const row = store.saveUserMetadata('case-2', { title: '  Title  ', target: '  alice  ', type: 'username', notes: ' note ' });
    assert.equal(row.title, 'Title');
    assert.equal(row.target, 'alice');
    assert.equal(row.notes, 'note');
    assert.equal(row.status, 'pending');
  } finally { cleanup(root); }
});

test('CaseStore rejects invalid target type metadata', () => {
  const root = temp();
  try {
    const store = new CaseStore(root);
    assert.throws(() => store.saveUserMetadata('case-3', { type: 'url' }), /Invalid target type/);
  } finally { cleanup(root); }
});

test('CaseStore files ignores temporary files', () => {
  const root = temp();
  try {
    const store = new CaseStore(root);
    const dir = store.directory('case-4', true);
    fs.writeFileSync(path.join(dir, 'result.txt'), 'ok');
    fs.writeFileSync(path.join(dir, 'partial.tmp'), 'ignore');
    assert.deepEqual(store.files('case-4').map(x => x.name), ['result.txt']);
  } finally { cleanup(root); }
});

test('CaseStore file returns an existing regular file', () => {
  const root = temp();
  try {
    const store = new CaseStore(root);
    const dir = store.directory('case-5', true);
    const file = path.join(dir, 'result.txt');
    fs.writeFileSync(file, 'ok');
    assert.equal(store.file('case-5', 'result.txt'), file);
  } finally { cleanup(root); }
});

test('CaseStore list counts result files but not metadata', () => {
  const root = temp();
  try {
    const store = new CaseStore(root);
    store.update('case-6', { title: 'Count me', status: 'complete' });
    fs.writeFileSync(path.join(store.directory('case-6'), 'result.txt'), 'ok');
    const rows = store.list();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].resultCount, 1);
  } finally { cleanup(root); }
});

test('CaseStore recover marks running cases interrupted', () => {
  const root = temp();
  try {
    const store = new CaseStore(root);
    store.update('case-7', { status: 'running' });
    store.recover();
    assert.equal(store.read('case-7').status, 'interrupted');
  } finally { cleanup(root); }
});

test('CaseStore delete removes a case directory', () => {
  const root = temp();
  try {
    const store = new CaseStore(root);
    store.update('case-8', { status: 'pending' });
    store.delete('case-8');
    assert.equal(store.read('case-8'), null);
  } finally { cleanup(root); }
});

test('getTool returns a known tool definition', () => assert.equal(getTool('sherlock').type, 'username'));
test('getTool rejects unknown tools', () => assert.throws(() => getTool('not-a-tool'), /Unknown tool/));
test('validateTarget normalizes phone numbers', () => assert.equal(validateTarget('phone', '+1 (361) 555-1212'), '+13615551212'));
test('validateTarget normalizes domains', () => assert.equal(validateTarget('domain', 'Example.COM'), 'example.com'));

test('startProcess captures output and completes successfully', async () => {
  const root = temp();
  try {
    const task = startProcess({
      executable: process.execPath,
      args: ['-e', 'process.stdout.write("hello"); process.stderr.write("warn")'],
      cwd: root,
      env: process.env,
      timeout: 10000
    });
    const result = await task.result;
    assert.equal(result.success, true);
    assert.equal(result.status, 'complete');
    assert.match(result.stdout, /hello/);
    assert.match(result.stderr, /warn/);
    assert.equal(fs.readFileSync(path.join(root, 'stdout.log'), 'utf8'), 'hello');
  } finally { cleanup(root); }
});
