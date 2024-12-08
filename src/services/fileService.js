const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dataDir = path.join(process.cwd(), 'podcast_data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const subtitleCacheDir = path.join(dataDir, 'subtitles');
if (!fs.existsSync(subtitleCacheDir)) fs.mkdirSync(subtitleCacheDir);

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

const loadConfig = () => {
    try {
        const configPath = path.join(__dirname, '../../podcast_data/config.json');
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            return config;
        }
        return {};
    } catch (error) {
        console.error('加载配置文件失败:', error);
        return {};
    }
};

function saveConfig(config) {
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf-8');
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
        const subtitleDir = path.join(__dirname, '../../podcast_data/subtitles');
        if (!fs.existsSync(subtitleDir)) {
            console.log('[文件服务] 创建字幕缓存目录');
            fs.mkdirSync(subtitleDir, { recursive: true });
        }
        const subtitlePath = path.join(subtitleDir, `${fileHash}.json`);
        
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
        const subtitlePath = path.join(__dirname, '../../podcast_data/subtitles', `${fileHash}.json`);
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

module.exports = {
  loadAudioIndex,
  saveAudioIndex,
  loadConfig,
  saveConfig,
  getFileHash,
  saveSubtitleCache,
  loadSubtitleCache
};