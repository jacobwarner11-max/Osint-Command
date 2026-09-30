'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { CaseStore } = require('../lib/store');
const evidence = require('../lib/evidence');

const project = path.resolve(__dirname, '..');

async function runFixture(failCapture, check) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-finalize-'));
  try {
    const store = new CaseStore(root);
    // Exercise main.js finalization with a local Node fixture instead of an OSINT provider.
    const context = vm.createContext({ __dirname: project, process, console, reviewStore: store,
      reviewEvent: { sender: { isDestroyed: () => true } },
      require: id => {
        if (id === 'electron') return { app: { requestSingleInstanceLock: () => false, quit: () => {} } };
        if (id === './lib/tools') return {
          getTool: () => ({ name: 'Fixture', type: 'username', timeout: 10000,
            args: () => ['-e', 'process.stdout.write("fixture output")'] }),
          validateTarget: (_type, target) => target,
          resolveTool: async () => ({ executable: process.execPath, env: process.env })
        };
        if (id === './lib/archive') return {};
        if (id === './lib/evidence' && failCapture) return { ...evidence,
          captureRunEvidence: () => { throw new Error('Simulated output read failure.'); } };
        return id.startsWith('.') ? require(path.join(project, id)) : require(id);
      } });
    vm.runInContext(fs.readFileSync(path.join(project, 'main.js'), 'utf8'), context);
    vm.runInContext('store = reviewStore', context);
    const result = await vm.runInContext("runTool(reviewEvent, { tool: 'sherlock', target: 'sampleuser', options: { caseId: 'case-fixture' } })", context);
    const reopened = new CaseStore(root);
    const run = JSON.parse(fs.readFileSync(path.join(result.outputDirectory, 'run.json'), 'utf8'));
    check({ result, run, record: reopened.read('case-fixture'),
      provenance: evidence.listCaseEvidence(reopened.directory('case-fixture'), 'case-fixture') });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('run finalization persists successful evidence capture separately from tool completion', async () => {
  await runFixture(false, ({ result, run, record, provenance }) => {
    assert.equal(result.success, true);
    assert.equal(run.status, 'complete');
    assert.equal(run.evidenceStatus, 'captured');
    assert.equal(record.evidenceStatus, 'captured');
    assert.equal(run.evidenceWarning, null);
    assert.equal(provenance.records.length, 1);
    assert.deepEqual(provenance.warnings, []);
  });
});

test('capture failure survives reopening without changing a successful tool exit', async () => {
  await runFixture(true, ({ result, run, record, provenance }) => {
    assert.equal(result.success, true);
    assert.equal(result.status, 'complete');
    assert.equal(run.status, 'complete');
    assert.equal(record.status, 'complete');
    assert.equal(run.evidenceStatus, 'failed');
    assert.equal(record.evidenceStatus, 'failed');
    assert.match(run.evidenceWarning, /Simulated output read failure/);
    assert.equal(record.evidenceWarning, run.evidenceWarning);
    assert.deepEqual(provenance.records, []);
    assert.equal(provenance.warnings[0].message, run.evidenceWarning);
  });
});
