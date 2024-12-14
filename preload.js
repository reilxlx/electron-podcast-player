const { contextBridge, ipcRenderer } = require('electron');

// 添加翻译进度事件监听器
let translationProgressCallback = null;
ipcRenderer.on('translation-progress', (event, data) => {
    if (translationProgressCallback) {
        translationProgressCallback(data);
    }
});

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
  
  // 修改进度事件监听器的注册方式
  onTranslationProgress: (callback) => {
    translationProgressCallback = callback;
    return () => {
      translationProgressCallback = null;
    };
  },

  onAudioIndexUpdated: (callback) => {
    ipcRenderer.on('audio-index-updated', () => callback());
    return () => ipcRenderer.removeAllListeners('audio-index-updated');
  },

  getSubtitleFilePath: (hash) => ipcRenderer.invoke('get-subtitle-filepath', hash)
});