import { MAX_TEXT_LENGTH, NICKNAME_PATTERN } from '../../limits';
import type { Message } from '../../types';
import { charCount } from '../../utils/text';

// 收到「別人的」訊息時的檢查（見 docs/architecture.md 9.5）。
// 資料庫已經有同樣的限制，這裡是第二道防線：就算後端出錯、被人繞過、或收到格式奇怪的資料，
// 畫面也不會被它弄壞，更不會去載入不是我們自己圖片倉庫的圖片。

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 圖片路徑一定是「發送者的編號/隨機編號.副檔名」，和資料庫 send_message 的規則一致 */
const IMAGE_PATH = /^([0-9a-f-]{36})\/[0-9a-f-]{36}\.(jpg|png|gif|webp)$/i;

export interface ParseOptions {
  /** 由圖片路徑組出完整網址（通常是 Supabase Storage 的公開網址） */
  imageUrlOf: (imagePath: string) => string;
  /** 合法圖片網址的開頭，也就是「我們自己的 Storage 網域與倉庫」 */
  imageUrlPrefix: string;
  /** 訊息被丟掉時通知一聲（原因是給開發者看的） */
  onReject?: (reason: string) => void;
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isTime = (value: unknown): value is string => isString(value) && !Number.isNaN(Date.parse(value));
const isTimeOrNull = (value: unknown): value is string | null => value === null || isTime(value);

/**
 * 檢查一列從資料庫（或即時推送）來的訊息，通過就轉成畫面用的 Message；
 * 任何一項不合格就回傳 null（呼叫的人要把它丟掉）。
 */
export function parseMessageRow(raw: unknown, options: ParseOptions): Message | null {
  const reject = (reason: string): null => {
    options.onReject?.(reason);
    return null;
  };

  if (typeof raw !== 'object' || raw === null) return reject('不是物件');
  const row = raw as Record<string, unknown>;

  if (!isString(row.id) || !UUID.test(row.id)) return reject('id 不是合法的編號');
  if (!isString(row.user_id) || !UUID.test(row.user_id)) return reject('user_id 不是合法的編號');
  if (!isString(row.nickname) || !NICKNAME_PATTERN.test(row.nickname)) return reject('代號格式不合');
  if (!isString(row.content)) return reject('content 不是文字');
  if (charCount(row.content) > MAX_TEXT_LENGTH) return reject('文字超過長度上限');
  if (!isTime(row.created_at) || !isTime(row.updated_at)) return reject('建立或更新時間不合法');
  if (!isTimeOrNull(row.edited_at) || !isTimeOrNull(row.deleted_at)) return reject('編輯或刪除時間不合法');

  let imageUrl: string | null = null;
  if (row.image_path !== null && row.image_path !== undefined) {
    if (!isString(row.image_path)) return reject('image_path 不是文字');
    const match = IMAGE_PATH.exec(row.image_path);
    if (!match) return reject('圖片路徑格式不合');
    // 圖片必須放在「發送者自己的資料夾」
    if (match[1]!.toLowerCase() !== row.user_id.toLowerCase()) return reject('圖片不在發送者自己的資料夾');
    imageUrl = options.imageUrlOf(row.image_path);
    if (!isFromOwnStorage(imageUrl, options.imageUrlPrefix)) return reject('圖片網址不是來自自己的圖片倉庫');
  }

  return {
    id: row.id,
    userId: row.user_id,
    nickname: row.nickname,
    text: row.content,
    imageUrl,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    editedAt: row.edited_at === null ? null : new Date(row.edited_at).toISOString(),
    deletedAt: row.deleted_at === null ? null : new Date(row.deleted_at).toISOString(),
  };
}

/** 網址必須是 https（或同一個開頭）、網域與路徑開頭都等於我們自己的圖片倉庫，不能帶帳號密碼或奇怪的轉址 */
function isFromOwnStorage(url: string, prefix: string): boolean {
  try {
    const target = new URL(url);
    const base = new URL(prefix);
    if (target.origin !== base.origin) return false;
    if (target.username || target.password) return false;
    return target.pathname.startsWith(base.pathname) && !target.pathname.includes('..');
  } catch {
    return false;
  }
}
