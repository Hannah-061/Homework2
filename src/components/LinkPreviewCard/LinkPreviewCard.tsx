import { useEffect } from 'react';
import { useChatActions, useChatState } from '../../state/ChatContext';
import { useI18n } from '../../i18n';

/** 縮圖只收 https（以及不會連到外面的 data: 圖片）；其他一律不顯示 */
function safeThumb(url: string | null): string | null {
  if (!url) return null;
  return url.startsWith('https://') || url.startsWith('data:image/') ? url : null;
}

/** 訊息下方的連結預覽卡；取得失敗時什麼都不顯示 */
export function LinkPreviewCard({ url }: { url: string }) {
  const { t } = useI18n();
  const actions = useChatActions();
  const entry = useChatState().previews[url];

  useEffect(() => {
    void actions.loadPreview(url);
  }, [actions, url]);

  if (!entry || entry.status !== 'done') return null;
  const { preview } = entry;
  const thumb = safeThumb(preview.thumbnailUrl);

  return (
    <a className="preview" href={url} target="_blank" rel="noopener noreferrer nofollow" aria-label={t('msg.linkPreview')}>
      {thumb && <img className="preview__thumb" src={thumb} alt="" referrerPolicy="no-referrer" loading="lazy" />}
      <span className="preview__info" style={{ display: 'block' }}>
        <span className="preview__site" style={{ display: 'block' }}>{preview.siteName}</span>
        {preview.title && <span className="preview__title" style={{ display: 'block' }}>{preview.title}</span>}
        {preview.description && <span className="preview__desc">{preview.description}</span>}
      </span>
    </a>
  );
}
