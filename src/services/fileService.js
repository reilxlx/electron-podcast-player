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
    try {
        const subtitleDir = path.join(__dirname, '../../podcast_data/subtitles');
        if (!fs.existsSync(subtitleDir)) {
            fs.mkdirSync(subtitleDir, { recursive: true });
        }
        const subtitlePath = path.join(subtitleDir, `${fileHash}.json`);
        fs.writeFileSync(subtitlePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
        console.error('保存字幕缓存失败:', error);
        throw error;
    }
};

const loadSubtitleCache = (fileHash) => {
    try {
        const subtitlePath = path.join(__dirname, '../../podcast_data/subtitles', `${fileHash}.json`);
        if (fs.existsSync(subtitlePath)) {
            return JSON.parse(fs.readFileSync(subtitlePath, 'utf8'));
        }
        return null;
    } catch (error) {
        console.error('加载字幕缓存失败:', error);
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