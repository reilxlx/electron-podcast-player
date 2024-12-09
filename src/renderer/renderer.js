let currentFileHash = null;
let subtitles = [];
let translations = {};
let showTranslation = true;
let audioPlayer = null;
let currentSubtitleIndex = -1;
let apiKeyInputTimeout = null;
let currentWordIndex = -1;
let wordPositions = [];
let cachedData = null;
let translationInProgress = false;

// 在文件顶部添加IPC监听器
window.electronAPI.onTranslationProgress((data) => {
    console.log('[渲染进程] 收到进度更新:', data);
    if (!translationInProgress) return;
    
    const { current, total, text } = data;
    updateTranslationProgress(
        current,
        total,
        text ? `当前翻译：${text.substring(0, 30)}${text.length > 30 ? '...' : ''}` : ''
    );
});

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

    // 监听主进程发来的音频索引更新通知
    window.electronAPI.onAudioIndexUpdated(() => {
        console.log('[渲染进程] 收到音频索引更新通知');
        window.electronAPI.getAudioIndex().then(updatedAudioIndex => {
            updateFileList(updatedAudioIndex);
            
            // 设置新添加的文件为激活状态
            const currentItem = document.querySelector(`.history-item:first-child`);
            if (currentItem) {
                // 移除其他项的激活状态
                document.querySelectorAll('.history-item').forEach(item => {
                    item.classList.remove('active');
                });
                currentItem.classList.add('active');
                
                // 确保新添加的项可见
                currentItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });
    });
});

function updateFileList(audioIndex) {
    const fileList = document.getElementById('file-list');
    fileList.innerHTML = '';
    
    const entries = Object.entries(audioIndex).reverse();
    
    entries.forEach(([hash, info]) => {
        const div = document.createElement('div');
        div.className = 'history-item';
        div.setAttribute('data-hash', hash);
        const fileName = info.file_path.split('/').pop();
        div.textContent = fileName;
        
        // 添加右键菜单事件
        div.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showContextMenu(e, hash);
        });
        
        // 修改悬浮显示，只显示文件名
        let tooltipTimeout;
        div.addEventListener('mouseenter', (e) => {
            tooltipTimeout = setTimeout(() => {
                showTooltip(e, fileName);  // 只传入文件名
            }, 500);
        });
        
        div.addEventListener('mouseleave', () => {
            clearTimeout(tooltipTimeout);
            hideTooltip();
        });
        
        div.addEventListener('click', () => loadHistoryFile(hash, info));
        fileList.appendChild(div);
    });
}

