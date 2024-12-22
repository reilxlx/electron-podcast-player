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

// 添加防抖函数
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

window.addEventListener('DOMContentLoaded', async () => {
    audioPlayer = document.getElementById('audio-player');
    const fileList = document.getElementById('file-list');

    // 添加搜索功能
    const searchInput = document.getElementById('search-input');
    let originalFileList = [];

    // 加载历史记录
    const audioIndex = await window.electronAPI.getAudioIndex();
    updateFileList(audioIndex);
    originalFileList = Array.from(document.querySelectorAll('.history-item'));

    // 搜索功能实现
    searchInput.addEventListener('input', (e) => {
        searchFiles(e.target.value);
    });

    // 阻止搜索框的拖拽事件
    searchInput.addEventListener('mousedown', (e) => {
        e.stopPropagation();
    });

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

    // 添加右键菜单监听器到SiliconCloud按钮
    const siliconCloudPill = document.querySelector('.option-pill[data-translator="silicon_cloud"]');
    
    siliconCloudPill.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showModelContextMenu(e, 'silicon_cloud');
    });
});

// 优化文件列表更新
function updateFileList(audioIndex) {
    const fileList = document.getElementById('file-list');
    const fragment = document.createDocumentFragment();
    
    const entries = Object.entries(audioIndex).reverse();
    const fileNameCache = new Map(); // 缓存文件名
    
    entries.forEach(([hash, info]) => {
        const div = document.createElement('div');
        div.className = 'history-item';
        div.dataset.hash = hash;
        
        // 从缓存获取文件名，如果没有则计算并缓存
        let fileName = fileNameCache.get(info.file_path);
        if (!fileName) {
            fileName = info.file_path.split('/').pop();
            fileNameCache.set(info.file_path, fileName);
        }
        div.textContent = fileName;
        
        // 使用事件委托处理右键菜单
        div.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showContextMenu(e, hash);
        });
        
        // 优化悬浮显示
        let tooltipTimeout;
        div.addEventListener('mouseenter', (e) => {
            tooltipTimeout = setTimeout(() => {
                showTooltip(e, fileName);
            }, 500);
        });
        
        div.addEventListener('mouseleave', () => {
            clearTimeout(tooltipTimeout);
            hideTooltip();
        });
        
        div.addEventListener('click', () => loadHistoryFile(hash, info));
        fragment.appendChild(div);
    });
    
    fileList.innerHTML = '';
    fileList.appendChild(fragment);
}

