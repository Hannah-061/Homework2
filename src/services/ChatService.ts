/**
 * 前端和後台之間的「合約」（docs/architecture.md 第 5 節）。
 *
 * 畫面元件只認這個檔案。階段一由 services/mock 實作（假後台），
 * 階段二由 services/supabase 實作（真後台），兩者吐出來的資料格式與事件完全一樣。
 */

export type Lang = 'zh' | 'en';

// ---------- 資料格式 ----------

export type MessageKind = 'text' | 'image';
/** normal 正常 / retracted 已收回 / hidden 因被檢舉達 3 人而遮住 */
export type MessageStatus = 'normal' | 'retracted' | 'hidden';

export interface ImageInfo {
  url: string;
  width: number;
  height: number;
}

/** 被提及（@）的人。userId 是當時選的那個人，之後別人用了同一個代號不會被算進來 */
export interface Mention {
  userId: string;
  nickname: string;
}

/**
 * 這則訊息引用了哪一則。摘要是送出當下記下的；
 * 原訊息之後被收回或被檢舉遮住時，後台會把摘要清掉、state 改掉。
 */
export interface ReplyRef {
  messageId: string;
  senderId: string;
  nickname: string;
  kind: MessageKind;
  /** 原文前面幾十個字；原訊息是圖片、或已被收回／遮住時是 null */
  preview: string | null;
  state: MessageStatus;
}

export interface Message {
  id: string;
  senderId: string;
  nickname: string;
  kind: MessageKind;
  text: string | null;
  image: ImageInfo | null;
  /** ISO 8601，UTC，例如 2026-10-18T14:32:05Z */
  createdAt: string;
  status: MessageStatus;
  /** 文字訊息裡被 @ 的人（最多 5 個）；沒有就是空陣列 */
  mentions: Mention[];
  /** 引用的訊息；沒有引用就是 null */
  replyTo: ReplyRef | null;
}

export interface OnlineUser {
  userId: string;
  nickname: string;
  /** ISO 8601 */
  joinedAt: string;
}

export interface LinkPreview {
  url: string;
  siteName: string;
  title: string | null;
  description: string | null;
  /** 僅限 https */
  thumbnailUrl: string | null;
}

// ---------- 錯誤 ----------

export type ErrorCode =
  | 'NICKNAME_INVALID'
  | 'NICKNAME_TAKEN'
  | 'ROOM_FULL'
  | 'NOT_JOINED'
  | 'TEXT_EMPTY'
  | 'TEXT_TOO_LONG'
  | 'IMAGE_TOO_LARGE'
  | 'IMAGE_TYPE_NOT_ALLOWED'
  | 'RATE_LIMITED'
  | 'NOT_OWNER'
  | 'MESSAGE_NOT_FOUND'
  | 'CANNOT_REPORT_OWN'
  | 'ALREADY_REPORTED'
  | 'TOO_MANY_MENTIONS'
  | 'TRANSLATE_FAILED'
  | 'TRANSLATE_QUOTA'
  | 'PREVIEW_UNAVAILABLE'
  | 'SESSION_EXPIRED'
  | 'NETWORK';

/** 畫面只看 code，再去文字表找對應的中英文說明；後台不產生給人看的文字 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly retryAfterSeconds?: number;

  constructor(code: ErrorCode, retryAfterSeconds?: number) {
    super(code);
    this.name = 'AppError';
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function toAppError(e: unknown): AppError {
  return e instanceof AppError ? e : new AppError('NETWORK');
}

// ---------- 事件（後台 → 前端） ----------

export type ConnectionStatus = 'connected' | 'reconnecting' | 'offline';

export type ChatEvent =
  | { type: 'connection.status'; status: ConnectionStatus }
  /** 剛進來與重新連線之後的完整名單；不會產生進出提示 */
  | { type: 'presence.sync'; users: OnlineUser[] }
  | { type: 'presence.joined'; user: OnlineUser }
  | { type: 'presence.left'; user: OnlineUser }
  | { type: 'message.new'; message: Message }
  | { type: 'message.updated'; message: Message }
  /** 離線太久，代號已被釋放（或被別人用了）：畫面要退回輸入代號 */
  | { type: 'session.expired' };

// ---------- 指令（前端 → 後台） ----------

export interface JoinResult {
  userId: string;
  /** 最近 50 則，由舊到新 */
  messages: Message[];
  onlineUsers: OnlineUser[];
}

export interface TranslateResult {
  translatedText: string;
  targetLang: Lang;
}

export interface SendOptions {
  /** 要引用的訊息編號 */
  replyTo?: string;
  mentions?: Mention[];
}

export type ChatEventListener = (event: ChatEvent) => void;

export interface ChatService {
  /**
   * 這個瀏覽器（或分頁）上次用的代號。有的話，畫面會自動用它進入聊天室。
   * 階段一的假後台記在分頁裡（一個分頁 = 一個人）；階段二記在瀏覽器裡。
   */
  restoreSession(): string | null;

  /** room.join */
  join(nickname: string): Promise<JoinResult>;
  /** room.leave：釋放代號，並忘記上次的代號 */
  leave(): Promise<void>;

  /** message.sendText；可以帶引用（被引用訊息的編號）與提及（最多 5 個在線的人） */
  sendText(text: string, options?: SendOptions): Promise<Message>;
  /** message.sendImage（檔案已經在前端檢查並重新壓縮過）；圖片也可以帶引用 */
  sendImage(file: File, options?: Pick<SendOptions, 'replyTo'>): Promise<Message>;
  /** message.retract */
  retract(messageId: string): Promise<void>;
  /** message.report */
  report(messageId: string): Promise<void>;
  /** 這個後台／瀏覽器能不能翻譯；不能的話，畫面就不顯示「翻譯」按鈕 */
  canTranslate(): boolean;
  /** message.translate */
  translate(messageId: string, targetLang: Lang): Promise<TranslateResult>;
  /** link.preview */
  previewLink(url: string): Promise<LinkPreview>;

  /** 訂閱事件；回傳取消訂閱的函式 */
  subscribe(listener: ChatEventListener): () => void;
}

// ---------- 全站共用的規則（前端檢查與假後台共用；真後台在資料庫函式裡再檢查一次） ----------

export const LIMITS = {
  nicknameMax: 12,
  textMax: 500,
  /** 超過這個字數才顯示剩餘字數 */
  textWarnAt: 450,
  historySize: 50,
  imageMaxBytes: 5 * 1024 * 1024,
  imageMaxSide: 4096,
  imageTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as readonly string[],
  /** 10 秒內最多 5 則（含圖片） */
  rateWindowMs: 10_000,
  rateMaxMessages: 5,
  /** 一則訊息最多提到幾個人 */
  mentionMax: 5,
  /** 引用區顯示原文的前幾個字（後台存的摘要長度） */
  replyPreviewMax: 80,
  /** 檢舉達這個人數就遮住 */
  reportHideAt: 3,
  /** 別人離開後，等這麼久還沒回來才顯示「離開了」 */
  leaveGraceMs: 10_000,
} as const;
