import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useChatActions, useChatState } from '../../state/ChatContext';
import { useI18n } from '../../i18n';
import { dayKey, formatDate } from '../../lib/time';
import type { Message } from '../../services/ChatService';
import { Icon } from '../Icon';
import { MessageItem, PendingItem } from '../MessageItem/MessageItem';

interface Props {
  onRetract: (message: Message) => void;
  onReport: (message: Message) => void;
  onOpenImage: (message: Message) => void;
}

/** 離底部多近算「在最底部」 */
const BOTTOM_SLACK_PX = 80;

type Entry =
  | { type: 'message'; at: string; id: string; message: Message }
  | { type: 'notice'; at: string; id: string; kind: 'joined' | 'left'; nickname: string };

/** 訊息區：日期分隔線、系統提示、自動捲動、「新訊息」箭頭按鈕 */
export function MessageList({ onRetract, onReport, onOpenImage }: Props) {
  const { t, lang } = useI18n();
  const actions = useChatActions();
  const { messages, notices, pending, userId, unseen } = useChatState();
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastCount = useRef(0);

  const entries = useMemo<Entry[]>(() => {
    const list: Entry[] = [
      ...messages.map((m): Entry => ({ type: 'message', at: m.createdAt, id: m.id, message: m })),
      ...notices.map((n): Entry => ({ type: 'notice', at: n.at, id: n.id, kind: n.type, nickname: n.nickname })),
    ];
    return list.sort((a, b) => a.at.localeCompare(b.at));
  }, [messages, notices]);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_SLACK_PX;
    stick.current = atBottom;
    actions.setAtBottom(atBottom);
  };

  // 有新東西進來：在最底部（或是自己剛送的）就捲到底；否則不拉走畫面
  const total = entries.length + pending.length;
  useLayoutEffect(() => {
    const grew = total > lastCount.current;
    lastCount.current = total;
    if (!grew) return;
    const lastEntry = entries[entries.length - 1];
    const lastIsOwn =
      pending.length > 0 || (lastEntry?.type === 'message' && lastEntry.message.senderId === userId);
    if (stick.current || lastIsOwn) {
      scrollToBottom();
      stick.current = true;
    }
  }, [total, entries, pending.length, userId, scrollToBottom]);

  // 圖片載入、翻譯展開讓內容變高時，如果本來就在底部，維持在底部
  useEffect(() => {
    const node = inner.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (stick.current) scrollToBottom();
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [scrollToBottom]);

  // 點別處或按 Esc 關掉訊息選單
  useEffect(() => {
    if (!menuFor) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.menu') && !target.closest('.mbtn') && !target.closest('.bubble') && !target.closest('.imgmsg')) {
        setMenuFor(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuFor(null);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuFor]);

  const dayLine = (iso: string, prevIso: string | null) =>
    prevIso === null || dayKey(iso) !== dayKey(prevIso) ? (
      <div className="datesep" role="separator">{formatDate(iso, lang)}</div>
    ) : null;

  const empty = entries.length === 0 && pending.length === 0;

  return (
    <div className="messages-wrap" style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div ref={scroller} className="messages" onScroll={onScroll} role="log" aria-live="polite" aria-relevant="additions">
        {empty && <p className="messages__empty">{t('room.empty')}</p>}
        <div ref={inner} className="messages__inner">
          {entries.map((entry, i) => {
            const prev = i > 0 ? entries[i - 1]!.at : null;
            return (
              <Fragment key={entry.id}>
                {dayLine(entry.at, prev)}
                {entry.type === 'notice' ? (
                  <div className="sys" role="status">
                    {t(entry.kind === 'joined' ? 'room.noticeJoined' : 'room.noticeLeft', { name: entry.nickname })}
                  </div>
                ) : (
                  <MessageItem
                    message={entry.message}
                    mine={entry.message.senderId === userId}
                    menuOpen={menuFor === entry.message.id}
                    onMenu={(open) => setMenuFor(open ? entry.message.id : null)}
                    onRetract={() => {
                      setMenuFor(null);
                      onRetract(entry.message);
                    }}
                    onReport={() => {
                      setMenuFor(null);
                      onReport(entry.message);
                    }}
                    onOpenImage={onOpenImage}
                  />
                )}
              </Fragment>
            );
          })}
          {pending.map((p) => (
            <PendingItem key={p.id} item={p} />
          ))}
        </div>
      </div>
      {unseen > 0 && (
        <button
          type="button"
          className="newpill"
          aria-label={t('room.newMessages', { n: unseen })}
          onClick={() => {
            scrollToBottom(true);
            stick.current = true;
          }}
        >
          <Icon name="down" />
        </button>
      )}
    </div>
  );
}