// 优化搜索功能
const searchFiles = debounce((searchTerm) => {
    const fileList = document.getElementById('file-list');
    const items = fileList.getElementsByClassName('history-item');
    
    if (!searchTerm) {
        Array.from(items).forEach(item => {
            item.style.display = 'block';
        });
        return;
    }
    
    const lowerSearchTerm = searchTerm.toLowerCase();
    Array.from(items).forEach(item => {
        const fileName = item.textContent.toLowerCase();
        item.style.display = fileName.includes(lowerSearchTerm) ? 'block' : 'none';
    });
}, 150); // 150ms 的防抖延迟

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
    
    // 添加路径按钮
    const pathBtn = document.createElement('button');
    pathBtn.className = 'context-menu-item';
    pathBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 12 12">
            <path d="M3 1H9C9.55228 1 10 1.44772 10 2V10C10 10.5523 9.55228 11 9 11H3C2.44772 11 2 10.5523 2 10V2C2 1.44772 2.44772 1 3 1Z" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M1 4H11" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>路径</span>
    `;
    console.log("Hash value:", hash); // 确认hash值
    pathBtn.addEventListener('click', async () => {
        menu.remove();
        const filePath = await window.electronAPI.getSubtitleFilePath(hash);
        // 使用macOS风格的提示框显示路径
        const alertBox = document.createElement('div');
        alertBox.className = 'macos-alert';
        alertBox.innerHTML = `
            <div class="macos-alert-icon">
                <svg width="24" height="24" viewBox="0 0 24 24">
                    <path d="M3 1H21C21.5523 1 22 1.44772 22 2V22C22 22.5523 21.5523 23 21 23H3C2.44772 23 2 22.5523 2 22V2C2 1.44772 2.44772 1 3 1Z" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M1 5H23" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </div>
            <div class="macos-alert-message">
                <p class="macos-alert-title">字幕文件路径</p>
                <p class="macos-alert-text">${filePath}</p>
            </div>
            <div class="macos-alert-buttons">
                <button class="macos-alert-button" onclick="this.parentElement.parentElement.remove()">关闭</button>
            </div>
        `;
        document.body.appendChild(alertBox);
    });
    menu.appendChild(pathBtn);
    
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

// 文件名提示框关函数
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
    console.log('[渲染进程] 开始载历史文件:', { hash, info });
    
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
        console.log('[渲染进程] 设置音频源:', info.file_path);
        audioPlayer.src = info.file_path;

        console.log('[渲染进程] 加载缓存数据...');
        const cachedData = await window.electronAPI.loadCachedData(hash);
        console.log('[渲染进程] 缓存数据:', cachedData);
        
        if (cachedData) {
            console.log('[渲染进程] 解析缓存数据...');
            subtitles = cachedData.subtitles;
            translations = cachedData.translations || {};
            
            // 检查是否有翻译数据
            const hasTranslations = translations && Object.keys(translations).length > 0;
            console.log('[渲染进程] 是否有翻译:', hasTranslations);
            
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
                console.log('[渲染进程] 设置翻译器:', translator);
                await setTranslatorFromHistory(translator);
            }
            
            console.log('[渲染进程] 显示字幕...');
            displaySubtitles(subtitles, translations, showTranslation);
            
            // 重新触发一次时间更新，确保字幕高亮状态正确
            if (audioPlayer.currentTime > 0) {
                onTimeUpdate();
            }
        } else {
            console.error('[渲染进程] 未找到缓存数据');
            const subtitleDisplay = document.getElementById('subtitle-display');
            subtitleDisplay.innerHTML = `
                <div class="error-message">
                    <p>加载字幕失败: 未找到缓存数据</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('[渲染进程] 加载历史文件失败:', error);
        const subtitleDisplay = document.getElementById('subtitle-display');
        subtitleDisplay.innerHTML = `
            <div class="error-message">
                <p>加载字幕失败: ${error.message}</p>
            </div>
        `;
    }
}

