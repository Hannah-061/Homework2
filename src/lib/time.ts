import type { Lang } from '../services/ChatService';

const locale = (lang: Lang) => (lang === 'zh' ? 'zh-TW' : 'en-US');

/** 14:32（使用者所在時區） */
export function formatTime(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

/** 一天的 key，用來判斷有沒有跨日（使用者所在時區） */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 2026/10/18（中文）、Oct 18, 2026（英文） */
export function formatDate(iso: string, lang: Lang): string {
  const d = new Date(iso);
  if (lang === 'zh') {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}/${m}/${day}`;
  }
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(d);
}
