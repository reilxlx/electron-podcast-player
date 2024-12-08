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

function loadConfig() {
  if (fs.existsSync(configFile)) {
    return JSON.parse(fs.readFileSync(configFile, 'utf-8'));
  }
  return {
    gemini_api_key: "",
    silicon_cloud_api_key: ""
  };
}

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

function saveSubtitleCache(fileHash, data) {
  const filePath = path.join(subtitleCacheDir, fileHash + '.json');
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function loadSubtitleCache(fileHash) {
  const filePath = path.join(subtitleCacheDir, fileHash + '.json');
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

module.exports = {
  loadAudioIndex,
  saveAudioIndex,
  loadConfig,
  saveConfig,
  getFileHash,
  saveSubtitleCache,
  loadSubtitleCache
};