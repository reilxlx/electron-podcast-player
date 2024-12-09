const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAudioIndex: () => ipcRenderer.invoke('get-audio-index'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  selectAudio: (filePath) => ipcRenderer.invoke('select-audio', filePath),
  transcribeAudio: (fileInfo) => ipcRenderer.invoke('transcribe-audio', fileInfo),
  translateSubtitles: (params) => ipcRenderer.invoke('translate-subtitles', params),
  loadCachedData: (fileHash) => ipcRenderer.invoke('load-cached-data', fileHash),
  saveConfig: (newConfig) => ipcRenderer.invoke('save-config', newConfig),

  selectAudioFile: () => ipcRenderer.invoke('select-audio-file'),
  getSiliconCloudApiKey: () => ipcRenderer.invoke('get-silicon-cloud-api-key'),
  deleteHistoryFile: (hash) => ipcRenderer.invoke('delete-history-file', hash),
  showConfirmDialog: (options) => ipcRenderer.invoke('show-confirm-dialog', options),
});