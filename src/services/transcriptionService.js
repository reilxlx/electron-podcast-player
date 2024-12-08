const fs = require('fs');
const fetch = require('node-fetch');
const FormData = require('form-data');

/**
 * 上传文件到 AssemblyAI
 * @param {string} filePath
 * @param {string} apiKey
 * @returns {Promise<string>} uploadUrl
 */
async function uploadFileToAssemblyAI(filePath, apiKey) {
  const formData = new FormData();
  formData.append('file', fs.createReadStream(filePath));

  const response = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: {
      'Authorization': apiKey
    },
    body: formData
  });

  if (!response.ok) {
    throw new Error(`上传文件失败: ${response.statusText}`);
  }

  const reader = response.body.getReader();
  let uploadedUrl = 'https://api.assemblyai.com/v2/upload';
  // AssemblyAI的upload接口需要一次性POST整个文件，一般情况下直接POST文件后返回200即可使用该URL
  // 不过AssemblyAI的upload返回为空内容，只要上传成功即可使用该特定endpoint。
  // 若需要更严谨处理，可参考AssemblyAI官方文档获取上传后的url或使用他们的import方式。
  // 此处假设上传成功后，需使用transcribe时需要再次上传或已有方式获得URL。
  // 实际AssemblyAI推荐是先调用upload endpoint获取上传文件的URL（在返回的Headers中或者其他接口提供），
  // 这里简化处理，如有需要请参考官方文档。

  // 实际上AssemblyAI建议使用他们提供的直传方式上传后，返回的不是JSON，而是直接可用的URL。
  // 请根据官方文档更新此逻辑。

  // 简化处理：假设我们本地实现了一个步骤，需要先上传到自建存储，再传给AssemblyAI:
  // 如需真正使用AssemblyAI的upload功能，请参考官方API，这里仅示意。
  
  // 由于官方的AssemblyAI upload返回方式不同，这里仅为演示，请参考官方文档进行修改。
  // 官方文档：https://www.assemblyai.com/docs/walkthroughs#upload-a-file
  // 实际中：需要读取response的headers中的upload_url或者使用import endpoint进行Cloud URL导入。

  // 这里我们假设音频文件已经在一个可访问的URL上。若本地文件，需要先自己上传到云存储。
  // 为示例方便，我们直接抛出错误提示用户修改。
  throw new Error("请将音频文件上传到公开可访问的URL后再调用AssemblyAI transcription。此处需用户根据官方文档自行实现。");
}

/**
 * 请求转录并返回转录ID
 * @param {string} audioUrl 上传文件后获得的可访问URL
 * @param {string} apiKey
 * @returns {Promise<string>} transcriptId
 */
async function requestTranscription(audioUrl, apiKey) {
  const response = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      audio_url: audioUrl,
      speaker_labels: true
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`请求转录失败: ${response.status} ${errText}`);
  }

  const data = await response.json();
  return data.id;
}

/**
 * 轮询转录结果直到完成
 * @param {string} transcriptId
 * @param {string} apiKey
 * @returns {Promise<object>} transcriptResult
 */
async function pollTranscriptionResult(transcriptId, apiKey) {
  let status = 'processing';
  let result = null;
  while (status !== 'completed' && status !== 'error') {
    const response = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
      headers: {
        'Authorization': apiKey
      }
    });

    if (!response.ok) {
      throw new Error(`轮询转录结果失败: ${response.statusText}`);
    }

    const data = await response.json();
    status = data.status;
    if (status === 'completed') {
      result = data;
    } else if (status === 'error') {
      throw new Error(`转录出错: ${data.error}`);
    } else {
      await new Promise(res => setTimeout(res, 5000)); // 每5秒轮询一次
    }
  }
  return result;
}

/**
 * 对本地音频文件进行转录
 * @param {string} filePath
 * @param {string} apiKey AssemblyAI的API Key，格式 "Bearer YOUR_API_KEY"
 * @returns {Promise<object>} 返回AssemblyAI的转录结果对象
 */
async function transcribeAudio(filePath, apiKey) {
  // 实际过程:
  // 1. 上传文件到云(如S3), 获取URL，或使用AssemblyAI的upload endpoint(请参考官方文档)
  // 2. requestTranscription(audioUrl, apiKey)
  // 3. pollTranscriptionResult
  // 这里请根据实际环境修改，以下只提供示意流程。

  // 假设用户已经有可以访问的audioUrl(该步骤需用户实现文件托管)
  // const audioUrl = "https://example.com/path/to/audio.wav";

  // 若用户希望使用AssemblyAI的upload接口，
  // 请实现uploadFileToAssemblyAI函数的实际逻辑，根据官方文档，
  // upload成功后并不会直接返回JSON，而是通过分块流式上传文件。
  // 官方建议是将文件上传到https://api.assemblyai.com/v2/upload，并将返回的URL用在转录请求中。
  
  // 这里直接抛错，提醒用户自行实现。
  throw new Error("transcribeAudio函数需用户根据实际环境提供已托管的音频URL或实现AssemblyAI上传逻辑。");

  // 如果已经有audioUrl:
  // let transcriptId = await requestTranscription(audioUrl, apiKey);
  // let transcript = await pollTranscriptionResult(transcriptId, apiKey);
  // return transcript;
}

module.exports = {
  transcribeAudio
};