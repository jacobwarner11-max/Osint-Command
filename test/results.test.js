'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeRun, listCaseFindings } = require('../lib/results');

function fixture(action) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-normalized-'));
  const caseId = 'case-one';
  const caseDirectory = path.join(root, caseId);
  fs.mkdirSync(caseDirectory);
  try { return action({ root, caseId, caseDirectory }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function evidence(...names) {
  return { artifacts: names.map((name, index) => ({
    name, hashStatus: 'computed', sha256: String(index + 1).repeat(64).slice(0, 64)
  })) };
}

test('Sherlock console normalization preserves all four candidate accounts', () => fixture(({ caseId, caseDirectory }) => {
  const runId = 'run-sherlock';
  const runDirectory = path.join(caseDirectory, runId);
  fs.mkdirSync(runDirectory);
  fs.writeFileSync(path.join(runDirectory, 'stdout.log'), [
    '[*] Checking username Majn998 on:',
    '[+] F3.cool: https://f3.cool/Majn998/',
    '[+] HackerNews: https://news.ycombinator.com/user?id=Majn998',
    '[+] jbzd.com.pl: https://jbzd.com.pl/uzytkownik/Majn998',
    '[+] BabyRu: https://www.baby.ru/u/Majn998',
    '[*] Search completed with 4 results'
  ].join('\n'));

  const result = normalizeRun({ caseId, runId, runDirectory, tool: 'sherlock', target: 'Majn998',
    runStatus: 'complete', evidence: evidence('stdout.log') });
  assert.equal(result.status, 'captured');
  assert.equal(result.count, 4);

  const listed = listCaseFindings(caseDirectory, caseId);
  assert.equal(listed.reportedCount, 4);
  assert.equal(listed.uniqueCount, 4);
  assert.equal(listed.findings.every(item => item.classification === 'candidate'), true);
  assert.equal(listed.findings.some(item => item.site === 'HackerNews'), true);
}));

test('Maigret simple JSON keeps provider tags as site tags, not interests', () => fixture(({ caseId, caseDirectory }) => {
  const runId = 'run-maigret';
  const runDirectory = path.join(caseDirectory, runId);
  fs.mkdirSync(runDirectory);
  const name = 'report_Majn998_simple.json';
  fs.writeFileSync(path.join(runDirectory, name), JSON.stringify({
    GitHub: {
      username: 'Majn998',
      url_user: 'https://github.com/Majn998',
      status: { username: 'Majn998', url: 'https://github.com/Majn998', tags: ['coding', 'us'], ids: { bio: 'artist' } }
    },
    ArtStation: {
      username: 'Majn998',
      url_user: 'https://www.artstation.com/Majn998',
      status: { username: 'Majn998', url: 'https://www.artstation.com/Majn998', tags: ['design', 'art'], ids: {} }
    }
  }));

  normalizeRun({ caseId, runId, runDirectory, tool: 'maigret', target: 'Majn998',
    runStatus: 'complete', evidence: evidence(name) });
  const listed = listCaseFindings(caseDirectory, caseId);
  assert.equal(listed.reportedCount, 2);
  const github = listed.findings.find(item => item.site === 'GitHub');
  assert.deepEqual(github.siteTags, ['coding', 'us']);
  assert.equal(Object.hasOwn(github, 'interests'), false);
  assert.equal(github.observations[0].observed.bio, 'artist');
}));

test('same account URL from Sherlock and Maigret is corroborated without verifying identity', () => fixture(({ caseId, caseDirectory }) => {
  const sherlockId = 'run-sherlock';
  const sherlockDir = path.join(caseDirectory, sherlockId);
  fs.mkdirSync(sherlockDir);
  fs.writeFileSync(path.join(sherlockDir, 'stdout.log'), '[+] GitHub: https://github.com/sample\n');
  normalizeRun({ caseId, runId: sherlockId, runDirectory: sherlockDir, tool: 'sherlock', target: 'sample',
    runStatus: 'complete', evidence: evidence('stdout.log') });

  const maigretId = 'run-maigret';
  const maigretDir = path.join(caseDirectory, maigretId);
  fs.mkdirSync(maigretDir);
  const name = 'report_sample_simple.json';
  fs.writeFileSync(path.join(maigretDir, name), JSON.stringify({
    GitHub: { username: 'sample', url_user: 'https://github.com/sample/',
      status: { username: 'sample', url: 'https://github.com/sample/', tags: ['coding'], ids: {} } }
  }));
  normalizeRun({ caseId, runId: maigretId, runDirectory: maigretDir, tool: 'maigret', target: 'sample',
    runStatus: 'complete', evidence: evidence(name) });

  const listed = listCaseFindings(caseDirectory, caseId);
  assert.equal(listed.reportedCount, 2);
  assert.equal(listed.uniqueCount, 1);
  assert.equal(listed.findings[0].classification, 'corroborated');
  assert.deepEqual(listed.findings[0].tools.sort(), ['maigret', 'sherlock']);
  assert.match(listed.findings[0].corroboration, /does not verify/i);
}));

test('bad Maigret JSON produces a warning without hiding other runs', () => fixture(({ caseId, caseDirectory }) => {
  const goodId = 'run-good';
  const goodDir = path.join(caseDirectory, goodId);
  fs.mkdirSync(goodDir);
  fs.writeFileSync(path.join(goodDir, 'stdout.log'), '[+] Example: https://example.com/user\n');
  normalizeRun({ caseId, runId: goodId, runDirectory: goodDir, tool: 'sherlock', target: 'user',
    runStatus: 'complete', evidence: evidence('stdout.log') });

  const badId = 'run-bad';
  const badDir = path.join(caseDirectory, badId);
  fs.mkdirSync(badDir);
  const name = 'report_user_simple.json';
  fs.writeFileSync(path.join(badDir, name), '{bad json');
  normalizeRun({ caseId, runId: badId, runDirectory: badDir, tool: 'maigret', target: 'user',
    runStatus: 'complete', evidence: evidence(name) });

  const listed = listCaseFindings(caseDirectory, caseId);
  assert.equal(listed.uniqueCount, 1);
  assert.equal(listed.warnings.length, 1);
  assert.match(listed.warnings[0].message, /could not parse json/i);
}));