async function showContextMenu(event, hash) {
    // 移除已存在的上下文菜单
    const existingMenu = document.querySelector('.context-menu');
    if (existingMenu) {
        existingMenu.remove();
    }

    const menu = document.createElement('div');
    menu.className = 'context-menu';

    // 获取字幕数据以检查是否有翻译
    const cachedData = await window.electronAPI.loadCachedData(hash);
    const hasTranslations = cachedData && cachedData.translations && Object.keys(cachedData.translations).length > 0;
    
    // 添加翻译按钮
    const translateBtn = document.createElement('button');
    translateBtn.className = 'context-menu-item';
    translateBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 12 12">
            <path d="M1.5 3L4.5 9L7.5 3M2.5 6h4M9 2v8" 
                  stroke="currentColor" 
                  fill="none" 
                  stroke-linecap="round" 
                  stroke-linejoin="round"/>
        </svg>
        <span>翻译</span>
    `;
    
    if (hasTranslations) {
        translateBtn.classList.add('disabled');
        translateBtn.title = '该文件已有翻译';
    } else {
        translateBtn.addEventListener('click', async () => {
            menu.remove();
            
            // 显示加载状态
            const subtitleDisplay = document.getElementById('subtitle-display');
            const originalContent = subtitleDisplay.innerHTML;
            subtitleDisplay.innerHTML = `
                <div class="transcription-status">
                    <div class="loading-spinner"></div>
                    <p>正在翻译字幕，请稍候...</p>
                </div>
            `;
            
            try {
                // 准备翻译数据
                if (!cachedData || !cachedData.subtitles || !Array.isArray(cachedData.subtitles)) {
                    throw new Error('字幕数据无效');
                }
                
                const textsToTranslate = cachedData.subtitles
                    .filter(subtitle => subtitle && typeof subtitle === 'object')
                    .map((subtitle, index) => {
                        // 从字幕对象中获取文本内容
                        let text = '';
                        if (subtitle.text) {
                            text = subtitle.text;
                        } else if (subtitle.original_text) {
                            text = subtitle.original_text;
                        } else if (Array.isArray(subtitle.words)) {
                            text = subtitle.words.map(word => word.text).join(' ');
                        }
                        
                        return {
                            index: index,
                            text: text.trim()
                        };
                    })
                    .filter(item => item.text !== '');
                
                if (textsToTranslate.length === 0) {
                    throw new Error('没有找到可翻译的文本');
                }
                
                console.log('[渲染进程] 开始翻译，总数:', textsToTranslate.length);
                translationInProgress = true;
                
                // 创建进度显示
                createTranslationProgress();
                
                try {
                    // 获取当前选中的翻译器和API key
                    const activePill = document.querySelector('.option-pill.active');
                    const selectedTranslator = activePill ? activePill.getAttribute('data-translator') : 'google';
                    let apiKey = null;
                    
                    if (selectedTranslator === 'silicon_cloud') {
                        const config = await window.electronAPI.getConfig();
                        if (!config || !config.silicon_cloud_api_key) {
                            throw new Error('未配置SiliconCloud API密钥');
                        }
                        apiKey = config.silicon_cloud_api_key;
                    }
                    
                    // 调用翻译API
                    const translationResult = await window.electronAPI.translateSubtitles({
                        fileHash: hash,
                        subtitles: textsToTranslate,
                        translator: selectedTranslator,
                        apiKey: apiKey
                    });
                    
                    console.log('[渲染进程] 翻译完成');
                    
                    // 更新UI显示
                    const translationToggle = document.getElementById('show-translation');
                    translationToggle.checked = true;
                    showTranslation = true;
                    toggleTranslation();
                } catch (error) {
                    console.error('[渲染进程] 翻译失败:', error);
                    throw error;
                } finally {
                    translationInProgress = false;
                    clearTranslationProgress();
                }
                
                // 更新UI显示
                const updatedData = await window.electronAPI.loadCachedData(hash);
                subtitles = updatedData.subtitles;
                translations = updatedData.translations || {};
                displaySubtitles(subtitles, translations, showTranslation);
                
            } catch (error) {
                console.error('翻译失败:', error);
                subtitleDisplay.innerHTML = `
                    <div class="error-message">
                        <p>翻译失败: ${error.message}</p>
                    </div>
                `;
                
                // 3秒后恢复原始内容
                setTimeout(() => {
                    subtitleDisplay.innerHTML = originalContent;
                }, 3000);
            }
        });
    }
    
    menu.appendChild(translateBtn);
    
    // 添加删除按钮
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'context-menu-item destructive';
    deleteBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 12 12">
            <path d="M1.5 3h9m-8 0l.5 7h6l.5-7m-5-1.5v-1h3v1" 
                  stroke="currentColor" 
                  fill="none" 
                  stroke-linecap="round" 
                  stroke-linejoin="round"/>
        </svg>
        <span>删除</span>
    `;
    
    deleteBtn.addEventListener('click', async () => {
        const confirmed = await window.electronAPI.showConfirmDialog({
            title: '确认删除',
            message: '确定要删除这个文件的字幕记录吗？',
            buttons: ['删除', '取消']
        });
        
        if (confirmed === 0) {
            await window.electronAPI.deleteHistoryFile(hash);
            const audioIndex = await window.electronAPI.getAudioIndex();
            updateFileList(audioIndex);
        }
        menu.remove();
    });

    menu.appendChild(deleteBtn);
    document.body.appendChild(menu);

    // 设置菜单位置
    const x = event.clientX;
    const y = event.clientY;
    
    // 确保菜单不会超出窗口边界
    const menuRect = menu.getBoundingClientRect();
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    let menuX = x;
    let menuY = y;
    
    if (x + menuRect.width > windowWidth) {
        menuX = windowWidth - menuRect.width;
    }
    
    if (y + menuRect.height > windowHeight) {
        menuY = windowHeight - menuRect.height;
    }
    
    menu.style.left = `${menuX}px`;
    menu.style.top = `${menuY}px`;

    // 点击其他区域关闭菜单
    const closeMenu = (e) => {
        if (!menu.contains(e.target)) {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        }
    };
    
    setTimeout(() => {
        document.addEventListener('click', closeMenu);
    }, 0);
}

