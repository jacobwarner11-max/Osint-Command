'use strict';

const { contextBridge } = require('electron');
const types = { sherlock: 'username', maigret: 'username', holehe: 'email',
  phoneinfoga: 'phone', theharvester: 'domain', subfinder: 'domain', amass: 'domain' };
const statuses = ['complete', 'failed', 'timed-out', 'running', 'pending', 'cancelled', 'interrupted'];
let finishRun;

// All data and tool activity in the smoke check stay inside this test fixture.
contextBridge.exposeInMainWorld('electronAPI', {
  getTools: async () => Object.entries(types).map(([id, type]) => ({ id, type,
    name: id, risk: 'open', tags: [], description: 'Simulated tool for UI checks' })),
  checkTool: async () => true,
  getAllCases: async () => statuses.map(status => ({ id: `fixture-${status}`,
    title: `Sample ${status} case`, target: 'example.com', type: 'domain',
    status, tool: 'subfinder', created: 1, resultCount: 0 })),
  getResults: async () => [],
  getCaseEvidence: async () => [{ runId: 'run-fixture', tool: 'subfinder', status: 'complete',
    started: 1, reviewStatus: 'unreviewed', truncated: false,
    artifacts: [{ name: 'stdout.log', size: 12, sha256: '0'.repeat(64) }] }],
  getAppInfo: async () => ({ platform: process.platform, arch: process.arch,
    versions: process.versions, resultsDir: 'Isolated UI test data', appVersion: 'test' }),
  onToolProgress: () => () => {},
  runTool: () => new Promise(resolve => { finishRun = resolve; }),
  killTool: async () => {
    finishRun({ success: false, status: 'cancelled' });
    return { success: true };
  }
});
