import { useCallback, useEffect, useState } from 'react';
import type { ChatService } from '../services/ChatService';
import type { OnlineUser } from '../types';
import { REJOIN_QUIET_MS } from '../limits';

export interface Toast {
  id: number;
  text: string;
}

/** 線上名單，以及「某某 進入／離開了聊天室」的短暫提示（一次顯示一個，依序排隊） */
export function usePresence(service: ChatService) {
  const [online, setOnline] = useState<OnlineUser[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    let nextId = 0;
    const pendingLeaves = new Map<string, number>();
    const push = (text: string) => setToasts((queue) => [...queue, { id: nextId++, text }]);

    const offs = [
      service.on('presence:changed', setOnline),
      service.on('presence:joined', ({ nickname }) => {
        // 剛離開就又加入（例如重新整理頁面）：兩個提示都不顯示
        const timer = pendingLeaves.get(nickname);
        if (timer !== undefined) {
          window.clearTimeout(timer);
          pendingLeaves.delete(nickname);
          return;
        }
        push(`${nickname} 進入了聊天室`);
      }),
      service.on('presence:left', ({ nickname }) => {
        if (pendingLeaves.has(nickname)) return;
        const timer = window.setTimeout(() => {
          pendingLeaves.delete(nickname);
          push(`${nickname} 離開了聊天室`);
        }, REJOIN_QUIET_MS);
        pendingLeaves.set(nickname, timer);
      }),
    ];

    return () => {
      offs.forEach((off) => off());
      pendingLeaves.forEach((timer) => window.clearTimeout(timer));
    };
  }, [service]);

  const dismissToast = useCallback(() => setToasts((queue) => queue.slice(1)), []);

  return { online, toast: toasts[0] ?? null, dismissToast };
}
