import {
  AppError,
  LIMITS,
  type ChatEvent,
  type ChatEventListener,
  type ChatService,
  type ConnectionStatus,
  type JoinResult,
  type Lang,
  type LinkPreview,
  type Message,
  type OnlineUser,
  type TranslateResult,
} from '../ChatService';
import { checkNickname, countChars, nicknameKey } from '../../lib/nickname';
import { fileToDataUrl, readImageSize } from '../../lib/image';
import { BOTS, BOT_LINES, buildSeedHistory } from './seed';
import { fakePreview, fakeTranslate } from './fakes';

/**
 * 階段一的「假後台」。
 *
 * - 訊息、檢舉、在線名單存在瀏覽器的 localStorage；同一個瀏覽器開兩個分頁 = 兩個人互相聊天
 *   （分頁之間用 BroadcastChannel 互相通知）。
 * - 另有幾個機器人定時說話、進進出出。
 * - 在網址後面加 ?mock=xxx 可以觸發各種狀況，見 docs/architecture.md 第 4 節與 README。
 */

const KEY_MESSAGES = 'anonchat.mock.messages';
const KEY_REPORTS = 'anonchat.mock.reports';
const KEY_PRESENCE = 'anonchat.mock.presence';
const KEY_SESSION_USER = 'anonchat.mock.userId';
const KEY_SESSION_NICK = 'anonchat.mock.nickname';
const CHANNEL = 'anonchat-mock';

const HEARTBEAT_MS = 4_000;
const STALE_MS = 12_000;
/** 假後台裡，別人檢舉後「其他人」會跟著檢舉，這樣一個人也看得到遮住的樣子 */
const SIMULATED_REPORTERS = ['sim-reporter-1', 'sim-reporter-2'];

type Scenario = 'full' | 'offline' | 'translate-fail' | 'translate-quota' | 'send-fail';

interface PresenceEntry {
  nickname: string;
  joinedAt: string;
  lastSeen: number;
}

type Wire =
  | { kind: 'presence' }
  | { kind: 'message.new'; message: Message }
  | { kind: 'message.updated'; message: Message };

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const rand = (min: number, max: number) => min + Math.random() * (max - min);

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function getSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function setSession(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // 讀寫不到就算了，這一次當作沒有記住
  }
}

export class MockChatService implements ChatService {
  private listeners = new Set<ChatEventListener>();
  private channel: BroadcastChannel | null;
  private scenarios: Set<Scenario>;
  private userId: string;
  private me: { nickname: string; joinedAt: string } | null = null;

  private heartbeatTimer: number | undefined;
  private botTimers: number[] = [];
  private offlineTimers: number[] = [];
  /** 目前在線的機器人 */
  private botsOnline = new Map<string, OnlineUser>();
  /** 上一次看到的「其他分頁的真人」，用來算出誰進來、誰離開 */
  private knownHumans = new Map<string, OnlineUser>();
  private sentAt: number[] = [];

  constructor() {
    const raw = new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('mock');
    this.scenarios = new Set((raw ?? '').split(',').map((s) => s.trim()) as Scenario[]);

    this.userId = getSession(KEY_SESSION_USER) ?? crypto.randomUUID();
    setSession(KEY_SESSION_USER, this.userId);

    this.channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
    this.channel?.addEventListener('message', (e: MessageEvent<Wire>) => this.onWire(e.data));
    // 關掉分頁時盡量把自己從名單拿掉（重新整理時也會，但很快就會再登記回來）
    window.addEventListener('pagehide', () => this.unregisterPresence());
  }

  // ---------- ChatService ----------

  restoreSession(): string | null {
    return getSession(KEY_SESSION_NICK);
  }

