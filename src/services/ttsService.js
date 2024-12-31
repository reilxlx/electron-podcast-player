const fetch = require('node-fetch');

/**
 * 将文本转换为语音
 * @param {string} text 要转换的中文文本
 * @param {string} apiKey SiliconCloud API密钥
 * @param {string} ttsModel TTS模型名称
 * @param {string} base_url API基础URL
 * @returns {Promise<Buffer>} 音频数据的Buffer
 */
async function textToSpeech(text, apiKey, ttsModel, base_url = 'https://api.siliconflow.cn/v1') {
    try {
        if (!text) {
            throw new Error("[TTS] 错误: 文本内容为空");
        }
        if (!apiKey) {
            throw new Error("[TTS] 错误: 未提供SiliconCloud API密钥");
        }
        if (!ttsModel) {
            throw new Error("[TTS] 错误: 未提供TTS模型名称");
        }

        console.log(`[TTS] 开始转换文本: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
        console.log('[TTS] 使用的模型:', ttsModel);

        const payload = {
            model: ttsModel,
            input: text,
            voice: `${ttsModel}:anna`,
            response_format: "mp3",
            sample_rate: 8000,
            stream: false,
            speed: 1,
            gain: 0
        };

        const max_retries = 3;
        for (let i = 0; i < max_retries; i++) {
            try {
                console.log(`[TTS] 尝试第 ${i + 1} 次请求...`);
                
                const response = await fetch(`${base_url}/audio/speech`, {
                    method: 'POST',
                    headers: {
                        "Authorization": `Bearer ${apiKey}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    const errText = await response.text();
                    console.error('[TTS] API响应错误:', errText);
                    throw new Error(`SiliconCloud API请求失败: ${response.status} ${errText}`);
                }

                // 获取音频数据
                const audioBuffer = await response.buffer();
                console.log('[TTS] 音频生成成功，数据大小:', audioBuffer.length, 'bytes');
                return audioBuffer;

            } catch (err) {
                console.error(`[TTS] 第 ${i + 1} 次请求失败:`, err.message);
                if (i === max_retries - 1) {
                    throw err;
                }
                console.log(`[TTS] 等待重试...`);
                await new Promise(res => setTimeout(res, 1000 * (i + 1))); // 递增重试延迟
            }
        }
    } catch (error) {
        console.error('[TTS] 调用SiliconCloud TTS API失败:', error);
        throw new Error(`TTS转换失败: ${error.message}`);
    }
}

module.exports = {
    textToSpeech
}; 