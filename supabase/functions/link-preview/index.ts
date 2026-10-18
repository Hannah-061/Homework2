// Edge Function：link-preview
// 前端把訊息裡的網址送來，這裡代替使用者去讀該網頁的「分享資訊」（Open Graph 標籤），
// 整理成 { url, siteName, title, description, thumbnailUrl } 回傳。結果會快取 24 小時。
// 部署時 Verify JWT 要「關掉」：後台那個開關只認舊版簽章，新版專案的使用者登入憑證會被誤擋。
// 改由這支程式自己驗證：請求要帶使用者的登入憑證（匿名身分也算），向 Supabase 確認過才處理。
//
// 安全（docs/architecture.md 第 9 節）：
//  - 只接受 http / https，只接受 80 / 443 埠
//  - SSRF 防護：網址指向的 IP 必須是公開網路，拒絕本機、內部網路、雲端服務的 metadata 位址；
//    重新導向最多 3 次，每一次都重新檢查
//  - 逾時 5 秒，最多讀 1 MB；只回傳整理後的欄位，不回傳原始網頁內容
//  - 縮圖只收 https
//  - CORS：只有 ALLOWED_ORIGINS（Edge Function Secrets，用逗號隔開）裡的網站能呼叫
//
// 這份程式是貼到 Supabase 後台的編輯器裡的（後台編輯器不支援多個檔案），所以所有東西都寫在這一個檔案裡。

import { createClient } from 'npm:@supabase/supabase-js@2';

const CACHE_HOURS = 24;
const MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 5000;

function secretKey(): string {
  try {
    const dict = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>;
    const first = dict.default ?? Object.values(dict)[0];
    if (first) return first;
  } catch {
    // 讀不到就用舊名字
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
}

// ---------- CORS ----------

function allowedOrigin(req: Request): string | null {
  const origin = req.headers.get('origin');
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return origin && allowed.includes(origin) ? origin : null;
}

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin ?? 'null',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

// ---------- SSRF 防護 ----------

function isPrivateV4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p as [number, number, number, number];
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateV6(ip: string): boolean {
  const x = ip.toLowerCase();
  if (x === '::' || x === '::1') return true;
  if (x.startsWith('fc') || x.startsWith('fd')) return true; // 內部網路
  if (x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb')) return true; // link-local
  const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]!);
  return false;
}

/** 這個網址能不能安全地去讀：只接受 http/https、80/443 埠，而且主機解析出來的每個 IP 都是公開網路 */
async function assertPublic(u: URL): Promise<void> {
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('protocol');
  if (u.port && u.port !== '80' && u.port !== '443') throw new Error('port');
  if (u.username || u.password) throw new Error('credentials');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new Error('local host');
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (isPrivateV4(host)) throw new Error('private ip');
    return;
  }
  if (host.includes(':')) {
    if (isPrivateV6(host)) throw new Error('private ip');
    return;
  }
  const v4 = await Deno.resolveDns(host, 'A').catch(() => [] as string[]);
  const v6 = await Deno.resolveDns(host, 'AAAA').catch(() => [] as string[]);
  if (v4.length + v6.length === 0) throw new Error('no dns');
  if (v4.some(isPrivateV4) || v6.some(isPrivateV6)) throw new Error('private ip');
}

/** 取得網頁（手動處理重新導向，每一次都重新檢查）；最多讀 MAX_BYTES */
async function fetchHtml(start: URL): Promise<{ html: string; finalUrl: URL }> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(url);
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AnonChatLinkPreview/1.0)', Accept: 'text/html' },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('redirect without location');
      url = new URL(loc, url);
      continue;
    }
    if (!res.ok) throw new Error(`status ${res.status}`);
    const type = res.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml/i.test(type)) throw new Error('not html');
    const reader = res.body?.getReader();
    if (!reader) throw new Error('no body');
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.length;
    }
    reader.cancel().catch(() => undefined);
    const all = new Uint8Array(Math.min(total, MAX_BYTES));
    let off = 0;
    for (const c of chunks) {
      const take = Math.min(c.length, all.length - off);
      all.set(c.subarray(0, take), off);
      off += take;
      if (off >= all.length) break;
    }
    return { html: new TextDecoder('utf-8').decode(all), finalUrl: url };
  }
  throw new Error('too many redirects');
}

