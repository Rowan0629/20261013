import { MAX_TEXT_LENGTH } from './limits';

/** 失敗原因的名稱。對應 docs/architecture.md 5.5 */
export type ChatErrorCode =
  | 'nickname_taken'
  | 'nickname_invalid'
  | 'too_long'
  | 'empty'
  | 'image_too_large'
  | 'image_type_not_allowed'
  | 'rate_limited'
  | 'not_owner'
  | 'not_joined'
  | 'network';

export class ChatError extends Error {
  readonly code: ChatErrorCode;
  constructor(code: ChatErrorCode) {
    super(code);
    this.name = 'ChatError';
    this.code = code;
  }
}

const TEXTS: Record<ChatErrorCode, string> = {
  nickname_taken: '這個代號有人在用，請換一個',
  nickname_invalid: '代號只能用 1–12 個中文、英文或數字',
  too_long: `訊息太長了，最多 ${MAX_TEXT_LENGTH} 字`,
  empty: '請先輸入內容',
  image_too_large: '圖片太大了，請選 5 MB 以內的圖片',
  image_type_not_allowed: '不支援這種圖片，請選 JPG、PNG、GIF 或 WebP',
  rate_limited: '送太快了，請稍等一下再送',
  not_owner: '只能修改自己的訊息',
  not_joined: '請先輸入代號再發言',
  network: '連線中斷，請稍後再試',
};

export function errorText(code: ChatErrorCode): string {
  return TEXTS[code];
}

/** 把任何錯誤轉成給使用者看的一句話 */
export function describeError(error: unknown): string {
  return errorText(error instanceof ChatError ? error.code : 'network');
}
