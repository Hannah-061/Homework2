import { useRef, type ReactNode } from 'react';
import { useChatActions, useChatState } from '../../state/ChatContext';
import { useI18n } from '../../i18n';
import { linkify, firstUrl } from '../../lib/linkify';
import { formatTime } from '../../lib/time';
import type { Message } from '../../services/ChatService';
import type { Pending } from '../../state/chatStore';
import { DotsIcon, Icon } from '../Icon';
import { LinkPreviewCard } from '../LinkPreviewCard/LinkPreviewCard';

/** 長按多久算「長按」 */
const LONG_PRESS_MS = 500;

interface Props {
  message: Message;
  mine: boolean;
  menuOpen: boolean;
  onMenu: (open: boolean) => void;
  onRetract: () => void;
  onReport: () => void;
  onOpenImage: (message: Message) => void;
}

/** 文字轉成一段一段的元素（絕不拼 HTML 字串），只有 http/https 會變成連結 */
function RichText({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((seg, i) =>
        seg.type === 'link' ? (
          <a key={i} href={seg.href} target="_blank" rel="noopener noreferrer nofollow">{seg.value}</a>
        ) : (
          <span key={i}>{seg.value}</span>
        ),
      )}
    </>
  );
}

export function MessageItem({ message, mine, menuOpen, onMenu, onRetract, onReport, onOpenImage }: Props) {
  const { t, lang } = useI18n();
  const actions = useChatActions();
  const { revealed, translations } = useChatState();
  const pressTimer = useRef<number | undefined>(undefined);
  const pressStart = useRef<{ x: number; y: number } | null>(null);

  const { status } = message;
  const masked = status === 'hidden' && !revealed.has(message.id);
  const retracted = status === 'retracted';
  const canMenu = !retracted && !masked;
  const tr = translations[message.id];
  const url = status === 'normal' && message.text ? firstUrl(message.text) : null;

  // ---- 長按自己的訊息 = 打開選單（點「⋯」也可以） ----
  const cancelPress = () => {
    window.clearTimeout(pressTimer.current);
    pressStart.current = null;
  };
  const bubbleProps = mine && canMenu
    ? {
        onPointerDown: (e: React.PointerEvent) => {
          pressStart.current = { x: e.clientX, y: e.clientY };
          pressTimer.current = window.setTimeout(() => {
            onMenu(true);
            pressStart.current = null;
          }, LONG_PRESS_MS);
        },
        onPointerMove: (e: React.PointerEvent) => {
          const s = pressStart.current;
          if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) cancelPress();
        },
        onPointerUp: cancelPress,
        onPointerLeave: cancelPress,
        onPointerCancel: cancelPress,
        onContextMenu: (e: React.MouseEvent) => {
          e.preventDefault();
          onMenu(true);
        },
      }
    : {};

  let body: ReactNode;
  if (retracted) {
    body = <div className="bubble gone">{t('msg.retracted')}</div>;
  } else if (masked) {
    body = (
      <>
        <div className="bubble masked">{t('msg.hidden')}</div>
        <button type="button" className="tbtn" onClick={() => actions.reveal(message.id)}>
          <Icon name="eye" />
          {t('msg.show')}
        </button>
      </>
    );
  } else if (message.kind === 'image' && message.image) {
    const img = message.image;
    body = (
      <button
        type="button"
        className="imgmsg"
        aria-label={t('msg.zoomImage')}
        onClick={() => onOpenImage(message)}
        style={{ aspectRatio: `${img.width} / ${img.height}`, width: 220 }}
        {...bubbleProps}
      >
        <img src={img.url} alt={t('msg.imageAlt', { name: message.nickname })} width={img.width} height={img.height} loading="lazy" draggable={false} />
      </button>
    );
  } else {
    body = (
      <>
        <div className="bubble" {...bubbleProps}>
          <RichText text={message.text ?? ''} />
        </div>
        {url && <LinkPreviewCard url={url} />}
        {status === 'normal' && message.text && (
          <>
            {tr?.status === 'done' && tr.visible && tr.text && (
              <div className="translation">
                <span className="label">{tr.lang === 'en' ? t('tr.labelEn') : t('tr.labelZh')}</span>
                {tr.text}
              </div>
            )}
            {tr?.status === 'error' && tr.error && (
              <div className="err compact" role="alert"><span>{t(`err.${tr.error}`)}</span></div>
            )}
            {tr?.status === 'done' && tr.visible ? (
              <button type="button" className="tbtn" onClick={() => actions.hideTranslation(message.id)}>
                {t('tr.hide')}
              </button>
            ) : tr?.status === 'loading' ? (
              <button type="button" className="tbtn" disabled>{t('tr.loading')}</button>
            ) : (
              <button type="button" className="tbtn" onClick={() => void actions.translate(message, lang)}>
                <Icon name="translate" />
                {tr?.status === 'error' ? t('tr.retry') : t('tr.button')}
              </button>
            )}
          </>
        )}
      </>
    );
  }

  return (
    <div className={`row${mine ? ' own' : ''}`} data-message-id={message.id}>
      <div className="meta">
        {!mine && <span className="nick">{message.nickname}</span>}
        <span>{formatTime(message.createdAt, lang)}</span>
        {canMenu && (
          <button
            type="button"
            className="mbtn"
            aria-label={t('msg.more')}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => onMenu(!menuOpen)}
          >
            <DotsIcon />
          </button>
        )}
      </div>
      {body}
      {menuOpen && canMenu && (
        <div className="menu" role="menu">
          {mine ? (
            <button type="button" role="menuitem" className="danger" onClick={onRetract} autoFocus>
              <Icon name="undo" />
              {t('msg.retract')}
            </button>
          ) : (
            <button type="button" role="menuitem" className="danger" onClick={onReport} autoFocus>
              <Icon name="flag" />
              {t('msg.report')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** 自己剛送出、後台還沒確認（或送失敗）的訊息 */
export function PendingItem({ item }: { item: Pending }) {
  const { t, lang } = useI18n();
  const actions = useChatActions();
  const failed = item.state === 'failed';

  return (
    <div className="row own">
      <div className="meta">
        <span>{formatTime(item.createdAt, lang)}</span>
        <span className={`status-label${failed ? ' fail' : ''}`}>
          {failed ? t('msg.sendFailed') : item.kind === 'image' ? t('composer.uploading') : t('msg.sending')}
        </span>
      </div>
      {item.kind === 'image' && item.previewUrl ? (
        <div className={`imgmsg${failed ? '' : ' sending'}`}>
          <img src={item.previewUrl} alt="" draggable={false} />
        </div>
      ) : (
        <div className={`bubble ${failed ? 'failed' : 'sending'}`}>{item.text}</div>
      )}
      {failed &&
        (item.kind === 'text' ? (
          <button type="button" className="tbtn danger" onClick={() => void actions.resend(item.id)}>
            <Icon name="refresh" />
            {t('msg.resend')}
          </button>
        ) : (
          <button type="button" className="tbtn danger" onClick={() => actions.discardPending(item.id)}>
            {t('room.cancel')}
          </button>
        ))}
    </div>
  );
}
