import type { Lang } from '../services/ChatService';

export type Detected = 'zh' | 'en' | 'other' | 'unknown';

/**
 * 粗略判斷一段文字主要是哪種語言（不連網，只看字元）：
 * - 有日文假名、韓文，或帶重音符號／其他文字（法文、俄文…）→ other
 * - 漢字比英文字母多 → zh
 * - 只有英文字母 → en
 * - 沒有任何文字（只有數字、符號、emoji）→ unknown
 */
export function detectLanguage(text: string): Detected {
  let han = 0;
  let ascii = 0;
  let other = 0;
  for (const ch of text) {
    if (/\p{Script=Han}/u.test(ch)) han++;
    else if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(ch)) other += 2;
    else if (/[A-Za-z]/.test(ch)) ascii++;
    else if (/\p{L}/u.test(ch)) other++;
  }
  // 有重音符號、假名、韓文、西里爾字母…（而且不是以漢字為主）→ 其他語言
  if (other > 0 && (han === 0 || other >= han)) return 'other';
  if (han > 0 && han >= ascii) return 'zh';
  if (ascii > 0) return 'en';
  if (han > 0) return 'zh';
  return other > 0 ? 'other' : 'unknown';
}

/**
 * 翻譯方向（docs/architecture.md 5.2）：
 * 中文 → 英文；英文 → 中文；其他語言 → 目前介面語言；
 * 無法判斷 → 目前介面語言，但介面是英文又無法判斷時翻成中文。
 */
export function translationTarget(text: string, uiLang: Lang): Lang {
  switch (detectLanguage(text)) {
    case 'zh':
      return 'en';
    case 'en':
      return 'zh';
    case 'other':
      return uiLang;
    default:
      return 'zh';
  }
}
