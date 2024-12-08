const { AssemblyAI } = require('assemblyai');

/**
 * 对本地音频文件进行转录
 * @param {string} filePath 音频文件路径
 * @param {string} apiKey AssemblyAI的API Key
 * @returns {Promise<object>} 返回AssemblyAI的转录结果对象
 */
async function transcribeAudio(filePath, apiKey) {
    console.log(`[ASR] 开始转录音频文件: ${filePath}`);
    try {
        console.log('[ASR] 初始化AssemblyAI客户端...');
        const client = new AssemblyAI({
            apiKey: apiKey
        });

        console.log('[ASR] 设置转录参数...');
        const params = {
            audio: filePath,
            speaker_labels: true
        };

        console.log('[ASR] 发送转录请求...');
        const transcript = await client.transcripts.transcribe(params);

        if (transcript.status === 'error') {
            console.error(`[ASR] 转录失败: ${transcript.error}`);
            throw new Error(`转录失败: ${transcript.error}`);
        }

        console.log('[ASR] 转录成功，处理转录结果...');
        const result = {
            text: transcript.text,
            words: transcript.words,
            utterances: transcript.utterances,
            speakers: transcript.speakers,
            status: transcript.status
        };

        console.log('[ASR] 转录完成');
        return result;

    } catch (error) {
        console.error('[ASR] 转录过程出错:', error);
        throw error;
    }
}

module.exports = {
    transcribeAudio
};