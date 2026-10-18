import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import {
  AppError,
  LIMITS,
  type ChatEvent,
  type ChatEventListener,
  type ChatService,
  type ErrorCode,
  type JoinResult,
  type Lang,
  type LinkPreview,
  type Message,
  type OnlineUser,
  type TranslateResult,
} from '../ChatService';
import { readImageSize } from '../../lib/image';
import { browserTranslatorSupported, translateInBrowser } from '../../lib/browserTranslate';

/**
 * 階段二的真後台（docs/architecture.md 第 4、5.5 節）。
 * 這個資料夾是整個專案唯一可以 import Supabase 套件的地方。
 *
 * - 身分：Supabase 匿名登入（使用者看不到、不用登入），記在這個瀏覽器裡。
 * - 在線名單、進出：Realtime Presence，通道 room:main。
 * - 新訊息、收回、被遮住：Realtime Postgres Changes（messages 表的新增與更新）。
 * - 寫入（進入、送訊息、收回、檢舉）：一律呼叫資料庫函式（supabase/sql/002_functions.sql）。
 * - 圖片：Storage 的 chat-images；連結預覽：Edge Function。
 * - 翻譯：用瀏覽器內建的翻譯功能（免費，沒有後台）；不支援的瀏覽器不顯示「翻譯」按鈕。
 */

const BUCKET = 'chat-images';
const CHANNEL = 'room:main';
const KEY_NICKNAME = 'anonchat.nickname';
/** 每 20 秒回報一次「我還在」；後台超過 60 秒沒收到就釋放代號 */
const HEARTBEAT_MS = 20_000;

const ERROR_CODES: ReadonlySet<string> = new Set<ErrorCode>([
  'NICKNAME_INVALID',
  'NICKNAME_TAKEN',
  'ROOM_FULL',
  'NOT_JOINED',
  'TEXT_EMPTY',
  'TEXT_TOO_LONG',
  'IMAGE_TOO_LARGE',
  'IMAGE_TYPE_NOT_ALLOWED',
  'RATE_LIMITED',
  'NOT_OWNER',
  'MESSAGE_NOT_FOUND',
  'CANNOT_REPORT_OWN',
  'ALREADY_REPORTED',
  'TRANSLATE_FAILED',
  'TRANSLATE_QUOTA',
  'PREVIEW_UNAVAILABLE',
  'SESSION_EXPIRED',
  'NETWORK',
]);

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

interface DbMessage {
  id: string;
  sender_id: string;
  nickname: string;
  kind: 'text' | 'image';
  body: string | null;
  image_path: string | null;
  image_width: number | null;
  image_height: number | null;
  status: 'normal' | 'retracted' | 'hidden';
  created_at: string;
}

interface PresenceMeta {
  nickname?: string;
  joinedAt?: string;
}

interface DbError {
  message?: string;
  hint?: string | null;
}

/** 資料庫函式用「錯誤訊息 = 錯誤碼」回報；轉成前端認得的 AppError */
function toError(e: DbError | null | undefined): AppError {
  const code = e?.message ?? '';
  if (ERROR_CODES.has(code)) {
    const secs = code === 'RATE_LIMITED' ? Number(e?.hint) : NaN;
    return new AppError(code as ErrorCode, Number.isFinite(secs) ? secs : undefined);
  }
  return new AppError('NETWORK');
}

export class SupabaseChatService implements ChatService {
  private sb: SupabaseClient;
  private listeners = new Set<ChatEventListener>();
  /** 看過的訊息文字（編號 → 文字），翻譯時用 */
  private texts = new Map<string, string>();

  private userId: string | null = null;
  private me: { nickname: string; joinedAt: string } | null = null;
  private channel: RealtimeChannel | null = null;
  private heartbeat: number | undefined;

  /** 目前看到的在線的人（key = userId），用來算出誰進來、誰離開 */
  private known = new Map<string, OnlineUser>();
  /** 還在做第一次同步，或剛重新連線：這時的名單變化不產生「進來／離開」提示 */
  private quietSync = true;
  /** 靜默期間結束時，要不要補發一次完整名單（重新連線需要；剛進入不需要，進入的結果裡已經有名單） */
  private emitSyncWhenDone = false;
  private wasDisconnected = false;

