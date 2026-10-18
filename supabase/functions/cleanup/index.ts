// Edge Function：cleanup
// 由排程每分鐘呼叫一次：
//   1) 只保留最新 50 則訊息（prune_messages）
//   2) 把被刪訊息的圖片、被收回的圖片、送出失敗留下的圖片，從 Storage 真的刪掉
// 驗證：請求要帶 x-cron-secret，值要等於 Edge Function Secrets 裡的 CRON_SECRET。
// 部署時要關掉 Verify JWT（排程不是用使用者登入來呼叫），改由 CRON_SECRET 把關。
//
// 這份程式是貼到 Supabase 後台的編輯器裡的（後台編輯器不支援多個檔案），所以所有東西都寫在這一個檔案裡。

import { createClient } from 'npm:@supabase/supabase-js@2';

const BUCKET = 'chat-images';

/** 新版 Supabase 給 Edge Function 的 secret key；沒有就退回舊名字 */
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

/** 比對密碼時不要讓比對時間洩漏答案 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  const expected = Deno.env.get('CRON_SECRET') ?? '';
  const given = req.headers.get('x-cron-secret') ?? '';
  if (!expected || !safeEqual(given, expected)) {
    return new Response('unauthorized', { status: 401 });
  }

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const pruned = await sb.rpc('prune_messages');
  if (pruned.error) return json({ error: pruned.error.message }, 500);
  const orphans = await sb.rpc('orphan_images');
  if (orphans.error) return json({ error: orphans.error.message }, 500);

  const paths = [...new Set([...(pruned.data as string[]), ...(orphans.data as string[])])];
  let removed = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    const res = await sb.storage.from(BUCKET).remove(chunk);
    if (res.error) return json({ error: res.error.message, removed }, 500);
    removed += res.data?.length ?? 0;
  }
  return json({ ok: true, imagesOfPrunedMessages: (pruned.data as string[]).length, removedFiles: removed });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
