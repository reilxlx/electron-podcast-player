const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { 
  loadAudioIndex, saveAudioIndex, getFileHash, 
  loadConfig, saveConfig, saveSubtitleCache, loadSubtitleCache, setSiliconCloudModel, setSiliconCloudApiKey 
} = require('./src/services/fileService');
const { transcribeAudio } = require('./src/services/transcriptionService');
const { translateTextBatch } = require('./src/services/translationService');
const { summarizeContent } = require('./src/services/summaryService');
const { parseTranscript, generateSubtitleTimes } = require('./src/services/subtitleParser');
const { AssemblyAI } = require('assemblyai');
const fs = require('fs');
const { textToSpeech } = require('./src/services/ttsService');
const { transcribeAudio: whisperTranscribe, saveTranscriptionResult } = require('./src/services/whisperTranscriptionService');

let mainWindow = null;
let audioIndex = {};
let config = {};

const isDev = process.env.NODE_ENV === 'development';

// 获取 podcast_data 文件夹的路径
const getPodcastDataPath = () => {
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    return path.join(__dirname, 'podcast_data');
  } else {
    return path.join(process.resourcesPath, 'podcast_data');
  }
};

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    titleBarStyle: 'hiddenInset',  // macOS 专属的隐藏标题栏样式
    trafficLightPosition: { x: 20, y: 16 }, // 调整红绿灯按钮位置，增加左边距
    vibrancy: 'sidebar',  // 添加毛玻璃效果
    visualEffectState: 'active',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // 设置窗口背景色为透明
  mainWindow.setBackgroundColor('#00000000');

  mainWindow.loadFile(path.join(__dirname, 'src/renderer/index.html'));
  
  // 加载配置与音频索引
  audioIndex = loadAudioIndex();
  config = loadConfig();

  // 监听IPC事件
  ipcMain.handle('get-audio-index', () => audioIndex);
  ipcMain.handle('get-config', () => config);

  ipcMain.handle('select-audio', async (event, filePath) => {
    try {
        console.log('[主进程] 选择音频文件:', filePath);
        
        // 检查文件是否存在
        if (!fs.existsSync(filePath)) {
            throw new Error('音频文件不存在');
        }

        // 计算hash，用于检查缓存
        console.log('[主进程] 计算文件hash...');
        let fileHash = await getFileHash(filePath);
        console.log('[主进程] 文件hash:', fileHash);

        // 检查音频索引
        if (audioIndex[fileHash]) {
            console.log('[主进程] 在索引中找到文件记录');
            // 检查文件路径是否变更
            if (audioIndex[fileHash].file_path !== filePath) {
                console.log('[主进程] 文件路径已变更，更新索引');
                audioIndex[fileHash].file_path = filePath;
                saveAudioIndex(audioIndex);
            }

            // 加载缓存
            let cachedData = loadSubtitleCache(fileHash);
            if (cachedData === null) {
                console.log('[主进程] 缓存无效或已损坏，需要重新转录');
                // 从索引中删除无效记录
                delete audioIndex[fileHash];
                saveAudioIndex(audioIndex);
                return { fileHash, cachedData: null };
            }
            return { fileHash, cachedData };
        } else {
            console.log('[主进程] 文件未在索引中找到，需要转录');
            return { fileHash, cachedData: null };
        }
    } catch (error) {
        console.error('[主进程] 选择音频文件失败:', error);
        throw error;
    }
  });

  ipcMain.handle('transcribe-audio', async (event, fileInfo) => {
    try {
        console.log('[主进程] 开始处理音频转录请求');
        console.log('[主进程] 使用的转录服务:', fileInfo.transcriptionService);

        // 从配置文件中读取配置
        console.log('[主进程] 加载配置文件...');
        const config = loadConfig();

        let subtitleData;
        
        // 根据传入的转录服务类型选择转录引擎
        if (fileInfo.transcriptionService === 'whisper') {
            // 检查Whisper服务器URL配置
            if (!config.whisper_server_url) {
                throw new Error('未配置Whisper服务器URL，请在设置中配置');
            }
            
            // 使用Whisper服务
            console.log('[主进程] 使用Whisper服务进行转录...');
            const subtitles = await whisperTranscribe(fileInfo.filePath, config.whisper_server_url);
            console.log('[主进程] Whisper转录结果:', subtitles);
            
            if (!subtitles || !Array.isArray(subtitles) || subtitles.length === 0) {
                throw new Error('Whisper转录失败：未获取到有效的转录结果');
            }

            // 保存转录结果
            const subtitlePath = await saveTranscriptionResult(fileInfo.filePath, subtitles);
            console.log('[主进程] 转录结果已保存到:', subtitlePath);
            
            subtitleData = {
                subtitles: subtitles,
                file_path: fileInfo.filePath,
                translations: {}
            };

            // 保存字幕缓存
            console.log('[主进程] 保存字幕缓存...');
            await saveSubtitleCache(fileInfo.hash, subtitleData);

        } else if (fileInfo.transcriptionService === 'assemblyai') {
            // 检查AssemblyAI API Key配置
            if (!config.asr_api_key) {
                throw new Error('未配置AssemblyAI API Key，请在设置中配置');
            }
            
            // 使用AssemblyAI服务
            console.log('[主进程] 使用AssemblyAI服务进行转录...');
            const transcript = await transcribeAudio(fileInfo.filePath, config.asr_api_key);
            console.log('[主进程] AssemblyAI转录完成，处理转录结果...');

            // 处理转录结果
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

            // 构建字幕数据
            subtitleData = {
                subtitles: subtitles,  // 使用处理后的字幕数组
                file_path: fileInfo.filePath,
                translations: {}
            };

            // 保存字幕缓存
            console.log('[主进程] 保存AssemblyAI转录结果到缓存...');
            await saveSubtitleCache(fileInfo.hash, subtitleData);
            console.log('[主进程] AssemblyAI转录结果保存成功');

        } else {
            throw new Error('未选择转录服务或不支持的转录服务类型');
        }

        // 更新音频索引
        console.log('[主进程] 更新音频索引...');
        audioIndex[fileInfo.hash] = {
            file_path: fileInfo.filePath,
            subtitle_file: `podcast_data/subtitles/${fileInfo.hash}.json`
        };
        saveAudioIndex(audioIndex);

        // 通知渲染进程重新加载音频索引并更新列表
        console.log('[主进程] 通知渲染进程重新加载音频索引');
        mainWindow.webContents.send('audio-index-updated');

        console.log('[主进程] 音频转录完成');
        return subtitleData;
    } catch (error) {
        console.error('[主进程] 音频转录失败:', error);
        throw error;
    }
  });

  ipcMain.handle('translate-subtitles', async (event, { fileHash, subtitles, translator, apiKey, model }) => {
    console.log('[主进程] 收到翻译请求，使用的翻译器:', translator);
    try {
      const translatedSubtitles = await translateTextBatch(
        subtitles,
        translator,
        apiKey,
        (current, text) => {
          mainWindow.webContents.send('translation-progress', { current, total: subtitles.length, text });
        },
        2,
        model
      );

      // 如果是单词翻译，直接返回翻译结果
      if (fileHash === 'word_translation') {
        return translatedSubtitles;
      }

      // 更新缓存数据
      const cachedData = loadSubtitleCache(fileHash);

      // 确保 cachedData.translations 存在
      if (!cachedData.translations) {
        cachedData.translations = {};
      }

      if (cachedData) {
        // 根据翻译器类型更新 translations 对象
        if (translator === 'ollama') {
          Object.keys(translatedSubtitles).forEach(index => {
            // 确保 translatedSubtitles[index] 存在
            if (translatedSubtitles[index]) {
              cachedData.translations[index] = {
                ...translatedSubtitles[index],
                translator: `ollama:${model}`
              };
            } else {
              console.warn(`[主进程] 翻译结果中缺少索引 ${index} 的数据`);
            }
          });
        } else {
          cachedData.translations = translatedSubtitles;
        }
        // 保存更新后的缓存
        saveSubtitleCache(fileHash, cachedData);
        console.log('[主进程] 翻译结果已保存到缓存');
      }

      return translatedSubtitles;
    } catch (error) {
      console.error('[主进程] 翻译失败:', error);
      throw error;
    }
  });

  ipcMain.handle('load-cached-data', (event, fileHash) => {
    return loadSubtitleCache(fileHash);
  });

  ipcMain.handle('save-config', async (event, newConfig) => {
    try {
      const configPath = path.join(getPodcastDataPath(), 'config.json');
      let currentConfig = {};
      
      // 读取现有配置
      if (fs.existsSync(configPath)) {
        currentConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
      
      // 更新配置，保留所有字段
      const updatedConfig = {
        ...currentConfig,
        ...newConfig
      };
      
      // 确保目录存在
      const configDir = path.dirname(configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      
      // 保存配置
      fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2));
      config = updatedConfig; // 更新内存中的配置
      return config;
    } catch (error) {
      console.error('保存配置失败:', error);
      throw error;
    }
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
        console.log('[主进程] 开始删除历史文件:', hash);
        
        // 删除字幕文件
        const subtitlePath = path.join(getPodcastDataPath(), 'subtitles', `${hash}.json`);
        if (fs.existsSync(subtitlePath)) {
            console.log('[主进程] 删除字幕文件:', subtitlePath);
            fs.unlinkSync(subtitlePath);
        } else {
            console.log('[主进程] 字幕文件不存在:', subtitlePath);
        }
        
        // 从索引中删除记录
        if (audioIndex[hash]) {
            console.log('[主进程] 从索引中删除记录');
            delete audioIndex[hash];
            saveAudioIndex(audioIndex);
        }
        
        // 清理其他可能的相关文件（如果有的话）
        const cacheDir = path.join(getPodcastDataPath(), 'cache');
        const cacheFile = path.join(cacheDir, `${hash}.cache`);
        if (fs.existsSync(cacheFile)) {
            console.log('[主进程] 删除缓存文件:', cacheFile);
            fs.unlinkSync(cacheFile);
        }
        
        console.log('[主进程] 文件删除完成');
        return true;
    } catch (error) {
        console.error('[主进程] 删除历史文件失败:', error);
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

  ipcMain.handle('get-subtitle-filepath', (event, hash) => {
    const subtitlePath = path.join(getPodcastDataPath(), 'subtitles', `${hash}.json`);
    return subtitlePath;
  });

  ipcMain.handle('text-to-speech', async (event, { text, apiKey, ttsModel, index }) => {
    try {
        const audioBuffer = await textToSpeech(text, apiKey, ttsModel, index);
        return audioBuffer;
    } catch (error) {
        console.error('TTS转换失败:', error);
        throw error;
    }
  });
}
// 添加IPC处理器
ipcMain.handle('get-silicon-cloud-api-key', async () => {
  try {
    const configPath = path.join(getPodcastDataPath(), 'config.json');
    
    // 检查文件是否存在
    if (!fs.existsSync(configPath)) {
      console.warn('配置文件不存在，将创建默认配置');
      // 创建默认配置
      const defaultConfig = {
        silicon_cloud_api_key: '',
        asr_api_key: '',
        silicon_cloud_model: 'Qwen/Qwen2.5-7B-Instruct'
      };
      
      // 确保目录存在
      const configDir = path.dirname(configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      
      // 写入默认配置
      fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
      return '';
    }
    
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return config.silicon_cloud_api_key || '';
  } catch (error) {
    console.error('获取API Key失败:', error);
    return '';
  }
});

ipcMain.handle('get-silicon-cloud-model', async () => {
    try {
        const config = loadConfig();
        return config.silicon_cloud_model || 'Qwen/Qwen2.5-7B-Instruct';
    } catch (error) {
        console.error('获取SiliconCloud模型失败:', error);
        return 'Qwen/Qwen2.5-7B-Instruct';
    }
});

ipcMain.handle('set-silicon-cloud-model', async (event, { translator, model }) => {
    try {
        if (translator === 'silicon_cloud') {
            setSiliconCloudModel(model);
            return { success: true };
        }
        throw new Error('不支持的翻译器类型');
    } catch (error) {
        console.error('设置SiliconCloud模型失败:', error);
        return { success: false, message: error.message };
    }
});

// 添加总结功能的IPC处理器
ipcMain.handle('summarize-content', async (event, { subtitles }) => {
  try {
    // 获取配置
    const config = loadConfig();
    if (!config.silicon_cloud_api_key || !config.silicon_cloud_summary_model) {
      throw new Error('请先配置SiliconCloud API Key和总结模型');
    }

    // 直接传递字幕数据进行总结
    const summary = await summarizeContent(
      subtitles,
      config.silicon_cloud_api_key,
      config.silicon_cloud_summary_model
    );

    return summary;
  } catch (error) {
    console.error('内容总结失败:', error);
    throw error;
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