'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { safePath, validId, writeJSON } = require('./store');

const SCHEMA_VERSION = 1;
const NORMALIZED_FILE = 'normalized-results.json';
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_FINDINGS = 5000;
const SUPPORTED_TOOLS = new Set(['sherlock', 'maigret']);

function readText(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > MAX_INPUT_BYTES) throw new Error('Result source is not a regular file or is too large.');
  return fs.readFileSync(file, 'utf8');
}

function canonicalizeUrl(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim().replace(/[),.;]+$/, '');
  if (!raw) return null;
  let parsed;
  try { parsed = new URL(raw); } catch { return null; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  parsed.hash = '';
  parsed.hostname = parsed.hostname.toLowerCase();
  if ((parsed.protocol === 'https:' && parsed.port === '443') || (parsed.protocol === 'http:' && parsed.port === '80')) parsed.port = '';
  if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return { url: parsed.toString(), key: parsed.toString() };
}

function cleanStrings(values, limit = 64) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter(value => typeof value === 'string').map(value => value.trim()).filter(Boolean))].slice(0, limit);
}

function cleanObserved(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output = {};
  for (const [key, item] of Object.entries(value).slice(0, 50)) {
    if (typeof key !== 'string' || key.length > 100) continue;
    if (typeof item === 'string') output[key] = item.slice(0, 2000);
    else if (typeof item === 'number' || typeof item === 'boolean' || item === null) output[key] = item;
    else if (Array.isArray(item)) output[key] = item.slice(0, 25).map(entry =>
      typeof entry === 'string' ? entry.slice(0, 500) : entry).filter(entry =>
      typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean' || entry === null);
  }
  return output;
}

function evidenceSource(evidence, name, line = null) {
  const artifact = evidence?.artifacts?.find(item => item?.name === name);
  return {
    file: name,
    line: Number.isSafeInteger(line) && line > 0 ? line : null,
    sha256: artifact?.hashStatus === 'computed' ? artifact.sha256 : null
  };
}

function addFinding(map, finding) {
  const normalized = canonicalizeUrl(finding.url);
  if (!normalized) return;
  const key = normalized.key;
  const existing = map.get(key);
  const next = {
    key,
    site: typeof finding.site === 'string' && finding.site.trim() ? finding.site.trim().slice(0, 200) : new URL(normalized.url).hostname,
    url: normalized.url,
    username: typeof finding.username === 'string' && finding.username ? finding.username.slice(0, 320) : '',
    classification: 'candidate',
    siteTags: cleanStrings(finding.siteTags),
    observed: cleanObserved(finding.observed),
    sources: Array.isArray(finding.sources) ? finding.sources.filter(source => source && typeof source.file === 'string').slice(0, 20) : []
  };
  if (!existing) {
    if (map.size >= MAX_FINDINGS) throw new Error('Normalized finding limit exceeded.');
    map.set(key, next);
    return;
  }
  existing.siteTags = [...new Set([...existing.siteTags, ...next.siteTags])].slice(0, 64);
  for (const source of next.sources) {
    if (!existing.sources.some(item => item.file === source.file && item.line === source.line)) existing.sources.push(source);
  }
  if (!existing.username && next.username) existing.username = next.username;
  if (!Object.keys(existing.observed).length && Object.keys(next.observed).length) existing.observed = next.observed;
}

function normalizeSherlock(runDirectory, target, evidence) {
  const findings = new Map();
  const warnings = [];
  const txtPath = safePath(runDirectory, 'sherlock.txt');
  if (fs.existsSync(txtPath)) {
    const lines = readText(txtPath).split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const value = lines[index].trim();
      if (/^https?:\/\//i.test(value)) {
        let site = '';
        try { site = new URL(value).hostname; } catch { /* ignored */ }
        addFinding(findings, { site, url: value, username: target,
          sources: [evidenceSource(evidence, 'sherlock.txt', index + 1)] });
      }
    }
  }

  const stdoutPath = safePath(runDirectory, 'stdout.log');
  if (fs.existsSync(stdoutPath)) {
    const lines = readText(stdoutPath).split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const match = lines[index].match(/^\[\+\]\s+(.+?):\s+(https?:\/\/\S+)\s*$/);
      if (!match) continue;
      addFinding(findings, { site: match[1], url: match[2], username: target,
        sources: [evidenceSource(evidence, 'stdout.log', index + 1)] });
    }
  }
  return { findings: [...findings.values()], warnings };
}

function normalizeMaigret(runDirectory, target, evidence) {
  const findings = new Map();
  const warnings = [];
  const files = fs.readdirSync(runDirectory, { withFileTypes: true })
    .filter(entry => entry.isFile() && /^report_.+_simple\.json$/i.test(entry.name))
    .map(entry => entry.name).sort();

  const stdoutPath = safePath(runDirectory, 'stdout.log');
  if (fs.existsSync(stdoutPath)) {
    const stdout = readText(stdoutPath);
    const errorRate = stdout.match(/Too many errors of type "([^"]+)" \(([\d.]+)%\)/i);
    if (errorRate) warnings.push(`Maigret reported ${errorRate[2]}% ${errorRate[1]} site-check errors; those checks are inconclusive.`);
  }
  if (!files.length) warnings.push('No Maigret simple JSON report was found; no candidate accounts were normalized.');
  for (const name of files) {
    const file = safePath(runDirectory, name);
    let data;
    try {
      data = JSON.parse(readText(file));
    } catch (error) {
      warnings.push(`${name}: could not parse JSON (${error.message}).`);
      continue;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      warnings.push(`${name}: expected a site-keyed JSON object.`);
      continue;
    }
    for (const [site, item] of Object.entries(data)) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const status = item.status && typeof item.status === 'object' ? item.status : {};
      const url = item.url_user || status.url;
      const username = item.username || status.username || target;
      addFinding(findings, {
        site,
        url,
        username,
        siteTags: status.tags,
        observed: item.ids_data || status.ids,
        sources: [evidenceSource(evidence, name)]
      });
    }
  }
  return { findings: [...findings.values()], warnings };
}

