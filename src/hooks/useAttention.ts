import { useCallback, useEffect, useRef } from 'react';
import type { Message } from '../types';
import { APP_TITLE } from '../limits';
import { showMessageNotification } from '../utils/notification';

const isAway = () => document.hidden || !document.hasFocus();

/**
 * 使用者不在聊天室畫面上時（切到別的分頁或視窗），提醒他有新訊息：
 * 分頁標題顯示未讀數，並（在使用者允許的情況下）跳出桌面通知。回到畫面就歸零。
 * 回傳的函式，在每次收到「別人的」新訊息時呼叫。
 */
export function useAttention(): (message: Message) => void {
  const unread = useRef(0);

  const refreshTitle = useCallback(() => {
    document.title = unread.current > 0 ? `(${unread.current}) ${APP_TITLE}` : APP_TITLE;
  }, []);

  useEffect(() => {
    const clearIfBack = () => {
      if (isAway()) return;
      unread.current = 0;
      refreshTitle();
    };
    window.addEventListener('focus', clearIfBack);
    document.addEventListener('visibilitychange', clearIfBack);
    return () => {
      window.removeEventListener('focus', clearIfBack);
      document.removeEventListener('visibilitychange', clearIfBack);
      unread.current = 0;
      refreshTitle();
    };
  }, [refreshTitle]);

  return useCallback(
    (message: Message) => {
      if (!isAway()) return;
      unread.current += 1;
      refreshTitle();
      showMessageNotification(message);
    },
    [refreshTitle],
  );
}
