import { ChatError } from '../../errors';
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MAX_TEXT_LENGTH,
  NICKNAME_PATTERN,
  RATE_LIMIT_COUNT,
  RATE_LIMIT_WINDOW_MS,
} from '../../limits';
import type {
  ChatEvents,
  ClaimResult,
  ConnectionState,
  Cursor,
  Message,
  OnlineUser,
  SendInput,
  Unsubscribe,
} from '../../types';
import { compareMessages } from '../../utils/messages';
import { charCount } from '../../utils/text';
import type { ChatService } from '../ChatService';
import {
  ALL_BOTS,
  ALWAYS_ONLINE,
  INITIAL_ONLINE,
  PHRASES,
  createHistory,
  sampleImage,
} from './mockData';

/** 階段一用的遙控器：讓你不用等隨機事件，就能測試各種畫面狀態（網址加 ?debug 才會出現） */
export interface MockControls {
  setOffline(offline: boolean): void;
  isOffline(): boolean;
  /** 假的人連說 count 句話 */
  botSay(count?: number): void;
  botJoin(): void;
  botLeave(): void;
}

const USER_ID_KEY = 'chat.userId';
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);

function loadOrCreateUserId(): string {
  try {
    const saved = localStorage.getItem(USER_ID_KEY);
    if (saved) return saved;
    const created = `u_${crypto.randomUUID()}`;
    localStorage.setItem(USER_ID_KEY, created);
    return created;
  } catch {
    return `u_${crypto.randomUUID()}`;
  }
}

/**
 * 模擬器：所有資料都在瀏覽器的記憶體裡，並由程式扮演「其他人」。
 * 遵守與真實後端相同的規則（代號、長度、大小、頻率、只能改自己的），
 * 所以畫面在階段一就能完整測試。重新整理網頁後，模擬的世界會重來。
 */
