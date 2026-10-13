// 資料格式。對應 docs/architecture.md 第 5 節「通訊約定」。

/** 一則訊息 */
export interface Message {
  id: string;
  /** 發送者的匿名身分識別碼，用來判斷是不是「我」。畫面不顯示它 */
  userId: string;
  /** 發送當下的代號 */
  nickname: string;
  /** 文字內容；沒有文字時為空字串。被刪除的訊息一定是空字串 */
  text: string;
  imageUrl: string | null;
  /** 以下全是 ISO 8601 時間字串 */
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

/** 線上的一個人 */
export interface OnlineUser {
  userId: string;
  nickname: string;
}

/** 「從哪一則開始往前讀」的位置 */
export interface Cursor {
  createdAt: string;
  id: string;
}

export type ClaimResult = 'ok' | 'taken' | 'invalid';

export type ConnectionState = 'connected' | 'reconnecting';

export interface SendInput {
  text?: string;
  image?: File;
}

export type Unsubscribe = () => void;

/** 後端會主動通知畫面的事件，名稱與內容見 docs/architecture.md 5.2 */
export interface ChatEvents {
  'message:new': Message;
  'message:updated': Message;
  'presence:changed': OnlineUser[];
  'presence:joined': { nickname: string };
  'presence:left': { nickname: string };
  'connection:changed': ConnectionState;
}
