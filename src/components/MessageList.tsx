import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from 'react';
import type { Message } from '../types';
import { dayKey, formatDayLabel } from '../utils/time';
import { Icon } from './Icon';
import { MessageItem } from './MessageItem';
import styles from './MessageList.module.css';

export interface MessageListHandle {
  scrollToBottom: () => void;
}

interface Props {
  messages: Message[];
  myUserId: string;
  loaded: boolean;
  hasMore: boolean;
  loadingOlder: boolean;
  editingId: string | null;
  selectedId: string | null;
  onLoadOlder: () => void;
  /** 使用者不在底部時，有幾則「別人的」新訊息進來 */
  onNewWhileAway: (count: number) => void;
  onAtBottomChange: (atBottom: boolean) => void;
  onToggleSelect: (id: string) => void;
  onStartEdit: (id: string) => void;
  onSaveEdit: (id: string, text: string) => Promise<string | null>;
  onCancelEdit: () => void;
  onRequestDelete: (message: Message) => void;
  onOpenImage: (message: Message) => void;
}

/** 離底部多近算「在底部」 */
const BOTTOM_TOLERANCE = 80;
/** 捲到離頂端多近就載入更早的訊息 */
const TOP_TRIGGER = 80;

/**
 * 訊息列表，負責所有「捲動」的規則：
 * - 使用者在底部：新訊息進來就自動捲到底
 * - 使用者往上滑：畫面不動，改由上層顯示「有 N 則新訊息」按鈕
 * - 自己送出的訊息：一律捲到底
 * - 載入更早的訊息：保持使用者正在看的那則訊息不動，畫面不跳
 */
export const MessageList = forwardRef<MessageListHandle, Props>(function MessageList(props, ref) {
  const { messages, myUserId, loaded, hasMore, loadingOlder } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const heightBeforeLoad = useRef<number | null>(null);
  const snapshot = useRef<{ firstId: string | null; lastId: string | null }>({ firstId: null, lastId: null });

  // 讓最新的 props 能被事件處理函式讀到，而不用一直重新綁定
  const latest = useRef(props);
  latest.current = props;

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);
  useImperativeHandle(ref, () => ({ scrollToBottom }), [scrollToBottom]);

  const setAtBottom = useCallback((value: boolean) => {
    if (atBottomRef.current === value) return;
    atBottomRef.current = value;
    latest.current.onAtBottomChange(value);
  }, []);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_TOLERANCE);
    const p = latest.current;
    if (el.scrollTop < TOP_TRIGGER && p.loaded && p.hasMore && !p.loadingOlder) {
      heightBeforeLoad.current = el.scrollHeight;
      p.onLoadOlder();
    }
  }

  // 訊息清單變動後，決定畫面要怎麼捲
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prev = snapshot.current;
    const firstId = messages[0]?.id ?? null;
    const lastId = messages[messages.length - 1]?.id ?? null;

    if (prev.firstId !== null && firstId !== prev.firstId && lastId === prev.lastId) {
      // 前面多了更早的訊息：把捲動位置往下補，讓使用者正在看的那則留在原處
      if (heightBeforeLoad.current !== null) {
        el.scrollTop += el.scrollHeight - heightBeforeLoad.current;
        heightBeforeLoad.current = null;
      }
    } else if (lastId !== prev.lastId) {
      // 後面多了新訊息（或第一次載入）
      const start = prev.lastId ? messages.findIndex((m) => m.id === prev.lastId) + 1 : 0;
      const added = messages.slice(start);
      const firstLoad = prev.lastId === null;
      if (firstLoad || atBottomRef.current || added.some((m) => m.userId === myUserId)) {
        scrollToBottom();
      } else {
        const fromOthers = added.filter((m) => m.userId !== myUserId && m.deletedAt === null).length;
        if (fromOthers > 0) latest.current.onNewWhileAway(fromOthers);
      }
    }
    snapshot.current = { firstId, lastId };
  }, [messages, myUserId, scrollToBottom]);

  // 內容高度改變（圖片載入、開啟編輯框）或視窗大小改變（手機鍵盤彈出）時，
  // 如果使用者本來就在底部，就繼續停在底部
  useEffect(() => {
    const content = contentRef.current;
    const scroller = scrollRef.current;
    if (!content || !scroller) return;
    const observer = new ResizeObserver(() => {
      if (atBottomRef.current) scrollToBottom();
    });
    observer.observe(content);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [scrollToBottom]);

  const items: ReactNode[] = [];
  let lastDay = '';
  for (const message of messages) {
    const day = dayKey(message.createdAt);
    if (day !== lastDay) {
      lastDay = day;
      items.push(
        <div key={`day-${day}`} className={styles.divider}>
          <span className={styles.dividerLine} />
          {formatDayLabel(message.createdAt)}
          <span className={styles.dividerLine} />
        </div>,
      );
    }
    items.push(
      <MessageItem
        key={message.id}
        message={message}
        mine={message.userId === myUserId}
        selected={props.selectedId === message.id}
        editing={props.editingId === message.id}
        onToggleSelect={props.onToggleSelect}
        onStartEdit={props.onStartEdit}
        onSaveEdit={props.onSaveEdit}
        onCancelEdit={props.onCancelEdit}
        onRequestDelete={props.onRequestDelete}
        onOpenImage={props.onOpenImage}
      />,
    );
  }

  return (
    <div className={styles.scroll} ref={scrollRef} onScroll={handleScroll}>
      <div className={styles.content} ref={contentRef}>
        {!loaded && (
          <div className={styles.note} role="status">
            <Icon name="spinner" size={18} />
            載入中…
          </div>
        )}
        {loaded && loadingOlder && (
          <div className={styles.note} role="status">
            <Icon name="spinner" size={18} />
            載入更早的訊息…
          </div>
        )}
        {loaded && !loadingOlder && !hasMore && messages.length > 0 && (
          <div className={styles.note}>已經是最早的訊息</div>
        )}
        {loaded && messages.length === 0 && (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>
              <Icon name="message" size={34} />
            </div>
            <div className={styles.emptyTitle}>還沒有人說話，你先開始吧</div>
            <div className={styles.emptyText}>你說的話，所有進來這間聊天室的人都看得到。</div>
          </div>
        )}
        {items}
      </div>
    </div>
  );
});
