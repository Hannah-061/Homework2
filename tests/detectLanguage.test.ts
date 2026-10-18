import { describe, expect, it } from 'vitest';
import { detectLanguage, translationTarget } from '../src/lib/detectLanguage';

describe('判斷語言與翻譯方向', () => {
  it('中文 → 英文', () => {
    expect(detectLanguage('今晚有人要一起打遊戲嗎？')).toBe('zh');
    expect(translationTarget('今晚有人要一起打遊戲嗎？', 'zh')).toBe('en');
    expect(translationTarget('今晚有人要一起打遊戲嗎？', 'en')).toBe('en');
  });
  it('英文 → 中文', () => {
    expect(detectLanguage('Anyone up for a game tonight?')).toBe('en');
    expect(translationTarget('Anyone up for a game tonight?', 'zh')).toBe('zh');
    expect(translationTarget('Anyone up for a game tonight?', 'en')).toBe('zh');
  });
  it('其他語言 → 目前介面語言', () => {
    expect(detectLanguage('Bonne idée, à ce soir !')).toBe('other');
    expect(translationTarget('Bonne idée, à ce soir !', 'zh')).toBe('zh');
    expect(translationTarget('Bonne idée, à ce soir !', 'en')).toBe('en');
    expect(detectLanguage('こんにちは')).toBe('other');
  });
  it('看不出語言 → 翻成中文', () => {
    expect(detectLanguage('12345 👍')).toBe('unknown');
    expect(translationTarget('12345 👍', 'en')).toBe('zh');
  });
});