function normalizeRun({ caseId, runId, runDirectory, tool, target, runStatus, evidence = null }) {
  validId(caseId);
  validId(runId);
  if (!SUPPORTED_TOOLS.has(tool)) return { status: 'unsupported', count: 0, warnings: [] };
  if (path.basename(runDirectory) !== runId) throw new Error('Run directory does not match run ID.');
  const result = tool === 'sherlock' ? normalizeSherlock(runDirectory, target, evidence) :
    normalizeMaigret(runDirectory, target, evidence);
  const report = {
    schemaVersion: SCHEMA_VERSION,
    caseId,
    runId,
    tool,
    target,
    runStatus,
    generatedAt: Date.now(),
    reviewStatus: 'unreviewed',
    identityVerified: false,
    findings: result.findings,
    warnings: result.warnings
  };
  writeJSON(safePath(runDirectory, NORMALIZED_FILE), report);
  return { status: 'captured', count: report.findings.length, warnings: report.warnings };
}

function validSource(source) {
  return source && typeof source.file === 'string' && source.file.length > 0 && source.file.length <= 500 &&
    (source.line === null || (Number.isSafeInteger(source.line) && source.line > 0)) &&
    (source.sha256 === null || (typeof source.sha256 === 'string' && /^[a-f0-9]{64}$/.test(source.sha256)));
}

function validFinding(finding) {
  return finding && typeof finding.key === 'string' && finding.key.length <= 4000 &&
    typeof finding.site === 'string' && finding.site.length <= 200 &&
    typeof finding.url === 'string' && finding.url.length <= 4000 &&
    typeof finding.username === 'string' && finding.username.length <= 320 &&
    finding.classification === 'candidate' && Array.isArray(finding.siteTags) &&
    finding.siteTags.every(tag => typeof tag === 'string' && tag.length <= 200) &&
    finding.observed && typeof finding.observed === 'object' && !Array.isArray(finding.observed) &&
    Array.isArray(finding.sources) && finding.sources.every(validSource);
}

function readNormalized(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > MAX_INPUT_BYTES) throw new Error('Normalized result file is not a regular file or is too large.');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function listCaseFindings(caseDirectory, caseId) {
  validId(caseId);
  const warnings = [];
  const raw = [];
  if (!fs.existsSync(caseDirectory)) return { findings: [], warnings, reportedCount: 0, uniqueCount: 0 };
  for (const entry of fs.readdirSync(caseDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !/^run-[A-Za-z0-9_-]{1,76}$/.test(entry.name)) continue;
    const file = safePath(caseDirectory, `${entry.name}/${NORMALIZED_FILE}`);
    if (!fs.existsSync(file)) continue;
    try {
      const report = readNormalized(file);
      if (report?.schemaVersion !== SCHEMA_VERSION || report.caseId !== caseId || report.runId !== entry.name ||
          !SUPPORTED_TOOLS.has(report.tool) || typeof report.target !== 'string' || typeof report.runStatus !== 'string' ||
          !Number.isSafeInteger(report.generatedAt) || report.reviewStatus !== 'unreviewed' ||
          report.identityVerified !== false || !Array.isArray(report.findings) || report.findings.length > MAX_FINDINGS ||
          !report.findings.every(validFinding) || !Array.isArray(report.warnings) ||
          !report.warnings.every(message => typeof message === 'string')) throw new Error('Invalid normalized result record.');
      for (const message of report.warnings) warnings.push({ runId: entry.name, message });
      for (const finding of report.findings) raw.push({ ...finding, tool: report.tool, runId: report.runId });
    } catch (error) {
      warnings.push({ runId: entry.name, message: `Normalized findings unavailable: ${error.message}` });
    }
  }

  const grouped = new Map();
  for (const finding of raw) {
    const existing = grouped.get(finding.key);
    const observation = {
      tool: finding.tool,
      runId: finding.runId,
      username: finding.username,
      observed: finding.observed,
      sources: finding.sources
    };
    if (!existing) {
      grouped.set(finding.key, {
        key: finding.key,
        site: finding.site,
        url: finding.url,
        usernames: finding.username ? [finding.username] : [],
        tools: [finding.tool],
        classification: 'candidate',
        siteTags: [...finding.siteTags],
        observations: [observation]
      });
      continue;
    }
    if (finding.username && !existing.usernames.includes(finding.username)) existing.usernames.push(finding.username);
    if (!existing.tools.includes(finding.tool)) existing.tools.push(finding.tool);
    existing.siteTags = [...new Set([...existing.siteTags, ...finding.siteTags])].slice(0, 64);
    existing.observations.push(observation);
  }

  const findings = [...grouped.values()].map(finding => ({
    ...finding,
    classification: finding.tools.length >= 2 ? 'corroborated' : 'candidate',
    corroboration: finding.tools.length >= 2 ?
      'Same public account URL was reported by two or more distinct tools; this does not verify the account owner’s identity.' : null
  })).sort((a, b) => a.site.localeCompare(b.site) || a.url.localeCompare(b.url));

  return { findings, warnings, reportedCount: raw.length, uniqueCount: findings.length };
}

module.exports = { normalizeRun, listCaseFindings, canonicalizeUrl, NORMALIZED_FILE };
