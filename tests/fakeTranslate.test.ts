import { describe, expect, it } from 'vitest';
import { fakeTranslate } from '../src/services/mock/fakes';

describe('假後台的翻譯', () => {
  it('認得的中文句子會翻成英文', () => {
    expect(fakeTranslate('有人想一起打遊戲嗎？', 'en').translatedText).toBe('Anyone want to play games together?');
  });
  it('認得的英文句子會翻成中文', () => {
    expect(fakeTranslate('Anyone up for a game tonight?', 'zh').translatedText).toBe('今晚有人想一起玩遊戲嗎？');
  });
  it('不認得的句子明確標示是模擬，不假裝翻譯過', () => {
    const r = fakeTranslate('我自己打的一句話', 'en').translatedText;
    expect(r).toContain('Simulated');
    expect(r).toContain('我自己打的一句話');
  });
});