function displaySubtitles(subtitles, translations, showTranslation) {
    console.log('[渲染进程] 开始显示字幕:', {
        subtitlesLength: subtitles ? subtitles.length : 0,
        hasTranslations: !!translations,
        showTranslation
    });

    const subtitleDisplay = document.getElementById('subtitle-display');
    if (!subtitleDisplay) {
        console.error('[渲染进程] 未找到字幕显示区域元素');
        return;
    }

    // 使用DocumentFragment来减少DOM操作
    const fragment = document.createDocumentFragment();
    const container = document.createElement('div');
    container.className = 'subtitle-container';
    fragment.appendChild(container);

    wordPositions = [];
    currentSubtitleIndex = -1;

    if (!Array.isArray(subtitles)) {
        console.error('[渲染进程] 字幕数据不是数组:', subtitles);
        container.innerHTML = '<div class="error-message"><p>字幕数据格式错误</p></div>';
        subtitleDisplay.innerHTML = '';
        subtitleDisplay.appendChild(fragment);
        return;
    }

    // 创建一个通用的点击事件处理函数
    const handleWordClick = (e) => {
        if (!e.target.closest('.word')) {
            document.querySelectorAll('.word.selected').forEach(el => {
                el.classList.remove('selected');
            });
        }
    };

    // 只添加一次全局点击事件监听器
    document.removeEventListener('click', handleWordClick);
    document.addEventListener('click', handleWordClick);

    const currentTime = audioPlayer ? audioPlayer.currentTime * 1000 : 0;
    
    // 预先创建常用的DOM元素
    const createWordSpan = (word) => {
        const span = document.createElement('span');
        span.className = 'word';
        span.textContent = word.text || '';
        if (typeof word.start === 'number') span.dataset.startTime = word.start;
        if (typeof word.end === 'number') span.dataset.endTime = word.end;
        return span;
    };

    subtitles.forEach((subtitle, index) => {
        if (!subtitle || typeof subtitle !== 'object') {
            console.error(`[渲染进程] 字幕对象 ${index} 无效:`, subtitle);
            return;
        }

        const subtitleBlock = document.createElement('div');
        subtitleBlock.className = 'subtitle-block';
        subtitleBlock.dataset.index = index;
        
        if (subtitle.speaker) {
            subtitleBlock.dataset.speaker = subtitle.speaker;
        }

        if (currentTime >= subtitle.start_time && currentTime <= subtitle.end_time) {
            subtitleBlock.classList.add('active');
            currentSubtitleIndex = index;
        }

        // 使用事件委托来处理点击事件
        let clickTimer = null;
        subtitleBlock.addEventListener('click', (e) => {
            if (clickTimer === null) {
                clickTimer = setTimeout(() => {
                    if (typeof subtitle.start_time === 'number') {
                        const startTime = subtitle.start_time / 1000;
                        if (audioPlayer) {
                            audioPlayer.currentTime = startTime;
                            audioPlayer.play().catch(error => console.error('[渲染进程] 播放失败:', error));
                        }
                    }
                    clickTimer = null;
                }, 200);
            }
        });

        const originalText = document.createElement('div');
        originalText.className = 'original-text';

        if (Array.isArray(subtitle.words)) {
            const wordsFragment = document.createDocumentFragment();
            subtitle.words.forEach((word, wordIndex) => {
                if (!word || typeof word !== 'object') return;

                const wordSpan = createWordSpan(word);
                wordPositions.push({
                    element: wordSpan,
                    startTime: word.start,
                    endTime: word.end
                });

                wordsFragment.appendChild(wordSpan);
                if (wordIndex < subtitle.words.length - 1) {
                    wordsFragment.appendChild(document.createTextNode(' '));
                }

                // 使用事件委托处理双击和右键菜单事件
                wordSpan.addEventListener('dblclick', (e) => {
                    e.preventDefault();
                    if (clickTimer) {
                        clearTimeout(clickTimer);
                        clickTimer = null;
                    }
                    document.querySelectorAll('.word.selected').forEach(el => el.classList.remove('selected'));
                    wordSpan.classList.add('selected');
                    const selection = window.getSelection();
                    const range = document.createRange();
                    range.selectNodeContents(wordSpan);
                    selection.removeAllRanges();
                    selection.addRange(range);
                });

                wordSpan.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    const selection = window.getSelection();
                    const selectedText = selection.toString().trim();
                    if (selectedText) {
                        wordSpan.classList.add('selected');
                        showWordTranslationMenu(e, selectedText);
                    }
                });
            });
            originalText.appendChild(wordsFragment);
        } else {
            console.error(`[渲染进程] 字幕 ${index} 没有有效的words数组:`, subtitle);
            originalText.textContent = subtitle.text || '';
        }

        subtitleBlock.appendChild(originalText);

        if (translations && translations[index]) {
            const translationText = document.createElement('div');
            translationText.className = 'translation-text';
            translationText.textContent = translations[index].text || '';
            if (!showTranslation) {
                translationText.classList.add('hidden');
            }
            subtitleBlock.appendChild(translationText);
        }

        container.appendChild(subtitleBlock);
    });

    subtitleDisplay.innerHTML = '';
    subtitleDisplay.appendChild(fragment);
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
    // 使用二分查找来找到当前时间对应的字幕索引
    let newIndex = findSubtitleIndex(currentTime);

    // 只有当索引发生变化时才更新高亮状态
    if (newIndex !== currentSubtitleIndex) {
        const container = document.querySelector('.subtitle-container');
        if (!container) return;

        // 移除旧的高亮
        const oldBlock = container.querySelector('.subtitle-block.active');
        if (oldBlock) {
            oldBlock.classList.remove('active');
        }

        // 添加新的高亮
        if (newIndex !== -1) {
            const newBlock = container.querySelector(`[data-index="${newIndex}"]`);
            if (newBlock) {
                newBlock.classList.add('active');
                
                const containerRect = container.getBoundingClientRect();
                const blockRect = newBlock.getBoundingClientRect();
                const blockCenter = blockRect.height / 2;
                const containerCenter = containerRect.height / 2;
                const offsetTop = (blockRect.top - containerRect.top) + container.scrollTop;
                const targetScrollTop = offsetTop - containerCenter + blockCenter;

                // 使用 requestAnimationFrame 进行平滑滚动
                requestAnimationFrame(() => {
                    container.scrollTo({
                        top: targetScrollTop,
                        behavior: 'smooth'
                    });
                });
            }
        }
        
        currentSubtitleIndex = newIndex;
    }
}

