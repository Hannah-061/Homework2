import { useEffect, useId, useRef } from 'react';

interface Props {
  title: string;
  body: string;
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/** 離開、收回、檢舉共用的確認對話框 */
export function ConfirmDialog({ title, body, cancelLabel, confirmLabel, onCancel, onConfirm }: Props) {
  const titleId = useId();
  const bodyId = useId();
  const root = useRef<HTMLDivElement>(null);
  const cancelBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancelBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      } else if (e.key === 'Tab' && root.current) {
        // 焦點留在對話框裡
        const items = root.current.querySelectorAll<HTMLElement>('button');
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
    };
  }, [onCancel]);

  return (
    <>
      <div className="scrim" onClick={onCancel} />
      <div ref={root} className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId}>
        <h2 id={titleId} className="dialog__title">{title}</h2>
        <p id={bodyId} className="dialog__body">{body}</p>
        <div className="dialog__actions">
          <button ref={cancelBtn} type="button" className="btn white" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className="btn orange" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </>
  );
}
