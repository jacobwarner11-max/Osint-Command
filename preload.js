'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', Object.freeze({
  checkTool: tool => ipcRenderer.invoke('check-tool', tool),
  getTools: () => ipcRenderer.invoke('get-tools'),
  runTool: request => ipcRenderer.invoke('run-tool', request),
  killTool: request => ipcRenderer.invoke('kill-tool', request),
  onToolProgress: callback => {
    if (typeof callback !== 'function') throw new TypeError('Expected a callback.');
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('tool-progress', listener);
    return () => ipcRenderer.removeListener('tool-progress', listener);
  },
  getAllCases: () => ipcRenderer.invoke('get-all-cases'),
  getResults: id => ipcRenderer.invoke('get-results', id),
  getCaseEvidence: id => ipcRenderer.invoke('get-case-evidence', id),
  saveCaseMeta: request => ipcRenderer.invoke('save-case-meta', request),
  deleteCase: id => ipcRenderer.invoke('delete-case', id),
  openResultsFolder: id => ipcRenderer.invoke('open-results-folder', id),
  openResultsRoot: () => ipcRenderer.invoke('open-results-root'),
  saveConsole: text => ipcRenderer.invoke('save-console', text),
  copyResultPath: request => ipcRenderer.invoke('copy-result-path', request),
  saveResult: request => ipcRenderer.invoke('save-result', request),
  exportCase: request => ipcRenderer.invoke('export-case', request),
  clearAllResults: () => ipcRenderer.invoke('clear-all-results'),
  getAppInfo: () => ipcRenderer.invoke('get-app-info')
}));
