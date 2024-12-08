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

    audioPlayer.addEventListener('timeupdate', onTimeUpdate);

    const translationToggle = document.getElementById('show-translation');
    translationToggle.checked = false;  
    showTranslation = false;
    translationToggle.addEventListener('change', (e) => {
        showTranslation = e.target.checked;
        toggleTranslation();
    });

    await initTranslatorSelection();

    // 侧边栏折叠按钮
    const sidebarToggleBtn = document.getElementById('sidebar-toggle-button');
    const sidebar = document.getElementById('sidebar');
    sidebarToggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });

    initDropZone();
    
    // -------- 新增：监听历史列表滚动事件，实现滚动时显示滚动条，停止后隐藏 --------
    const historyList = document.querySelector('.history-list');
    let scrollTimeout;
    historyList.addEventListener('scroll', () => {
        historyList.classList.add('scrolling');
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            historyList.classList.remove('scrolling');
        }, 1000);
    });
});

function updateFileList(audioIndex) {
    const fileList = document.getElementById('file-list');
    fileList.innerHTML = '';
    
    Object.entries(audioIndex).forEach(([hash, info]) => {
        const div = document.createElement('div');
        div.className = 'history-item';
        div.textContent = info.file_path.split('/').pop();
        
        // 添加文件名称提示功能
        let tooltipTimeout;
        let tooltip;
        
        div.addEventListener('mouseenter', (e) => {
            tooltipTimeout = setTimeout(() => {
                // 创建提示框
                tooltip = document.createElement('div');
                tooltip.className = 'filename-tooltip';
                tooltip.textContent = info.file_path.split('/').pop();
                
                // 计算位置
                const rect = div.getBoundingClientRect();
                tooltip.style.left = `${rect.right + 10}px`;
                tooltip.style.top = `${rect.top}px`;
                
                // 添加到文档中
                document.body.appendChild(tooltip);
                
                // 触发动画
                requestAnimationFrame(() => {
                    tooltip.classList.add('show');
                });
            }, 500);
        });
        
        div.addEventListener('mouseleave', () => {
            clearTimeout(tooltipTimeout);
            if (tooltip) {
                tooltip.classList.remove('show');
                // 等待过渡动画完成后移除元素
                setTimeout(() => {
                    tooltip && tooltip.remove();
                    tooltip = null;
                }, 200);
            }
        });
        
        div.addEventListener('click', () => loadHistoryFile(hash, info));
        fileList.appendChild(div);
    });
}

async function loadHistoryFile(hash, info) {
    try {
        currentFileHash = hash;
        
        audioPlayer.src = info.file_path;

        const cachedData = await window.electronAPI.loadCachedData(hash);
        if (cachedData) {
            subtitles = cachedData.subtitles;
            translations = cachedData.translations || {};
            
            const firstTranslation = Object.values(translations)[0];
            const translator = firstTranslation ? firstTranslation.translator : 'google';
            
            await setTranslatorFromHistory(translator);
            
            displaySubtitles(subtitles, translations, showTranslation);
        }
    } catch (error) {
        console.error('加载历史文件失败:', error);
    }
}

function displaySubtitles(subtitles, translations, showTranslation) {
    const subtitleDisplay = document.getElementById('subtitle-display');
    subtitleDisplay.innerHTML = '';
    wordPositions = [];
    
    const container = document.createElement('div');
    container.className = 'subtitle-container';
    subtitleDisplay.appendChild(container);
    
    subtitles.forEach((subtitle, index) => {
        const subtitleBlock = document.createElement('div');
        subtitleBlock.className = 'subtitle-block';
        subtitleBlock.setAttribute('data-index', index);
        subtitleBlock.setAttribute('data-speaker', subtitle.speaker);
        
        subtitleBlock.addEventListener('click', () => {
            const startTime = subtitle.start_time / 1000;
            if (audioPlayer) {
                audioPlayer.currentTime = startTime;
                audioPlayer.play().catch(error => console.error('播放失败:', error));
            }
        });
        
        const originalText = document.createElement('div');
        originalText.className = 'original-text';
        
        subtitle.words.forEach((word, wordIndex) => {
            const wordSpan = document.createElement('span');
            wordSpan.className = 'word';
            wordSpan.textContent = word.text;
            wordSpan.setAttribute('data-start-time', word.start);
            wordSpan.setAttribute('data-end-time', word.end);
            
            wordPositions.push({
                element: wordSpan,
                startTime: word.start,
                endTime: word.end
            });
            
            originalText.appendChild(wordSpan);
            if (wordIndex < subtitle.words.length - 1) {
                originalText.appendChild(document.createTextNode(' '));
            }
        });
        
        subtitleBlock.appendChild(originalText);
        
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

function toggleTranslation() {
    const translationElements = document.querySelectorAll('.translation-text');
    
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

function onTimeUpdate() {
    const currentTime = audioPlayer.currentTime * 1000;
    updateSubtitleHighlight(currentTime);
    updateWordHighlight(currentTime);
}

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

// 初始化拖放区域
function initDropZone() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');

    // 点击选择文件
    dropZone.addEventListener('click', () => {
        fileInput.click();
    });

    // 文件选择处理
    fileInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (file) {
            await handleAudioFile(file.path);
        }
    });

    // 拖放处理
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');

        const file = e.dataTransfer.files[0];
        if (file) {
            await handleAudioFile(file.path);
        }
    });
}

// 处理音频文件
async function handleAudioFile(filePath) {
    try {
        const subtitleDisplay = document.getElementById('subtitle-display');
        
        // 显示转录中的提示
        subtitleDisplay.innerHTML = `
            <div class="transcription-status">
                <div class="loading-spinner"></div>
                <p>正在转录音频，请稍候...</p>
            </div>
        `;

        // 获取文件hash
        const result = await window.electronAPI.selectAudio(filePath);
        
        if (result.cachedData) {
            // 如果有缓存，直接使用缓存数据
            subtitles = result.cachedData.subtitles;
            translations = result.cachedData.translations || {};
            displaySubtitles(subtitles, translations, showTranslation);
            
        } else {
            // 无缓存，需要进行转录
            const transcribeResult = await window.electronAPI.transcribeAudio({
                filePath: filePath,
                hash: result.fileHash
            });
            
            subtitles = transcribeResult.subtitles;
            displaySubtitles(subtitles, {}, showTranslation);
        }

        // 更新音频播放器源
        audioPlayer.src = filePath;
        
        // 更新文件列表
        const audioIndex = await window.electronAPI.getAudioIndex();
        updateFileList(audioIndex);

    } catch (error) {
        // 显示错误信息
        subtitleDisplay.innerHTML = `
            <div class="error-message">
                <p>转录失败: ${error.message}</p>
            </div>
        `;
        console.error('处理音频文件失败:', error);
    }
}

ipcRenderer.on('update-subtitles', (event, data) => {
    const { subtitles, translations } = data;
    const showTranslation = document.getElementById('show-translation').checked;
    displaySubtitles(subtitles, translations, showTranslation);
});

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

async function setTranslatorFromHistory(translator) {
    const pills = document.querySelectorAll('.option-pill');
    
    pills.forEach(pill => pill.classList.remove('active'));
    
    const targetPill = document.querySelector(`[data-translator="${translator}"]`);
    if (targetPill) {
        targetPill.classList.add('active');
    }
    
    await updateApiKeyInput(translator);
}