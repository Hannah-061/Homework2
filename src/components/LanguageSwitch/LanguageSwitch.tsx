import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import type { Lang } from '../../services/ChatService';
import { Icon } from '../Icon';

/** 小地球：點開選「中文／English」，選擇會記在使用者自己的瀏覽器 */
export function LanguageSwitch() {
  const { lang, setLang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (next: Lang) => {
    setLang(next);
    setOpen(false);
  };

  return (
    <div ref={root} style={{ position: 'relative' }}>
      <button
        type="button"
        className="ibtn"
        aria-label={t('lang.label')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="globe" />
      </button>
      {open && (
        <div className="menu lang" role="menu">
          <button type="button" role="menuitemradio" aria-checked={lang === 'zh'} onClick={() => pick('zh')}>
            {t('lang.zh')}
          </button>
          <button type="button" role="menuitemradio" aria-checked={lang === 'en'} onClick={() => pick('en')}>
            {t('lang.en')}
          </button>
        </div>
      )}
    </div>
  );
}
