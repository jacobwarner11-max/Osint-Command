'use strict';

const fs = require('node:fs');
const archiver = require('archiver');

function createZip(files, destination) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 });
    const archive = archiver('zip', { zlib: { level: 9 } });
    let failure = null;
    function fail(error) {
      if (failure) return;
      failure = error;
      archive.abort();
      output.destroy();
    }
    output.once('error', fail);
    archive.once('error', fail);
    archive.on('warning', fail);
    output.once('close', () => { if (failure) reject(failure); else resolve(); });
    archive.pipe(output);
    for (const file of files) archive.file(file.path, { name: file.name });
    archive.finalize().catch(fail);
  });
}

module.exports = { createZip };
