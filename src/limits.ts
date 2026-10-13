// 各種上限。階段二的後端（資料庫、圖片倉庫）要設成同樣的數字，畫面這邊只負責貼心提示。
export const APP_TITLE = '匿名聊天室';

export const NICKNAME_MAX = 12;
export const NICKNAME_PATTERN = /^[一-鿿A-Za-z0-9]{1,12}$/;

export const MAX_TEXT_LENGTH = 500;
/** 剩餘字數少於等於這個數字時，輸入區才顯示「還剩 N 字」 */
export const COUNTER_SHOW_AT = 50;

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

/** 一次載入幾則歷史訊息 */
export const PAGE_SIZE = 50;

/** 頻率限制：同一個人在 WINDOW 毫秒內最多送 COUNT 則 */
export const RATE_LIMIT_COUNT = 5;
export const RATE_LIMIT_WINDOW_MS = 10_000;

/** 同一個人在這段時間內「離開又加入」，不顯示進出提示（例如重新整理頁面） */
export const REJOIN_QUIET_MS = 3_000;