export function createMockChatService(): ChatService & { controls: MockControls } {
  const store: Message[] = createHistory();
  const listeners = new Map<keyof ChatEvents, Set<(payload: unknown) => void>>();
  const onlineBots = new Set<string>(INITIAL_ONLINE);
  const sentAt: number[] = [];

  let userId = '';
  let nickname: string | null = null;
  /** 有代號，而且人在聊天室裡（換代號時代號保留，但人不在名單上） */
  let inRoom = false;
  let offline = false;
  let lastCreated = Date.now();
  let started = false;

  // ---------- 事件 ----------
  function emit<K extends keyof ChatEvents>(event: K, payload: ChatEvents[K]): void {
    // 斷線時收不到任何推送；連線狀態本身例外
    if (offline && event !== 'connection:changed') return;
    listeners.get(event)?.forEach((cb) => cb(payload));
  }

  function connectionState(): ConnectionState {
    return offline ? 'reconnecting' : 'connected';
  }

  function onlineUsers(): OnlineUser[] {
    const list: OnlineUser[] = [];
    if (nickname && inRoom) list.push({ userId, nickname });
    for (const name of ALL_BOTS) {
      if (onlineBots.has(name)) list.push({ userId: `bot:${name}`, nickname: name });
    }
    return list;
  }

  function emitPresence(): void {
    emit('presence:changed', onlineUsers());
  }

  // ---------- 訊息 ----------
  function nextTimestamp(): string {
    lastCreated = Math.max(Date.now(), lastCreated + 1);
    return new Date(lastCreated).toISOString();
  }

  function addMessage(from: { userId: string; nickname: string }, text: string, imageUrl: string | null): Message {
    const at = nextTimestamp();
    const message: Message = {
      id: `m_${at}_${Math.random().toString(36).slice(2, 8)}`,
      userId: from.userId,
      nickname: from.nickname,
      text,
      imageUrl,
      createdAt: at,
      updatedAt: at,
      editedAt: null,
      deletedAt: null,
    };
    store.push(message);
    emit('message:new', message);
    return message;
  }

  function replaceMessage(index: number, patch: Partial<Message>): Message {
    const updated = { ...store[index]!, ...patch, updatedAt: nextTimestamp() };
    store[index] = updated;
    emit('message:updated', updated);
    return updated;
  }

  function findOwn(id: string): number {
    const index = store.findIndex((m) => m.id === id);
    const message = store[index];
    if (!message || message.userId !== userId || message.deletedAt) throw new ChatError('not_owner');
    return index;
  }

  // ---------- 假的人 ----------
  function botSayOnce(): void {
    const names = [...onlineBots];
    if (names.length === 0) return;
    const name = names[Math.floor(Math.random() * names.length)]!;
    const withImage = Math.random() < 0.1;
    addMessage(
      { userId: `bot:${name}`, nickname: name },
      withImage ? '' : PHRASES[Math.floor(Math.random() * PHRASES.length)]!,
      withImage ? sampleImage(Math.floor(Math.random() * 100)) : null,
    );
  }

  function botJoin(): void {
    const candidates = ALL_BOTS.filter(
      (n) => !onlineBots.has(n) && n.toLowerCase() !== nickname?.toLowerCase(),
    );
    if (candidates.length === 0) return;
    const name = candidates[Math.floor(Math.random() * candidates.length)]!;
    onlineBots.add(name);
    emit('presence:joined', { nickname: name });
    emitPresence();
  }

  function botLeave(): void {
    const candidates = [...onlineBots].filter((n) => !ALWAYS_ONLINE.includes(n));
    if (candidates.length === 0) return;
    const name = candidates[Math.floor(Math.random() * candidates.length)]!;
    onlineBots.delete(name);
    emit('presence:left', { nickname: name });
    emitPresence();
  }

  function startBots(): void {
    if (started) return;
    started = true;
    const talk = () => {
      botSayOnce();
      setTimeout(talk, randomBetween(7_000, 16_000));
    };
    const churn = () => {
      if (onlineBots.size > 6 && Math.random() < 0.5) botLeave();
      else botJoin();
      setTimeout(churn, randomBetween(20_000, 45_000));
    };
    setTimeout(talk, randomBetween(4_000, 8_000));
    setTimeout(churn, randomBetween(15_000, 30_000));
  }

  // ---------- 規則檢查 ----------
  function requireOnline(): void {
    if (offline) throw new ChatError('network');
  }

  function checkText(text: string): void {
    if (charCount(text) > MAX_TEXT_LENGTH) throw new ChatError('too_long');
  }

  function checkRate(): void {
    const now = Date.now();
    while (sentAt.length > 0 && now - sentAt[0]! > RATE_LIMIT_WINDOW_MS) sentAt.shift();
    if (sentAt.length >= RATE_LIMIT_COUNT) throw new ChatError('rate_limited');
  }

  // ---------- 對外的介面 ----------
  const service: ChatService = {
    async start() {
      userId = loadOrCreateUserId();
      startBots();
      return { userId };
    },

    async claimNickname(name: string): Promise<ClaimResult> {
      await delay(150);
      requireOnline();
      if (!NICKNAME_PATTERN.test(name)) return 'invalid';
      const key = name.toLowerCase();
      for (const bot of onlineBots) if (bot.toLowerCase() === key) return 'taken';
      nickname = name;
      inRoom = true;
      emitPresence();
      return 'ok';
    },

    async releaseNickname() {
      nickname = null;
      inRoom = false;
      emitPresence();
    },

    async leavePresence() {
      inRoom = false;
      emitPresence();
    },

    async loadLatest(limit) {
      await delay(250);
      requireOnline();
      return store.slice(-limit);
    },

    async loadOlder(before: Cursor, limit) {
      await delay(500);
      requireOnline();
      let end = store.findIndex((m) => compareMessages(m, before) >= 0);
      if (end === -1) end = store.length;
      return store.slice(Math.max(0, end - limit), end);
    },

    async loadChangedSince(since) {
      await delay(200);
      requireOnline();
      return store.filter((m) => m.updatedAt > since);
    },

    async sendMessage(input: SendInput) {
      await delay(150);
      requireOnline();
      if (!nickname) throw new ChatError('not_joined');
      const text = (input.text ?? '').trim();
      if (!text && !input.image) throw new ChatError('empty');
      checkText(text);
      if (input.image) {
        if (input.image.size > MAX_IMAGE_BYTES) throw new ChatError('image_too_large');
        if (!ALLOWED_IMAGE_TYPES.includes(input.image.type)) throw new ChatError('image_type_not_allowed');
      }
      checkRate();
      sentAt.push(Date.now());
      // 階段一：圖片只留在瀏覽器記憶體裡，不真的上傳
      const imageUrl = input.image ? URL.createObjectURL(input.image) : null;
      addMessage({ userId, nickname }, text, imageUrl);
    },

    async editMessage(id, text) {
      await delay(150);
      requireOnline();
      const trimmed = text.trim();
      if (!trimmed) throw new ChatError('empty');
      checkText(trimmed);
      const index = findOwn(id);
      replaceMessage(index, { text: trimmed, editedAt: new Date().toISOString() });
    },

    async deleteMessage(id) {
      await delay(150);
      requireOnline();
      const index = findOwn(id);
      replaceMessage(index, { text: '', imageUrl: null, deletedAt: new Date().toISOString() });
    },

    on<K extends keyof ChatEvents>(event: K, callback: (payload: ChatEvents[K]) => void): Unsubscribe {
      const cb = callback as (payload: unknown) => void;
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(cb);
      // 「狀態」類的事件，訂閱當下先給一次目前的值
      if (event === 'presence:changed') cb(onlineUsers());
      if (event === 'connection:changed') cb(connectionState());
      return () => {
        set.delete(cb);
      };
    },

    imageDownloadUrl(imageUrl) {
      return imageUrl;
    },
  };

  const controls: MockControls = {
    setOffline(next) {
      if (offline === next) return;
      offline = next;
      emit('connection:changed', connectionState());
      // 恢復連線時，先前被丟掉的推送由畫面用 loadChangedSince 補回來；名單則直接重送
      if (!offline) emitPresence();
    },
    isOffline: () => offline,
    botSay(count = 1) {
      for (let i = 0; i < count; i++) botSayOnce();
    },
    botJoin,
    botLeave,
  };

  return Object.assign(service, { controls });
}
