'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { CaseStore } = require('../lib/store');
const { captureRunEvidence, listCaseEvidence, MAX_MANIFEST_BYTES } = require('../lib/evidence');

function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-evidence-'));
  try {
    const store = new CaseStore(root);
    store.saveUserMetadata('case-one', { title: 'Example', type: 'username', target: 'sampleuser' });
    return fn(store);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function createRun(store, runId, tool, status, started) {
  const dir = path.join(store.directory('case-one'), runId);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'run.json'), '{}');
  fs.writeFileSync(path.join(dir, 'stdout.log'), `output from ${tool}\n`);
  fs.writeFileSync(path.join(dir, 'result.txt'), 'public match is only a candidate\n');
  return captureRunEvidence({
    caseId: 'case-one', runId, runDirectory: dir, tool, target: 'sampleuser',
    started, finished: started + 100, status
  });
}

test('captures locally generated artifacts with SHA-256 and unreviewed provenance', () => fixture(store => {
  const manifest = createRun(store, 'run-one', 'sherlock', 'complete', 1000);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.acquisition, 'locally-executed-cli');
  assert.equal(manifest.primarySourceVerified, false);
  assert.equal(manifest.reviewStatus, 'unreviewed');
  assert.equal(manifest.artifacts.length, 2);
  const artifact = manifest.artifacts.find(file => file.name === 'result.txt');
  assert.equal(artifact.sha256,
    createHash('sha256').update('public match is only a candidate\n').digest('hex'));
  assert.equal(artifact.reviewStatus, 'unreviewed');
  assert.ok(!manifest.artifacts.some(file => file.name === 'run.json' || file.name === 'evidence.json'));
  assert.equal(fs.statSync(path.join(store.directory('case-one'), 'run-one', 'evidence.json')).mode & 0o777, 0o600);
}));

test('multiple tool runs accumulate separately in one existing case', () => fixture(store => {
  createRun(store, 'run-one', 'sherlock', 'complete', 1000);
  createRun(store, 'run-two', 'maigret', 'failed', 2000);
  const { records: entries, warnings } = listCaseEvidence(store.directory('case-one'), 'case-one');
  assert.deepEqual(warnings, []);
  assert.deepEqual(entries.map(record => [record.tool, record.status]), [['maigret', 'failed'], ['sherlock', 'complete']]);
  assert.equal(store.read('case-one').target, 'sampleuser');
  assert.equal(store.list()[0].resultCount, 4); // Two result files per run, not JSON manifests.
}));

test('older cases without manifests remain readable', () => fixture(store => {
  const dir = path.join(store.directory('case-one'), 'run-legacy');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'stdout.log'), 'legacy run');
  assert.deepEqual(listCaseEvidence(store.directory('case-one'), 'case-one'), { records: [], warnings: [] });
  assert.equal(store.list()[0].resultCount, 1);
}));

test('failed and cancelled runs still preserve local output metadata without asserting truth', () => fixture(store => {
  const record = createRun(store, 'run-failed', 'sherlock', 'cancelled', 3000);
  assert.equal(record.status, 'cancelled');
  assert.equal(record.primarySourceVerified, false);
  assert.equal(listCaseEvidence(store.directory('case-one'), 'case-one').records[0].artifacts.length, 2);
}));

test('a mismatched manifest warns without hiding another valid run or legacy files', () => fixture(store => {
  createRun(store, 'run-one', 'sherlock', 'complete', 1000);
  createRun(store, 'run-two', 'maigret', 'complete', 2000);
  const file = path.join(store.directory('case-one'), 'run-one', 'evidence.json');
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  record.caseId = 'case-different';
  fs.writeFileSync(file, JSON.stringify(record));
  const { records, warnings } = listCaseEvidence(store.directory('case-one'), 'case-one');
  assert.deepEqual(records.map(run => run.runId), ['run-two']);
  assert.equal(warnings[0].runId, 'run-one');
  assert.match(warnings[0].message, /Invalid evidence manifest/);
  assert.ok(store.files('case-one').some(file => file.name === 'run-one/result.txt'));
}));