// 使用二分查找优化字幕索引查找
function findSubtitleIndex(currentTime) {
    let left = 0;
    let right = subtitles.length - 1;

    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const subtitle = subtitles[mid];

        if (currentTime >= subtitle.start_time && currentTime <= subtitle.end_time) {
            return mid;
        }

        if (currentTime < subtitle.start_time) {
            right = mid - 1;
        } else {
            left = mid + 1;
        }
    }

    return -1;
}

function updateWordHighlight(currentTime) {
    // 如果当前没有高亮的单词，或者当前高亮的单词已经不在时间范围内
    if (currentWordIndex === -1 || 
        !wordPositions[currentWordIndex] ||
        currentTime < wordPositions[currentWordIndex].startTime ||
        currentTime > wordPositions[currentWordIndex].endTime) {

        // 移除当前高亮
        if (currentWordIndex !== -1 && wordPositions[currentWordIndex]) {
            wordPositions[currentWordIndex].element.classList.remove('word-active');
        }

        // 使用二分查找找到新的单词索引
        const newWordIndex = findWordIndex(currentTime);

        if (newWordIndex !== -1 && wordPositions[newWordIndex]) {
            wordPositions[newWordIndex].element.classList.add('word-active');
            currentWordIndex = newWordIndex;
        } else {
            currentWordIndex = -1;
        }
    }
}

// 使用二分查找优化单词索引查找
function findWordIndex(currentTime) {
    let left = 0;
    let right = wordPositions.length - 1;

    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const word = wordPositions[mid];

        if (currentTime >= word.startTime && currentTime <= word.endTime) {
            return mid;
        }

        if (currentTime < word.startTime) {
            right = mid - 1;
        } else {
            left = mid + 1;
        }
    }

    return -1;
}

// 优化音频时间更新处理
let lastUpdateTime = 0;
const UPDATE_INTERVAL = 50; // 最小更新间隔（毫秒）

function onTimeUpdate() {
    const now = Date.now();
    if (now - lastUpdateTime < UPDATE_INTERVAL) {
        return; // 如果距离上次更新时间太短，则跳过
    }
    
    const currentTime = audioPlayer.currentTime * 1000;
    updateSubtitleHighlight(currentTime);
    updateWordHighlight(currentTime);
    lastUpdateTime = now;
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
    const googlePill = document.querySelector('[data-translator="google"]');
    googlePill.classList.add('active');

    pills.forEach(pill => {
        pill.addEventListener('click', async () => {
            pills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
        });

        // 为 SiliconCloud 和 AssemblyAI 按钮添加右键菜单
        if (pill.getAttribute('data-translator') === 'silicon_cloud' || 
            pill.getAttribute('data-translator') === 'assembly_ai') {
            pill.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const translator = pill.getAttribute('data-translator');
                if (translator === 'assembly_ai') {
                    openSetAssemblyAIKeyModal();
                } else {
                    showModelContextMenu(e, translator);
                }
            });
        }
    });
}