  async join(rawNickname: string): Promise<JoinResult> {
    const checked = checkNickname(rawNickname);
    if (!checked.ok) throw new AppError('NICKNAME_INVALID');
    await wait(450);
    if (this.scenarios.has('full')) throw new AppError('ROOM_FULL');

    const key = nicknameKey(checked.nickname);
    this.pruneRegistry();
    const registry = readJson<Record<string, PresenceEntry>>(KEY_PRESENCE, {});
    const takenByHuman = Object.entries(registry).some(
      ([id, e]) => id !== this.userId && nicknameKey(e.nickname) === key,
    );
    const takenByBot = BOTS.some((b) => nicknameKey(b.nickname) === key);
    if (takenByHuman || takenByBot) throw new AppError('NICKNAME_TAKEN');

    this.me = { nickname: checked.nickname, joinedAt: new Date().toISOString() };
    setSession(KEY_SESSION_NICK, checked.nickname);
    this.ensureSeed();
    this.registerPresence();
    this.startHeartbeat();
    this.startBots();
    if (this.scenarios.has('offline')) this.runOfflineScenario();

    // 讓其他分頁知道有人進來
    this.post({ kind: 'presence' });

    const humans = this.otherHumans();
    this.knownHumans = new Map(humans.map((u) => [u.userId, u]));
    return {
      userId: this.userId,
      messages: this.recentMessages(),
      onlineUsers: this.allOnline(humans),
    };
  }

  async leave(): Promise<void> {
    this.stopTimers();
    this.unregisterPresence();
    this.post({ kind: 'presence' });
    this.me = null;
    this.knownHumans.clear();
    this.botsOnline.clear();
    setSession(KEY_SESSION_NICK, null);
  }

  async sendText(text: string): Promise<Message> {
    const me = this.requireMe();
    if (text.trim().length === 0) throw new AppError('TEXT_EMPTY');
    if (countChars(text) > LIMITS.textMax) throw new AppError('TEXT_TOO_LONG');
    this.checkRate();
    await wait(250);
    if (this.scenarios.has('send-fail')) throw new AppError('NETWORK');
    return this.publish({
      id: crypto.randomUUID(),
      senderId: this.userId,
      nickname: me.nickname,
      kind: 'text',
      text,
      image: null,
      createdAt: new Date().toISOString(),
      status: 'normal',
    });
  }

  async sendImage(file: File): Promise<Message> {
    const me = this.requireMe();
    if (!LIMITS.imageTypes.includes(file.type)) throw new AppError('IMAGE_TYPE_NOT_ALLOWED');
    if (file.size > LIMITS.imageMaxBytes) throw new AppError('IMAGE_TOO_LARGE');
    const size = await readImageSize(file);
    if (size.width > LIMITS.imageMaxSide || size.height > LIMITS.imageMaxSide) {
      throw new AppError('IMAGE_TOO_LARGE');
    }
    this.checkRate();
    await wait(700); // 假裝在上傳
    if (this.scenarios.has('send-fail')) throw new AppError('NETWORK');
    const url = await fileToDataUrl(file);
    return this.publish({
      id: crypto.randomUUID(),
      senderId: this.userId,
      nickname: me.nickname,
      kind: 'image',
      text: null,
      image: { url, width: size.width, height: size.height },
      createdAt: new Date().toISOString(),
      status: 'normal',
    });
  }

  async retract(messageId: string): Promise<void> {
    this.requireMe();
    await wait(200);
    const msg = this.find(messageId);
    if (!msg) throw new AppError('MESSAGE_NOT_FOUND');
    if (msg.senderId !== this.userId) throw new AppError('NOT_OWNER');
    this.update({ ...msg, status: 'retracted', text: null, image: null });
  }

  async report(messageId: string): Promise<void> {
    this.requireMe();
    await wait(200);
    const msg = this.find(messageId);
    if (!msg) throw new AppError('MESSAGE_NOT_FOUND');
    if (msg.senderId === this.userId) throw new AppError('CANNOT_REPORT_OWN');
    const reports = readJson<Record<string, string[]>>(KEY_REPORTS, {});
    const list = reports[messageId] ?? [];
    if (list.includes(this.userId)) throw new AppError('ALREADY_REPORTED');
    reports[messageId] = [...list, this.userId];
    writeJson(KEY_REPORTS, reports);
    this.applyReports(messageId);

    // 假後台：只有你一個人在檢舉時，其他人會很快跟著檢舉，讓你看到「遮住」的樣子
    SIMULATED_REPORTERS.forEach((simId, i) => {
      this.botTimers.push(
        window.setTimeout(() => {
          const r = readJson<Record<string, string[]>>(KEY_REPORTS, {});
          const l = r[messageId] ?? [];
          if (l.includes(simId)) return;
          r[messageId] = [...l, simId];
          writeJson(KEY_REPORTS, r);
          this.applyReports(messageId);
        }, 900 * (i + 1)),
      );
    });
  }

