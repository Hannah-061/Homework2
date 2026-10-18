import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { emojiPickerZhTW } from '../../i18n/emojiPicker';

interface PickerElement extends HTMLElement {
  i18n?: unknown;
  locale?: string;
  dataSource?: string;
}

const DATA_ZH = 'https://cdn.jsdelivr.net/npm/emoji-picker-element-data@^1/zh-hant/cldr/data.json';

/** 表情符號選單：用 emoji-picker-element（網頁標準元件），第一次打開時才載入 */
export function EmojiPanel({ onPick }: { onPick: (emoji: string) => void }) {
  const { lang, t } = useI18n();
  const [ready, setReady] = useState(false);
  const ref = useRef<PickerElement>(null);

  useEffect(() => {
    let cancelled = false;
    void import('emoji-picker-element').then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!ready || !el) return;
    const handler = (e: Event) => {
      const unicode = (e as CustomEvent<{ unicode?: string }>).detail?.unicode;
      if (unicode) onPick(unicode);
    };
    el.addEventListener('emoji-click', handler);
    return () => el.removeEventListener('emoji-click', handler);
  }, [ready, onPick]);

  useEffect(() => {
    const el = ref.current;
    if (!ready || !el) return;
    if (lang === 'zh') {
      el.i18n = emojiPickerZhTW;
      el.locale = 'zh-hant';
      el.dataSource = DATA_ZH;
    }
  }, [ready, lang]);

  return (
    <div className="emoji-panel" role="region" aria-label={t('emoji.title')}>
      {ready && <emoji-picker key={lang} ref={ref as React.Ref<HTMLElement>} />}
    </div>
  );
}
