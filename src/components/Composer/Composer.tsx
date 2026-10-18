import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChatActions, useChatState } from '../../state/ChatContext';
import { useI18n } from '../../i18n';
import { findMentionQuery, insertMention, validMentions } from '../../lib/mentions';
import { countChars, truncateChars } from '../../lib/nickname';
import { LIMITS, type Mention, type OnlineUser } from '../../services/ChatService';
import { Icon } from '../Icon';
import { EmojiPanel } from './EmojiPanel';

/** 電腦版（有滑鼠、寬螢幕）Enter 送出；手機 Enter 換行，用按鈕送出 */
function enterSends(): boolean {
  return window.matchMedia('(min-width: 900px) and (hover: hover) and (pointer: fine)').matches;
}

/** 輸入區：文字、提及（@）、引用、表情、圖片（可選檔、貼上、拖進來）、送出，以及被鎖住、離線時的樣子 */
export function Composer() {
  const { t } = useI18n();
  const actions = useChatActions();
  const { connection, rateLockUntil, composerError, online, userId, quoting, mentionRequest } = useChatState();
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [picked, setPicked] = useState<Mention[]>([]);
  const [menuIdx, setMenuIdx] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [lockSecs, setLockSecs] = useState(0);
  const field = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastRequest = useRef(0);

  const offline = connection !== 'connected';
  const locked = lockSecs > 0;
  const disabled = offline || locked;
  const chars = countChars(text);
  const canSend = !disabled && text.trim().length > 0;

  // ---- 提及選單 ----
  const activeMentions = useMemo(() => validMentions(text, picked), [text, picked]);
  const atLimit = activeMentions.length >= LIMITS.mentionMax;
  const mq = findMentionQuery(text, caret);
  const menuOpen = !disabled && mq !== null && dismissedAt !== mq.start;
  const candidates = useMemo<OnlineUser[]>(() => {
    if (!mq) return [];
    const q = mq.query.toLowerCase();
    return online
      .filter((u) => u.userId !== userId && (q === '' || u.nickname.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [mq, online, userId]);

  useEffect(() => setMenuIdx(0), [mq?.query]);

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

  // 開始引用：游標回到輸入框，可以直接打字
  useEffect(() => {
    if (quoting) field.current?.focus();
  }, [quoting?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 把 @代號 放進輸入框（從選單選、或點在線名單） */
  const addMention = useCallback(
    (user: OnlineUser, replaceFrom?: { start: number; caret: number }) => {
      const el = field.current;
      const sel = el?.selectionStart ?? text.length;
      let next: { text: string; caret: number };
      if (replaceFrom) {
        next = insertMention(text, replaceFrom.start, replaceFrom.caret, user.nickname);
      } else {
        // 點在線名單：插在游標位置，前面不是空白就先補一個空白
        const before = text.slice(0, sel);
        const lead = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
        const inserted = `${lead}@${user.nickname} `;
        next = { text: before + inserted + text.slice(sel), caret: before.length + inserted.length };
      }
      setText(truncateChars(next.text, LIMITS.textMax));
      setPicked((cur) => (cur.some((m) => m.userId === user.userId) ? cur : [...cur, { userId: user.userId, nickname: user.nickname }]));
      setCaret(next.caret);
      setDismissedAt(null);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(next.caret, next.caret);
      });
    },
    [text],
  );

  // 點了在線名單的人
  useEffect(() => {
    if (!mentionRequest || mentionRequest.n === lastRequest.current) return;
    lastRequest.current = mentionRequest.n;
    if (disabled) return;
    if (activeMentions.length >= LIMITS.mentionMax) actions.showComposerError('TOO_MANY_MENTIONS');
    else addMention(mentionRequest.user);
  }, [mentionRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback(async () => {
    const value = text;
    if (!canSend) return;
    const mentions = validMentions(value, picked);
    setText('');
    setPicked([]);
    setCaret(0);
    setEmojiOpen(false);
    const res = await actions.sendText(value, mentions);
    // 送太快被擋下：把字還給輸入框，等解鎖後可以直接再送
    if (res.code === 'RATE_LIMITED') {
      setText((cur) => (cur ? cur : value));
      setPicked((cur) => (cur.length ? cur : mentions));
    }
  }, [text, picked, canSend, actions]);

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
    const pos = start + emoji.length;
    requestAnimationFrame(() => {
      if (el && enterSends()) el.focus();
      el?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  }, [text.length]);

  const imageFrom = (list: FileList | null | undefined): File | undefined =>
    Array.from(list ?? []).find((f) => f.type.startsWith('image/'));

  const quoteLabel =
    quoting?.kind === 'image' ? t('quote.image') : (quoting?.text ?? '').slice(0, LIMITS.replyPreviewMax);

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
        {menuOpen && (
          <div className="mention-menu" role="listbox" id="mention-listbox" aria-label={t('mention.menu')}>
            {atLimit ? (
              <p className="mention-menu__note" role="status">{t('mention.limit', { n: LIMITS.mentionMax })}</p>
            ) : candidates.length === 0 ? (
              <p className="mention-menu__note">{t('mention.empty')}</p>
            ) : (
              candidates.map((u, i) => (
                <button
                  key={u.userId}
                  type="button"
                  role="option"
                  id={`mention-opt-${i}`}
                  aria-selected={i === menuIdx}
                  className={`mention-menu__item${i === menuIdx ? ' on' : ''}`}
                  // 不要讓輸入框失去焦點
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => mq && addMention(u, { start: mq.start, caret })}
                >
                  <span className="mention-menu__at" aria-hidden="true">@</span>
                  {u.nickname}
                </button>
              ))
            )}
          </div>
        )}
        {composerError && (
          <div className="err compact composer__error" role="alert" onClick={() => actions.dismissComposerError()}>
            <Icon name="alert" />
            <span>{t(`err.${composerError.code}`, { s: composerError.retryAfterSeconds ?? 0 })}</span>
          </div>
        )}
        {quoting && (
          <div className="quotebar">
            <Icon name="quote" className="quotebar__icon" />
            <span className="quotebar__body">
              <span className="quotebar__name">{t('quote.bar', { name: quoting.nickname })}</span>
              <span className="quotebar__text">{quoteLabel}</span>
            </span>
            <button type="button" className="ibtn" aria-label={t('quote.cancel')} onClick={() => actions.clearQuote()}>
              <Icon name="close" />
            </button>
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
            aria-controls={menuOpen ? 'mention-listbox' : undefined}
            aria-activedescendant={menuOpen && candidates.length > 0 && !atLimit ? `mention-opt-${menuIdx}` : undefined}
            placeholder={
              locked ? t('composer.rateHint', { s: lockSecs }) : offline ? t('composer.offlinePlaceholder') : t('composer.placeholder')
            }
            onChange={(e) => {
              setText(truncateChars(e.target.value, LIMITS.textMax));
              setCaret(e.target.selectionStart);
              setDismissedAt(null);
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              // 提及選單開著：上下選、Enter 或 Tab 確定、Esc 關閉
              if (menuOpen && !atLimit && candidates.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setMenuIdx((i) => (i + 1) % candidates.length);
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setMenuIdx((i) => (i - 1 + candidates.length) % candidates.length);
                  return;
                }
                if ((e.key === 'Enter' || e.key === 'Tab') && mq) {
                  e.preventDefault();
                  addMention(candidates[menuIdx]!, { start: mq.start, caret });
                  return;
                }
              }
              if (menuOpen && e.key === 'Escape' && mq) {
                e.preventDefault();
                setDismissedAt(mq.start);
                return;
              }
              // isComposing：中文輸入法選字時按的 Enter 不算送出
              if (e.key === 'Enter' && !e.shiftKey && enterSends()) {
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