  constructor(url: string, publishableKey: string) {
    this.sb = createClient(url, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
    window.addEventListener('online', () => void this.recover());
    window.addEventListener('offline', () => this.emit({ type: 'connection.status', status: 'offline' }));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void this.recover();
    });
  }

  // ---------- ChatService ----------

  restoreSession(): string | null {
    try {
      return localStorage.getItem(KEY_NICKNAME);
    } catch {
      return null;
    }
  }

  async join(nickname: string): Promise<JoinResult> {
    const userId = await this.ensureIdentity();

    const { data, error } = await this.sb.rpc('claim_nickname', { p_nickname: nickname });
    if (error) throw toError(error);
    const claimed = data as { nickname: string; joined_at: string };
    this.me = { nickname: claimed.nickname, joinedAt: new Date(claimed.joined_at).toISOString() };
    this.userId = userId;
    this.remember(claimed.nickname);

    // 先訂閱再讀歷史：這樣訂閱和讀取之間的空檔不會漏訊息（重複的由狀態層用訊息編號去掉）
    this.quietSync = true;
    this.emitSyncWhenDone = false;
    this.wasDisconnected = false;
    this.known.clear();
    await this.openChannel();
    await this.waitForSelfPresence();
    this.quietSync = false;

    const messages = await this.fetchRecent();
    this.startHeartbeat();
    return { userId, messages, onlineUsers: this.onlineList() };
  }

  async leave(): Promise<void> {
    window.clearInterval(this.heartbeat);
    this.forget();
    const channel = this.channel;
    this.channel = null;
    if (channel) {
      await channel.untrack().catch(() => undefined);
      await this.sb.removeChannel(channel).catch(() => undefined);
    }
    await this.sb.rpc('release_nickname');
    this.me = null;
    this.known.clear();
  }

  async sendText(text: string): Promise<Message> {
    const { data, error } = await this.sb.rpc('send_message', { p_kind: 'text', p_text: text });
    if (error) throw toError(error);
    return this.toMessage(data as DbMessage);
  }

  async sendImage(file: File): Promise<Message> {
    const uid = this.userId;
    if (!uid) throw new AppError('NOT_JOINED');
    if (!LIMITS.imageTypes.includes(file.type)) throw new AppError('IMAGE_TYPE_NOT_ALLOWED');
    if (file.size > LIMITS.imageMaxBytes) throw new AppError('IMAGE_TOO_LARGE');
    const size = await readImageSize(file);

    // 圖片只能傳到「自己的身分」命名的資料夾（後台規則）
    const path = `${uid}/${crypto.randomUUID()}.${EXT[file.type]}`;
    const up = await this.sb.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) {
      const status = Number((up.error as { statusCode?: string | number }).statusCode);
      if (status === 413) throw new AppError('IMAGE_TOO_LARGE');
      if (status === 415) throw new AppError('IMAGE_TYPE_NOT_ALLOWED');
      throw new AppError('NETWORK');
    }

    const { data, error } = await this.sb.rpc('send_message', {
      p_kind: 'image',
      p_image_path: path,
      p_width: size.width,
      p_height: size.height,
    });
    // 失敗時檔案會變成「沒有被任何訊息引用的圖片」，由清理程式稍後刪除
    if (error) throw toError(error);
    return this.toMessage(data as DbMessage);
  }

  async retract(messageId: string): Promise<void> {
    const { error } = await this.sb.rpc('retract_message', { p_id: messageId });
    if (error) throw toError(error);
  }

  async report(messageId: string): Promise<void> {
    const { error } = await this.sb.rpc('report_message', { p_id: messageId });
    if (error) throw toError(error);
  }

  canTranslate(): boolean {
    return browserTranslatorSupported();
  }

  async translate(messageId: string, targetLang: Lang): Promise<TranslateResult> {
    const text = this.texts.get(messageId);
    if (!text) throw new AppError('MESSAGE_NOT_FOUND');
    try {
      return { translatedText: await translateInBrowser(text, targetLang), targetLang };
    } catch {
      throw new AppError('TRANSLATE_FAILED');
    }
  }

  async previewLink(url: string): Promise<LinkPreview> {
    const { data, error } = await this.sb.functions.invoke('link-preview', { body: { url } });
    if (error || !data || (data as { error?: string }).error) throw new AppError('PREVIEW_UNAVAILABLE');
    return data as LinkPreview;
  }

  subscribe(listener: ChatEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ---------- 身分 ----------

  /** 沒有身分就向 Supabase 要一個匿名身分；有就沿用（重新整理後還是同一個人） */
  private async ensureIdentity(): Promise<string> {
    try {
      const { data } = await this.sb.auth.getSession();
      if (data.session) return data.session.user.id;
      const res = await this.sb.auth.signInAnonymously();
      if (res.error || !res.data.user) throw new AppError('NETWORK');
      return res.data.user.id;
    } catch (e) {
      throw e instanceof AppError ? e : new AppError('NETWORK');
    }
  }

  private remember(nickname: string): void {
    try {
      localStorage.setItem(KEY_NICKNAME, nickname);
    } catch {
      // 存不進去只是下次不會自動進入
    }
  }

  private forget(): void {
    try {
      localStorage.removeItem(KEY_NICKNAME);
    } catch {
      // 同上
    }
  }

  // ---------- 即時通道 ----------

  private async openChannel(): Promise<void> {
    if (this.channel) await this.sb.removeChannel(this.channel).catch(() => undefined);
    const me = this.me!;
    const channel = this.sb.channel(CHANNEL, { config: { presence: { key: this.userId! } } });
    this.channel = channel;

    channel
      .on('presence', { event: 'sync' }, () => this.onPresenceSync())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) =>
        this.emit({ type: 'message.new', message: this.toMessage(p.new as DbMessage) }),
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (p) =>
        this.emit({ type: 'message.updated', message: this.toMessage(p.new as DbMessage) }),
      );

    await new Promise<void>((resolve, reject) => {
      let first = true;
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void channel.track({ nickname: me.nickname, joinedAt: me.joinedAt } satisfies PresenceMeta);
          if (first) {
            first = false;
            resolve();
          } else {
            void this.onReconnected();
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          if (first) {
            first = false;
            reject(new AppError('NETWORK'));
          } else if (this.me) {
            this.wasDisconnected = true;
            this.emit({ type: 'connection.status', status: 'reconnecting' });
          }
        }
      });
    });
  }

  /** 在線名單變了：算出誰進來、誰離開（第一次同步與重新連線後只整批校正，不產生提示） */
  private onPresenceSync(): void {
    if (!this.channel) return;
    const state = this.channel.presenceState<PresenceMeta>();
    const now = new Map<string, OnlineUser>();
    for (const [key, metas] of Object.entries(state)) {
      const meta = metas[0];
      if (!meta?.nickname) continue;
      now.set(key, { userId: key, nickname: meta.nickname, joinedAt: meta.joinedAt ?? new Date().toISOString() });
    }

    if (this.quietSync) {
      this.known = now;
      if (this.emitSyncWhenDone && now.has(this.userId ?? '')) {
        this.quietSync = false;
        this.emitSyncWhenDone = false;
        this.emit({ type: 'presence.sync', users: this.onlineList() });
      }
      return;
    }
    // 自己的進出不產生提示（畫面也不需要）
    for (const [id, u] of now) if (!this.known.has(id) && id !== this.userId) this.emit({ type: 'presence.joined', user: u });
    for (const [id, u] of this.known) if (!now.has(id) && id !== this.userId) this.emit({ type: 'presence.left', user: u });
    this.known = now;
  }

  /** 完整的在線名單（一定包含自己，依進入時間排序） */
  private onlineList(): OnlineUser[] {
    const list = new Map(this.known);
    if (this.userId && this.me && !list.has(this.userId)) {
      list.set(this.userId, { userId: this.userId, nickname: this.me.nickname, joinedAt: this.me.joinedAt });
    }
    return [...list.values()].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  }

  /** 登記到在線名單需要一點時間；最多等 3 秒，讓進入的結果裡看得到自己 */
  private async waitForSelfPresence(): Promise<void> {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if (this.userId && this.known.has(this.userId)) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  /** 斷線後重新連上：整批校正名單、補回漏掉的訊息 */
  private async onReconnected(): Promise<void> {
    if (!this.wasDisconnected || !this.me) return;
    this.wasDisconnected = false;
    const alive = await this.reclaim();
    if (!alive) return;
    this.quietSync = true;
    this.emitSyncWhenDone = true;
    this.emit({ type: 'connection.status', status: 'connected' });
    await this.refetchMissed();
  }

  // ---------- 保持在線 ----------

  private startHeartbeat(): void {
    window.clearInterval(this.heartbeat);
    this.heartbeat = window.setInterval(() => void this.beat(), HEARTBEAT_MS);
  }

  private async beat(): Promise<void> {
    if (!this.me) return;
    const { error } = await this.sb.rpc('heartbeat');
    if (error && error.message === 'NOT_JOINED') await this.reclaim();
  }

  /**
   * 代號被後台釋放了（離線超過 60 秒）：試著把同一個代號要回來。
   * 要不回來（被別人用了、聊天室滿了）就通知畫面退回輸入代號。
   */
  private async reclaim(): Promise<boolean> {
    if (!this.me) return false;
    const { error } = await this.sb.rpc('claim_nickname', { p_nickname: this.me.nickname });
    if (!error) return true;
    if (['NICKNAME_TAKEN', 'ROOM_FULL', 'NICKNAME_INVALID'].includes(error.message ?? '')) {
      await this.expire();
    }
    return false;
  }

  private async expire(): Promise<void> {
    window.clearInterval(this.heartbeat);
    this.forget();
    const channel = this.channel;
    this.channel = null;
    this.me = null;
    this.known.clear();
    if (channel) await this.sb.removeChannel(channel).catch(() => undefined);
    this.emit({ type: 'session.expired' });
  }

  /** 網路恢復或分頁回到前景：馬上回報「我還在」，必要時重新連線 */
  private async recover(): Promise<void> {
    if (!this.me) return;
    if (!navigator.onLine) {
      this.emit({ type: 'connection.status', status: 'offline' });
      return;
    }
    await this.beat();
    if (this.channel && this.channel.state !== 'joined') {
      this.wasDisconnected = true;
      this.emit({ type: 'connection.status', status: 'reconnecting' });
      this.sb.realtime.connect();
    }
  }

  // ---------- 訊息 ----------

  private async fetchRecent(): Promise<Message[]> {
    const { data, error } = await this.sb
      .from('messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(LIMITS.historySize);
    if (error) throw new AppError('NETWORK');
    return (data as DbMessage[]).map((m) => this.toMessage(m)).reverse();
  }

  /** 重新連線後，把最近 50 則重讀一次：新的補上、斷線期間被收回或遮住的更新 */
  private async refetchMissed(): Promise<void> {
    try {
      const messages = await this.fetchRecent();
      for (const message of messages) this.emit({ type: 'message.new', message });
      for (const message of messages) this.emit({ type: 'message.updated', message });
    } catch {
      // 這次沒補成功，下一次重新連線再補
    }
  }

  private toMessage(row: DbMessage): Message {
    if (row.status === 'retracted' || !row.body) this.texts.delete(row.id);
    else this.texts.set(row.id, row.body);
    const image =
      row.kind === 'image' && row.image_path
        ? {
            url: this.sb.storage.from(BUCKET).getPublicUrl(row.image_path).data.publicUrl,
            width: row.image_width ?? 0,
            height: row.image_height ?? 0,
          }
        : null;
    return {
      id: row.id,
      senderId: row.sender_id,
      nickname: row.nickname,
      kind: row.kind,
      text: row.status === 'retracted' ? null : row.body,
      image: row.status === 'retracted' ? null : image,
      createdAt: new Date(row.created_at).toISOString(),
      status: row.status,
    };
  }

  private emit(event: ChatEvent): void {
    this.listeners.forEach((l) => l(event));
  }
}
