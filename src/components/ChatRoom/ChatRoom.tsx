import { useCallback, useEffect, useState } from 'react';
import { useChatActions, useChatState } from '../../state/ChatContext';
import { useI18n } from '../../i18n';
import { formatTime } from '../../lib/time';
import type { Message } from '../../services/ChatService';
import { Composer } from '../Composer/Composer';
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog';
import { Header } from '../Header/Header';
import { Icon } from '../Icon';
import { ImageViewer } from '../ImageViewer/ImageViewer';
import { MessageList } from '../MessageList/MessageList';
import { OnlineSheet, OnlineSidebar } from '../OnlineList/OnlineList';

type Confirm = { kind: 'leave' } | { kind: 'retract'; message: Message } | { kind: 'report'; message: Message };

/** 畫面 B：聊天室 */
export function ChatRoom() {
  const { t, lang } = useI18n();
  const actions = useChatActions();
  const { toast, hiddenUnread, hiddenMention } = useChatState();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [viewing, setViewing] = useState<Message | null>(null);

  // 在別的分頁時，標題顯示未讀數：(3) 匿名聊天室
  useEffect(() => {
    // 有人提到你時優先顯示 (@)，其次是一般的未讀數
    document.title = hiddenMention
      ? t('app.titleMention')
      : hiddenUnread > 0
        ? t('app.titleUnread', { n: hiddenUnread })
        : t('app.title');
  }, [hiddenUnread, hiddenMention, t]);
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) actions.clearHiddenUnread();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [actions]);

  // 視窗放大成電腦版時，手機的名單浮層自動收起
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)');
    const onChange = () => mq.matches && setSheetOpen(false);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const cancel = useCallback(() => setConfirm(null), []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  const confirmCopy = () => {
    if (!confirm) return null;
    switch (confirm.kind) {
      case 'leave':
        return { title: t('room.leaveTitle'), body: t('room.leaveBody'), ok: t('room.leaveOk') };
      case 'retract':
        return { title: t('msg.retractTitle'), body: t('msg.retractBody'), ok: t('msg.retractOk') };
      case 'report':
        return { title: t('msg.reportTitle'), body: t('msg.reportBody'), ok: t('msg.reportOk') };
    }
  };
  const copy = confirmCopy();

  const onConfirm = () => {
    if (!confirm) return;
    setConfirm(null);
    if (confirm.kind === 'leave') void actions.leave();
    else if (confirm.kind === 'retract') void actions.retract(confirm.message.id);
    else void actions.report(confirm.message.id);
  };

  return (
    <div className="screen chat">
      <Header onOpenOnline={() => setSheetOpen(true)} onLeave={() => setConfirm({ kind: 'leave' })} />
      <div className="chat__body">
        <OnlineSidebar />
        <main className="chat__main">
          <MessageList
            onQuote={(message) => actions.setQuote(message)}
            onRetract={(message) => setConfirm({ kind: 'retract', message })}
            onReport={(message) => setConfirm({ kind: 'report', message })}
            onOpenImage={setViewing}
          />
          <Composer />
        </main>
      </div>

      {sheetOpen && <OnlineSheet onClose={closeSheet} />}
      {confirm && copy && (
        <ConfirmDialog
          title={copy.title}
          body={copy.body}
          cancelLabel={t('room.cancel')}
          confirmLabel={copy.ok}
          onCancel={cancel}
          onConfirm={onConfirm}
        />
      )}
      {viewing?.image && (
        <ImageViewer
          url={viewing.image.url}
          alt={t('msg.imageAlt', { name: viewing.nickname })}
          caption={`${viewing.nickname} ${formatTime(viewing.createdAt, lang)}`}
          onClose={() => setViewing(null)}
        />
      )}
      {toast && (
        <div className={`toast${toast.tone === 'error' ? ' error' : ''}`} role="status">
          <Icon name={toast.tone === 'error' ? 'alert' : 'check'} />
          {toast.tone === 'error'
            ? t(`err.${toast.text}` as Parameters<typeof t>[0], { s: toast.retryAfterSeconds ?? 0 })
            : t(toast.text as Parameters<typeof t>[0])}
        </div>
      )}
    </div>
  );
}