  async translate(messageId: string, targetLang: Lang): Promise<TranslateResult> {
    this.requireMe();
    await wait(700);
    if (this.scenarios.has('translate-fail')) throw new AppError('TRANSLATE_FAILED');
    if (this.scenarios.has('translate-quota')) throw new AppError('TRANSLATE_QUOTA');
    const msg = this.find(messageId);
    if (!msg || msg.status !== 'normal' || !msg.text) throw new AppError('MESSAGE_NOT_FOUND');
    return fakeTranslate(msg.text, targetLang);
  }

  async previewLink(url: string): Promise<LinkPreview> {
    await wait(400);
    return fakePreview(url);
  }

  subscribe(listener: ChatEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ---------- 訊息 ----------

  private requireMe() {
    if (!this.me) throw new AppError('NOT_JOINED');
    return this.me;
  }

  private checkRate(): void {
    const now = Date.now();
    this.sentAt = this.sentAt.filter((t) => now - t < LIMITS.rateWindowMs);
    if (this.sentAt.length >= LIMITS.rateMaxMessages) {
      const retry = Math.ceil((this.sentAt[0]! + LIMITS.rateWindowMs - now) / 1000);
      throw new AppError('RATE_LIMITED', Math.max(1, retry));
    }
    this.sentAt.push(now);
  }

  private ensureSeed(): void {
    const existing = readJson<Message[] | null>(KEY_MESSAGES, null);
    if (existing === null) writeJson(KEY_MESSAGES, buildSeedHistory());
  }

  private allMessages(): Message[] {
    return readJson<Message[]>(KEY_MESSAGES, []);
  }

  private recentMessages(): Message[] {
    return this.allMessages()
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(-LIMITS.historySize);
  }

  private find(id: string): Message | undefined {
    return this.allMessages().find((m) => m.id === id);
  }

  private persist(messages: Message[]): void {
    let list = messages.slice(-LIMITS.historySize);
    // 圖片很佔空間：存不下時，從最舊的開始丟掉
    while (!writeJson(KEY_MESSAGES, list) && list.length > 1) list = list.slice(1);
  }

  /** 寫進「資料庫」並通知所有人（包含其他分頁） */
  private publish(message: Message): Message {
    const list = this.allMessages();
    list.push(message);
    this.persist(list);
    this.post({ kind: 'message.new', message });
    this.emit({ type: 'message.new', message });
    return message;
  }

  private update(message: Message): void {
    const list = this.allMessages().map((m) => (m.id === message.id ? message : m));
    this.persist(list);
    this.post({ kind: 'message.updated', message });
    this.emit({ type: 'message.updated', message });
  }

  /** 檢舉人數達門檻就把訊息遮住 */
  private applyReports(messageId: string): void {
    const msg = this.find(messageId);
    if (!msg || msg.status !== 'normal') return;
    const count = (readJson<Record<string, string[]>>(KEY_REPORTS, {})[messageId] ?? []).length;
    if (count >= LIMITS.reportHideAt) this.update({ ...msg, status: 'hidden' });
  }

  // ---------- 在線名單 ----------

  private registry(): Record<string, PresenceEntry> {
    return readJson<Record<string, PresenceEntry>>(KEY_PRESENCE, {});
  }

  private pruneRegistry(): void {
    const now = Date.now();
    const reg = this.registry();
    let changed = false;
    for (const [id, e] of Object.entries(reg)) {
      if (id !== this.userId && now - e.lastSeen > STALE_MS) {
        delete reg[id];
        changed = true;
      }
    }
    if (changed) writeJson(KEY_PRESENCE, reg);
  }

  private registerPresence(): void {
    if (!this.me) return;
    const reg = this.registry();
    reg[this.userId] = { nickname: this.me.nickname, joinedAt: this.me.joinedAt, lastSeen: Date.now() };
    writeJson(KEY_PRESENCE, reg);
  }

  private unregisterPresence(): void {
    const reg = this.registry();
    if (this.userId in reg) {
      delete reg[this.userId];
      writeJson(KEY_PRESENCE, reg);
      this.post({ kind: 'presence' });
    }
  }

  private otherHumans(): OnlineUser[] {
    const now = Date.now();
    return Object.entries(this.registry())
      .filter(([id, e]) => id !== this.userId && now - e.lastSeen <= STALE_MS)
      .map(([userId, e]) => ({ userId, nickname: e.nickname, joinedAt: e.joinedAt }));
  }

  private allOnline(humans = this.otherHumans()): OnlineUser[] {
    const me: OnlineUser[] = this.me
      ? [{ userId: this.userId, nickname: this.me.nickname, joinedAt: this.me.joinedAt }]
      : [];
    return [...me, ...humans, ...this.botsOnline.values()].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  }

  /** 比對其他分頁的名單，算出誰進來、誰離開 */
  private syncHumans(): void {
    if (!this.me) return;
    const now = new Map(this.otherHumans().map((u) => [u.userId, u]));
    for (const [id, u] of now) {
      if (!this.knownHumans.has(id)) this.emit({ type: 'presence.joined', user: u });
    }
    for (const [id, u] of this.knownHumans) {
      if (!now.has(id)) this.emit({ type: 'presence.left', user: u });
    }
    this.knownHumans = now;
  }

  private startHeartbeat(): void {
    window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = window.setInterval(() => {
      this.registerPresence();
      this.pruneRegistry();
      this.syncHumans();
    }, HEARTBEAT_MS);
  }

  // ---------- 機器人 ----------

  private startBots(): void {
    this.botTimers.forEach((t) => window.clearTimeout(t));
    this.botTimers = [];
    this.botsOnline.clear();
    const base = Date.now() - 3_600_000;
    // 一開始有兩個機器人在線
    for (const bot of BOTS.slice(0, 2)) {
      this.botsOnline.set(bot.id, {
        userId: bot.id,
        nickname: bot.nickname,
        joinedAt: new Date(base + this.botsOnline.size * 1000).toISOString(),
      });
    }
    this.scheduleBotChat();
    this.scheduleBotPresence();
  }

  private scheduleBotChat(): void {
    this.botTimers.push(
      window.setTimeout(() => {
        const online = [...this.botsOnline.values()];
        const speaker = online[Math.floor(Math.random() * online.length)];
        if (speaker && this.me) {
          const text = BOT_LINES[Math.floor(Math.random() * BOT_LINES.length)]!;
          this.publish({
            id: crypto.randomUUID(),
            senderId: speaker.userId,
            nickname: speaker.nickname,
            kind: 'text',
            text,
            image: null,
            createdAt: new Date().toISOString(),
            status: 'normal',
          });
        }
        this.scheduleBotChat();
      }, rand(18_000, 40_000)),
    );
  }

  private scheduleBotPresence(): void {
    this.botTimers.push(
      window.setTimeout(() => {
        const bot = BOTS[2 + Math.floor(Math.random() * (BOTS.length - 2))]!;
        const existing = this.botsOnline.get(bot.id);
        if (existing) {
          this.botsOnline.delete(bot.id);
          this.emit({ type: 'presence.left', user: existing });
        } else {
          const user: OnlineUser = { userId: bot.id, nickname: bot.nickname, joinedAt: new Date().toISOString() };
          this.botsOnline.set(bot.id, user);
          this.emit({ type: 'presence.joined', user });
        }
        this.scheduleBotPresence();
      }, rand(30_000, 60_000)),
    );
  }

  // ---------- 斷線情境 ----------

  /** ?mock=offline：進入 4 秒後「斷線」8 秒，再恢復 */
  private runOfflineScenario(): void {
    this.offlineTimers.forEach((t) => window.clearTimeout(t));
    const set = (status: ConnectionStatus) => this.emit({ type: 'connection.status', status });
    this.offlineTimers = [
      window.setTimeout(() => set('reconnecting'), 4_000),
      window.setTimeout(() => {
        set('connected');
        this.emit({ type: 'presence.sync', users: this.allOnline() });
      }, 12_000),
    ];
  }

  private stopTimers(): void {
    window.clearInterval(this.heartbeatTimer);
    this.botTimers.forEach((t) => window.clearTimeout(t));
    this.offlineTimers.forEach((t) => window.clearTimeout(t));
    this.botTimers = [];
    this.offlineTimers = [];
  }

  // ---------- 事件與分頁之間的通訊 ----------

  private emit(event: ChatEvent): void {
    this.listeners.forEach((l) => l(event));
  }

  private post(wire: Wire): void {
    this.channel?.postMessage(wire);
  }

  private onWire(wire: Wire): void {
    if (!this.me) return;
    if (wire.kind === 'presence') this.syncHumans();
    else if (wire.kind === 'message.new') this.emit({ type: 'message.new', message: wire.message });
    else this.emit({ type: 'message.updated', message: wire.message });
  }
}