async function updateApiKeyInput(translator) {
    // 由于移除了输入框，这个函数现在不需要做任何事情
    return;
}

async function setTranslatorFromHistory(translator) {
    const pills = document.querySelectorAll('.option-pill');
    
    pills.forEach(pill => pill.classList.remove('active'));
    
    const targetPill = document.querySelector(`[data-translator="${translator}"]`);
    if (targetPill) {
        targetPill.classList.add('active');
    }
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

// 显示设置模型的上下文菜单
function showModelContextMenu(event, translator) {
    event.preventDefault(); // 阻止默认右键菜单

    // 移除已存在的上下文菜单
    const existingMenu = document.querySelector('.context-menu');
    if (existingMenu) {
        existingMenu.remove();
    }

    const menu = document.createElement('div');
    menu.className = 'context-menu';

    // 添加"设置模型"选项，使用更简约的图标
    const setModelBtn = document.createElement('button');
    setModelBtn.className = 'context-menu-item';
    setModelBtn.innerHTML = `
        <svg class="menu-icon" viewBox="0 0 16 16">
            <path d="M13.5 8.5l-1.5 1.5-2-2L8.5 9.5l-2-2L5 9 3.5 7.5m7-3.5h3m-3 7h3m-12-7h3m-3 7h3m4-10v13" 
                  stroke="currentColor" 
                  fill="none" 
                  stroke-width="1.2" 
                  stroke-linecap="round" 
                  stroke-linejoin="round"/>
        </svg>
        <span>设置模型</span>
    `;

    setModelBtn.addEventListener('click', () => {
        menu.remove();
        openSetModelModal(translator);
    });

    // 添加"设置API Key"选项，使用更简约的图标
    const setApiKeyBtn = document.createElement('button');
    setApiKeyBtn.className = 'context-menu-item';
    setApiKeyBtn.innerHTML = `
        <svg class="menu-icon" viewBox="0 0 16 16">
            <path d="M8 1v14M4 5l4-4 4 4M4 11h8" 
                  stroke="currentColor" 
                  fill="none" 
                  stroke-width="1.2" 
                  stroke-linecap="round" 
                  stroke-linejoin="round"/>
        </svg>
        <span>设置API Key</span>
    `;

    setApiKeyBtn.addEventListener('click', () => {
        menu.remove();
        openSetApiKeyModal(translator);
    });

    menu.appendChild(setModelBtn);
    menu.appendChild(setApiKeyBtn);
    document.body.appendChild(menu);

    // 设置菜单位置
    const rect = event.target.getBoundingClientRect();
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

    // 使用 requestAnimationFrame 确保菜单先显示再添加点击监听
    requestAnimationFrame(() => {
        document.addEventListener('click', closeMenu);
    });
}

// 打开设置模型的模态窗口
function openSetModelModal(translator) {
    const existingModal = document.querySelector('.macos-alert');
    if (existingModal) {
        existingModal.remove();
    }

    const modal = document.createElement('div');
    modal.className = 'macos-alert';
    modal.innerHTML = `
        <div class="macos-alert-icon">
            <img src="assets/siliconcloud.png" width="24" height="24" alt="SiliconCloud Logo">
        </div>
        <div class="macos-alert-message">
            <p class="macos-alert-title">设置SiliconCloud模型</p>
            <input type="text" id="model-input" class="macos-alert-input" placeholder="输入模型名称">
        </div>
        <div class="macos-alert-buttons">
            <button class="macos-alert-button" id="save-model-button">保存</button>
            <button class="macos-alert-button" onclick="this.parentElement.parentElement.remove()">取消</button>
        </div>
    `;
    document.body.appendChild(modal);

    // 获取当前模型名称并填充到输入框中
    window.electronAPI.getSiliconCloudModel().then(model => {
        const modelInput = document.getElementById('model-input');
        if (model) {
            modelInput.value = model;
        }
    }).catch(error => {
        console.error('获取当前模型名称失败:', error);
    });

    // 处理保存按钮点击
    const saveButton = document.getElementById('save-model-button');
    saveButton.addEventListener('click', async () => {
        const modelInput = document.getElementById('model-input').value.trim();
        if (modelInput) {
            try {
                await window.electronAPI.setSiliconCloudModel(translator, modelInput);
                modal.remove();
                alert('模型名称已保存');
            } catch (error) {
                console.error('保存模型失败:', error);
                alert('保存模型失败，请重试');
            }
        } else {
            alert('模型名称不能为空');
        }
    });
}

// 修改打开设置API Key的模态窗口函数
function openSetApiKeyModal(translator) {
    const existingModal = document.querySelector('.macos-alert');
    if (existingModal) {
        existingModal.remove();
    }

    const modal = document.createElement('div');
    modal.className = 'macos-alert';
    modal.innerHTML = `
        <div class="macos-alert-icon">
            <img src="assets/siliconcloud.png" width="24" height="24" alt="SiliconCloud Logo">
        </div>
        <div class="macos-alert-message">
            <p class="macos-alert-title">设置SiliconCloud API Key</p>
            <input type="text" id="api-key-input" class="macos-alert-input" placeholder="输入API Key">
        </div>
        <div class="macos-alert-buttons">
            <button class="macos-alert-button" id="save-api-key-button">保存</button>
            <button class="macos-alert-button" onclick="this.parentElement.parentElement.remove()">取消</button>
        </div>
    `;
    document.body.appendChild(modal);

    // 获取当前API Key并填充到输入框中
    window.electronAPI.getSiliconCloudApiKey().then(apiKey => {
        const apiKeyInput = document.getElementById('api-key-input');
        if (apiKey) {
            apiKeyInput.value = apiKey;  // 直接显示 API Key
        }
    }).catch(error => {
        console.error('获取当前API Key失败:', error);
    });

    // 处理保存按钮点击
    const saveButton = document.getElementById('save-api-key-button');
    saveButton.addEventListener('click', async () => {
        const apiKeyInput = document.getElementById('api-key-input').value.trim();
        if (apiKeyInput) {
            try {
                await window.electronAPI.saveConfig({
                    silicon_cloud_api_key: apiKeyInput
                });
                modal.remove();
                alert('API Key已保存');
            } catch (error) {
                console.error('保存API Key失败:', error);
                alert('保存API Key失败，请重试');
            }
        } else {
            alert('API Key不能为空');
        }
    });
}

// 添加 AssemblyAI API Key 设置模态窗口函数
function openSetAssemblyAIKeyModal() {
    const existingModal = document.querySelector('.macos-alert');
    if (existingModal) {
        existingModal.remove();
    }

    const modal = document.createElement('div');
    modal.className = 'macos-alert';
    modal.innerHTML = `
        <div class="macos-alert-icon">
            <img src="assets/assemblyai.png" width="24" height="24" alt="AssemblyAI Logo">
        </div>
        <div class="macos-alert-message">
            <p class="macos-alert-title">设置AssemblyAI API Key</p>
            <input type="text" id="asr-key-input" class="macos-alert-input" placeholder="输入API Key">
        </div>
        <div class="macos-alert-buttons">
            <button class="macos-alert-button" id="save-asr-key-button">保存</button>
            <button class="macos-alert-button" onclick="this.parentElement.parentElement.remove()">取消</button>
        </div>
    `;
    document.body.appendChild(modal);

    // 获取当前ASR API Key并填充到输入框中
    window.electronAPI.getConfig().then(config => {
        const asrKeyInput = document.getElementById('asr-key-input');
        if (config && config.asr_api_key) {
            asrKeyInput.value = config.asr_api_key;
        }
    }).catch(error => {
        console.error('获取当前ASR API Key失败:', error);
    });

    // 处理保存按钮点击
    const saveButton = document.getElementById('save-asr-key-button');
    saveButton.addEventListener('click', async () => {
        const asrKeyInput = document.getElementById('asr-key-input').value.trim();
        if (asrKeyInput) {
            try {
                await window.electronAPI.saveConfig({
                    asr_api_key: asrKeyInput
                });
                modal.remove();
                alert('ASR API Key已保存');
            } catch (error) {
                console.error('保存ASR API Key失败:', error);
                alert('保存ASR API Key失败，请重试');
            }
        } else {
            alert('API Key不能为空');
        }
    });
}

// 显示单词翻译右键菜单
async function showWordTranslationMenu(event, word) {
    const existingMenu = document.querySelector('.context-menu');
    if (existingMenu) {
        existingMenu.remove();
    }

    const menu = document.createElement('div');
    menu.className = 'context-menu';

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
        <span>翻译 "${word}"</span>
    `;

    translateBtn.addEventListener('click', async () => {
        menu.remove();
        await translateWord(word);
    });

    menu.appendChild(translateBtn);
    document.body.appendChild(menu);

    // 设置菜单位置
    const x = event.clientX;
    const y = event.clientY;
    
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
            // 如果不是点击翻译按钮，则移除选中样式
            if (!e.target.closest('.context-menu-item')) {
                document.querySelectorAll('.word.selected').forEach(el => {
                    el.classList.remove('selected');
                });
            }
            document.removeEventListener('click', closeMenu);
        }
    };
    
    setTimeout(() => {
        document.addEventListener('click', closeMenu);
    }, 0);
}

// 翻译单词并显示结果
async function translateWord(word) {
    try {
        // 获取当前选中的翻译器
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
            fileHash: 'word_translation',
            subtitles: [{ index: 0, text: word }],
            translator: selectedTranslator,
            apiKey: apiKey
        });

        // 显示翻译结果
        showTranslationResult(word, translationResult[0]?.text || '翻译失败');
        
        // 移除选中样式
        document.querySelectorAll('.word.selected').forEach(el => {
            el.classList.remove('selected');
        });
        
    } catch (error) {
        console.error('翻译失败:', error);
        showTranslationResult(word, `翻译失败: ${error.message}`);
        
        // 移除选中样式
        document.querySelectorAll('.word.selected').forEach(el => {
            el.classList.remove('selected');
        });
    }
}

// 显示翻译结果弹窗
function showTranslationResult(word, translation) {
    const existingModal = document.querySelector('.macos-alert');
    if (existingModal) {
        existingModal.remove();
    }

    const modal = document.createElement('div');
    modal.className = 'macos-alert';
    modal.innerHTML = `
        <div class="macos-alert-icon">
            <svg width="24" height="24" viewBox="0 0 24 24">
                <path d="M3 5h12M9 3v2m1 3l2 2m2-2l-2 2m-8 3h8m-4-2v6m-6 2h12a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" 
                      stroke="currentColor" 
                      fill="none" 
                      stroke-width="2" 
                      stroke-linecap="round" 
                      stroke-linejoin="round"/>
            </svg>
        </div>
        <div class="macos-alert-message">
            <p class="macos-alert-title">${word}</p>
            <p class="macos-alert-text">${translation}</p>
        </div>
        <div class="macos-alert-buttons">
            <button class="macos-alert-button" onclick="this.parentElement.parentElement.remove()">关闭</button>
        </div>
    `;
    document.body.appendChild(modal);
}