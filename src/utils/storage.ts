// 瀏覽器內建儲存（localStorage）。無痕視窗或被封鎖時可能丟錯，所以全部包 try/catch，讀不到就當作沒有。
const NICKNAME_KEY = 'chat.nickname';

export function readSavedNickname(): string | null {
  try {
    return localStorage.getItem(NICKNAME_KEY);
  } catch {
    return null;
  }
}

export function saveNickname(name: string): void {
  try {
    localStorage.setItem(NICKNAME_KEY, name);
  } catch {
    /* 存不了就算了，下次重新輸入 */
  }
}
