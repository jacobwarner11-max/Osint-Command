'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { CaseStore } = require('../lib/store');
const { captureRunEvidence, listCaseEvidence } = require('../lib/evidence');

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
  const entries = listCaseEvidence(store.directory('case-one'), 'case-one');
  assert.deepEqual(entries.map(record => [record.tool, record.status]), [['maigret', 'failed'], ['sherlock', 'complete']]);
  assert.equal(store.read('case-one').target, 'sampleuser');
  assert.equal(store.list()[0].resultCount, 4); // Two result files per run, not JSON manifests.
}));

test('older cases without manifests remain readable', () => fixture(store => {
  const dir = path.join(store.directory('case-one'), 'run-legacy');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'stdout.log'), 'legacy run');
  assert.deepEqual(listCaseEvidence(store.directory('case-one'), 'case-one'), []);
  assert.equal(store.list()[0].resultCount, 1);
}));

test('failed and cancelled runs still preserve local output metadata without asserting truth', () => fixture(store => {
  const record = createRun(store, 'run-failed', 'sherlock', 'cancelled', 3000);
  assert.equal(record.status, 'cancelled');
  assert.equal(record.primarySourceVerified, false);
  assert.equal(listCaseEvidence(store.directory('case-one'), 'case-one')[0].artifacts.length, 2);
}));

test('mismatched case identity in a manifest is rejected', () => fixture(store => {
  createRun(store, 'run-one', 'sherlock', 'complete', 1000);
  const file = path.join(store.directory('case-one'), 'run-one', 'evidence.json');
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  record.caseId = 'case-different';
  fs.writeFileSync(file, JSON.stringify(record));
  assert.throws(() => listCaseEvidence(store.directory('case-one'), 'case-one'), /Invalid evidence manifest/);
}));
