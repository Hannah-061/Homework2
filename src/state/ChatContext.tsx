import { createContext, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { createChatService } from '../services';
import { ChatStore, type ChatState } from './chatStore';

const Ctx = createContext<ChatStore | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const ref = useRef<ChatStore | null>(null);
  if (ref.current === null) ref.current = new ChatStore(createChatService());
  const store = ref.current;

  useEffect(() => {
    store.init();
  }, [store]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

/** 動作（送訊息、收回、檢舉…）；不會因為狀態改變而重新建立 */
export function useChatActions(): ChatStore {
  const store = useContext(Ctx);
  if (!store) throw new Error('useChatActions 必須在 ChatProvider 裡使用');
  return store;
}

/** 目前的聊天狀態；狀態一變，用到的元件就會重畫 */
export function useChatState(): ChatState {
  const store = useChatActions();
  return useSyncExternalStore(store.subscribe, store.getState);
}
