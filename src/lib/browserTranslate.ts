import type { Lang } from '../services/ChatService';
import { detectLanguage } from './detectLanguage';

/**
 * 用瀏覽器內建的翻譯功能（Chrome 的 Translator API）翻譯：
 * 翻譯在使用者自己的電腦上做，不經過後台、不花錢。
 * 限制：只有電腦版 Chrome 138 以上（以及 Edge 148 以上）支援；第一次翻某個語言會先下載語言模型。
 */

type Availability = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported';

interface TranslatorInstance {
  translate(text: string): Promise<string>;
}
interface TranslatorStatic {
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<Availability>;
  create(o: { sourceLanguage: string; targetLanguage: string }): Promise<TranslatorInstance>;
}
interface DetectorInstance {
  detect(text: string): Promise<{ detectedLanguage: string; confidence: number }[]>;
}
interface DetectorStatic {
  create(): Promise<DetectorInstance>;
}

const g = globalThis as unknown as { Translator?: TranslatorStatic; LanguageDetector?: DetectorStatic };

export function browserTranslatorSupported(): boolean {
  return typeof g.Translator !== 'undefined';
}

/** 繁體優先，沒有再退回通用的中文 */
const CHINESE_TAGS = ['zh-Hant', 'zh'];

const translators = new Map<string, Promise<TranslatorInstance | null>>();

async function usable(source: string, target: string): Promise<boolean> {
  try {
    const a = await g.Translator!.availability({ sourceLanguage: source, targetLanguage: target });
    return a === 'available' || a === 'downloadable' || a === 'downloading';
  } catch {
    return false;
  }
}

async function getTranslator(source: string, target: string): Promise<TranslatorInstance | null> {
  const key = `${source}>${target}`;
  let p = translators.get(key);
  if (!p) {
    p = (async () => {
      if (!(await usable(source, target))) return null;
      // create() 需要使用者剛剛有點擊動作（按「翻譯」就是），第一次會下載語言模型
      return g.Translator!.create({ sourceLanguage: source, targetLanguage: target });
    })();
    translators.set(key, p);
    p.then((t) => {
      if (t === null) translators.delete(key);
    }).catch(() => translators.delete(key));
  }
  return p;
}

/** 判斷原文的語言代碼（Translator 需要知道來源語言） */
async function sourceTags(text: string): Promise<string[]> {
  const d = detectLanguage(text);
  if (d === 'zh') return CHINESE_TAGS;
  if (d === 'en') return ['en'];
  // 其他語言或看不出來：交給瀏覽器的語言偵測
  if (g.LanguageDetector) {
    try {
      const detector = await g.LanguageDetector.create();
      const top = (await detector.detect(text))[0];
      if (top && top.confidence > 0.5) return [top.detectedLanguage];
    } catch {
      // 偵測不到就當作翻不了
    }
  }
  return [];
}

/** 翻譯；做不到就丟出錯誤，由呼叫的人轉成「翻譯失敗」 */
export async function translateInBrowser(text: string, target: Lang): Promise<string> {
  if (!browserTranslatorSupported()) throw new Error('unsupported');
  const targets = target === 'zh' ? CHINESE_TAGS : ['en'];
  for (const source of await sourceTags(text)) {
    for (const tgt of targets) {
      if (source === tgt) continue;
      const translator = await getTranslator(source, tgt);
      if (translator) return translator.translate(text);
    }
  }
  throw new Error('no translator for this language pair');
}
