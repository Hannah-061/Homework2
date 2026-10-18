import {
  AppError,
  LIMITS,
  toAppError,
  type ChatEvent,
  type ChatService,
  type ConnectionStatus,
  type ErrorCode,
  type Lang,
  type LinkPreview,
  type Message,
  type OnlineUser,
} from '../services/ChatService';
import { checkNickname } from '../lib/nickname';
import { prepareImage } from '../lib/image';
import { translationTarget } from '../lib/detectLanguage';

/**
 * 聊天狀態：訊息、在線名單、連線狀態、翻譯結果…
 * 畫面元件只讀這裡的 state、呼叫這裡的動作；後台的事全部透過 ChatService。
 */

export type Phase = 'booting' | 'join' | 'entering' | 'room';

export interface Notice {
  id: string;
  type: 'joined' | 'left';
  nickname: string;
  /** ISO 8601（本機時間），用來排在訊息之間 */
  at: string;
}

/** 自己剛送出、後台還沒確認的訊息 */
export interface Pending {
  id: string;
  kind: 'text' | 'image';
  text: string | null;
  previewUrl: string | null;
  state: 'sending' | 'failed';
  createdAt: string;
}

export interface TranslationState {
  status: 'loading' | 'done' | 'error';
  text?: string;
  lang?: Lang;
  /** 目前有沒有展開（隱藏翻譯只是收起來，不會丟掉結果） */
  visible: boolean;
  error?: ErrorCode;
}

export type PreviewState =
  | { status: 'loading' }
  | { status: 'done'; preview: LinkPreview }
  | { status: 'none' };

export interface Toast {
  id: number;
  tone: 'info' | 'error';
  /** info 是文字表的 key；error 是錯誤碼 */
  text: string;
  retryAfterSeconds?: number;
}

export interface ChatState {
  phase: Phase;
  /** 輸入框的代號（自動進入失敗時，也會保留給使用者看） */
  nickname: string;
  userId: string | null;
  joinError: ErrorCode | null;
  messages: Message[];
  notices: Notice[];
  pending: Pending[];
  online: OnlineUser[];
  connection: ConnectionStatus;
  /** 往上看舊訊息時，新來的訊息數 */
  unseen: number;
  atBottom: boolean;
  /** 在別的分頁時累積的未讀數（顯示在分頁標題） */
  hiddenUnread: number;
  /** 被頻率限制時，輸入框鎖到什麼時候（毫秒時間戳；0 = 沒鎖） */
  rateLockUntil: number;
  revealed: ReadonlySet<string>;
  translations: Readonly<Record<string, TranslationState>>;
  previews: Readonly<Record<string, PreviewState>>;
  toast: Toast | null;
  /** 輸入區上方的錯誤（圖片太大、類型不支援…） */
  composerError: { code: ErrorCode; retryAfterSeconds?: number } | null;
}

export interface SendResult {
  ok: boolean;
  code?: ErrorCode;
}

