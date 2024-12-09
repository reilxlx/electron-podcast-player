const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { 
  loadAudioIndex, saveAudioIndex, getFileHash, 
  loadConfig, saveConfig, saveSubtitleCache, loadSubtitleCache 
} = require('./src/services/fileService');
const { transcribeAudio } = require('./src/services/transcriptionService');
const { translateTextBatch } = require('./src/services/translationService');
const { parseTranscript, generateSubtitleTimes } = require('./src/services/subtitleParser');
const { AssemblyAI } = require('assemblyai');
const fs = require('fs');

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

  ipcMain.handle('transcribe-audio', async (event, fileInfo) => {
    try {
        console.log('[主进程] 开始处理音频转录请求');
        
        // 从配置文件中读取ASR API Key
        console.log('[主进程] 加载配置文��...');
        const config = loadConfig();
        if (!config.asr_api_key) {
            console.error('[主进程] 未找到ASR API Key');
            throw new Error('未找到ASR API Key，请在配置文件中设置asr_api_key');
        }

        // 调用转录服务
        console.log('[主进程] 调用转录服务...');
        const transcript = await transcribeAudio(fileInfo.filePath, config.asr_api_key);
        
        // 解析转录结果
        console.log('[主进程] 解析转录结果...');
        const subtitles = [];
        if (transcript.utterances) {
            transcript.utterances.forEach((utterance, index) => {
                subtitles.push({
                    index: index,
                    speaker: utterance.speaker,
                    text: utterance.text,
                    start_time: utterance.start,
                    end_time: utterance.end,
                    words: utterance.words || []
                });
            });
        }

        // 构建完整的字幕数据对象
        const subtitleData = {
            subtitles: transcript.subtitles, // 使用转录服务返回的格式化字幕
            file_path: fileInfo.filePath     // 添加文件路径
        };

        // 保存字幕缓存
        console.log('[主进程] 保存字幕缓存...');
        await saveSubtitleCache(fileInfo.hash, subtitleData);

        // 更新音频索引
        console.log('[主进程] 更新音频索引...');
        const audioIndex = loadAudioIndex();
        audioIndex[fileInfo.hash] = {
            file_path: fileInfo.filePath,
            subtitle_file: `podcast_data/subtitles/${fileInfo.hash}.json`
        };
        saveAudioIndex(audioIndex);

        console.log('[主进程] 音频处理完成');
        return subtitleData;
    } catch (error) {
        console.error('[主进程] 音频转录失败:', error);
        throw error;
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

  ipcMain.handle('delete-history-file', async (event, hash) => {
    try {
        // 删除字幕文件
        const subtitlePath = path.join(__dirname, 'podcast_data/subtitles', `${hash}.json`);
        if (fs.existsSync(subtitlePath)) {
            fs.unlinkSync(subtitlePath);
        }
        
        // 从索引中删除记录
        delete audioIndex[hash];
        saveAudioIndex(audioIndex);
        
        return true;
    } catch (error) {
        console.error('删除历史文件失败:', error);
        throw error;
    }
  });

  ipcMain.handle('show-confirm-dialog', async (event, options) => {
    const result = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: options.buttons,
        title: options.title,
        message: options.message,
        defaultId: 1,
        cancelId: 1,
    });
    return result.response;
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