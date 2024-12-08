function parseTranscript(transcript) {
    // transcript与Python代码结构相同
    // 提取出subtitles结构
    let subtitles = [];
    for (let utt of transcript.utterances) {
      subtitles.push({
        speaker: utt.speaker,
        start_time: utt.start,
        end_time: utt.end,
        text: utt.text,
        words: utt.words
      });
    }
    return subtitles;
  }
  
  function generateSubtitleTimes(subtitles) {
    return subtitles.map(s => s.start_time);
  }
  
  module.exports = {
    parseTranscript,
    generateSubtitleTimes
  };