# Audio Player Application
这是一款专为论文播客和音频内容爱好者打造的智能音频播放器，一个集成了实时字幕、智能翻译的多功能工具。核心特色在于其强大的字幕同步功能 —— 通过 AssemblyAI 的先进语音识别技术，能够精确地将音频内容转化为文字，并实现词级别的同步高亮显示。当播放进行时，您可以清晰地看到每个单词是如何与声音完美契合的。内置的双语翻译系统支持 Google 翻译和 SiliconCloud 大语言模型，可以实时将内容翻译成中文，并以优雅的双语对照形式呈现。您还可以通过双击任何单词获取即时翻译，让学习过程更加流畅自然。无论是用于语言学习、内容创作，还是日常收听，这款播放器都能让您的音频体验更加丰富和高效。它不仅仅是一个播放器，更是连接声音与文字的桥梁，让您的聆听体验提升到新的高度。

## 功能特点

- 🎵 音频播放
  - 支持常见音频格式(MP3, AAC等)
  - 进度条拖动和点击定位

- 📝 字幕处理
  - 自动字幕滚动
  - 词级别同步高亮
  - 角色颜色区分
  - 字幕缓存

- 🌐 实时翻译
  - 支持 Google 翻译
  - 支持 SiliconCloud 翻译(需 API Key)
  - 双语字幕并排显示
  - 批量翻译支持
  - 翻译缓存

- 🔍 搜索功能
  - 历史记录搜索
  - 字幕内容搜索
  - 双击单词翻译

## 本地运行
1. 确保 podcast_data 文件夹存在：
```bash
mkdir podcast_data
mkdir podcast_data/audio
mkdir podcast_data/subtitle
touch podcast_data/config.json
touch podcast_data/audio_index.json
```
2. 申请并填写config.json中的API Key：
- Gemini API：从 Google AI Studio 获取 （https://aistudio.google.com/）
- SiliconCloud API：从 SiliconFlow 平台获取 （https://cloud.siliconflow.cn/）
- ASR API：从 AssemblyAI 获取 （https://www.assemblyai.com/）

```json
{
  "asr_api_key": "your_asr_api_key_here",
  "silicon_cloud_api_key": "your_silicon_cloud_api_key_here",
  "silicon_cloud_model": "Qwen/Qwen2.5-7B-Instruct"
}
```

3. 安装依赖
```bash
npm install --save-dev electron electron-builder
npm install assemblyai node-fetch@2
```

4 运行项目
```bash
# 开发环境运行
npm start
# 打包 macOS 应用（同时生成 dmg 和 zip）
npm run build:mac
```

## 项目结构
```
src/
├── main/              # Electron 主进程
├── renderer/          # 渲染进程
│   ├── index.html    # 主界面
│   ├── renderer.js   # 渲染逻辑
│   ├── styles.css    # 样式表
│   └── ui.js         # UI 交互
└── services/         # 核心服务
    ├── fileService.js       # 文件处理
    ├── player.js           # 播放控制
    ├── subtitleParser.js   # 字幕解析
    ├── transcriptionService.js # 语音转写
    └── translationService.js  # 翻译服务 
```
