import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Lang } from '../services/ChatService';
import { zhTW, type DictKey, type Dict } from './zh-TW';
import { en } from './en';

const dicts: Record<Lang, Dict> = { zh: zhTW, en };
const STORAGE_KEY = 'anonchat.lang';

type Params = Record<string, string | number>;
export type T = (key: DictKey, params?: Params) => string;

function format(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? String(params[k]) : `{${k}}`));
}

/** 預設中文；使用者選過就記在自己的瀏覽器裡 */
function loadLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'zh' || v === 'en') return v;
  } catch {
    // 無痕視窗等情況讀不到，照預設
  }
  return 'zh';
}

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: T;
}

const Ctx = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(loadLang);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 存不進去也沒關係，只是下次要重選
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-TW' : 'en';
  }, [lang]);

  const value = useMemo<I18nValue>(() => {
    const dict = dicts[lang];
    return { lang, setLang, t: (key, params) => format(dict[key], params) };
  }, [lang, setLang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n 必須在 I18nProvider 裡使用');
  return v;
}
