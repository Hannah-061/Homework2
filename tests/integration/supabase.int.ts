import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseChatService } from '../../src/services/supabase/SupabaseChatService';
import { AppError, type ChatEvent, type Message } from '../../src/services/ChatService';

// 在 Node 裡沒有瀏覽器，補上最少需要的東西。
// createImageBitmap 只用來讀圖片寬高，這裡回傳 1x1。
const g = globalThis as Record<string, unknown>;
g.window = { addEventListener() {}, setInterval, clearInterval };
g.document = { hidden: false, addEventListener() {} };
g.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });

const URL = process.env.VITE_SUPABASE_URL!;
const KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

const tag = Date.now().toString(36).slice(-4);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 等到某個事件出現（最多 8 秒） */
function waitFor(events: ChatEvent[], pred: (e: ChatEvent) => boolean, ms = 8000): Promise<ChatEvent> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      const hit = events.find(pred);
      if (hit) {
        clearInterval(timer);
        resolve(hit);
      } else if (Date.now() - start > ms) {
        clearInterval(timer);
        reject(new Error('等不到預期的事件'));
      }
    }, 50);
  });
}

async function failsWith(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof AppError ? e.code : `非預期的錯誤：${String(e)}`;
  }
  return 'NO_ERROR';
}

describe('真後台（SupabaseChatService）', () => {
  const a = new SupabaseChatService(URL, KEY);
  const b = new SupabaseChatService(URL, KEY);
  const c = new SupabaseChatService(URL, KEY);
  const aEvents: ChatEvent[] = [];
  const bEvents: ChatEvent[] = [];
  a.subscribe((e) => aEvents.push(e));
  b.subscribe((e) => bEvents.push(e));
  const nameA = `整合${tag}A`;
  const nameB = `整合${tag}B`;
  const sent: Message[] = [];

  afterAll(async () => {
    for (const m of sent) await a.retract(m.id).catch(() => undefined);
    await a.leave().catch(() => undefined);
    await b.leave().catch(() => undefined);
    await c.leave().catch(() => undefined);
  });

  beforeAll(async () => {
    expect(URL && KEY).toBeTruthy();
  });

  it('進入：拿到身分、歷史訊息、在線名單（含自己）', async () => {
    const res = await a.join(nameA);
    expect(res.userId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Array.isArray(res.messages)).toBe(true);
    expect(res.messages.length).toBeLessThanOrEqual(50);
    expect(res.onlineUsers.some((u) => u.userId === res.userId && u.nickname === nameA)).toBe(true);
  });

  it('另一個人進入：第一個人收到 presence.joined；代號重複被擋', async () => {
    await b.join(nameB);
    const ev = await waitFor(aEvents, (e) => e.type === 'presence.joined' && e.user.nickname === nameB);
    expect(ev.type).toBe('presence.joined');
    expect(await failsWith(c.join(nameA.toUpperCase()))).toBe('NICKNAME_TAKEN');
    expect(await failsWith(c.join('a​b'))).toBe('NICKNAME_INVALID');
  });

  it('送訊息：自己拿到結果，對方即時收到 message.new', async () => {
    const m = await a.sendText('整合測試訊息 👋');
    sent.push(m);
    expect(m.status).toBe('normal');
    expect(m.text).toBe('整合測試訊息 👋');
    const ev = await waitFor(bEvents, (e) => e.type === 'message.new' && e.message.id === m.id);
    expect(ev.type === 'message.new' && ev.message.nickname).toBe(nameA);
  });

  it('檢舉：不能檢舉自己、不能重複檢舉', async () => {
    const m = sent[0]!;
    expect(await failsWith(a.report(m.id))).toBe('CANNOT_REPORT_OWN');
    await b.report(m.id);
    expect(await failsWith(b.report(m.id))).toBe('ALREADY_REPORTED');
  });

  it('收回：只能收回自己的；對方收到 message.updated，內容被清空', async () => {
    const m = sent[0]!;
    expect(await failsWith(b.retract(m.id))).toBe('NOT_OWNER');
    await a.retract(m.id);
    const ev = await waitFor(bEvents, (e) => e.type === 'message.updated' && e.message.id === m.id);
    expect(ev.type === 'message.updated' && ev.message.status).toBe('retracted');
    expect(ev.type === 'message.updated' && ev.message.text).toBeNull();
  });

  it('圖片：上傳、送出、可以用公開網址讀到', async () => {
    await sleep(1000);
    const file = new File([PNG], 'x.png', { type: 'image/png' });
    const m = await a.sendImage(file);
    sent.push(m);
    expect(m.kind).toBe('image');
    expect(m.image?.url).toContain('/storage/v1/object/public/chat-images/');
    const res = await fetch(m.image!.url);
    expect(res.status).toBe(200);
    await waitFor(bEvents, (e) => e.type === 'message.new' && e.message.id === m.id);
  });

  it('頻率限制：10 秒內第 6 則被擋，帶秒數', async () => {
    await sleep(10_500);
    const results: string[] = [];
    let retry: number | undefined;
    for (let i = 0; i < 6; i++) {
      try {
        sent.push(await b.sendText(`頻率 ${i}`));
        results.push('ok');
      } catch (e) {
        results.push(e instanceof AppError ? e.code : 'ERR');
        if (e instanceof AppError) retry = e.retryAfterSeconds;
      }
    }
    expect(results.slice(0, 5)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    expect(results[5]).toBe('RATE_LIMITED');
    expect(retry).toBeGreaterThanOrEqual(1);
    for (const m of sent.slice(-5)) await b.retract(m.id).catch(() => undefined);
  });

  it('翻譯與連結預覽：Edge Function 還沒部署時，會優雅地失敗（不會當機）', async () => {
    const code = await failsWith(a.translate(sent[0]!.id, 'en'));
    expect(['TRANSLATE_FAILED', 'TRANSLATE_QUOTA', 'MESSAGE_NOT_FOUND', 'NO_ERROR']).toContain(code);
    const p = await failsWith(a.previewLink('https://example.com'));
    expect(['PREVIEW_UNAVAILABLE', 'NO_ERROR']).toContain(p);
  });

  it('離開：對方收到 presence.left，代號被釋放', async () => {
    await b.leave();
    await waitFor(aEvents, (e) => e.type === 'presence.left' && e.user.nickname === nameB);
    const res = await c.join(nameB);
    expect(res.userId).toBeTruthy();
  });
});