// ---------- 解析分享資訊 ----------

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function metaContent(html: string, keys: string[]): string | null {
  for (const key of keys) {
    for (const m of html.matchAll(/<meta\s+([^>]*?)>/gi)) {
      const attrs = m[1]!;
      const name = attrs.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
      if (name !== key) continue;
      const content = attrs.match(/content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i);
      const value = content?.[1] ?? content?.[2];
      if (value && value.trim()) return decodeEntities(value.trim());
    }
  }
  return null;
}

function clip(s: string | null, max: number): string | null {
  if (!s) return null;
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function parse(html: string, finalUrl: URL) {
  const head = html.slice(0, 200_000);
  const titleTag = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const title = metaContent(head, ['og:title', 'twitter:title']) ?? (titleTag ? decodeEntities(titleTag) : null);
  const description = metaContent(head, ['og:description', 'twitter:description', 'description']);
  const siteName = metaContent(head, ['og:site_name']) ?? finalUrl.hostname.replace(/^www\./, '');
  let thumbnailUrl: string | null = null;
  const img = metaContent(head, ['og:image', 'og:image:url', 'twitter:image']);
  if (img) {
    try {
      const abs = new URL(img, finalUrl);
      if (abs.protocol === 'https:') thumbnailUrl = abs.toString();
    } catch {
      // 縮圖網址壞掉就不要縮圖
    }
  }
  return {
    siteName: clip(siteName, 80) ?? finalUrl.hostname,
    title: clip(title, 200),
    description: clip(description, 300),
    thumbnailUrl,
  };
}

// ---------- 進入點 ----------

Deno.serve(async (req) => {
  const origin = allowedOrigin(req);
  const cors = corsHeaders(origin);
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response(null, { status: origin ? 204 : 403, headers: cors });
  if (!origin) return new Response('forbidden', { status: 403, headers: cors });
  if (req.method !== 'POST') return reply({ error: 'PREVIEW_UNAVAILABLE' }, 405);

  let target: URL;
  try {
    const body = (await req.json()) as { url?: string };
    if (typeof body.url !== 'string' || body.url.length > 2000) throw new Error('bad url');
    target = new URL(body.url);
    if (target.protocol !== 'https:' && target.protocol !== 'http:') throw new Error('protocol');
  } catch {
    return reply({ error: 'PREVIEW_UNAVAILABLE' });
  }
  const key = target.toString();

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 只有取得匿名身分的使用者能呼叫（防止別人拿我們的函式當免費的網頁抓取器）
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const who = token ? await sb.auth.getUser(token) : null;
  if (!who || who.error || !who.data.user) return reply({ error: 'PREVIEW_UNAVAILABLE' }, 401);

  // 快取
  const cached = await sb.from('link_previews').select('data, created_at').eq('url', key).maybeSingle();
  if (cached.data && Date.now() - new Date(cached.data.created_at).getTime() < CACHE_HOURS * 3_600_000) {
    return reply(cached.data.data);
  }

  try {
    const { html, finalUrl } = await fetchHtml(target);
    const parsed = parse(html, finalUrl);
    if (!parsed.title && !parsed.description && !parsed.thumbnailUrl) return reply({ error: 'PREVIEW_UNAVAILABLE' });
    const data = { url: key, ...parsed };
    await sb.from('link_previews').upsert({ url: key, data, created_at: new Date().toISOString() });
    return reply(data);
  } catch {
    return reply({ error: 'PREVIEW_UNAVAILABLE' });
  }
});
