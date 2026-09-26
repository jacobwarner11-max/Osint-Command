'use strict';

const path = require('node:path');
const os = require('node:os');
const { domainToASCII } = require('node:url');
const which = require('which');

// CLI references are listed in SOURCES.md. Tools must be installed separately.
const TOOLS = Object.freeze({
  sherlock: {
    name: 'Sherlock', type: 'username', commands: ['sherlock'], timeout: 300000,
    description: 'Username search across social networks', tags: ['username', 'social'], risk: 'open',
    args: (target, directory) => [target, '--output', path.join(directory, 'sherlock.txt'), '--timeout', '30', '--no-color']
  },
  maigret: {
    name: 'Maigret', type: 'username', commands: ['maigret'], timeout: 600000,
    description: 'Username investigation and account reports', tags: ['username', 'deep'], risk: 'open',
    args: (target, directory) => [target, '--json', 'simple', '--folderoutput', directory, '--timeout', '30']
  },
  holehe: {
    name: 'Holehe', type: 'email', commands: ['holehe'], timeout: 120000,
    description: 'Email registration checks; console results are saved', tags: ['email', 'reg'], risk: 'regulated',
    args: target => [target]
  },
  phoneinfoga: {
    name: 'PhoneInfoga', type: 'phone', commands: ['phoneinfoga'], timeout: 120000,
    description: 'Phone number OSINT; console results are saved', tags: ['phone', 'recon'], risk: 'open',
    args: target => ['scan', '-n', target]
  },
  theharvester: {
    name: 'theHarvester', type: 'domain', commands: ['theHarvester', 'theharvester'], timeout: 300000,
    description: 'Domain, email and hostname discovery', tags: ['domain', 'email'], risk: 'open',
    args: (target, directory) => ['-d', target, '-b', 'all', '-f', path.join(directory, 'theharvester')]
  },
  subfinder: {
    name: 'Subfinder', type: 'domain', commands: ['subfinder'], timeout: 180000,
    description: 'Passive subdomain discovery', tags: ['domain', 'sub'], risk: 'open',
    args: (target, directory) => ['-d', target, '-oJ', '-o', path.join(directory, 'subfinder.jsonl'), '-silent']
  },
  amass: {
    name: 'Amass', type: 'domain', commands: ['amass'], timeout: 300000,
    description: 'Passive domain enumeration; results vary with installed version', tags: ['domain', 'heavy'], risk: 'heavy',
    args: target => ['enum', '-d', target, '-passive']
  }
});

function getTool(id) {
  if (typeof id !== 'string' || !Object.hasOwn(TOOLS, id)) throw new Error('Unknown tool.');
  return TOOLS[id];
}

function validateTarget(type, input) {
  if (typeof input !== 'string') throw new Error('Enter a target.');
  const target = input.trim();
  if (!target || target.length > 320 || /[\x00-\x1f\x7f]/.test(target) || target.startsWith('-')) throw new Error('Invalid target.');
  if (type === 'username') {
    if (!/^[\p{L}\p{N}_][\p{L}\p{N}_.-]{0,99}$/u.test(target) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(target)) throw new Error('Enter a username containing letters, numbers, dots, underscores or hyphens.');
    return target;
  }
  if (type === 'email') {
    if (target.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) throw new Error('Enter a valid email address.');
    return target;
  }
  if (type === 'phone') {
    if (!/^\+?[\d ()-]+$/.test(target)) throw new Error('Enter a phone number including country code.');
    const digits = target.replace(/\D/g, '');
    if (!/^[1-9]\d{6,14}$/.test(digits)) throw new Error('Enter 7–15 digits, including country code.');
    return `+${digits}`;
  }
  if (type === 'domain') {
    const domain = domainToASCII(target.toLowerCase());
    if (!domain || domain.length > 253 || !domain.includes('.') || /^\d+(\.\d+){3}$/.test(domain) ||
        domain.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new Error('Enter a domain such as example.com, without a URL or path.');
    return domain;
  }
  throw new Error('Unknown target type.');
}

function toolEnvironment() {
  const env = { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', NO_COLOR: '1', TERM: 'dumb' };
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH';
  const extras = [path.join(os.homedir(), '.local', 'bin'), path.join(os.homedir(), 'go', 'bin')];
  if (process.platform !== 'win32') extras.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin');
  // Ignore empty/relative PATH entries; never resolve executables from a case directory.
  env[pathKey] = [...new Set([...(env[pathKey] || '').split(path.delimiter), ...extras].filter(entry => path.isAbsolute(entry)))].join(path.delimiter);
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  return { env, executablePath: env[pathKey] };
}

async function resolveTool(id) {
  const definition = getTool(id);
  const { env, executablePath } = toolEnvironment();
  for (const command of definition.commands) {
    const executable = await which(command, { path: executablePath, nothrow: true });
    if (executable && !(process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable))) return { executable, env };
  }
  throw new Error(`${definition.name} was not found. Install its native executable or Python console entry point and add it to PATH.`);
}

module.exports = { TOOLS, getTool, validateTarget, resolveTool };
