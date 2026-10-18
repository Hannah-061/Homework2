import { LIMITS } from '../services/ChatService';

/** 看不見的字元（零寬空白、文字方向控制字元…）與控制字元：用來冒充別人，一律拒絕 */
const INVISIBLE_OR_CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}​-‏‪-‮⁠-⁯﻿]/u;

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

/** 以「使用者看到的字數」計算，所以一個 emoji 算 1 個字 */
export function countChars(text: string): number {
  if (!segmenter) return Array.from(text).length;
  let n = 0;
  for (const _ of segmenter.segment(text)) n++;
  return n;
}

/** 從頭取最多 max 個「使用者看到的字」 */
export function truncateChars(text: string, max: number): string {
  if (!segmenter) return Array.from(text).slice(0, max).join('');
  let out = '';
  let n = 0;
  for (const part of segmenter.segment(text)) {
    if (n >= max) break;
    out += part.segment;
    n++;
  }
  return out;
}

export type NicknameCheck =
  | { ok: true; nickname: string }
  | { ok: false; reason: 'empty' | 'too-long' | 'invalid-chars' };

/** 去掉前後空白，再檢查長度與字元 */
export function checkNickname(raw: string): NicknameCheck {
  const nickname = raw.trim();
  if (nickname.length === 0) return { ok: false, reason: 'empty' };
  if (INVISIBLE_OR_CONTROL.test(nickname)) return { ok: false, reason: 'invalid-chars' };
  if (countChars(nickname) > LIMITS.nicknameMax) return { ok: false, reason: 'too-long' };
  return { ok: true, nickname };
}

/** 比對「是否重複」時用：忽略大小寫、全形半形、前後空白的差異 */
export function nicknameKey(nickname: string): string {
  return nickname.trim().normalize('NFKC').toLowerCase();
}
