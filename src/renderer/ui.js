let apiKeyInputTimeout;

// 初始化翻译选项
function initTranslationOptions() {
    const translatorBtns = document.querySelectorAll('.option-pill');
    const apiKeyInput = document.getElementById('api-key-input');
    
    // 默认选中Google翻译
    setActiveTranslator('google');
    apiKeyInput.value = 'Google翻译无需API Key';
    apiKeyInput.disabled = true;
    
    translatorBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const translator = btn.getAttribute('data-translator');
            setActiveTranslator(translator);
            
            if (translator === 'google') {
                apiKeyInput.value = 'Google翻译无需API Key';
                apiKeyInput.disabled = true;
            } else if (translator === 'silicon_cloud') {
                // 从config中获取API key并用*号显示
                const maskedKey = window.electronAPI.getSiliconCloudApiKey().then(key => {
                    apiKeyInput.value = key.replace(/./g, '*');
                    apiKeyInput.disabled = false;
                });
            }
        });
    });
    
    // API Key输入框鼠标悬停事件
    apiKeyInput.addEventListener('mouseenter', () => {
        if (apiKeyInput.disabled) return;
        
        apiKeyInputTimeout = setTimeout(async () => {
            const key = await window.electronAPI.getSiliconCloudApiKey();
            apiKeyInput.value = key;
        }, 1000);
    });
    
    apiKeyInput.addEventListener('mouseleave', () => {
        clearTimeout(apiKeyInputTimeout);
        if (!apiKeyInput.disabled) {
            const key = apiKeyInput.value;
            apiKeyInput.value = key.replace(/./g, '*');
        }
    });
}

// 设置活动的翻译器
function setActiveTranslator(translator) {
    const translatorBtns = document.querySelectorAll('.option-pill');
    translatorBtns.forEach(btn => {
        if (btn.getAttribute('data-translator') === translator) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

// 根据历史文件的翻译器设置UI状态
function setTranslatorFromHistory(translations) {
    if (!translations || Object.keys(translations).length === 0) return;
    
    // 获取第一个翻译的translator
    const firstTranslation = translations[Object.keys(translations)[0]];
    const translator = firstTranslation.translator;
    
    setActiveTranslator(translator);
    const apiKeyInput = document.getElementById('api-key-input');
    
    if (translator === 'google') {
        apiKeyInput.value = 'Google翻译无需API Key';
        apiKeyInput.disabled = true;
    } else if (translator === 'silicon_cloud') {
        window.electronAPI.getSiliconCloudApiKey().then(key => {
            apiKeyInput.value = key.replace(/./g, '*');
            apiKeyInput.disabled = false;
        });
    }
}

// 在页面加载时初始化
document.addEventListener('DOMContentLoaded', () => {
    initTranslationOptions();
});

module.exports = {
    setTranslatorFromHistory
};