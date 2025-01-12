const fetch = require('node-fetch');

/**
 * Ollama 本地翻译服务
 * @param {string} text 要翻译的文本
 * @param {string} model 模型名称，默认为 qwen2.5:0.5b
 * @param {number} timeout 超时时间（毫秒）
 * @returns {Promise<string>} 翻译后的文本
 */
async function ollamaTranslate(text, model = 'qwen2.5:0.5b', timeout = 30000) {
    // 检查文本是否为空
    if (!text) {
        console.log(`[Ollama翻译] 警告: 收到空文本`);
        return '';
    }

    console.log(`[Ollama翻译] 开始翻译文本: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}""`);

    const payload = {
        model: model,
        messages: [
            {
                "role": "system",
                "content": "你是一个专业的翻译助手。请将以下文本准确流畅地翻译成中文，保持原文的语气和风格。只返回翻译结果，不要有任何解释或额外的内容。"
            },
            {
                "role": "user",
                "content": text
            }
        ],
        temperature: 0.7,
        top_p: 0.9,
        frequency_penalty: 0.2,
        presence_penalty: 0.1,
        max_tokens: 2048,
        stream: false
    };

    // 获取配置
    const config = require('../../podcast_data/config.json');
    const serverUrl = config.ollama_server_url || 'http://localhost:11434/api/chat';

    const max_retries = 3;
    for (let i = 0; i < max_retries; i++) {
        try {
            console.log(`[Ollama翻译] 尝试第 ${i + 1} 次请求...`);
            const response = await fetch(serverUrl, {
                method: 'POST',
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload),
                timeout
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Ollama API请求失败: ${response.status} ${errText}`);
            }

            const data = await response.json();
            if (!data.message) {
                throw new Error("API未返回有效的翻译结果");
            }

            const translated_text = data.message.content.trim();
            console.log(`[Ollama翻译] 翻译成功: "${translated_text.substring(0, 50)}${translated_text.length > 50 ? '...' : ''}"`);
            return translated_text;
        } catch (err) {
            console.error(`[Ollama翻译] 第 ${i + 1} 次请求失败:`, err.message);
            if (i === max_retries - 1) {
                throw err;
            }
            console.log(`[Ollama翻译] 等待重试...`);
            await new Promise(res => setTimeout(res, 1000 * (i + 1))); // 递增重试延迟
        }
    }
}

/**
 * 批量翻译接口 (支持并发)
 * @param {Array<{index:number,text:string}>} texts 要翻译的文本数组
 * @param {Function} onProgress 进度回调函数，参数为(index, translatedText)
 * @param {number} concurrency 并发数
 */
async function translateTextBatchWithOllama(texts, onProgress, concurrency = 2) {
    console.log(`[Ollama翻译服务] 开始批量翻译 ${texts.length} 条文本，并发数: ${concurrency}`);
    const results = {};
    const tasks = [];
    let completedCount = 0;

    // 创建并发任务
    for (let i = 0; i < texts.length; i++) {
        const item = texts[i];
        const task = async () => {
            let translation = "";
            try {
                translation = await ollamaTranslate(item.text);
                results[item.index] = { text: translation, translator: 'ollama' };
            } catch (err) {
                console.error(`[Ollama翻译服务] 翻译失败:`, err);
                results[item.index] = { text: "", translator: 'ollama' };
            } finally {
                completedCount++;
                if (typeof onProgress === 'function') {
                    onProgress(completedCount - 1, translation);
                }
            }
        };
        tasks.push(task);
    }

    // 执行并发任务
    const batches = [];
    for (let i = 0; i < tasks.length; i += concurrency) {
        batches.push(tasks.slice(i, i + concurrency));
    }

    for (const batch of batches) {
        await Promise.all(batch.map(task => task()));
    }

    console.log('[Ollama翻译服务] 批量翻译完成');
    return results;
}

module.exports = {
    ollamaTranslate,
    translateTextBatchWithOllama
}; 