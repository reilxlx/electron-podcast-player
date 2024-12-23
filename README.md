# Audio Player Application

一个基于 Electron 的音频播放器应用，支持字幕显示和实时翻译功能。


## 本地开发
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

## 功能特点

- 🎵 音频播放
  - 支持常见音频格式(MP3, AAC等)
  - 进度条拖动和点击定位
  - 后台播放支持
  - Media Session API 集成(锁屏/通知中心控制)

- 📝 字幕处理
  - 支持 SRT 和 VTT 格式字幕
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

## 技术栈

- Electron
- HTML5 Audio API
- Node.js
- AssemblyAI (语音转写)
- Google Translate API
- SiliconCloud API

## 项目结构

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