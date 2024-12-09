const fetch = require('node-fetch');

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
 * @param {string} text 
 * @param {string} api_key 
 * @param {string} base_url 
 * @param {string} model 
 * @param {number} timeout 
 * @returns {Promise<string>}
 */
async function siliconCloudTranslate(text, api_key, base_url = 'https://api.siliconflow.cn/v1', model = 'Qwen/Qwen2.5-7B-Instruct', timeout = 30000) {
  if (!text.trim()) {
    throw new Error("Input text for translation cannot be empty.");
  }
  if (!api_key) {
    throw new Error("OpenAI API key must be provided.");
  }

  const payload = {
    model: model,
    messages: [
      {
        "role": "system",
        "content": "You are an expert translator. Please translate the following English text to Chinese accurately and fluently."
      },
      {
        "role": "user",
        "content": text
      }
    ],
    temperature: 0.3,
    max_tokens: 1024,
    stream: false
  };

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
    throw new Error(`SiliconCloud翻译请求失败: ${response.status} ${errText}`);
  }

  const data = await response.json();
  if (!data.choices || data.choices.length === 0) {
    throw new Error("No completion choices returned by the API.");
  }

  const translated_text = data.choices[0].message.content.trim();
  return translated_text;
}

/**
 * 批量翻译接口
 * @param {Array<{index:number,text:string}>} texts 要翻译的文本数组
 * @param {string} translator 翻译器类型 'google' | 'silicon_cloud'
 * @param {string|null} apiKey API密钥（对Google翻译可选）
 */
async function translateTextBatch(texts, translator, apiKey) {
  console.log(`[翻译批量] 开始批量翻译 ${texts.length} 条文本，使用翻译器: ${translator}`);
  let result = {};
  for (let item of texts) {
    console.log(`[翻译批量] 处理第 ${item.index + 1}/${texts.length} 条文本`);
    let translation = "";
    if (translator === 'google') {
      translation = await googleTranslate(item.text) || "";
    } else if (translator === 'silicon_cloud') {
      try {
        console.log('[翻译批量] 使用SiliconCloud翻译...');
        translation = await siliconCloudTranslate(item.text, apiKey);
      } catch (err) {
        console.error(`[翻译批量] SiliconCloud翻译失败:`, err);
        translation = "";
      }
    } else {
      console.log('[翻译批量] 使用默认Google翻译...');
      translation = await googleTranslate(item.text) || "";
    }
    result[item.index] = { text: translation, translator };
  }
  console.log('[翻译批量] 批量翻译完成');
  return result;
}

module.exports = {
  translateTextBatch
};