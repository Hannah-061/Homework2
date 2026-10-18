import { useChatState } from '../../state/ChatContext';
import { useI18n } from '../../i18n';
import { Icon, Logo } from '../Icon';
import { LanguageSwitch } from '../LanguageSwitch/LanguageSwitch';

interface Props {
  onOpenOnline: () => void;
  onLeave: () => void;
}

/** 頂部列 + 連線狀態橫幅 */
export function Header({ onOpenOnline, onLeave }: Props) {
  const { t } = useI18n();
  const { online, connection } = useChatState();

  return (
    <>
      <header className="topbar">
        <Logo className="topbar__logo" />
        <h1 className="topbar__title">{t('room.title')}</h1>
        <button type="button" className="pill" aria-label={t('room.onlineAria', { n: online.length })} onClick={onOpenOnline}>
          <span className="dot" aria-hidden="true" />
          {t('room.online', { n: online.length })}
        </button>
        <LanguageSwitch />
        <button type="button" className="ibtn orange leave-btn" aria-label={t('room.leaveAria')} onClick={onLeave}>
          <Icon name="exit" />
          <span className="topbar__leave-label">{t('room.leave')}</span>
        </button>
      </header>
      {connection !== 'connected' && (
        <div className="banner" role="status">
          <Icon name="wifiOff" />
          {connection === 'reconnecting' ? t('room.reconnecting') : t('room.offline')}
        </div>
      )}
    </>
  );
}
