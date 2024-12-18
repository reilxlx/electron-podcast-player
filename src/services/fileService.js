const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 获取 podcast_data 文件夹的路径
function getPodcastDataPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'podcast_data');
  } else {
    return path.join(app.getAppPath(), 'podcast_data');
  }
}

const dataDir = getPodcastDataPath();
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const subtitleCacheDir = path.join(dataDir, 'subtitles');
if (!fs.existsSync(subtitleCacheDir)) fs.mkdirSync(subtitleCacheDir, { recursive: true });

const audioIndexFile = path.join(dataDir, 'audio_index.json');
const configFile = path.join(dataDir, 'config.json');

function loadAudioIndex() {
  if (fs.existsSync(audioIndexFile)) {
    return JSON.parse(fs.readFileSync(audioIndexFile, 'utf-8'));
  } else {
    return {};
  }
}

function saveAudioIndex(index) {
  fs.writeFileSync(audioIndexFile, JSON.stringify(index, null, 2), 'utf-8');
}

const defaultConfig = {
    // ... 现有配置项 ...
    silicon_cloud_model: 'Qwen/Qwen2.5-7B-Instruct' // 添加默认模型
};

// 修改 loadConfig 以包含默认模型
const loadConfig = () => {
    try {
        const configPath = configFile;
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            // 如果没有silicon_cloud_model，则设置默认值
            if (!config.silicon_cloud_model) {
                config.silicon_cloud_model = defaultConfig.silicon_cloud_model;
                saveConfig(config);
            }
            return config;
        }
        // 如果配置文件不存在，返回默认配置
        return { ...defaultConfig };
    } catch (error) {
        console.error('加载配置文件失败:', error);
        return { ...defaultConfig };
    }
};

// 修改 saveConfig 函数，使其只更新指定的字段
function saveConfig(newConfig) {
  try {
    // 读取现有配置
    let currentConfig = {};
    if (fs.existsSync(configFile)) {
      currentConfig = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
    }

    // 只更新提供的字段，保留其他现有字段
    const updatedConfig = {
      ...currentConfig,
      ...Object.fromEntries(
        Object.entries(newConfig).filter(([key]) => 
          // 只允许更新特定字段
          ['silicon_cloud_api_key', 'silicon_cloud_model'].includes(key)
        )
      )
    };

    // 确保 asr_api_key 不被删除
    if (currentConfig.asr_api_key) {
      updatedConfig.asr_api_key = currentConfig.asr_api_key;
    }

    fs.writeFileSync(configFile, JSON.stringify(updatedConfig, null, 2), 'utf-8');
    return updatedConfig;
  } catch (error) {
    console.error('保存配置文件失败:', error);
    throw error;
  }
}

async function getFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    stream.on('data', data => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

const saveSubtitleCache = (fileHash, data) => {
    console.log(`[文件服务] 开始保存字幕缓存，文件哈希: ${fileHash}`);
    try {
        const subtitlePath = path.join(subtitleCacheDir, `${fileHash}.json`);
        
        // 验证数据格式
        if (!data.subtitles || !Array.isArray(data.subtitles)) {
            throw new Error('无效的字幕数据格式: subtitles必须是数组');
        }

        if (!data.file_path) {
            throw new Error('无效的字幕数据格式: 缺少file_path');
        }

        // 验证每个字幕对象的格式
        data.subtitles.forEach((subtitle, index) => {
            if (!subtitle.speaker || 
                typeof subtitle.start_time !== 'number' ||
                typeof subtitle.end_time !== 'number' ||
                !subtitle.content ||
                !Array.isArray(subtitle.words)) {
                throw new Error(`字幕对象 ${index} 格式无效`);
            }

            // 验证words数组格式
            subtitle.words.forEach((word, wordIndex) => {
                if (!word.text || 
                    typeof word.start !== 'number' ||
                    typeof word.end !== 'number') {
                    throw new Error(`字幕对象 ${index} 的word ${wordIndex} 格式无效`);
                }
            });
        });

        fs.writeFileSync(subtitlePath, JSON.stringify(data, null, 2), 'utf8');
        console.log('[文件服务] 字幕缓存保存成功');
    } catch (error) {
        console.error('[文件服务] 保存字幕缓存失败:', error);
        throw error;
    }
};

const loadSubtitleCache = (fileHash) => {
    console.log(`[文件服务] 尝试加载字幕缓存，文件哈希: ${fileHash}`);
    try {
        const subtitlePath = path.join(subtitleCacheDir, `${fileHash}.json`);
        if (fs.existsSync(subtitlePath)) {
            const data = JSON.parse(fs.readFileSync(subtitlePath, 'utf8'));
            
            // 验证数据格式
            if (!data.subtitles || !Array.isArray(data.subtitles)) {
                console.warn('[文件服务] 缓存文件格式无效');
                return null;
            }
            
            console.log('[文件服务] 成功加载字幕缓存');
            return data;
        }
        console.log('[文件服务] 未找到字幕缓存');
        return null;
    } catch (error) {
        console.error('[文件服务] 加载字幕缓存失败:', error);
        return null;
    }
};

// 修改 setSiliconCloudModel 函数，只更新模型字段
function setSiliconCloudModel(newModel) {
  try {
    const currentConfig = loadConfig();
    return saveConfig({
      ...currentConfig,
      silicon_cloud_model: newModel
    });
  } catch (error) {
    console.error('设置SiliconCloud模型失败:', error);
    throw error;
  }
}

// 添加一个专门用于设置 API Key 的函数
function setSiliconCloudApiKey(apiKey) {
  try {
    const currentConfig = loadConfig();
    return saveConfig({
      ...currentConfig,
      silicon_cloud_api_key: apiKey
    });
  } catch (error) {
    console.error('设置SiliconCloud API Key失败:', error);
    throw error;
  }
}

module.exports = {
  loadAudioIndex,
  saveAudioIndex,
  loadConfig,
  saveConfig,
  getFileHash,
  saveSubtitleCache,
  loadSubtitleCache,
  getPodcastDataPath,
  setSiliconCloudModel,  // 导出新函数
  setSiliconCloudApiKey,  // 导出新函数
};