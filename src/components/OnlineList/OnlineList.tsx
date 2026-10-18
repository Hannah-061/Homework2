import { useEffect } from 'react';
import { useChatState } from '../../state/ChatContext';
import { useI18n } from '../../i18n';
import { Icon } from '../Icon';

function UserList() {
  const { online, userId } = useChatState();
  const { t } = useI18n();
  return (
    <ul className="userlist">
      {online.map((u) => (
        <li key={u.userId} className={u.userId === userId ? 'me' : undefined}>
          <span className="name">{u.nickname}</span>
          {u.userId === userId && <span className="you">{t('room.you')}</span>}
        </li>
      ))}
    </ul>
  );
}

/** 電腦版：常駐在側邊 */
export function OnlineSidebar() {
  const { online } = useChatState();
  const { t } = useI18n();
  return (
    <aside className="sidebar" aria-label={t('room.onlineList')}>
      <h2 className="sidebar__heading">
        <span className="dot" aria-hidden="true" />
        {t('room.onlineHeading', { n: online.length })}
      </h2>
      <UserList />
    </aside>
  );
}

/** 手機版：點頂部人數後，從下方彈出 */
export function OnlineSheet({ onClose }: { onClose: () => void }) {
  const { online } = useChatState();
  const { t } = useI18n();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <section className="sheet" role="dialog" aria-modal="true" aria-label={t('room.onlineList')}>
        <div className="sheet__grabber" />
        <div className="sheet__head">
          <h2 className="sheet__title">
            <span className="dot" aria-hidden="true" />
            {t('room.onlineHeading', { n: online.length })}
          </h2>
          <button type="button" className="ibtn" aria-label={t('room.closeList')} onClick={onClose} autoFocus>
            <Icon name="close" />
          </button>
        </div>
        <UserList />
      </section>
    </>
  );
}
