import type {
  ChatEvents,
  ClaimResult,
  Cursor,
  Message,
  SendInput,
  Unsubscribe,
} from '../types';

/**
 * 通訊接頭：畫面與後端之間唯一的出入口。
 *
 * 畫面只認這份規格，不認識 Supabase。階段一接「模擬器」，階段二接「Supabase 版」，
 * 兩邊都照這份規格實作，畫面就一行都不用改。（見 docs/architecture.md 第 4、5 節）
 *
 * 失敗時一律丟出 ChatError（錯誤名稱見 errors.ts）。
 */
export interface ChatService {
  // ---- 身分與代號 ----
  /** 取得匿名身分。瀏覽器以前來過就沿用同一個 */
  start(): Promise<{ userId: string }>;
  /** 登記（或續約）代號。同一個人重複登記自己的代號會成功 */
  claimNickname(name: string): Promise<ClaimResult>;
  releaseNickname(): Promise<void>;
  /**
   * 離開線上名單，但「保留」代號（換代號時用）：
   * 人還在輸入代號的畫面，別人的名單上不該再看到他在線；
   * 舊代號要保留到新代號登記成功為止，免得新代號被占用時舊代號被搶走。
   * 之後再次登記成功（claimNickname 回傳 ok），就會重新出現在名單上。
   */
  leavePresence(): Promise<void>;

  // ---- 讀取訊息（結果都是由舊到新） ----
  loadLatest(limit: number): Promise<Message[]>;
  /** 讀比 before 更舊的訊息 */
  loadOlder(before: Cursor, limit: number): Promise<Message[]>;
  /** 讀「updatedAt 在這個時間之後」的訊息，斷線重連補資料用（包含被編輯、被刪除的） */
  loadChangedSince(since: string): Promise<Message[]>;

  // ---- 寫入訊息 ----
  sendMessage(input: SendInput): Promise<void>;
  editMessage(id: string, text: string): Promise<void>;
  deleteMessage(id: string): Promise<void>;

  // ---- 事件訂閱，回傳取消訂閱的函式 ----
  /**
   * 'presence:changed' 與 'connection:changed' 是「狀態」，
   * 訂閱的當下會立刻收到一次目前的值，畫面不必另外查詢。
   */
  on<K extends keyof ChatEvents>(
    event: K,
    callback: (payload: ChatEvents[K]) => void,
  ): Unsubscribe;

  /** 圖片的下載網址（階段二的 Storage 需要特殊的下載參數，所以由接頭決定） */
  imageDownloadUrl(imageUrl: string): string;
}
