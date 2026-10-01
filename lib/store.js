'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function validId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id) ||
      /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(id)) {
    throw new Error('Case ID must contain 1–80 letters, numbers, underscores or hyphens.');
  }
  return id;
}

function safePath(root, relative = '') {
  const parts = relative ? relative.split(/[\\/]/) : [];
  if (path.isAbsolute(relative) || parts.some(p => !p || p === '.' || p === '..' || /[:\x00-\x1f]/.test(p))) {
    throw new Error('Invalid results path.');
  }
  let current = root;
  for (const part of ['', ...parts]) {
    if (part) current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Symbolic links are not allowed in results paths.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return current;
}

function writeJSON(file, data) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

class CaseStore {
  constructor(root) {
    this.root = path.resolve(root);
    safePath(this.root);
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
  }

  directory(id, create = false) {
    const directory = safePath(this.root, validId(id));
    if (create) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    return directory;
  }

  read(id) {
    const directory = this.directory(id);
    const file = safePath(directory, 'meta.json');
    if (!fs.existsSync(file)) return null;
    if (fs.statSync(file).size > 1024 * 1024) throw new Error('Case metadata is too large.');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid case metadata.');
    return { ...data, id, path: directory };
  }

  update(id, changes) {
    const directory = this.directory(id, true);
    const old = this.read(id) || {};
    const { id: ignoredId, path: ignoredPath, ...metadata } = old;
    const next = { ...metadata, ...changes, created: metadata.created || Date.now(), updated: Date.now() };
    writeJSON(safePath(directory, 'meta.json'), next);
    return { ...next, id, path: directory };
  }

  saveUserMetadata(id, metadata) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Invalid metadata.');
    const changes = {};
    for (const [key, limit] of Object.entries({ title: 200, target: 320, type: 20, notes: 20000 })) {
      if (metadata[key] !== undefined) {
        if (typeof metadata[key] !== 'string' || metadata[key].length > limit) throw new Error(`Invalid ${key}.`);
        changes[key] = metadata[key].trim();
      }
    }
    if (changes.type && !['username', 'email', 'domain', 'phone'].includes(changes.type)) throw new Error('Invalid target type.');
    if (!this.read(id)) changes.status = 'pending';
    return this.update(id, changes);
  }

  files(id) {
    const base = this.directory(id);
    if (!fs.existsSync(base)) return [];
    const result = [];
    const walk = (relative, depth = 0) => {
      if (depth > 12 || result.length > 10000) throw new Error('Result directory is too large.');
      const directory = safePath(base, relative);
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const name = relative ? `${relative}/${entry.name}` : entry.name;
        const file = safePath(base, name);
        if (entry.isDirectory()) walk(name, depth + 1);
        else if (entry.isFile() && !entry.name.endsWith('.tmp')) {
          const stat = fs.statSync(file);
          result.push({ name, path: file, size: stat.size, modified: stat.mtimeMs });
        }
      }
    };
    walk('');
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  file(id, relative) {
    if (typeof relative !== 'string' || !relative) throw new Error('A result file is required.');
    const file = safePath(this.directory(id), relative);
    if (!fs.statSync(file).isFile()) throw new Error('Result is not a regular file.');
    return file;
  }

  list() {
    safePath(this.root);
    return fs.readdirSync(this.root, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.isSymbolicLink())
      .flatMap(entry => {
        try {
          const record = this.read(entry.name);
          return record ? [{ ...record, resultCount: this.files(entry.name).filter(f => f.name !== 'meta.json' && !f.name.endsWith('/run.json') && !f.name.endsWith('/evidence.json') && !f.name.endsWith('/normalized-results.json')).length }] : [];
        } catch { return []; }
      })
      .sort((a, b) => (b.created || 0) - (a.created || 0));
  }

  recover() {
    for (const record of this.list()) {
      if (record.status !== 'running') continue;
      const changes = { status: 'interrupted', error: 'Application closed before this run finished.',
        evidenceStatus: 'unavailable', evidenceWarning: 'Provenance capture was interrupted. No capture-time hashes are available.',
        normalizationStatus: 'unavailable', normalizationWarning: 'Result normalization was interrupted.',
        normalizedFindingCount: 0, recoveredAt: Date.now() };
      try {
        if (typeof record.lastRunId === 'string' && /^run-[A-Za-z0-9_-]{1,76}$/.test(record.lastRunId)) {
          const directory = this.directory(record.id);
          const runPath = safePath(directory, `${record.lastRunId}/run.json`);
          if (fs.existsSync(runPath)) {
            if (fs.statSync(runPath).size > 1024 * 1024) throw new Error('Run metadata is too large.');
            const run = JSON.parse(fs.readFileSync(runPath, 'utf8'));
            if (run?.caseId !== record.id || run.runId !== record.lastRunId) throw new Error('Run identity does not match the case.');
            // A tool may already have finished before the application stopped during capture.
            if (['complete', 'failed', 'cancelled', 'timed-out', 'interrupted'].includes(run.status)) {
              Object.assign(changes, { status: run.status, error: run.error || null });
              for (const field of ['finished', 'duration', 'exitCode']) if (run[field] !== undefined) changes[field] = run[field];
            }
            if (fs.existsSync(safePath(directory, `${record.lastRunId}/evidence.json`))) {
              changes.evidenceStatus = run.evidenceStatus === 'captured' ? 'captured' : 'needs-review';
              changes.evidenceWarning = changes.evidenceStatus === 'captured' ? null :
                'Application closed during finalization. Inspect Run provenance for the available manifest and any warnings.';
            } else if (run.evidenceStatus === 'failed' && typeof run.evidenceWarning === 'string') {
              changes.evidenceStatus = 'failed';
              changes.evidenceWarning = run.evidenceWarning;
            }
            if (fs.existsSync(safePath(directory, `${record.lastRunId}/normalized-results.json`))) {
              changes.normalizationStatus = run.normalizationStatus === 'captured' ? 'captured' : 'needs-review';
              changes.normalizationWarning = changes.normalizationStatus === 'captured' ? run.normalizationWarning || null :
                'Application closed during finalization. Inspect Normalized findings and any warnings.';
              if (Number.isSafeInteger(run.normalizedFindingCount) && run.normalizedFindingCount >= 0) {
                changes.normalizedFindingCount = run.normalizedFindingCount;
              }
            } else if (run.normalizationStatus === 'unsupported') {
              changes.normalizationStatus = 'unsupported';
              changes.normalizationWarning = null;
            } else if (run.normalizationStatus === 'failed' && typeof run.normalizationWarning === 'string') {
              changes.normalizationStatus = 'failed';
              changes.normalizationWarning = run.normalizationWarning;
            }
            // Recovery time is not an observed finish/capture time. Never create replacement hashes or normalized results here.
            writeJSON(runPath, { ...run, status: changes.status, error: changes.error,
              evidenceStatus: changes.evidenceStatus, evidenceWarning: changes.evidenceWarning,
              normalizationStatus: changes.normalizationStatus, normalizationWarning: changes.normalizationWarning,
              normalizedFindingCount: changes.normalizedFindingCount, recoveredAt: changes.recoveredAt });
          }
        }
      } catch (error) {
        changes.evidenceWarning = `Provenance recovery unavailable: ${error.message}`;
      }
      this.update(record.id, changes);
    }
  }

  delete(id) {
    const directory = this.directory(id);
    if (!fs.existsSync(directory)) throw new Error('Case not found.');
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

module.exports = { CaseStore, validId, safePath, writeJSON };
