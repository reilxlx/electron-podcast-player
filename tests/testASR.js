const { transcribeAudio } = require('../src/services/transcriptionService');

// 测试配置
const TEST_CONFIG = {
    audioFile: process.argv[2], // 从命令行参数获取音频文件路径
    apiKey: process.argv[3]     // 从命令行参数获取API Key
};

async function testASR() {
    // 参数检查
    if (!TEST_CONFIG.audioFile || !TEST_CONFIG.apiKey) {
        console.error('使用方法: node testASR.js <音频文件路径> <API_KEY>');
        process.exit(1);
    }

    console.log('开始ASR测试...');
    console.log('音频文件:', TEST_CONFIG.audioFile);
    console.log('API Key:', TEST_CONFIG.apiKey.substring(0, 8) + '********');

    try {
        // 调用ASR服务
        const result = await transcribeAudio(TEST_CONFIG.audioFile, TEST_CONFIG.apiKey);

        // 输出结果
        console.log('\n转录结果:');
        console.log('='.repeat(50));
        
        // 完整文本
        console.log('\n完整文本:');
        console.log(result.text);
        
        // 分段文本（带说话人）
        if (result.utterances && result.utterances.length > 0) {
            console.log('\n分段文本:');
            result.utterances.forEach((utterance, index) => {
                console.log(`\n[说话人 ${utterance.speaker}] ${utterance.text}`);
                console.log(`时间: ${formatTime(utterance.start)} -> ${formatTime(utterance.end)}`);
            });
        }

        // 保存结果到文件
        const fs = require('fs');
        const outputFile = `asr_result_${Date.now()}.json`;
        fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
        console.log(`\n详细结果已保存到文件: ${outputFile}`);

    } catch (error) {
        console.error('\n转录失败:', error);
        process.exit(1);
    }
}

// 时间格式化函数（毫秒转为 MM:SS 格式）
function formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

// 运行测试
testASR().then(() => {
    console.log('\n测试完成');
    process.exit(0);
}).catch(error => {
    console.error('\n测试过程中发生错误:', error);
    process.exit(1);
}); 