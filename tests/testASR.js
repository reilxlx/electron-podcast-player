const { transcribeAudio } = require('../src/services/transcriptionService');
const fs = require('fs');
const path = require('path');

// 测试配置
const TEST_CONFIG = {
    audioFile: process.argv[2],
    apiKey: process.argv[3]
};

async function testASR() {
    if (!TEST_CONFIG.audioFile || !TEST_CONFIG.apiKey) {
        console.error('使用方法: node testASR.js <音频文件路径> <API_KEY>');
        process.exit(1);
    }

    console.log('开始ASR测试...');
    console.log('音频文件:', TEST_CONFIG.audioFile);
    console.log('API Key:', TEST_CONFIG.apiKey.substring(0, 8) + '********');

    try {
        const result = await transcribeAudio(TEST_CONFIG.audioFile, TEST_CONFIG.apiKey);

        console.log('\n转录结果:');
        console.log('='.repeat(50));

        // 显示分段文本
        if (result.subtitles && result.subtitles.length > 0) {
            result.subtitles.forEach((subtitle, index) => {
                console.log(`\n[段落 ${index + 1}]`);
                console.log(`说话人: ${subtitle.speaker}`);
                console.log(`时间: ${formatTime(subtitle.start_time)} -> ${formatTime(subtitle.end_time)}`);
                console.log(`内容: ${subtitle.content}`);
                
                // 显示词级别时间戳（可选）
                if (subtitle.words && subtitle.words.length > 0) {
                    console.log('词级别时间戳:');
                    subtitle.words.forEach(word => {
                        console.log(`  ${word.text}: ${formatTime(word.start)} -> ${formatTime(word.end)}`);
                    });
                }
                console.log('-'.repeat(50));
            });
        }

        // 保存结果到文件
        const outputDir = path.join(__dirname, '../podcast_data/subtitles');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        
        const outputFile = path.join(outputDir, `test_result_${Date.now()}.json`);
        fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
        console.log(`\n详细结果已保存到文件: ${outputFile}`);

    } catch (error) {
        console.error('\n转录失败:', error);
        process.exit(1);
    }
}

function formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

testASR().then(() => {
    console.log('\n测试完成');
    process.exit(0);
}).catch(error => {
    console.error('\n测试过程中发生错误:', error);
    process.exit(1);
}); 