'use strict';

// Local tool-output provenance. This records artifacts, NOT verified identities or primary sources.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { safePath, validId, writeJSON } = require('./store');

const SCHEMA_VERSION = 1;
const MAX_ARTIFACTS = 500;
const MAX_HASH_BYTES = 100 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const RUN_STATUSES = new Set(['complete', 'failed', 'cancelled', 'timed-out', 'interrupted']);

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
      !RUN_STATUSES.has(status)) {
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
  // Long relative paths can exceed the reader's byte limit before the entry limit.
  // Keep the largest readable prefix and make the omission explicit.
  const serializedBytes = () => Buffer.byteLength(JSON.stringify(manifest, null, 2), 'utf8');
  if (serializedBytes() > MAX_MANIFEST_BYTES) {
    manifest.truncated = true;
    let low = 0, high = artifacts.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      manifest.artifacts = artifacts.slice(0, middle);
      if (serializedBytes() <= MAX_MANIFEST_BYTES) low = middle;
      else high = middle - 1;
    }
    manifest.artifacts = artifacts.slice(0, low);
    if (serializedBytes() > MAX_MANIFEST_BYTES) throw new Error('Run provenance metadata is too large.');
  }
  writeJSON(safePath(runDirectory, 'evidence.json'), manifest);
  return manifest;
}

function readRecord(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) throw new Error('Provenance record is not a regular file or exceeds 1 MiB.');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function validArtifact(artifact) {
  return artifact && typeof artifact.name === 'string' && artifact.name.length > 0 &&
    Number.isSafeInteger(artifact.size) && artifact.size >= 0 &&
    artifact.role === 'tool-output' && artifact.reviewStatus === 'unreviewed' &&
    ((artifact.hashStatus === 'computed' && typeof artifact.sha256 === 'string' && /^[a-f0-9]{64}$/.test(artifact.sha256)) ||
     (artifact.hashStatus === 'skipped-size-limit' && artifact.sha256 === null));
}

function listCaseEvidence(caseDirectory, caseId) {
  validId(caseId);
  const records = [];
  const warnings = [];
  if (!fs.existsSync(caseDirectory)) return { records, warnings };
  for (const entry of fs.readdirSync(caseDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !/^run-[A-Za-z0-9_-]{1,76}$/.test(entry.name)) continue;
    try {
      const manifestPath = safePath(caseDirectory, `${entry.name}/evidence.json`);
      if (!fs.existsSync(manifestPath)) {
        // Legacy runs need no migration. New runs retain a reason for missing evidence.
        const runPath = safePath(caseDirectory, `${entry.name}/run.json`);
        if (fs.existsSync(runPath)) {
          const run = readRecord(runPath);
          if (run.evidenceStatus || run.evidenceWarning) {
            warnings.push({ runId: entry.name, message: typeof run.evidenceWarning === 'string' && run.evidenceWarning ?
              run.evidenceWarning : run.evidenceStatus === 'pending' ? 'Provenance capture has not finished.' : 'Evidence manifest is unavailable.' });
          }
        }
        continue;
      }
      const manifest = readRecord(manifestPath);
      if (manifest?.schemaVersion !== SCHEMA_VERSION || manifest.caseId !== caseId ||
          manifest.runId !== entry.name || typeof manifest.tool !== 'string' || typeof manifest.target !== 'string' ||
          !RUN_STATUSES.has(manifest.status) || !Number.isSafeInteger(manifest.started) ||
          !Number.isSafeInteger(manifest.finished) || !Number.isSafeInteger(manifest.capturedAt) ||
          manifest.acquisition !== 'locally-executed-cli' || manifest.primarySourceVerified !== false ||
          manifest.reviewStatus !== 'unreviewed' || typeof manifest.truncated !== 'boolean' ||
          !Array.isArray(manifest.artifacts) || manifest.artifacts.length > MAX_ARTIFACTS ||
          !manifest.artifacts.every(validArtifact)) throw new Error('Invalid evidence manifest.');
      records.push(manifest);
    } catch (error) {
      warnings.push({ runId: entry.name, message: `Provenance unavailable: ${error.message}` });
    }
  }
  return { records: records.sort((a, b) => b.started - a.started), warnings };
}

module.exports = { captureRunEvidence, listCaseEvidence, collectArtifacts, hashFile, MAX_MANIFEST_BYTES };
