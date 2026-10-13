import type { Message } from '../types';
import { APP_TITLE } from '../limits';

export function requestNotificationPermission(): void {
  // 必須在使用者按下按鈕的當下呼叫，瀏覽器才會允許詢問
  if (typeof Notification === 'undefined' || Notification.permission !== 'default') return;
  try {
    void Notification.requestPermission();
  } catch {
    /* 舊版瀏覽器不支援，忽略 */
  }
}

export function showMessageNotification(message: Message): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification(APP_TITLE, {
      body: `${message.nickname}：${message.text || '傳了一張圖片'}`,
      tag: 'chat-message', // 同時有多則時，只保留最新一個
    });
  } catch {
    /* 某些手機瀏覽器不允許直接建立通知，忽略 */
  }
}
