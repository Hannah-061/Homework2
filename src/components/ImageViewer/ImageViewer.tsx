import { useEffect } from 'react';
import { useI18n } from '../../i18n';
import { Icon } from '../Icon';

interface Props {
  url: string;
  alt: string;
  caption: string;
  onClose: () => void;
}

/** 圖片放大檢視：點背景、點 ×、按 Esc 都可以關閉 */
export function ImageViewer({ url, alt, caption, onClose }: Props) {
  const { t } = useI18n();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={t('viewer.aria')} onClick={onClose}>
      <div className="viewer__top">
        <button
          type="button"
          className="ibtn sun"
          aria-label={t('viewer.close')}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          autoFocus
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="viewer__stage">
        <img className="viewer__img" src={url} alt={alt} onClick={(e) => e.stopPropagation()} />
        <div className="viewer__caption">{caption}</div>
      </div>
      <p className="viewer__hint">{t('viewer.hint')}</p>
    </div>
  );
}
