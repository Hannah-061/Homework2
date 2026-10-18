import { describe, expect, it } from 'vitest';
import { checkNickname, countChars, nicknameKey, truncateChars } from '../src/lib/nickname';

describe('代號規則', () => {
  it('去掉前後空白', () => {
    expect(checkNickname('  小明  ')).toEqual({ ok: true, nickname: '小明' });
  });
  it('全空白或空字串不行', () => {
    expect(checkNickname('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(checkNickname('')).toEqual({ ok: false, reason: 'empty' });
  });
  it('12 個字可以，13 個字不行', () => {
    expect(checkNickname('一二三四五六七八九十甲乙').ok).toBe(true);
    expect(checkNickname('一二三四五六七八九十甲乙丙')).toEqual({ ok: false, reason: 'too-long' });
  });
  it('emoji 算 1 個字', () => {
    expect(countChars('🐱')).toBe(1);
    expect(countChars('👨‍👩‍👧')).toBe(1);
    expect(checkNickname('🐱'.repeat(12)).ok).toBe(true);
    expect(checkNickname('🐱'.repeat(13)).ok).toBe(false);
  });
  it('看不見的字元一律拒絕（零寬空白、文字方向控制字元）', () => {
    expect(checkNickname('小​明')).toEqual({ ok: false, reason: 'invalid-chars' });
    expect(checkNickname('‮abc')).toEqual({ ok: false, reason: 'invalid-chars' });
  });
  it('比對重複時忽略大小寫、全形半形與前後空白', () => {
    expect(nicknameKey('Sam')).toBe(nicknameKey(' ＳＡＭ '));
  });
  it('truncateChars 不會把 emoji 切一半', () => {
    expect(truncateChars('🐱🐱🐱', 2)).toBe('🐱🐱');
  });
});
