const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { 
  loadAudioIndex, saveAudioIndex, getFileHash, 
  loadConfig, saveConfig, saveSubtitleCache, loadSubtitleCache 
} = require('./src/services/fileService');
const { transcribeAudio } = require('./src/services/transcriptionService');
const { translateTextBatch } = require('./src/services/translationService');
const { parseTranscript, generateSubtitleTimes } = require('./src/services/subtitleParser');

let mainWindow = null;
let audioIndex = {};
let config = {};

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src/renderer/index.html'));
  
  // 加载配置与音频索引
  audioIndex = loadAudioIndex();
  config = loadConfig();

  // 监听IPC事件
  ipcMain.handle('get-audio-index', () => audioIndex);
  ipcMain.handle('get-config', () => config);

  ipcMain.handle('select-audio', async (event, filePath) => {
    // 计算hash，用于检查缓存
    let fileHash = await getFileHash(filePath);
    if (audioIndex[fileHash]) {
      // 缓存存在
      let cachedData = loadSubtitleCache(fileHash);
      return { fileHash, cachedData };
    } else {
      // 无缓存，需要转录
      return { fileHash, cachedData: null };
    }
  });

  ipcMain.handle('transcribe-audio', async (event, {filePath, apiKey, fileHash}) => {
    try {
      let transcript = await transcribeAudio(filePath, apiKey);
      // 解析转录结果
      let subtitles = parseTranscript(transcript);
      let translations = {}; // 初始无翻译
      // 保存缓存
      saveSubtitleCache(fileHash, {
        subtitles,
        translations,
        filePath
      });
      audioIndex[fileHash] = {
        file_path: filePath,
        subtitle_file: fileHash + '.json'
      };
      saveAudioIndex(audioIndex);
      return { subtitles, translations };
    } catch (err) {
      console.error(err);
      throw err;
    }
  });

  ipcMain.handle('translate-subtitles', async (event, {fileHash, subtitles, translator, apiKey}) => {
    // 批量翻译
    let texts = subtitles.map((s, i) => ({index: i, text: s.text}));
    let result = await translateTextBatch(texts, translator, apiKey);
    // 加载缓存
    let cachedData = loadSubtitleCache(fileHash);
    cachedData.translations = result;
    saveSubtitleCache(fileHash, cachedData);
    return result;
  });

  ipcMain.handle('load-cached-data', (event, fileHash) => {
    return loadSubtitleCache(fileHash);
  });

  ipcMain.handle('save-config', (event, newConfig) => {
    config = newConfig;
    saveConfig(config);
  });

  ipcMain.handle('select-audio-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Audio Files', extensions: ['mp3', 'wav', 'm4a', 'ogg'] }
      ]
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });
}
// 添加IPC处理器
ipcMain.handle('get-silicon-cloud-api-key', async () => {
  try {
      const configPath = path.join(__dirname, '../../podcast_data/config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return config.silicon_cloud_api_key || '';
  } catch (error) {
      console.error('获取API Key失败:', error);
      return '';
  }
});
// 在 createWindow 函数开始处添加
process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
});

// 在 app.whenReady() 中添加错误处理
app.whenReady().then(createWindow).catch((error) => {
  console.error('应用启动错误:', error);
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});