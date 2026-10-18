import { describe, expect, it } from 'vitest';
import { firstUrl, linkify } from '../src/lib/linkify';

describe('網址轉連結', () => {
  it('http 與 https 會變成連結', () => {
    expect(linkify('看 https://example.com/a?b=1 吧')).toEqual([
      { type: 'text', value: '看 ' },
      { type: 'link', value: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
      { type: 'text', value: ' 吧' },
    ]);
  });
  it('句尾的標點不算網址的一部分', () => {
    const segs = linkify('是 https://example.com/x。');
    expect(segs.find((s) => s.type === 'link')?.value).toBe('https://example.com/x');
  });
  it('javascript: 與 data: 不會變成連結', () => {
    expect(linkify('javascript:alert(1)').every((s) => s.type === 'text')).toBe(true);
    expect(linkify('data:text/html,<script>alert(1)</script>').every((s) => s.type === 'text')).toBe(true);
  });
  it('HTML 標籤原樣當作文字，不會被拆解', () => {
    const segs = linkify('<script>alert(1)</script>');
    expect(segs).toEqual([{ type: 'text', value: '<script>alert(1)</script>' }]);
  });
  it('firstUrl 取第一個網址', () => {
    expect(firstUrl('a https://a.com b https://b.com')).toBe('https://a.com');
    expect(firstUrl('沒有網址')).toBeNull();
  });
});
