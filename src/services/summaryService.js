const fetch = require('node-fetch');

/**
 * 从字幕数据中提取所有英文内容
 * @param {Array} subtitles 字幕数组
 * @returns {string} 合并后的英文文本
 */
function extractSubtitleContent(subtitles) {
    if (!Array.isArray(subtitles)) {
        throw new Error("[总结] 错误: 无效的字幕数据");
    }

    // 提取所有字幕的content内容并合并
    const textContent = subtitles
        .map(subtitle => subtitle.content || '') // 直接使用content字段
        .filter(text => text.trim() !== '') // 过滤空字幕
        .join(' '); // 用空格连接所有文本

    if (!textContent) {
        throw new Error("[总结] 错误: 未找到有效的字幕内容");
    }

    return textContent;
}

async function summarizeContent(subtitles, apiKey, model, base_url = 'https://api.siliconflow.cn/v1', timeout = 30000) {
    try {
        // 提取字幕内容
        const text = extractSubtitleContent(subtitles);
        
        if (!text) {
            console.log(`[总结] 警告: 收到空文本`);
            return '';
        }
        if (!apiKey) {
            throw new Error("[总结] 错误: 未提供SiliconCloud API密钥");
        }

        // 打印完整的要总结的文本内容
        console.log('[总结] 要总结的完整文本:', text);
        console.log(`[总结] 文本长度: ${text.length} 字符`);
        console.log(`[总结] 开始总结文本: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);

        const payload = {
            model: model,
            messages: [
                {
                    role: "system",
                    content: "你是一个专业的内容总结助手。请对提供的英文内容进行简洁的总结，突出重点内容。总结要求：1. 使用中文输出 2. 总结内容控制在500字以内 3. 保持客观准确"
                },
                {
                    role: "user",
                    content: text
                }
            ],
            temperature: 0.7,
            max_tokens: 4096, // 固定为2048，确保不超过模型限制
            stream: false
        };

        const max_retries = 3;
        for (let i = 0; i < max_retries; i++) {
            try {
                console.log(`[总结] 尝试第 ${i + 1} 次请求...`);
                console.log('[总结] 使用的模型:', model);
                
                const response = await fetch(`${base_url}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        "Authorization": `Bearer ${apiKey}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(payload),
                    timeout
                });

                if (!response.ok) {
                    const errText = await response.text();
                    console.error('[总结] API响应错误:', errText);
                    throw new Error(`SiliconCloud API请求失败: ${response.status} ${errText}`);
                }

                const data = await response.json();
                if (!data.choices || data.choices.length === 0) {
                    throw new Error("API未返回有效的总结结果");
                }

                const summary = data.choices[0].message.content.trim();
                console.log(`[总结] 总结成功: "${summary.substring(0, 50)}${summary.length > 50 ? '...' : ''}"`);
                return summary;
            } catch (err) {
                console.error(`[总结] 第 ${i + 1} 次请求失败:`, err.message);
                if (i === max_retries - 1) {
                    throw err;
                }
                console.log(`[总结] 等待重试...`);
                await new Promise(res => setTimeout(res, 1000 * (i + 1))); // 递增重试延迟
            }
        }
    } catch (error) {
        console.error('[总结] 调用SiliconCloud总结API失败:', error);
        throw new Error(`总结失败: ${error.response?.data?.error?.message || error.message}`);
    }
}

module.exports = {
    summarizeContent
}; 