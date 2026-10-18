import type { Mention } from '../services/ChatService';

/** 文字裡的提及，用 @代號 表示 */
export const mentionToken = (nickname: string): string => `@${nickname}`;

/**
 * 游標前面是不是正在打 @（而且 @ 前面是開頭或空白）？
 * 是的話回傳「@ 的位置」與「@ 後面已經打的字」，用來跳出提及選單。
 */
export function findMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)@([^\s@]*)$/.exec(before);
  if (!m) return null;
  const query = m[2] ?? '';
  return { start: before.length - query.length - 1, query };
}

/** 把「@ 與後面已經打的字」換成「@代號 」（後面加一個空白），並回傳新的游標位置 */
export function insertMention(
  text: string,
  start: number,
  caret: number,
  nickname: string,
): { text: string; caret: number } {
  const insert = `${mentionToken(nickname)} `;
  return { text: text.slice(0, start) + insert + text.slice(caret), caret: start + insert.length };
}

/** 送出前：只留下「文字裡真的還有 @代號」的人（選了又刪掉的不算），同一個人只算一次 */
export function validMentions(text: string, picked: readonly Mention[]): Mention[] {
  const seen = new Set<string>();
  const out: Mention[] = [];
  for (const m of picked) {
    if (seen.has(m.userId)) continue;
    if (text.includes(mentionToken(m.nickname))) {
      seen.add(m.userId);
      out.push(m);
    }
  }
  return out;
}

export type MentionSegment =
  | { type: 'text'; value: string }
  | { type: 'mention'; value: string; mention: Mention };

/**
 * 把文字切成「一般文字」和「提及」的片段，畫面一段一段組成元素（不拼 HTML）。
 * 代號長的先比對，這樣 @小明明 不會被 @小明 搶走。
 */
export function splitByMentions(text: string, mentions: readonly Mention[]): MentionSegment[] {
  if (mentions.length === 0) return [{ type: 'text', value: text }];
  const sorted = [...mentions].sort((a, b) => b.nickname.length - a.nickname.length);
  const out: MentionSegment[] = [];
  let i = 0;
  let buf = '';
  while (i < text.length) {
    let hit: Mention | null = null;
    if (text[i] === '@') {
      hit = sorted.find((m) => text.startsWith(mentionToken(m.nickname), i)) ?? null;
    }
    if (hit) {
      if (buf) out.push({ type: 'text', value: buf });
      buf = '';
      const token = mentionToken(hit.nickname);
      out.push({ type: 'mention', value: token, mention: hit });
      i += token.length;
    } else {
      buf += text[i];
      i++;
    }
  }
  if (buf) out.push({ type: 'text', value: buf });
  return out;
}

/** 這則訊息有沒有「提到」某個人：被 @，或這則訊息引用了他的訊息 */
export function mentionsUser(
  message: { senderId: string; mentions: readonly Mention[]; replyTo: { senderId: string } | null },
  userId: string | null,
): boolean {
  if (!userId || message.senderId === userId) return false;
  return message.mentions.some((m) => m.userId === userId) || message.replyTo?.senderId === userId;
}
