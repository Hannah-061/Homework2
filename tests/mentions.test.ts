import { describe, expect, it } from 'vitest';
import { findMentionQuery, insertMention, splitByMentions, validMentions } from '../src/lib/mentions';

const a = { userId: 'a', nickname: '小明' };
const b = { userId: 'b', nickname: '小明明' };

describe('提及（@）', () => {
  it('游標前面正在打 @ 時，找得到 @ 的位置與已經打的字', () => {
    expect(findMentionQuery('嗨 @小', 4)).toEqual({ start: 2, query: '小' });
    expect(findMentionQuery('@', 1)).toEqual({ start: 0, query: '' });
  });
  it('@ 前面不是開頭或空白（例如 email）就不算', () => {
    expect(findMentionQuery('abc@def', 7)).toBeNull();
  });
  it('@ 後面已經有空白，就不再是在打提及', () => {
    expect(findMentionQuery('@小明 你好', 6)).toBeNull();
  });
  it('選了人之後，換成「@代號 」並把游標放在後面', () => {
    expect(insertMention('嗨 @小', 2, 4, '小明')).toEqual({ text: '嗨 @小明 ', caret: 6 });
  });
  it('送出前只留下文字裡還有 @代號 的人，同一個人只算一次', () => {
    expect(validMentions('嗨 @小明', [a, b, a])).toEqual([a]);
    expect(validMentions('沒有提到任何人', [a])).toEqual([]);
  });
  it('切成一般文字與提及的片段；代號長的先比對', () => {
    expect(splitByMentions('嗨 @小明明 和 @小明！', [a, b])).toEqual([
      { type: 'text', value: '嗨 ' },
      { type: 'mention', value: '@小明明', mention: b },
      { type: 'text', value: ' 和 ' },
      { type: 'mention', value: '@小明', mention: a },
      { type: 'text', value: '！' },
    ]);
  });
  it('沒選過的 @某某 只是一般文字', () => {
    expect(splitByMentions('@路人 你好', [a])).toEqual([{ type: 'text', value: '@路人 你好' }]);
  });
});
