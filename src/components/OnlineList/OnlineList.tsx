import { useEffect } from 'react';
import { useChatActions, useChatState } from '../../state/ChatContext';
import { useI18n } from '../../i18n';
import { Icon } from '../Icon';

/** 點名單裡的別人 = 把 @代號 放進輸入框；自己那一列不能點 */
function UserList({ onPicked }: { onPicked?: () => void }) {
  const { online, userId } = useChatState();
  const actions = useChatActions();
  const { t } = useI18n();
  return (
    <ul className="userlist">
      {online.map((u) =>
        u.userId === userId ? (
          <li key={u.userId} className="me">
            <span className="name">{u.nickname}</span>
            <span className="you">{t('room.you')}</span>
          </li>
        ) : (
          <li key={u.userId}>
            <button
              type="button"
              className="userbtn"
              aria-label={t('mention.fromList', { name: u.nickname })}
              onClick={() => {
                actions.requestMention(u);
                onPicked?.();
              }}
            >
              <span className="name">{u.nickname}</span>
            </button>
          </li>
        ),
      )}
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
        <UserList onPicked={onClose} />
      </section>
    </>
  );
}
