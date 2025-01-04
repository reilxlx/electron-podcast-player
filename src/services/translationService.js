const fetch = require('node-fetch');
const { loadConfig } = require('./fileService');
const { ollamaTranslate } = require('./ollamaTranslationService');

/**
 * Google 翻译实现
 * @param {string} text 要翻译的文本
 * @param {string} dest_lang 目标语言代码，默认为简体中文
 * @param {string} src_lang 源语言代码，默认为自动检测
 * @returns {Promise<string|null>} 翻译后的文本，如果发生错误则返回null
 */
async function googleTranslate(text, dest_lang = 'zh-cn', src_lang = 'auto') {
  // 检查文本是否为空
  if (!text) {
    console.log(`[翻译] 警告: 收到空文本`);
    return '';
  }

  console.log(`[翻译] 开始翻译文本: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
  try {
    const url = "https://translate.googleapis.com/translate_a/single";
    const params = new URLSearchParams({
      client: 'gtx',
      sl: src_lang,
      tl: dest_lang,
      dt: 't',
      q: text
    });

    const max_retries = 3;
    for (let i = 0; i < max_retries; i++) {
      try {
        console.log(`[翻译] 尝试第 ${i + 1} 次请求...`);
        const response = await fetch(`${url}?${params.toString()}`, {
          headers: {
            "User-Agent": "Mozilla/5.0"
          },
          timeout: 30000
        });
        if (!response.ok) {
          throw new Error(`Google翻译请求失败: ${response.statusText}`);
        }
        const result = await response.json();
        const translated_text = result[0].map(part => part[0]).join('');
        console.log(`[翻译] 翻译成功: "${translated_text.substring(0, 50)}${translated_text.length > 50 ? '...' : ''}"`);
        return translated_text;
      } catch (err) {
        if (i === max_retries - 1) {
          throw err;
        }
        console.log(`[翻译] 请求失败，等待重试...`);
        await new Promise(res => setTimeout(res, 1000));
      }
    }
  } catch (err) {
    console.error(`[翻译] 翻译错误:`, err);
    return null;
  }
}

/**
 * SiliconCloud 翻译实现
 * 使用用户提供的api_key调用SiliconFlow接口
 * @param {string} text 要翻译的文本
 * @param {string} api_key API密钥
 * @param {string} base_url API基础URL
 * @param {string} model 模型名称
 * @param {number} timeout 超时时间（毫秒）
 * @returns {Promise<string>} 翻译后的文本
 */
async function siliconCloudTranslate(text, api_key, base_url = 'https://api.siliconflow.cn/v1', timeout = 30000) {
  // 获取配置中的模型名称
  const config = loadConfig();
  const model = config.silicon_cloud_model || 'Qwen/Qwen2.5-7B-Instruct';

  // 检查文本是否为空
  if (!text) {
    console.log(`[翻译] 警告: 收到空文本`);
    return '';
  }
  if (!api_key) {
    throw new Error("[翻译] 错误: 未提供SiliconCloud API密钥");
  }

  console.log(`[翻译] 开始翻译文本: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);

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
    temperature: 0.3,
    max_tokens: Math.max(1024, text.length * 2), // 动态调整token限制
    stream: false
  };

  const max_retries = 3;
  for (let i = 0; i < max_retries; i++) {
    try {
      console.log(`[翻译] 尝试第 ${i + 1} 次请求...`);
      const response = await fetch(`${base_url}/chat/completions`, {
        method: 'POST',
        headers: {
          "Authorization": `Bearer ${api_key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        timeout
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`SiliconCloud API请求失败: ${response.status} ${errText}`);
      }

      const data = await response.json();
      if (!data.choices || data.choices.length === 0) {
        throw new Error("API未返回有效的翻译结果");
      }

      const translated_text = data.choices[0].message.content.trim();
      console.log(`[翻译] 翻译成功: "${translated_text.substring(0, 50)}${translated_text.length > 50 ? '...' : ''}"`);
      return translated_text;
    } catch (err) {
      console.error(`[翻译] 第 ${i + 1} 次请求失败:`, err.message);
      if (i === max_retries - 1) {
        throw err;
      }
      console.log(`[翻译] 等待重试...`);
      await new Promise(res => setTimeout(res, 1000 * (i + 1))); // 递增重试延迟
    }
  }
}

/**
 * 批量翻译接口 (支持并发)
 * @param {Array<{index:number,text:string}>} texts 要翻译的文本数组
 * @param {string} translator 翻译器类型 'google' | 'silicon_cloud' | 'ollama'
 * @param {string|null} apiKey API密钥（对Google翻译和Ollama可选）
 * @param {Function} onProgress 进度回调函数，参数为(index, translatedText)
 * @param {number} concurrency 并发数
 */
async function translateTextBatch(texts, translator, apiKey, onProgress, concurrency = 2) {
  console.log(`[翻译服务] 开始批量翻译 ${texts.length} 条文本，使用翻译器: ${translator}，并发数: ${concurrency}`);
  const results = {};
  const tasks = [];
  let completedCount = 0;

  // 创建并发任务
  for (let i = 0; i < texts.length; i++) {
    const item = texts[i];
    const task = async () => {
      let translation = "";
      try {
        if (translator === 'google') {
          translation = await googleTranslate(item.text) || "";
        } else if (translator === 'silicon_cloud') {
          console.log('[翻译服务] 使用SiliconCloud翻译...');
          translation = await siliconCloudTranslate(item.text, apiKey);
        } else if (translator === 'ollama') {
          console.log('[翻译服务] 使用Ollama本地翻译...');
          translation = await ollamaTranslate(item.text);
        } else {
          console.log('[翻译服务] 使用默认Google翻译...');
          translation = await googleTranslate(item.text) || "";
        }
        results[item.index] = { text: translation, translator };
      } catch (err) {
        console.error(`[翻译服务] 翻译失败:`, err);
        results[item.index] = { text: "", translator };
      } finally {
        completedCount++;
        if (typeof onProgress === 'function') {
          onProgress(completedCount -1, translation);
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

  console.log('[翻译服务] 批量翻译完成');
  return results;
}

module.exports = {
  translateTextBatch
};