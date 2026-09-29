'use strict';

// Local tool-output provenance. This records artifacts, NOT verified identities or primary sources.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { safePath, validId, writeJSON } = require('./store');

const SCHEMA_VERSION = 1;
const MAX_ARTIFACTS = 500;
const MAX_HASH_BYTES = 100 * 1024 * 1024;

function hashFile(file) {
  const hash = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(65536);
  try {
    for (;;) {
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!bytes) break;
      hash.update(buffer.subarray(0, bytes));
    }
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

function collectArtifacts(runDirectory) {
  const artifacts = [];
  let truncated = false;
  const walk = (relative = '', depth = 0) => {
    if (depth > 12) { truncated = true; return; }
    const directory = safePath(runDirectory, relative);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (artifacts.length >= MAX_ARTIFACTS) { truncated = true; return; }
      if (entry.isSymbolicLink()) continue;
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (!relative && ['run.json', 'evidence.json'].includes(entry.name)) continue;
      const file = safePath(runDirectory, name);
      if (entry.isDirectory()) walk(name, depth + 1);
      else if (entry.isFile()) {
        const size = fs.statSync(file).size;
        artifacts.push({
          name, size, sha256: size <= MAX_HASH_BYTES ? hashFile(file) : null,
          hashStatus: size <= MAX_HASH_BYTES ? 'computed' : 'skipped-size-limit',
          role: 'tool-output', reviewStatus: 'unreviewed'
        });
      }
    }
  };
  walk();
  return { artifacts, truncated };
}

function captureRunEvidence({ caseId, runId, runDirectory, tool, target, started, finished, status }) {
  validId(caseId);
  validId(runId);
  if (path.basename(runDirectory) !== runId || !/^[a-z][a-z0-9-]{0,63}$/.test(tool) ||
      typeof target !== 'string' || !Number.isSafeInteger(started) || !Number.isSafeInteger(finished) ||
      !['complete', 'failed', 'cancelled', 'timed-out', 'interrupted'].includes(status)) {
    throw new Error('Invalid run provenance.');
  }
  const { artifacts, truncated } = collectArtifacts(runDirectory);
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    caseId, runId, tool, target, status, started, finished,
    capturedAt: Date.now(), acquisition: 'locally-executed-cli',
    primarySourceVerified: false, reviewStatus: 'unreviewed',
    artifacts, truncated
  };
  writeJSON(safePath(runDirectory, 'evidence.json'), manifest);
  return manifest;
}

function listCaseEvidence(caseDirectory, caseId) {
  validId(caseId);
  if (!fs.existsSync(caseDirectory)) return [];
  const records = [];
  for (const entry of fs.readdirSync(caseDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !/^run-[A-Za-z0-9_-]{1,76}$/.test(entry.name)) continue;
    const manifestPath = safePath(caseDirectory, `${entry.name}/evidence.json`);
    if (!fs.existsSync(manifestPath)) continue; // Older cases remain valid.
    if (fs.statSync(manifestPath).size > 1024 * 1024) throw new Error('Evidence manifest too large.');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest?.schemaVersion !== SCHEMA_VERSION || manifest.caseId !== caseId ||
        manifest.runId !== entry.name || !Array.isArray(manifest.artifacts) ||
        manifest.artifacts.length > MAX_ARTIFACTS) throw new Error('Invalid evidence manifest.');
    records.push(manifest);
  }
  return records.sort((a, b) => b.started - a.started);
}

module.exports = { captureRunEvidence, listCaseEvidence, collectArtifacts, hashFile };
