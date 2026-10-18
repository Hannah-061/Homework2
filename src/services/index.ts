import type { ChatService } from './ChatService';
import { MockChatService } from './mock/MockChatService';

/**
 * 依設定挑選要用哪個後台（docs/architecture.md 第 4 節）。
 *   VITE_BACKEND=mock      階段一：假後台（預設）
 *   VITE_BACKEND=supabase  階段二：真後台（還沒實作）
 *
 * 畫面元件只透過這裡拿到 ChatService，不直接碰任何後台套件。
 */
export function createChatService(): ChatService {
  const backend = import.meta.env.VITE_BACKEND ?? 'mock';
  if (backend === 'mock') return new MockChatService();
  if (backend === 'supabase') {
    // 階段二：改成 `return new SupabaseChatService()`，其他程式都不用動。
    throw new Error('VITE_BACKEND=supabase 還沒實作：這是階段二的工作。請先改回 mock。');
  }
  throw new Error(`不認得的 VITE_BACKEND：${String(backend)}`);
}
