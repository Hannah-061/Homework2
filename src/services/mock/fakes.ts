import { AppError, type LinkPreview, type Lang, type TranslateResult } from '../ChatService';
import { SAMPLE_THUMB } from './seed';

interface Phrase {
  /** 原文可能的寫法 */
  texts: string[];
  zh: string;
  en: string;
}

/** 假後台認得的句子（機器人會說的話、範例歷史訊息），翻譯結果是真的中英對照 */
const PHRASES: Phrase[] = [
  { texts: ['今天天氣真好'], zh: '今天天氣真好', en: 'The weather is great today.' },
  { texts: ['有人在嗎？'], zh: '有人在嗎？', en: 'Is anyone here?' },
  { texts: ['Anyone up for a game tonight?'], zh: '今晚有人想一起玩遊戲嗎？', en: 'Anyone up for a game tonight?' },
  {
    texts: ['剛剛那個連結你們看了嗎 https://example.com/post/42'],
    zh: '剛剛那個連結你們看了嗎 https://example.com/post/42',
    en: 'Did you guys see that link? https://example.com/post/42',
  },
  { texts: ['哈哈哈哈'], zh: '哈哈哈哈', en: 'Hahaha' },
  { texts: ['我先去吃飯，晚點回來'], zh: '我先去吃飯，晚點回來', en: "I'm going to grab a meal first. Back later." },
  { texts: ['Good morning, everyone!'], zh: '大家早安！', en: 'Good morning, everyone!' },
  { texts: ['Bonne idée, à ce soir !'], zh: '好主意，今晚見！', en: 'Good idea, see you tonight!' },
  { texts: ['推薦一部好看的電影給我'], zh: '推薦一部好看的電影給我', en: 'Recommend me a good movie.' },
  { texts: ['收到 👍'], zh: '收到 👍', en: 'Got it 👍' },
  { texts: ['有人想一起打遊戲嗎？'], zh: '有人想一起打遊戲嗎？', en: 'Anyone want to play games together?' },
  { texts: ['See you all tomorrow'], zh: '明天見各位', en: 'See you all tomorrow' },
  { texts: ['大家晚安，今天有人要通宵嗎？'], zh: '大家晚安，今天有人要通宵嗎？', en: "Good night, everyone. Is anyone staying up all night tonight?" },
  { texts: ['我可以，但我要先去洗澡 🛁'], zh: '我可以，但我要先去洗澡 🛁', en: "I'm in, but I need to take a bath first 🛁" },
  { texts: ['Count me in, I will bring snacks.'], zh: '算我一份，我會帶零食。', en: 'Count me in, I will bring snacks.' },
  { texts: ['那九點見'], zh: '那九點見', en: 'See you at nine, then.' },
  { texts: ['晚安～'], zh: '晚安～', en: 'Good night~' },
  { texts: ['早安！昨天好像有人沒睡 😂'], zh: '早安！昨天好像有人沒睡 😂', en: 'Good morning! Looks like somebody never slept last night 😂' },
  { texts: ['有人看過這個嗎？ https://example.com/post/42'], zh: '有人看過這個嗎？ https://example.com/post/42', en: 'Has anyone seen this? https://example.com/post/42' },
  { texts: ['這是一則因為多人檢舉而被遮住的訊息'], zh: '這是一則因為多人檢舉而被遮住的訊息', en: 'This is a message that was hidden because of multiple reports.' },
  { texts: ['哈哈 這張好可愛'], zh: '哈哈 這張好可愛', en: 'Haha, this one is so cute.' },
  { texts: ['哈哈 我剛看到 👋'], zh: '哈哈 我剛看到 👋', en: 'Haha, I just saw it 👋' },
  { texts: ['我可以！'], zh: '我可以！', en: "I'm in!" },
  { texts: ['晚上有人要一起打遊戲嗎？'], zh: '晚上有人要一起打遊戲嗎？', en: 'Does anyone want to play games together tonight?' },
];

/**
 * 假的翻譯：不連任何翻譯服務。
 * 認得的句子（機器人、範例訊息）會給真的中英對照；其他句子（例如你自己打的）
 * 沒辦法真的翻，只會標示「模擬」並附上原文。真的翻譯在階段二才有。
 */
export function fakeTranslate(text: string, targetLang: Lang): TranslateResult {
  const known = PHRASES.find((p) => p.texts.includes(text.trim()));
  if (known) return { translatedText: known[targetLang], targetLang };
  const note = targetLang === 'en' ? '[Simulated English translation, not a real one]' : '【模擬中文翻譯，不是真的翻譯】';
  return { translatedText: `${note} ${text}`, targetLang };
}

const PREVIEWS: Record<string, Omit<LinkPreview, 'url'>> = {
  'example.com': {
    siteName: 'example.com',
    title: '網站標題會顯示在這裡',
    description: '網站的簡短描述，最多顯示兩行。這是假後台提供的範例。',
    thumbnailUrl: SAMPLE_THUMB,
  },
  'github.com': {
    siteName: 'GitHub',
    title: 'GitHub：程式碼放這裡',
    description: '假後台的範例預覽，沒有縮圖時只顯示文字。',
    thumbnailUrl: null,
  },
  'wikipedia.org': {
    siteName: 'Wikipedia',
    title: '維基百科，自由的百科全書',
    description: '假後台的範例預覽。',
    thumbnailUrl: null,
  },
};

/** 假的連結預覽：只認幾個固定網站，其他一律「無法取得」 */
export function fakePreview(url: string): LinkPreview {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    throw new AppError('PREVIEW_UNAVAILABLE');
  }
  const key = Object.keys(PREVIEWS).find((k) => host === k || host.endsWith(`.${k}`));
  if (!key) throw new AppError('PREVIEW_UNAVAILABLE');
  return { url, ...PREVIEWS[key]! };
}
