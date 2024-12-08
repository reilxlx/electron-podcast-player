const { translateTextBatch } = require('../src/services/translationService');

/**
 * 测试翻译服务
 */
async function testTranslationService() {
    console.log('开始测试翻译服务...\n');

    // 测试用例1: 单句英文翻译
    try {
        console.log('测试1: 单句英文翻译');
        const result1 = await translateTextBatch([
            { index: 0, text: "Hello, how are you?" }
        ], 'google');
        console.log('输入:', "Hello, how are you?");
        console.log('输出:', result1[0].text);
        console.log('翻译器:', result1[0].translator);
        console.log('测试1完成\n');
    } catch (error) {
        console.error('测试1失败:', error);
    }

    // 测试用例2: 多句英文翻译
    try {
        console.log('测试2: 多句英文翻译');
        const texts = [
            { index: 0, text: "The weather is nice today." },
            { index: 1, text: "I love programming." },
            { index: 2, text: "This is a test message." }
        ];
        const result2 = await translateTextBatch(texts, 'google');
        texts.forEach(item => {
            console.log('输入:', item.text);
            console.log('输出:', result2[item.index].text);
            console.log('---');
        });
        console.log('测试2完成\n');
    } catch (error) {
        console.error('测试2失败:', error);
    }

    // 测试用例3: 特殊字符处理
    try {
        console.log('测试3: 特殊字符处理');
        const result3 = await translateTextBatch([
            { index: 0, text: "Hello! How's your day? :)" }
        ], 'google');
        console.log('输入:', "Hello! How's your day? :)");
        console.log('输出:', result3[0].text);
        console.log('测试3完成\n');
    } catch (error) {
        console.error('测试3失败:', error);
    }

    // 测试用例4: 长文本翻译
    try {
        console.log('测试4: 长文本翻译');
        const longText = "This is a longer text that we want to translate. " +
            "It contains multiple sentences and should test the translator's " +
            "ability to handle longer content. Let's see how it performs.";
        const result4 = await translateTextBatch([
            { index: 0, text: longText }
        ], 'google');
        console.log('输入:', longText);
        console.log('输出:', result4[0].text);
        console.log('测试4完成\n');
    } catch (error) {
        console.error('测试4失败:', error);
    }
}

// 运行测试
testTranslationService().then(() => {
    console.log('所有测试完成');
}).catch(error => {
    console.error('测试过程中发生错误:', error);
}); 