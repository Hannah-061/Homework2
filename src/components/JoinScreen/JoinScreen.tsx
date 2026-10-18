import { useEffect, useState } from 'react';
import { useChatActions, useChatState } from '../../state/ChatContext';
import { useI18n } from '../../i18n';
import { checkNickname, countChars, truncateChars } from '../../lib/nickname';
import { LIMITS } from '../../services/ChatService';
import { Icon, Logo } from '../Icon';
import { LanguageSwitch } from '../LanguageSwitch/LanguageSwitch';

/** 畫面 A：輸入代號（含「進入中」「代號重複」「聊天室已滿」各種狀態） */
export function JoinScreen() {
  const { t } = useI18n();
  const actions = useChatActions();
  const { phase, nickname: remembered, joinError } = useChatState();
  const entering = phase === 'entering';
  const [value, setValue] = useState(remembered);

  // 自動進入失敗退回這個畫面時，把上次的代號帶進輸入框
  useEffect(() => {
    if (remembered) setValue(remembered);
  }, [remembered]);

  const count = countChars(value.trim());
  const valid = checkNickname(value).ok;
  const full = joinError === 'ROOM_FULL';
  const networkError = joinError === 'NETWORK';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (valid && !entering) void actions.join(value);
  };

  return (
    <div className="screen join">
      <div className="join__top">
        <LanguageSwitch />
      </div>
      <div className="join__main">
        <div className="join__hero">
          <Logo className="join__logo" />
          <h1 className="join__title">{t('app.title')}</h1>
          <p className="join__subtitle">{t('join.subtitle')}</p>
        </div>

        <form className="join__card" onSubmit={submit} noValidate>
          <span className="join__tag pixel" aria-hidden="true">PLAYER 1</span>
          <label className="join__label" htmlFor="nickname">{t('join.nicknameLabel')}</label>
          <input
            id="nickname"
            className="join__input"
            type="text"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="go"
            placeholder={t('join.nicknamePlaceholder')}
            value={value}
            readOnly={entering}
            aria-invalid={joinError === 'NICKNAME_TAKEN' || joinError === 'NICKNAME_INVALID'}
            aria-describedby={joinError ? 'join-error' : undefined}
            onChange={(e) => setValue(truncateChars(e.target.value, LIMITS.nicknameMax))}
          />
          {joinError && (
            <div id="join-error" className="err" role="alert">
              <Icon name="alert" />
              <span>{t(`err.${joinError}`)}</span>
            </div>
          )}
          <div className="join__meta">
            <span>{t('join.rules')}</span>
            <span className="join__count">{count} / {LIMITS.nicknameMax}</span>
          </div>
          {full || networkError ? (
            <button type="submit" className="btn join__go" disabled={!valid || entering}>
              <Icon name="refresh" />
              {t('join.retry')}
            </button>
          ) : (
            <button type="submit" className="btn orange join__go" disabled={!valid || entering}>
              {entering && <Icon name="spinner" className="join__spinner" />}
              {entering ? t('join.entering') : t('join.enter')}
            </button>
          )}
        </form>
      </div>
      <p className="join__note">{t('join.publicNote')}</p>
    </div>
  );
}