// 文件名提示框相关函数
function showTooltip(event, fileName) {  // 修改参数名以更好地反映其内容
    const tooltip = document.createElement('div');
    tooltip.className = 'filename-tooltip';
    tooltip.textContent = fileName;  // 直接使用文件名
    document.body.appendChild(tooltip);

    const rect = event.target.getBoundingClientRect();
    tooltip.style.left = `${rect.left}px`;
    tooltip.style.top = `${rect.bottom + 5}px`;

    requestAnimationFrame(() => {
        tooltip.classList.add('show');
    });
}

function hideTooltip() {
    const tooltip = document.querySelector('.filename-tooltip');
    if (tooltip) {
        tooltip.remove();
    }
}

async function loadHistoryFile(hash, info) {
    // 先移除其他项的 active 类
    document.querySelectorAll('.history-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // 为当前点击项添加 active 类
    const currentItem = document.querySelector(`.history-item[data-hash="${hash}"]`);
    if (currentItem) {
        currentItem.classList.add('active');
    }
    
    try {
        currentFileHash = hash;
        
        audioPlayer.src = info.file_path;

        const cachedData = await window.electronAPI.loadCachedData(hash);
        if (cachedData) {
            subtitles = cachedData.subtitles;
            translations = cachedData.translations || {};
            
            // 检查是否有翻译数据
            const hasTranslations = translations && Object.keys(translations).length > 0;
            const translationToggle = document.getElementById('show-translation');
            translationToggle.disabled = !hasTranslations;
            
            // 如果没有翻译，强制关闭翻译显示
            if (!hasTranslations) {
                translationToggle.checked = false;
                showTranslation = false;
            }
            
            if (hasTranslations) {
                const firstTranslation = Object.values(translations)[0];
                const translator = firstTranslation ? firstTranslation.translator : 'google';
                await setTranslatorFromHistory(translator);
            }
            
            displaySubtitles(subtitles, translations, showTranslation);
            
            // 重新触发一次时间更新，确保字幕高亮状态正确
            if (audioPlayer.currentTime > 0) {
                onTimeUpdate();
            }
        }
    } catch (error) {
        console.error('加载历史文件失败:', error);
    }
}

function displaySubtitles(subtitles, translations, showTranslation) {
    const subtitleDisplay = document.getElementById('subtitle-display');
    subtitleDisplay.innerHTML = '';
    wordPositions = [];
    currentSubtitleIndex = -1;  // 重置当前字幕索引
    
    const container = document.createElement('div');
    container.className = 'subtitle-container';
    subtitleDisplay.appendChild(container);
    
    subtitles.forEach((subtitle, index) => {
        const subtitleBlock = document.createElement('div');
        subtitleBlock.className = 'subtitle-block';
        subtitleBlock.setAttribute('data-index', index);
        subtitleBlock.setAttribute('data-speaker', subtitle.speaker);
        
        // 检查当前时间，如果在这个字幕的时间范围内，则添加active类
        if (audioPlayer && audioPlayer.currentTime * 1000 >= subtitle.start_time 
            && audioPlayer.currentTime * 1000 <= subtitle.end_time) {
            subtitleBlock.classList.add('active');
            currentSubtitleIndex = index;
        }
        
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
    
    // 获取容器元素，添加空值检查
    const container = document.querySelector('.subtitle-container');
    if (!container) {
        console.warn('未找到字幕容器元素');
        return;
    }
    
    const activeBlock = document.querySelector('.subtitle-block.active');
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

    // 确保容器存在后再执行滚动
    if (container) {
        requestAnimationFrame(() => {
            container.scrollTop = targetScrollTop;
        });
    }
}

function updateSubtitleHighlight(currentTime) {
    const subtitleBlocks = document.querySelectorAll('.subtitle-block');
    let newIndex = -1;

    for (let i = 0; i < subtitles.length; i++) {
        const subtitle = subtitles[i];
        if (currentTime >= subtitle.start_time && currentTime <= subtitle.end_time) {
            newIndex = i;
            break;
        }
    }

    // 只有当索引发生变化时才更新高亮状态
    if (newIndex !== currentSubtitleIndex) {
        subtitleBlocks.forEach(block => block.classList.remove('active'));
        
        if (newIndex !== -1) {
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
        
        // 更新文件列表并立即显示
        const audioIndex = await window.electronAPI.getAudioIndex();
        updateFileList(audioIndex);
        
        // 设置新添加的文件为激活状态
        const currentItem = document.querySelector(`.history-item[data-hash="${result.fileHash}"]`);
        if (currentItem) {
            // 移除其他项的激活状态
            document.querySelectorAll('.history-item').forEach(item => {
                item.classList.remove('active');
            });
            currentItem.classList.add('active');
        }

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

// 创建翻译进度显示区域
function createTranslationProgress() {
    const subtitleDisplay = document.getElementById('subtitle-display');
    if (!subtitleDisplay) return;
    
    const progressElement = document.createElement('div');
    progressElement.className = 'translation-progress';
    progressElement.innerHTML = `
        <div class="translation-progress-header">
            <div class="translation-progress-icon"></div>
            <div class="translation-progress-title">正在翻译字幕...</div>
        </div>
        
        <div class="translation-progress-stats">
            <div class="translation-progress-count">已完成：0/0</div>
            <div class="translation-progress-percentage">0%</div>
        </div>
        
        <div class="translation-progress-bar">
            <div class="translation-progress-fill" style="width: 0%"></div>
        </div>
        
        <div class="translation-progress-detail"></div>
    `;
    
    subtitleDisplay.innerHTML = '';
    subtitleDisplay.appendChild(progressElement);
}

// 更新翻译进度
function updateTranslationProgress(current, total, detail = '') {
    const progressElement = document.querySelector('.translation-progress');
    if (!progressElement) return;
    
    const percent = Math.round((current / total) * 100);
    
    // 更新计数
    const countElement = progressElement.querySelector('.translation-progress-count');
    if (countElement) {
        countElement.textContent = `已完成：${current}/${total}`;
    }
    
    // 更新百分比
    const percentElement = progressElement.querySelector('.translation-progress-percentage');
    if (percentElement) {
        percentElement.textContent = `${percent}%`;
    }
    
    // 更新进度条
    const fillElement = progressElement.querySelector('.translation-progress-fill');
    if (fillElement) {
        fillElement.style.width = `${percent}%`;
    }
    
    // 更新详情文本
    const detailElement = progressElement.querySelector('.translation-progress-detail');
    if (detailElement) {
        detailElement.textContent = detail ? detail : '';
    }
}

// 清除翻译进度显示
function clearTranslationProgress() {
    const subtitleDisplay = document.getElementById('subtitle-display');
    if (!subtitleDisplay) return;
    
    const progressElement = subtitleDisplay.querySelector('.translation-progress');
    if (progressElement) {
        progressElement.remove();
    }
}

// 修改进度事件监听器
window.electronAPI.onTranslationProgress((data) => {
    console.log('[渲染进程] 收到进度更新:', data);
    if (!translationInProgress) return;
    
    const { current, total, text } = data;
    updateTranslationProgress(
        current,
        total,
        text ? `当前翻译：${text.substring(0, 30)}${text.length > 30 ? '...' : ''}` : ''
    );
});