const initialState: ChatState = {
  phase: 'booting',
  nickname: '',
  userId: null,
  joinError: null,
  messages: [],
  notices: [],
  pending: [],
  online: [],
  connection: 'connected',
  unseen: 0,
  atBottom: true,
  hiddenUnread: 0,
  rateLockUntil: 0,
  revealed: new Set(),
  translations: {},
  previews: {},
  toast: null,
  composerError: null,
};

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}`;

export class ChatStore {
  private state: ChatState = initialState;
  private listeners = new Set<() => void>();
  private unsubscribeService: (() => void) | null = null;
  private leaveTimers = new Map<string, number>();
  private toastTimer: number | undefined;
  private started = false;

  constructor(private readonly service: ChatService) {}

  // ---------- 給 React 用 ----------

  getState = (): ChatState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)): void {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l());
  }

  // ---------- 進入、離開 ----------

  /** 打開網頁時呼叫一次：有上次的代號就自動進入 */
  init(): void {
    if (this.started) return;
    this.started = true;
    this.unsubscribeService = this.service.subscribe((e) => this.handleEvent(e));
    const remembered = this.service.restoreSession();
    if (remembered) void this.join(remembered);
    else this.set({ phase: 'join' });
  }

  async join(rawNickname: string): Promise<void> {
    const checked = checkNickname(rawNickname);
    if (!checked.ok) {
      this.set({ phase: 'join', nickname: rawNickname, joinError: 'NICKNAME_INVALID' });
      return;
    }
    this.set({ phase: 'entering', nickname: checked.nickname, joinError: null });
    try {
      const res = await this.service.join(checked.nickname);
      this.clearLeaveTimers();
      this.set({
        phase: 'room',
        userId: res.userId,
        messages: sortMessages(res.messages),
        online: res.onlineUsers,
        notices: [],
        pending: [],
        unseen: 0,
        atBottom: true,
        connection: 'connected',
        joinError: null,
      });
    } catch (e) {
      this.set({ phase: 'join', joinError: toAppError(e).code });
    }
  }

  async leave(): Promise<void> {
    await this.service.leave().catch(() => undefined);
    this.clearLeaveTimers();
    this.set({ ...initialState, phase: 'join', previews: this.state.previews });
  }

  // ---------- 送訊息 ----------

  async sendText(text: string): Promise<SendResult> {
    const pending: Pending = {
      id: nextId('p'),
      kind: 'text',
      text,
      previewUrl: null,
      state: 'sending',
      createdAt: new Date().toISOString(),
    };
    this.set((s) => ({ pending: [...s.pending, pending], composerError: null }));
    return this.deliver(pending, () => this.service.sendText(text));
  }

  async resend(pendingId: string): Promise<SendResult> {
    const item = this.state.pending.find((p) => p.id === pendingId);
    if (!item || item.kind !== 'text' || item.text === null) return { ok: false };
    const text = item.text;
    this.patchPending(pendingId, { state: 'sending' });
    return this.deliver(item, () => this.service.sendText(text));
  }

  /** 傳圖片：先在這裡檢查並重新壓縮，再交給後台 */
  async sendImage(file: File): Promise<SendResult> {
    let prepared: File;
    try {
      prepared = await prepareImage(file);
    } catch (e) {
      const err = toAppError(e);
      this.set({ composerError: { code: err.code } });
      return { ok: false, code: err.code };
    }
    const pending: Pending = {
      id: nextId('p'),
      kind: 'image',
      text: null,
      previewUrl: URL.createObjectURL(prepared),
      state: 'sending',
      createdAt: new Date().toISOString(),
    };
    this.set((s) => ({ pending: [...s.pending, pending], composerError: null }));
    return this.deliver(pending, () => this.service.sendImage(prepared));
  }

  private async deliver(pending: Pending, send: () => Promise<Message>): Promise<SendResult> {
    try {
      const message = await send();
      this.removePending(pending.id);
      this.addMessage(message, true);
      return { ok: true };
    } catch (e) {
      const err = toAppError(e);
      if (err.code === 'RATE_LIMITED') {
        // 太快了：不留在畫面上，文字還給輸入框，並鎖住一下
        this.removePending(pending.id);
        const secs = err.retryAfterSeconds ?? 5;
        this.set({ rateLockUntil: Date.now() + secs * 1000 });
        return { ok: false, code: err.code };
      }
      this.patchPending(pending.id, { state: 'failed' });
      return { ok: false, code: err.code };
    }
  }

  private patchPending(id: string, patch: Partial<Pending>): void {
    this.set((s) => ({ pending: s.pending.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  }

  private removePending(id: string): void {
    const item = this.state.pending.find((p) => p.id === id);
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
    this.set((s) => ({ pending: s.pending.filter((p) => p.id !== id) }));
  }

  discardPending(id: string): void {
    this.removePending(id);
  }

  // ---------- 收回、檢舉 ----------

  async retract(messageId: string): Promise<void> {
    try {
      await this.service.retract(messageId);
    } catch (e) {
      this.showError(toAppError(e));
    }
  }

  async report(messageId: string): Promise<void> {
    try {
      await this.service.report(messageId);
      this.showToast({ tone: 'info', text: 'msg.reported' });
    } catch (e) {
      this.showError(toAppError(e));
    }
  }

  reveal(messageId: string): void {
    this.set((s) => ({ revealed: new Set(s.revealed).add(messageId) }));
  }

  // ---------- 翻譯、連結預覽 ----------

  async translate(message: Message, uiLang: Lang): Promise<void> {
    if (!message.text) return;
    const current = this.state.translations[message.id];
    if (current?.status === 'loading') return;
    if (current?.status === 'done') {
      // 以前翻過：直接展開，不用再問後台
      this.setTranslation(message.id, { ...current, visible: true });
      return;
    }
    this.setTranslation(message.id, { status: 'loading', visible: true });
    try {
      const res = await this.service.translate(message.id, translationTarget(message.text, uiLang));
      this.setTranslation(message.id, {
        status: 'done',
        text: res.translatedText,
        lang: res.targetLang,
        visible: true,
      });
    } catch (e) {
      this.setTranslation(message.id, { status: 'error', visible: true, error: toAppError(e).code });
    }
  }

  hideTranslation(messageId: string): void {
    const current = this.state.translations[messageId];
    if (current) this.setTranslation(messageId, { ...current, visible: false });
  }

  private setTranslation(id: string, value: TranslationState): void {
    this.set((s) => ({ translations: { ...s.translations, [id]: value } }));
  }

  /** 看到有網址的訊息時才去問預覽；同一個網址只問一次 */
  async loadPreview(url: string): Promise<void> {
    if (this.state.previews[url]) return;
    this.set((s) => ({ previews: { ...s.previews, [url]: { status: 'loading' } } }));
    try {
      const preview = await this.service.previewLink(url);
      this.set((s) => ({ previews: { ...s.previews, [url]: { status: 'done', preview } } }));
    } catch {
      this.set((s) => ({ previews: { ...s.previews, [url]: { status: 'none' } } }));
    }
  }

  // ---------- 畫面回報的狀態 ----------

  setAtBottom(atBottom: boolean): void {
    if (atBottom === this.state.atBottom && (!atBottom || this.state.unseen === 0)) return;
    this.set((s) => ({ atBottom, unseen: atBottom ? 0 : s.unseen }));
  }

  /** 回到分頁時，清掉標題上的未讀數 */
  clearHiddenUnread(): void {
    if (this.state.hiddenUnread !== 0) this.set({ hiddenUnread: 0 });
  }

  dismissComposerError(): void {
    if (this.state.composerError) this.set({ composerError: null });
  }

  clearToast(): void {
    window.clearTimeout(this.toastTimer);
    this.set({ toast: null });
  }

  // ---------- 後台事件 ----------

  private handleEvent(event: ChatEvent): void {
    switch (event.type) {
      case 'connection.status':
        this.set({ connection: event.status });
        break;
      case 'presence.sync':
        this.set({ online: sortUsers(event.users) });
        break;
      case 'presence.joined':
        this.onUserJoined(event.user);
        break;
      case 'presence.left':
        this.onUserLeft(event.user);
        break;
      case 'message.new':
        this.addMessage(event.message, false);
        break;
      case 'message.updated':
        this.set((s) => ({ messages: s.messages.map((m) => (m.id === event.message.id ? event.message : m)) }));
        break;
    }
  }

  private onUserJoined(user: OnlineUser): void {
    if (user.userId === this.state.userId) return;
    this.set((s) => ({
      online: s.online.some((u) => u.userId === user.userId) ? s.online : sortUsers([...s.online, user]),
    }));
    // 剛剛才「離開」的人又回來了（例如手機切換 App）：當作沒離開過，不洗版
    const timer = this.leaveTimers.get(user.userId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.leaveTimers.delete(user.userId);
      return;
    }
    this.addNotice('joined', user.nickname);
  }

  private onUserLeft(user: OnlineUser): void {
    if (user.userId === this.state.userId) return;
    this.set((s) => ({ online: s.online.filter((u) => u.userId !== user.userId) }));
    if (this.leaveTimers.has(user.userId)) return;
    const timer = window.setTimeout(() => {
      this.leaveTimers.delete(user.userId);
      if (!this.state.online.some((u) => u.userId === user.userId)) this.addNotice('left', user.nickname);
    }, LIMITS.leaveGraceMs);
    this.leaveTimers.set(user.userId, timer);
  }

  private addNotice(type: Notice['type'], nickname: string): void {
    const notice: Notice = { id: nextId('n'), type, nickname, at: new Date().toISOString() };
    this.set((s) => ({ notices: [...s.notices, notice].slice(-100) }));
  }

  private addMessage(message: Message, own: boolean): void {
    if (this.state.messages.some((m) => m.id === message.id)) return;
    const mine = own || message.senderId === this.state.userId;
    this.set((s) => ({
      messages: sortMessages([...s.messages, message]),
      unseen: !mine && !s.atBottom ? s.unseen + 1 : s.unseen,
      hiddenUnread: !mine && document.hidden ? s.hiddenUnread + 1 : s.hiddenUnread,
    }));
  }

  // ---------- 提示 ----------

  private showError(err: AppError): void {
    this.showToast({ tone: 'error', text: err.code, retryAfterSeconds: err.retryAfterSeconds });
  }

  private showToast(t: Omit<Toast, 'id'>): void {
    window.clearTimeout(this.toastTimer);
    this.set({ toast: { ...t, id: ++counter } });
    this.toastTimer = window.setTimeout(() => this.set({ toast: null }), 3000);
  }

  private clearLeaveTimers(): void {
    this.leaveTimers.forEach((t) => window.clearTimeout(t));
    this.leaveTimers.clear();
  }

  dispose(): void {
    this.unsubscribeService?.();
    this.clearLeaveTimers();
  }
}

function sortMessages(list: Message[]): Message[] {
  return list.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function sortUsers(list: OnlineUser[]): OnlineUser[] {
  return list.slice().sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
}
