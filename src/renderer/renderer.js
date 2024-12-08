let currentFileHash = null;
let subtitles = [];
let translations = {};
let showTranslation = true;
let audioPlayer = null;
let currentSubtitleIndex = -1;
let apiKeyInputTimeout = null;
let currentWordIndex = -1;
let wordPositions = [];

window.addEventListener('DOMContentLoaded', async () => {
    audioPlayer = document.getElementById('audio-player');
    const fileList = document.getElementById('file-list');

    // 加载历史记录
    const audioIndex = await window.electronAPI.getAudioIndex();
    updateFileList(audioIndex);

    // 音频播放时间更新处理
    audioPlayer.addEventListener('timeupdate', onTimeUpdate);

    // 显示翻译开关
    const translationToggle = document.getElementById('show-translation');
    translationToggle.checked = false;  // 默认不显示翻译
    showTranslation = false;
    translationToggle.addEventListener('change', (e) => {
        showTranslation = e.target.checked;
        toggleTranslation();
    });

    // 初始化翻译器选择
    await initTranslatorSelection();

    // 添加侧边栏折叠按钮事件
    const sidebarToggleBtn = document.getElementById('sidebar-toggle-button');
    const sidebar = document.getElementById('sidebar');
    sidebarToggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });
});

// 更新文件列表
function updateFileList(audioIndex) {
    const fileList = document.getElementById('file-list');
    fileList.innerHTML = '';
    
    Object.entries(audioIndex).forEach(([hash, info]) => {
        const div = document.createElement('div');
        div.className = 'history-item';
        div.textContent = info.file_path.split('/').pop(); // 只显示文件名
        div.addEventListener('click', () => loadHistoryFile(hash, info));
        fileList.appendChild(div);
    });
}

// 加载历史文件
async function loadHistoryFile(hash, info) {
    try {
        currentFileHash = hash;
        
        // 加载音频文件
        audioPlayer.src = info.file_path;

        // 加载字幕缓存
        const cachedData = await window.electronAPI.loadCachedData(hash);
        if (cachedData) {
            subtitles = cachedData.subtitles;
            translations = cachedData.translations || {};
            
            // 获取使用的翻译器类型
            const firstTranslation = Object.values(translations)[0];
            const translator = firstTranslation ? firstTranslation.translator : 'google';
            
            // 设置翻译器状态
            await setTranslatorFromHistory(translator);
            
            // 显示字幕（默认只显示原文）
            displaySubtitles(subtitles, translations, showTranslation);
        }
    } catch (error) {
        console.error('加载历史文件失败:', error);
    }
}

// 显示字幕
function displaySubtitles(subtitles, translations, showTranslation) {
    const subtitleDisplay = document.getElementById('subtitle-display');
    subtitleDisplay.innerHTML = '';
    wordPositions = []; // 重置单词位置数组
    
    const container = document.createElement('div');
    container.className = 'subtitle-container';
    subtitleDisplay.appendChild(container);
    
    subtitles.forEach((subtitle, index) => {
        const subtitleBlock = document.createElement('div');
        subtitleBlock.className = 'subtitle-block';
        subtitleBlock.setAttribute('data-index', index);
        subtitleBlock.setAttribute('data-speaker', subtitle.speaker);
        
        // 添加点击事件处理
        subtitleBlock.addEventListener('click', () => {
            const startTime = subtitle.start_time / 1000;
            if (audioPlayer) {
                audioPlayer.currentTime = startTime;
                audioPlayer.play().catch(error => {
                    console.error('播放失败:', error);
                });
            }
        });
        
        // 显示原文，按单词拆分
        const originalText = document.createElement('div');
        originalText.className = 'original-text';
        
        // 处理每个单词
        subtitle.words.forEach((word, wordIndex) => {
            const wordSpan = document.createElement('span');
            wordSpan.className = 'word';
            wordSpan.textContent = word.text;
            wordSpan.setAttribute('data-start-time', word.start);
            wordSpan.setAttribute('data-end-time', word.end);
            
            // 存储单词位置信息
            wordPositions.push({
                element: wordSpan,
                startTime: word.start,
                endTime: word.end
            });
            
            originalText.appendChild(wordSpan);
            // 添加空格
            if (wordIndex < subtitle.words.length - 1) {
                originalText.appendChild(document.createTextNode(' '));
            }
        });
        
        subtitleBlock.appendChild(originalText);
        
        // 添加翻译文本
        if (translations && translations[index]) {
            const translationText = document.createElement('div');
            translationText.className = 'translation-text';
            translationText.textContent = translations[index].text;
            if (!showTranslation) {
                translationText.classList.add('hidden');
            }
            subtitleBlock.appendChild(translationText);
        }
        
        container.appendChild(subtitleBlock);
    });
}

// 切换翻译显示状态
function toggleTranslation() {
    const translationElements = document.querySelectorAll('.translation-text');
    
    // 记录当前活动字幕块的位置信息
    const activeBlock = document.querySelector('.subtitle-block.active');
    const container = document.querySelector('.subtitle-container');
    let targetScrollTop = container.scrollTop;
    
    if (activeBlock) {
        const containerRect = container.getBoundingClientRect();
        const blockRect = activeBlock.getBoundingClientRect();
        const containerCenter = containerRect.height / 2;
        const blockCenter = blockRect.height / 2;
        const offsetTop = (blockRect.top - containerRect.top) + container.scrollTop;
        targetScrollTop = offsetTop - containerCenter + blockCenter;
    }

    translationElements.forEach(element => {
        if (showTranslation) {
            element.classList.remove('hidden');
        } else {
            element.classList.add('hidden');
        }
    });

    requestAnimationFrame(() => {
        container.scrollTop = targetScrollTop;
    });
}

