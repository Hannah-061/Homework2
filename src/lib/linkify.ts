export type Segment =
  | { type: 'text'; value: string }
  | { type: 'link'; value: string; href: string };

// 只認 http:// 與 https://。javascript:、data: 之類的一律不會變成連結。
const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING_PUNCT = /[.,!?;:)\]}、。，！？；：）」』】》〉]+$/u;

function isSafeUrl(href: string): boolean {
  try {
    const u = new URL(href);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 把文字切成「一般文字」與「連結」的片段。
 * 畫面再用片段一段一段組成元素，絕不拼 HTML 字串（避免 XSS）。
 */
export function linkify(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    let url = match[0];
    const trimmed = url.replace(TRAILING_PUNCT, '');
    const tail = url.slice(trimmed.length);
    url = trimmed;
    if (!isSafeUrl(url)) continue;
    if (start > last) out.push({ type: 'text', value: text.slice(last, start) });
    out.push({ type: 'link', value: url, href: url });
    last = start + url.length;
    if (tail) {
      out.push({ type: 'text', value: tail });
      last += tail.length;
    }
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}

export function firstUrl(text: string): string | null {
  const link = linkify(text).find((s) => s.type === 'link');
  return link ? link.value : null;
}
