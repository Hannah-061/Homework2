import { useCallback, useEffect, useRef, useState } from 'react';
import { useChatActions, useChatState } from '../../state/ChatContext';
import { useI18n } from '../../i18n';
import { countChars, truncateChars } from '../../lib/nickname';
import { LIMITS } from '../../services/ChatService';
import { Icon } from '../Icon';
import { EmojiPanel } from './EmojiPanel';

/** 電腦版（有滑鼠、寬螢幕）Enter 送出；手機 Enter 換行，用按鈕送出 */
function enterSends(): boolean {
  return window.matchMedia('(min-width: 900px) and (hover: hover) and (pointer: fine)').matches;
}

/** 輸入區：文字、表情、圖片（可選檔、貼上、拖進來）、送出，以及被鎖住、離線時的樣子 */
export function Composer() {
  const { t } = useI18n();
  const actions = useChatActions();
  const { connection, rateLockUntil, composerError } = useChatState();
  const [text, setText] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [lockSecs, setLockSecs] = useState(0);
  const field = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const offline = connection !== 'connected';
  const locked = lockSecs > 0;
  const disabled = offline || locked;
  const chars = countChars(text);
  const canSend = !disabled && text.trim().length > 0;

  // 頻率限制的倒數：每 250ms 更新一次，歸零自動解鎖
  useEffect(() => {
    const tick = () => setLockSecs(Math.max(0, Math.ceil((rateLockUntil - Date.now()) / 1000)));
    tick();
    if (rateLockUntil <= Date.now()) return;
    const id = window.setInterval(() => {
      tick();
      if (Date.now() >= rateLockUntil) window.clearInterval(id);
    }, 250);
    return () => window.clearInterval(id);
  }, [rateLockUntil]);

  // 輸入框隨內容長高（最多約 5 行）
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 6, 132)}px`;
  }, [text]);

  // 圖片錯誤提示 5 秒後自己消失
  useEffect(() => {
    if (!composerError) return;
    const id = window.setTimeout(() => actions.dismissComposerError(), 5000);
    return () => window.clearTimeout(id);
  }, [composerError, actions]);

  const send = useCallback(async () => {
    const value = text;
    if (!canSend) return;
    setText('');
    setEmojiOpen(false);
    const res = await actions.sendText(value);
    // 送太快被擋下：把字還給輸入框，等解鎖後可以直接再送
    if (res.code === 'RATE_LIMITED') setText((cur) => (cur ? cur : value));
  }, [text, canSend, actions]);

  const sendImage = useCallback(
    (file: File | undefined) => {
      if (!file || disabled) return;
      void actions.sendImage(file);
    },
    [actions, disabled],
  );

  const insertEmoji = useCallback((emoji: string) => {
    const el = field.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    setText((cur) => truncateChars(cur.slice(0, start) + emoji + cur.slice(end), LIMITS.textMax));
    const caret = start + emoji.length;
    requestAnimationFrame(() => {
      if (el && enterSends()) el.focus();
      el?.setSelectionRange(caret, caret);
    });
  }, [text.length]);

  const imageFrom = (list: FileList | null | undefined): File | undefined =>
    Array.from(list ?? []).find((f) => f.type.startsWith('image/'));

  return (
    <>
      <div
        className={`composer${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          sendImage(imageFrom(e.dataTransfer.files));
        }}
      >
        {composerError && (
          <div className="err compact composer__error" role="alert" onClick={() => actions.dismissComposerError()}>
            <Icon name="alert" />
            <span>{t(`err.${composerError.code}`, { s: composerError.retryAfterSeconds ?? 0 })}</span>
          </div>
        )}
        <div className="composer__line">
          <button
            type="button"
            className={`ibtn ${emojiOpen ? 'mint' : 'sun'}`}
            aria-label={t('composer.emoji')}
            aria-expanded={emojiOpen}
            disabled={disabled}
            onClick={() => setEmojiOpen((o) => !o)}
          >
            <Icon name="smile" />
          </button>
          <button
            type="button"
            className="ibtn sun"
            aria-label={t('composer.image')}
            disabled={disabled}
            onClick={() => fileInput.current?.click()}
          >
            <Icon name="image" />
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={LIMITS.imageTypes.join(',')}
            hidden
            onChange={(e) => {
              sendImage(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <textarea
            ref={field}
            className="composer__field"
            rows={1}
            value={text}
            disabled={disabled}
            aria-label={t('composer.aria')}
            placeholder={
              locked ? t('composer.rateHint', { s: lockSecs }) : offline ? t('composer.offlinePlaceholder') : t('composer.placeholder')
            }
            onChange={(e) => setText(truncateChars(e.target.value, LIMITS.textMax))}
            onKeyDown={(e) => {
              // isComposing：中文輸入法選字時按的 Enter 不算送出
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && enterSends()) {
                e.preventDefault();
                void send();
              }
            }}
            onPaste={(e) => {
              const img = imageFrom(e.clipboardData.files);
              if (img) {
                e.preventDefault();
                sendImage(img);
              }
            }}
          />
          <button type="button" className="ibtn orange composer__send" aria-label={t('composer.send')} disabled={!canSend} onClick={() => void send()}>
            <Icon name="send" />
            <span className="composer__send-label">{t('composer.send')}</span>
          </button>
        </div>
        {(locked || chars > LIMITS.textWarnAt) && (
          <div className="composer__hint">
            <span>{locked ? t('composer.rateHint', { s: lockSecs }) : t('composer.remaining', { n: LIMITS.textMax - chars })}</span>
            {chars > LIMITS.textWarnAt && <span>{chars} / {LIMITS.textMax}</span>}
          </div>
        )}
        <div className="composer__keys">{t('composer.keyHint')}</div>
      </div>
      {emojiOpen && !disabled && <EmojiPanel onPick={insertEmoji} />}
    </>
  );
}