// 改进的字幕高亮和滚动逻辑
function updateSubtitleHighlight(currentTime) {
    const subtitleBlocks = document.querySelectorAll('.subtitle-block');
    let newIndex = -1;

    for (let i = 0; i < subtitles.length; i++) {
        if (currentTime >= subtitles[i].start_time && currentTime <= subtitles[i].end_time) {
            newIndex = i;
            break;
        }
    }

    if (newIndex !== -1 && newIndex !== currentSubtitleIndex) {
        subtitleBlocks.forEach(block => block.classList.remove('active'));
        
        const newBlock = document.querySelector(`[data-index="${newIndex}"]`);
        if (newBlock) {
            newBlock.classList.add('active');
            
            const container = document.querySelector('.subtitle-container');
            const containerRect = container.getBoundingClientRect();
            const blockRect = newBlock.getBoundingClientRect();

            const blockCenter = blockRect.height / 2;
            const containerCenter = containerRect.height / 2;
            const offsetTop = (blockRect.top - containerRect.top) + container.scrollTop;
            const targetScrollTop = offsetTop - containerCenter + blockCenter;

            container.scrollTo({
                top: targetScrollTop,
                behavior: 'smooth'
            });
        }
        
        currentSubtitleIndex = newIndex;
    }
}

// 音频播放时间更新事件
function onTimeUpdate() {
    const currentTime = audioPlayer.currentTime * 1000;
    updateSubtitleHighlight(currentTime);
    updateWordHighlight(currentTime);
}

// 单词高亮更新
function updateWordHighlight(currentTime) {
    if (currentWordIndex !== -1 && wordPositions[currentWordIndex]) {
        wordPositions[currentWordIndex].element.classList.remove('word-active');
    }
    
    const newWordIndex = wordPositions.findIndex(word => 
        currentTime >= word.startTime && currentTime <= word.endTime
    );
    
    if (newWordIndex !== -1 && wordPositions[newWordIndex]) {
        wordPositions[newWordIndex].element.classList.add('word-active');
        currentWordIndex = newWordIndex;
    }
}

// 拖放处理
const dragArea = document.getElementById('drag-area');

dragArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    dragArea.classList.add('drag-over');
});

dragArea.addEventListener('dragleave', () => {
    dragArea.classList.remove('drag-over');
});

dragArea.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragArea.classList.remove('drag-over');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        const filePath = files[0].path;
        await window.electronAPI.selectAudio(filePath);
    }
});

// 当接收到新的字幕数据时更新显示
ipcRenderer.on('update-subtitles', (event, data) => {
    const { subtitles, translations } = data;
    const showTranslation = document.getElementById('show-translation').checked;
    displaySubtitles(subtitles, translations, showTranslation);
});

// 初始化翻译器选择
async function initTranslatorSelection() {
    const pills = document.querySelectorAll('.option-pill');
    const apiKeyInput = document.getElementById('api-key-input');

    const googlePill = document.querySelector('[data-translator="google"]');
    googlePill.classList.add('active');
    apiKeyInput.type = 'text';  
    apiKeyInput.value = 'Google翻译无需API Key';
    apiKeyInput.disabled = true;

    pills.forEach(pill => {
        pill.addEventListener('click', async () => {
            pills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            
            const translator = pill.getAttribute('data-translator');
            await updateApiKeyInput(translator);
        });
    });

    apiKeyInput.addEventListener('mouseenter', () => {
        if (apiKeyInput.disabled) return;
        
        apiKeyInputTimeout = setTimeout(async () => {
            const config = await window.electronAPI.getConfig();
            if (config && config.silicon_cloud_api_key) {
                apiKeyInput.type = 'text';
                apiKeyInput.value = config.silicon_cloud_api_key;
            }
        }, 1000);
    });

    apiKeyInput.addEventListener('mouseleave', () => {
        clearTimeout(apiKeyInputTimeout);
        if (!apiKeyInput.disabled) {
            apiKeyInput.type = 'password';
            apiKeyInput.value = '*'.repeat(40);
        }
    });
}

// 更新API Key输入框
async function updateApiKeyInput(translator) {
    const apiKeyInput = document.getElementById('api-key-input');
    
    if (translator === 'google') {
        apiKeyInput.type = 'text';
        apiKeyInput.value = 'Google翻译无需API Key';
        apiKeyInput.disabled = true;
    } else if (translator === 'silicon_cloud') {
        apiKeyInput.type = 'password';
        apiKeyInput.value = '*'.repeat(40);
        apiKeyInput.disabled = false;
    }
}

// 根据历史记录设置翻译器状态
async function setTranslatorFromHistory(translator) {
    const pills = document.querySelectorAll('.option-pill');
    
    pills.forEach(pill => pill.classList.remove('active'));
    
    const targetPill = document.querySelector(`[data-translator="${translator}"]`);
    if (targetPill) {
        targetPill.classList.add('active');
    }
    
    await updateApiKeyInput(translator);
}