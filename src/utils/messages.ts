import type { Cursor, Message } from '../types';

export function compareMessages(a: Cursor, b: Cursor): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/**
 * 把新收到的訊息併進現有清單：同一個 id 以 updatedAt 較新的為準，結果依時間排好。
 * 沒有任何變化時回傳原本的陣列，避免畫面白白重畫。
 */
export function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  if (incoming.length === 0) return current;
  const byId = new Map(current.map((m) => [m.id, m]));
  let changed = false;
  for (const m of incoming) {
    const existing = byId.get(m.id);
    if (!existing || existing.updatedAt < m.updatedAt) {
      byId.set(m.id, m);
      changed = true;
    }
  }
  if (!changed) return current;
  return [...byId.values()].sort(compareMessages);
}

/** 手上訊息裡最新的變動時間，斷線重連時用它向後端要「之後有變動的訊息」 */
export function latestUpdatedAt(messages: Message[]): string {
  let latest = '1970-01-01T00:00:00.000Z';
  for (const m of messages) if (m.updatedAt > latest) latest = m.updatedAt;
  return latest;
}