test('long output paths stay within the manifest byte limit and round-trip with truncation', () => fixture(store => {
  const dir = path.join(store.directory('case-one'), 'run-long');
  fs.mkdirSync(dir);
  let nested = dir;
  for (let i = 0; i < 11; i++) {
    nested = path.join(nested, String(i).padStart(2, '0') + 'x'.repeat(198));
    fs.mkdirSync(nested);
  }
  for (let i = 0; i < 500; i++) fs.writeFileSync(path.join(nested, `output-${String(i).padStart(3, '0')}.txt`), 'sample');
  const manifest = captureRunEvidence({ caseId: 'case-one', runId: 'run-long', runDirectory: dir,
    tool: 'sherlock', target: 'sampleuser', started: 1000, finished: 2000, status: 'complete' });
  assert.ok(fs.statSync(path.join(dir, 'evidence.json')).size <= MAX_MANIFEST_BYTES);
  assert.equal(manifest.truncated, true);
  assert.ok(manifest.artifacts.length > 0 && manifest.artifacts.length < 500);
  assert.deepEqual(listCaseEvidence(store.directory('case-one'), 'case-one'), { records: [manifest], warnings: [] });
  assert.equal(store.list()[0].resultCount, 500);
}));

test('corrupt, oversized and malformed artifact records are isolated from valid manifests', () => fixture(store => {
  createRun(store, 'run-good', 'sherlock', 'complete', 1000);
  for (const [runId, body] of [['run-corrupt', '{'], ['run-large', ' '.repeat(MAX_MANIFEST_BYTES + 1)]]) {
    const dir = path.join(store.directory('case-one'), runId);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'evidence.json'), body);
  }
  const malformed = createRun(store, 'run-malformed', 'maigret', 'complete', 2000);
  malformed.artifacts = [null];
  fs.writeFileSync(path.join(store.directory('case-one'), 'run-malformed', 'evidence.json'), JSON.stringify(malformed));
  const { records, warnings } = listCaseEvidence(store.directory('case-one'), 'case-one');
  assert.deepEqual(records.map(run => run.runId), ['run-good']);
  assert.deepEqual(warnings.map(warning => warning.runId).sort(), ['run-corrupt', 'run-large', 'run-malformed']);
}));

test('saved capture failure remains visible after reopening the case', () => fixture(store => {
  const dir = path.join(store.directory('case-one'), 'run-failed');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ evidenceStatus: 'failed', evidenceWarning: 'Evidence capture failed: output read error.' }));
  const reopened = new CaseStore(store.root);
  const { records, warnings } = listCaseEvidence(reopened.directory('case-one'), 'case-one');
  assert.deepEqual(records, []);
  assert.deepEqual(warnings, [{ runId: 'run-failed', message: 'Evidence capture failed: output read error.' }]);
}));

test('recovery records interrupted provenance without inventing a finish time or hashes', () => fixture(store => {
  store.update('case-one', { status: 'running', lastRunId: 'run-interrupted' });
  const dir = path.join(store.directory('case-one'), 'run-interrupted');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ caseId: 'case-one', runId: 'run-interrupted',
    status: 'running', started: 1000, evidenceStatus: 'pending' }));
  fs.writeFileSync(path.join(dir, 'stdout.log'), 'partial output');
  new CaseStore(store.root).recover();
  const run = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
  assert.equal(run.status, 'interrupted');
  assert.equal(run.evidenceStatus, 'unavailable');
  assert.equal(run.finished, undefined);
  assert.equal(fs.existsSync(path.join(dir, 'evidence.json')), false);
  assert.equal(listCaseEvidence(store.directory('case-one'), 'case-one').warnings.length, 1);
  assert.equal(store.read('case-one').evidenceStatus, 'unavailable');
}));

test('recovery preserves a completed run and its captured manifest', () => fixture(store => {
  const manifest = createRun(store, 'run-completed', 'sherlock', 'complete', 1000);
  const dir = path.join(store.directory('case-one'), 'run-completed');
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ caseId: 'case-one', runId: 'run-completed',
    status: 'complete', finished: 1100, evidenceStatus: 'captured', evidenceWarning: null }));
  store.update('case-one', { status: 'running', lastRunId: 'run-completed' });
  store.recover();
  assert.equal(store.read('case-one').status, 'complete');
  assert.equal(store.read('case-one').finished, 1100);
  assert.equal(store.read('case-one').evidenceStatus, 'captured');
  assert.deepEqual(listCaseEvidence(store.directory('case-one'), 'case-one'), { records: [manifest], warnings: [] });
}));
