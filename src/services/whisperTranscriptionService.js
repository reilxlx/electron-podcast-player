const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const FormData = require('form-data');
const fetch = require('node-fetch');

/**
 * 使用Whisper API转录音频文件
 * @param {string} audioFilePath 音频文件路径
 * @param {string} whisperServerUrl Whisper服务器URL
 * @returns {Promise<Array>} 转录结果数组
 */
async function transcribeAudio(audioFilePath, whisperServerUrl) {
    try {
        console.log('[Whisper] 开始转录音频文件:', audioFilePath);
        console.log('[Whisper] 使用服务器:', whisperServerUrl);

        // 检查文件是否存在
        if (!fs.existsSync(audioFilePath)) {
            throw new Error(`音频文件不存在: ${audioFilePath}`);
        }

        // 创建FormData对象
        const formData = new FormData();
        formData.append("file", fs.createReadStream(audioFilePath));
        formData.append("temperature", "0.0");
        formData.append("temperature_inc", "0.2");
        formData.append("response_format", "srt");

        console.log('[Whisper] 发送转录请求...');
        
        // 发送请求到Whisper服务器
        const response = await fetch(whisperServerUrl, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error(`Whisper API error: ${response.status} ${response.statusText}`);
        }

        // 获取SRT格式的响应
        const srtContent = await response.text();
        console.log('[Whisper] 收到SRT格式响应:', srtContent.substring(0, 200) + '...');
        
        // 解析SRT格式为字幕对象数组
        const subtitles = parseSRT(srtContent);
        console.log('[Whisper] 解析完成，字幕数量:', subtitles.length);

        return subtitles;
    } catch (error) {
        console.error('[Whisper] 转录失败:', error);
        throw error;
    }
}

/**
 * 解析SRT格式内容
 * @param {string} srtContent SRT格式的字幕内容
 * @returns {Array} 字幕对象数组
 */
function parseSRT(srtContent) {
    console.log('[Whisper] 开始解析SRT内容');
    const subtitles = [];
    const blocks = srtContent.trim().split('\n\n');
    console.log('[Whisper] 找到字幕块数量:', blocks.length);

    for (const block of blocks) {
        const lines = block.split('\n');
        if (lines.length < 3) {
            console.warn('[Whisper] 跳过无效字幕块:', block);
            continue;
        }

        // 解析时间戳
        const timeMatch = lines[1].match(/(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/);
        if (!timeMatch) {
            console.warn('[Whisper] 无效的时间戳格式:', lines[1]);
            continue;
        }

        const startTime = parseTimestamp(timeMatch[1]);
        const endTime = parseTimestamp(timeMatch[2]);

        // 合并剩余行作为文本内容
        const text = lines.slice(2).join(' ').trim();

        // 将文本拆分成单词
        const words = text.split(/\s+/);
        const duration = endTime - startTime;
        const wordDuration = duration / words.length;

        // 为每个单词创建时间戳
        const wordObjects = words.map((word, index) => {
            const wordStartTime = startTime + (wordDuration * index);
            const wordEndTime = wordStartTime + wordDuration;
            return {
                text: word,
                start: Math.round(wordStartTime),
                end: Math.round(wordEndTime)
            };
        });

        // 创建字幕对象
        const subtitle = {
            start_time: startTime,
            end_time: endTime,
            text: text,
            words: wordObjects
        };

        subtitles.push(subtitle);
    }

    console.log('[Whisper] SRT解析完成，有效字幕数量:', subtitles.length);
    return subtitles;
}

/**
 * 将SRT时间戳转换为毫秒
 * @param {string} timestamp SRT格式的时间戳 (00:00:00,000)
 * @returns {number} 毫秒数
 */
function parseTimestamp(timestamp) {
    try {
        const [time, milliseconds] = timestamp.split(',');
        const [hours, minutes, seconds] = time.split(':').map(Number);
        
        return (hours * 3600000) + (minutes * 60000) + (seconds * 1000) + parseInt(milliseconds);
    } catch (error) {
        console.error('[Whisper] 时间戳解析失败:', timestamp, error);
        throw new Error(`无效的时间戳格式: ${timestamp}`);
    }
}

/**
 * 保存转录结果到JSON文件
 * @param {string} audioFilePath 音频文件路径
 * @param {Array} subtitles 字幕数组
 * @returns {Promise<string>} 保存的文件路径
 */
async function saveTranscriptionResult(audioFilePath, subtitles) {
    try {
        console.log('[Whisper] 开始保存转录结果');
        
        // 生成文件hash
        const fileHash = crypto.createHash('md5')
            .update(fs.readFileSync(audioFilePath))
            .digest('hex');
        console.log('[Whisper] 生成的文件hash:', fileHash);

        // 创建保存目录
        const subtitlesDir = path.join(process.cwd(), 'podcast_data', 'subtitles');
        if (!fs.existsSync(subtitlesDir)) {
            console.log('[Whisper] 创建字幕目录:', subtitlesDir);
            fs.mkdirSync(subtitlesDir, { recursive: true });
        }

        // 保存字幕数据
        const subtitlePath = path.join(subtitlesDir, `${fileHash}.json`);
        const subtitleData = {
            subtitles: subtitles,
            translations: {}
        };

        console.log('[Whisper] 保存字幕数据到:', subtitlePath);
        fs.writeFileSync(subtitlePath, JSON.stringify(subtitleData, null, 2));
        
        return subtitlePath;
    } catch (error) {
        console.error('[Whisper] 保存转录结果失败:', error);
        throw error;
    }
}

module.exports = {
    transcribeAudio,
    saveTranscriptionResult
}; 