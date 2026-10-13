import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from '@supabase/supabase-js';
import { ChatError, type ChatErrorCode } from '../../errors';
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from '../../limits';
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
import type { ChatService } from '../ChatService';

const BUCKET = 'chat-images';
/** 代號是「租」的（租期 60 秒），每 20 秒續租一次。見 docs/architecture.md 6.4 */
const HEARTBEAT_MS = 20_000;
/** PostgREST 一次最多回 1000 列 */
const PAGE = 1000;
const MAX_CATCH_UP_PAGES = 10;

const IMAGE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/** messages 資料表的一列（欄位名稱和 supabase/migrations 裡的一致） */
interface MessageRow {
  id: string;
  user_id: string;
  nickname: string;
  content: string;
  image_path: string | null;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

const toIso = (value: string | null): string | null =>
  value === null ? null : new Date(value).toISOString();

/** 資料庫守門函式丟出的錯誤字眼 → 畫面用的錯誤名稱（見 docs/architecture.md 5.5） */
const DB_ERRORS: Record<string, ChatErrorCode> = {
  not_joined: 'not_joined',
  too_long: 'too_long',
  empty: 'empty',
  rate_limited: 'rate_limited',
  not_owner: 'not_owner',
  invalid_image: 'image_type_not_allowed',
};

function toChatError(error: { message?: string } | null): ChatError {
  return new ChatError(DB_ERRORS[error?.message ?? ''] ?? 'network');
}

function toUploadError(error: { message?: string }): ChatError {
  const text = error.message ?? '';
  if (/size|large|exceed/i.test(text)) return new ChatError('image_too_large');
  if (/mime|type|not supported/i.test(text)) return new ChatError('image_type_not_allowed');
  return new ChatError('network');
}

export interface SupabaseConfig {
  url: string;
  publishableKey: string;
}

/**
 * Supabase 版的通訊接頭：照 ChatService 的規格實作，畫面完全不知道它的存在。
 * 對應關係見 docs/architecture.md 第 3.2 節：
 *   身分 = 匿名登入；訊息 = 資料庫 + Postgres Changes；線上名單 = Presence；圖片 = Storage。
 * 所有「寫入」都走資料庫裡的守門函式（supabase/migrations），這裡不做任何信任前端的事。
 */
export function createSupabaseChatService(config: SupabaseConfig): ChatService {
  const client: SupabaseClient = createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });

  const listeners = new Map<keyof ChatEvents, Set<(payload: unknown) => void>>();
  /** 訊息 id → 圖片路徑；刪除訊息時要用它順便刪掉圖片檔 */
  const imagePaths = new Map<string, string>();

  let userId = '';
  let accessToken = '';
  let nickname: string | null = null;
  let channel: RealtimeChannel | null = null;
  let heartbeat: number | undefined;
  let starting: Promise<{ userId: string }> | null = null;

  let online: OnlineUser[] = [];
  let presenceReady = false;
  let channelReady = true;
  let browserOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
  let connection: ConnectionState = 'connected';
  let markSubscribed: () => void = () => undefined;
  const subscribed = new Promise<void>((resolve) => {
    markSubscribed = resolve;
  });

  // ---------- 事件 ----------
  function emit<K extends keyof ChatEvents>(event: K, payload: ChatEvents[K]): void {
    listeners.get(event)?.forEach((callback) => callback(payload));
  }

  function updateConnection(): void {
    const next: ConnectionState = channelReady && browserOnline ? 'connected' : 'reconnecting';
    if (next === connection) return;
    connection = next;
    emit('connection:changed', connection);
  }

  // ---------- 資料轉換 ----------
  function toMessage(row: MessageRow): Message {
    if (row.image_path) imagePaths.set(row.id, row.image_path);
    return {
      id: row.id,
      userId: row.user_id,
      nickname: row.nickname,
      text: row.content,
      imageUrl: row.image_path
        ? client.storage.from(BUCKET).getPublicUrl(row.image_path).data.publicUrl
        : null,
      createdAt: toIso(row.created_at)!,
      updatedAt: toIso(row.updated_at)!,
      editedAt: toIso(row.edited_at),
      deletedAt: toIso(row.deleted_at),
    };
  }

  // ---------- 線上名單（Presence） ----------
  function readPresence(): OnlineUser[] {
    if (!channel) return [];
    const list: OnlineUser[] = [];
    for (const [key, metas] of Object.entries(channel.presenceState<{ nickname?: string }>())) {
      const name = metas[0]?.nickname;
      if (name) list.push({ userId: key, nickname: name });
    }
    // 自己排第一，其他人依代號排序，名單才不會一直跳動
    return list.sort((a, b) =>
      a.userId === userId ? -1 : b.userId === userId ? 1 : a.nickname.localeCompare(b.nickname, 'zh-Hant'),
    );
  }

  // ---------- 代號租約 ----------
  function stopHeartbeat(): void {
    if (heartbeat !== undefined) window.clearInterval(heartbeat);
    heartbeat = undefined;
  }

  /** 續租。如果代號已被別人登記走，就放手（下次發言時畫面會得到 not_joined） */
  async function renewClaim(): Promise<void> {
    if (!nickname) return;
    try {
      const { data, error } = await client.rpc('claim_nickname', { p_name: nickname });
      if (error) return; // 網路不好，下一輪再試
      if (data !== 'ok') {
        nickname = null;
        stopHeartbeat();
        void channel?.untrack();
      } else if (channelReady) {
        void channel?.track({ nickname });
      }
    } catch {
      /* 下一輪再試 */
    }
  }

  function startHeartbeat(): void {
    stopHeartbeat();
    heartbeat = window.setInterval(() => void renewClaim(), HEARTBEAT_MS);
  }

  /** 呼叫守門函式；如果租約剛好過期（手機放背景太久）就自動重新登記一次再試 */
  async function callRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    let result = await client.rpc(name, args);
    if (result.error?.message === 'not_joined' && nickname) {
      const claim = await client.rpc('claim_nickname', { p_name: nickname });
      if (claim.data === 'ok') {
        result = await client.rpc(name, args);
      } else {
        nickname = null;
        stopHeartbeat();
      }
    }
    if (result.error) throw toChatError(result.error);
    return result.data as T;
  }

  // ---------- 啟動：取得匿名身分、連上即時通道 ----------
  async function init(): Promise<{ userId: string }> {
    let session = (await client.auth.getSession()).data.session;

    if (session) {
      // 確認這個身分在伺服器上還有效（例如專案裡的使用者被刪除過）
      const { error } = await client.auth.getUser();
      if (error) {
        if (error.name === 'AuthRetryableFetchError') throw new ChatError('network');
        await client.auth.signOut();
        session = null;
      }
    }
    if (!session) {
      const { data, error } = await client.auth.signInAnonymously();
      if (error || !data.session) throw new ChatError('network');
      session = data.session;
    }

    userId = session.user.id;
    accessToken = session.access_token;
    client.auth.onAuthStateChange((_event, next) => {
      if (next) accessToken = next.access_token;
    });

    channel = client
      .channel('chat-room', { config: { presence: { key: userId } } })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) =>
        emit('message:new', toMessage(payload.new as MessageRow)),
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (payload) =>
        emit('message:updated', toMessage(payload.new as MessageRow)),
      )
      .on('presence', { event: 'sync' }, () => {
        presenceReady = true; // 第一次同步完成後，才開始顯示「某某進入／離開」
        online = readPresence();
        emit('presence:changed', online);
      })
      .on('presence', { event: 'join' }, ({ key, currentPresences, newPresences }) => {
        // 同一個人開第二個分頁不算「進入」；剛連上時對既有的人也不要跳提示
        if (!presenceReady || key === userId || currentPresences.length > 0) return;
        const name = (newPresences[0] as { nickname?: string } | undefined)?.nickname;
        if (name) emit('presence:joined', { nickname: name });
      })
      .on('presence', { event: 'leave' }, ({ key, currentPresences, leftPresences }) => {
        if (!presenceReady || key === userId || currentPresences.length > 0) return;
        const name = (leftPresences[0] as { nickname?: string } | undefined)?.nickname;
        if (name) emit('presence:left', { nickname: name });
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          channelReady = true;
          markSubscribed();
          if (nickname) void channel?.track({ nickname }); // 斷線重連後，重新宣告自己在線上
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          channelReady = false;
        }
        updateConnection();
      });

    window.addEventListener('online', () => {
      browserOnline = true;
      updateConnection();
    });
    window.addEventListener('offline', () => {
      browserOnline = false;
      updateConnection();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void renewClaim(); // 手機放背景時計時器會變慢，回來馬上續租
    });
    // 關掉分頁時，盡力讓代號馬上釋放（keepalive 讓請求在頁面關閉後仍能送出）
    window.addEventListener('pagehide', () => {
      if (!nickname || !accessToken) return;
      void fetch(`${config.url}/rest/v1/rpc/release_nickname`, {
        method: 'POST',
        keepalive: true,
        headers: {
          apikey: config.publishableKey,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      }).catch(() => undefined);
    });

    return { userId };
  }

  // ---------- 對外的介面 ----------
  return {
    start() {
      starting ??= init().catch((error) => {
        starting = null; // 讓下一次呼叫可以重試
        throw error;
      });
      return starting;
    },

    async claimNickname(name): Promise<ClaimResult> {
      const { data, error } = await client.rpc('claim_nickname', { p_name: name });
      if (error) throw toChatError(error);
      if (data === 'ok') {
        nickname = name;
        await Promise.race([subscribed, new Promise((resolve) => setTimeout(resolve, 5000))]);
        void channel?.track({ nickname: name });
        startHeartbeat();
      }
      return data as ClaimResult;
    },

    async releaseNickname() {
      nickname = null;
      stopHeartbeat();
      void channel?.untrack();
      await client.rpc('release_nickname');
    },

    async loadLatest(limit) {
      const { data, error } = await client
        .from('messages')
        .select('*')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit);
      if (error) throw toChatError(error);
      return (data as MessageRow[]).map(toMessage).reverse();
    },

    async loadOlder(before: Cursor, limit) {
      const { data, error } = await client
        .from('messages')
        .select('*')
        .or(
          `created_at.lt.${before.createdAt},and(created_at.eq.${before.createdAt},id.lt.${before.id})`,
        )
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit);
      if (error) throw toChatError(error);
      return (data as MessageRow[]).map(toMessage).reverse();
    },

    async loadChangedSince(since) {
      const out: Message[] = [];
      for (let page = 0; page < MAX_CATCH_UP_PAGES; page++) {
        const { data, error } = await client
          .from('messages')
          .select('*')
          .gte('updated_at', since) // 用「大於等於」，同一毫秒內的變動才不會漏掉；重複的由畫面去重
          .order('updated_at', { ascending: true })
          .order('id', { ascending: true })
          .range(page * PAGE, page * PAGE + PAGE - 1);
        if (error) throw toChatError(error);
        const rows = data as MessageRow[];
        out.push(...rows.map(toMessage));
        if (rows.length < PAGE) break;
      }
      return out;
    },

    async sendMessage(input: SendInput) {
      let imagePath: string | null = null;
      if (input.image) {
        if (input.image.size > MAX_IMAGE_BYTES) throw new ChatError('image_too_large');
        if (!ALLOWED_IMAGE_TYPES.includes(input.image.type)) throw new ChatError('image_type_not_allowed');
        imagePath = `${userId}/${crypto.randomUUID()}.${IMAGE_EXT[input.image.type]}`;
        const { error } = await client.storage.from(BUCKET).upload(imagePath, input.image, {
          contentType: input.image.type,
          cacheControl: '31536000',
        });
        if (error) throw toUploadError(error);
      }
      try {
        const row = await callRpc<MessageRow>('send_message', {
          p_text: (input.text ?? '').trim(),
          p_image_path: imagePath,
        });
        emit('message:new', toMessage(row)); // 即時推送也會送一份，畫面會自動去重
      } catch (error) {
        // 訊息沒送成功，就把剛上傳的圖片收回來，不留垃圾檔
        if (imagePath) void client.storage.from(BUCKET).remove([imagePath]);
        throw error;
      }
    },

    async editMessage(id, text) {
      const row = await callRpc<MessageRow>('edit_message', { p_id: id, p_text: text.trim() });
      emit('message:updated', toMessage(row));
    },

    async deleteMessage(id) {
      const imagePath = imagePaths.get(id);
      const row = await callRpc<MessageRow>('delete_message', { p_id: id });
      emit('message:updated', toMessage(row));
      // 順便刪掉圖片檔（盡力而為，失敗不影響訊息已被刪除）
      if (imagePath) {
        imagePaths.delete(id);
        void client.storage.from(BUCKET).remove([imagePath]);
      }
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
      if (event === 'presence:changed') cb(online);
      if (event === 'connection:changed') cb(connection);
      return () => {
        set.delete(cb);
      };
    },

    imageDownloadUrl(imageUrl) {
      // Supabase 的公開網址加上 download 參數，瀏覽器就會下載而不是開啟
      const name = imageUrl.split('/').pop()?.split('?')[0] ?? 'image';
      return `${imageUrl}?download=${encodeURIComponent(name)}`;
    },
  };
}
