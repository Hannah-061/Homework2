import { useEffect } from 'react';
import { useChatState } from './state/ChatContext';
import { useI18n } from './i18n';
import { ChatRoom } from './components/ChatRoom/ChatRoom';
import { JoinScreen } from './components/JoinScreen/JoinScreen';

/** 決定現在顯示「輸入代號」還是「聊天室」 */
export function App() {
  const { phase } = useChatState();
  const { t, lang } = useI18n();

  // 不在聊天室時，分頁標題就是網站名稱（聊天室裡的標題由 ChatRoom 管理，會加上未讀數）
  useEffect(() => {
    if (phase !== 'room') document.title = t('app.title');
  }, [phase, t, lang]);

  if (phase === 'booting') return null;
  if (phase === 'room') return <ChatRoom />;
  return <JoinScreen />;
}
