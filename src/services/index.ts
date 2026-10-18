import type { ChatService } from './ChatService';
import { MockChatService } from './mock/MockChatService';
import { SupabaseChatService } from './supabase/SupabaseChatService';

/**
 * 依設定挑選要用哪個後台（docs/architecture.md 第 4 節）。
 *   VITE_BACKEND=mock      階段一：假後台（預設）
 *   VITE_BACKEND=supabase  階段二：真後台（SupabaseChatService）
 *
 * 畫面元件只透過這裡拿到 ChatService，不直接碰任何後台套件。
 */
export function createChatService(): ChatService {
  // 這裡直接比對 import.meta.env.VITE_BACKEND，打包時沒用到的那一邊會被整個拿掉
  // （例如用假後台打包時，不會把 Supabase 套件包進網頁）。
  if (import.meta.env.VITE_BACKEND === 'supabase') {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) {
      throw new Error('VITE_BACKEND=supabase 需要 VITE_SUPABASE_URL 與 VITE_SUPABASE_PUBLISHABLE_KEY（見 .env.example）。');
    }
    return new SupabaseChatService(url, key);
  }
  return new MockChatService();
}
