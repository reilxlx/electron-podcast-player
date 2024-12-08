const { AssemblyAI } = require('assemblyai');

/**
 * 对本地音频文件进行转录
 * @param {string} filePath 音频文件路径
 * @param {string} apiKey AssemblyAI的API Key
 * @returns {Promise<object>} 返回AssemblyAI的转录结果对象
 */
async function transcribeAudio(filePath, apiKey) {
    try {
        // 初始化AssemblyAI客户端
        const client = new AssemblyAI({
            apiKey: apiKey
        });

        // 设置转录参数
        const params = {
            audio: filePath,
            speaker_labels: true
        };

        // 请求转录
        const transcript = await client.transcripts.transcribe(params);

        if (transcript.status === 'error') {
            throw new Error(`转录失败: ${transcript.error}`);
        }

        return transcript;
    } catch (error) {
        console.error('转录过程出错:', error);
        throw error;
    }
}

module.exports = {
    transcribeAudio
};