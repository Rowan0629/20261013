/** 字數。用「字元」而不是 JavaScript 的長度算，這樣一個 emoji 只算 1 個字（和資料庫一致） */
export function charCount(text: string): number {
  return Array.from(text).length;
}
