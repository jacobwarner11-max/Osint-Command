'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');

const LOG_LIMIT = 20 * 1024 * 1024;
const TAIL_LIMIT = 50000;

function terminateTree(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  if (process.platform !== 'win32') {
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') return Promise.reject(error); }
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const command = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
    const killer = spawn(command, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
    killer.once('error', reject);
    killer.once('close', code => {
      if (code === 0 || child.exitCode !== null || child.signalCode !== null) resolve();
      else reject(new Error(`Unable to stop the process tree (taskkill exit ${code}).`));
    });
  });
}

function startProcess({ executable, args, cwd, env, timeout, onProgress = () => {} }) {
  const started = Date.now();
  const descriptors = {};
  try {
    descriptors.stdout = fs.openSync(path.join(cwd, 'stdout.log'), 'wx', 0o600);
    descriptors.stderr = fs.openSync(path.join(cwd, 'stderr.log'), 'wx', 0o600);
  } catch (error) {
    for (const fd of Object.values(descriptors)) fs.closeSync(fd);
    throw error;
  }
  let child, timer, progressTimer, done = false, stopping = null, launchError = null;
  const tails = { stdout: '', stderr: '' };
  const bytes = { stdout: 0, stderr: 0 };
  const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
  let pending = [];
  let resolveResult;
  const result = new Promise(resolve => { resolveResult = resolve; });

  function flush() {
    clearTimeout(progressTimer);
    progressTimer = null;
    const events = pending;
    pending = [];
    for (const event of events) {
      try { onProgress(event); } catch { /* The renderer may have closed. */ }
    }
  }

  function progress(stream, text) {
    const field = stream === 'stdout' ? 'output' : 'error';
    const last = pending.at(-1);
    if (last?.[field] !== undefined) last[field] = (last[field] + text).slice(-65536);
    else pending.push({ [field]: text.slice(-65536), timestamp: Date.now() });
    if (pending.length > 20) flush();
    else if (!progressTimer) progressTimer = setTimeout(flush, 80);
  }

  async function cancel(reason = 'cancelled') {
    if (done) return;
    const previous = stopping;
    stopping = stopping || reason;
    try { await terminateTree(child); }
    catch (error) { stopping = previous; throw error; }
  }

  function failAndStop(error) {
    launchError = error;
    void cancel('failed').catch(stopError => {
      launchError = new Error(`${error.message} ${stopError.message}`);
      // Do not report completion while a child is still alive.
      progress('stderr', `${launchError.message}\n`);
    });
  }

  function consume(stream, chunk) {
    if (done) return;
    const available = Math.max(0, LOG_LIMIT - bytes[stream]);
    const data = chunk.subarray(0, available);
    try {
      let offset = 0;
      while (offset < data.length) offset += fs.writeSync(descriptors[stream], data, offset);
      bytes[stream] += data.length;
      const text = decoders[stream].write(data);
      tails[stream] = (tails[stream] + text).slice(-TAIL_LIMIT);
      progress(stream, text);
      if (data.length < chunk.length) failAndStop(new Error(`${stream} exceeded the ${LOG_LIMIT / 1048576} MB log limit.`));
    } catch (error) { failAndStop(error); }
  }

  function finish(code, signal) {
    if (done) return;
    done = true;
    clearTimeout(timer);
    for (const stream of ['stdout', 'stderr']) {
      const tail = decoders[stream].end();
      if (tail) { tails[stream] = (tails[stream] + tail).slice(-TAIL_LIMIT); progress(stream, tail); }
      try { fs.closeSync(descriptors[stream]); }
      catch (error) { launchError = launchError || error; }
    }
    flush();
    const status = launchError ? 'failed' : stopping || (code === 0 ? 'complete' : 'failed');
    const error = launchError?.message || (status === 'timed-out' ? `Timeout after ${timeout / 1000}s.` :
      status === 'cancelled' ? 'Stopped by user.' : status === 'failed' ? `Process exited with ${signal || `code ${code}`}.` : null);
    resolveResult({ success: status === 'complete', status, exitCode: code, signal,
      duration: Date.now() - started, error, stdout: tails.stdout, stderr: tails.stderr });
  }

  try {
    child = spawn(executable, args, { cwd, env, windowsHide: true, shell: false,
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => consume('stdout', chunk));
    child.stderr.on('data', chunk => consume('stderr', chunk));
    child.stdout.on('error', failAndStop);
    child.stderr.on('error', failAndStop);
    child.once('error', error => { launchError = error; });
    child.once('close', finish);
    timer = setTimeout(() => { void cancel('timed-out').catch(failAndStop); }, timeout);
    timer.unref();
  } catch (error) {
    launchError = error;
    finish(null, null);
  }

  return { result, cancel, get pid() { return child?.pid; } };
}

module.exports = { startProcess, terminateTree, LOG_LIMIT };
