import { useCallback, useEffect, useRef, useState } from 'react';
import { describeError } from '../errors';
import { PAGE_SIZE } from '../limits';
import { useAttention } from '../hooks/useAttention';
import { usePresence } from '../hooks/usePresence';
import type { ChatService } from '../services/ChatService';
import type { ConnectionState, Message } from '../types';
import { latestUpdatedAt, mergeMessages } from '../utils/messages';
import { formatDayLabel, formatTime } from '../utils/time';
import { Composer } from './Composer';
import { Icon } from './Icon';
import { MessageList, type MessageListHandle } from './MessageList';
import { OnlineList } from './OnlineList';
import { ConfirmDialog, ConnectionBanner, ImageViewer, PresenceToast } from './Overlays';
import styles from './ChatRoom.module.css';

interface Props {
  service: ChatService;
  userId: string;
  nickname: string;
  onChangeNickname: () => void;
  /** 斷線太久，代號被別人登記走了 */
  onNicknameLost: () => void;
}

export function ChatRoom({ service, userId, nickname, onChangeNickname, onNicknameLost }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>('connected');
  const [newCount, setNewCount] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  const [onlineOpen, setOnlineOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Message | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Message | null>(null);

  const { online, toast, dismissToast } = usePresence(service);
  const notifyAttention = useAttention();
  const listRef = useRef<MessageListHandle>(null);

  // 事件處理函式裡需要「最新的值」，用 ref 存著，免得一直重新訂閱
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const loadedRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const onLostRef = useRef(onNicknameLost);
  onLostRef.current = onNicknameLost;
  const attentionRef = useRef(notifyAttention);
  attentionRef.current = notifyAttention;

  // ---------- 載入最新一批 ----------
  const loadFirst = useCallback(async () => {
    setLoadFailed(false);
    try {
      const list = await service.loadLatest(PAGE_SIZE);
      setMessages((current) => mergeMessages(current, list));
      setHasMore(list.length >= PAGE_SIZE);
      loadedRef.current = true;
      setLoaded(true);
    } catch {
      setLoadFailed(true);
    }
  }, [service]);

  // ---------- 訂閱事件，並載入第一批 ----------
  useEffect(() => {
    let alive = true;
    let previous: ConnectionState = 'connected';

    // 斷線重連後：補上斷線期間新增、被編輯、被刪除的訊息，並確認代號還是自己的
    async function resync() {
      if (!loadedRef.current) {
        await loadFirst();
        return;
      }
      try {
        const changed = await service.loadChangedSince(latestUpdatedAt(messagesRef.current));
        if (!alive) return;
        setMessages((current) => mergeMessages(current, changed));
        const result = await service.claimNickname(nickname);
        if (alive && result !== 'ok') onLostRef.current();
      } catch {
        /* 如果又斷線了，下一次恢復連線時會再補一次 */
      }
    }

    const offs = [
      service.on('message:new', (message) => {
        setMessages((current) => mergeMessages(current, [message]));
        if (message.userId !== userId) attentionRef.current(message);
      }),
      service.on('message:updated', (message) => {
        setMessages((current) => mergeMessages(current, [message]));
      }),
      service.on('connection:changed', (state) => {
        const was = previous;
        previous = state;
        setConnection(state);
        if (state === 'connected' && was === 'reconnecting') void resync();
      }),
    ];

    void loadFirst();
    return () => {
      alive = false;
      offs.forEach((off) => off());
    };
  }, [service, userId, nickname, loadFirst]);

  // ---------- 往上滑載入更早的訊息 ----------
  const loadOlder = useCallback(async () => {
    const oldest = messagesRef.current[0];
    if (!oldest || loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const list = await service.loadOlder({ createdAt: oldest.createdAt, id: oldest.id }, PAGE_SIZE);
      setMessages((current) => mergeMessages(current, list));
      setHasMore(list.length >= PAGE_SIZE);
    } catch {
      /* 失敗就維持原樣，使用者再往上滑一次就會重試 */
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [service]);

  // ---------- 編輯、刪除 ----------
  const toggleSelect = useCallback((id: string) => setSelectedId((cur) => (cur === id ? null : id)), []);
  const startEdit = useCallback((id: string) => {
    setSelectedId(null);
    setEditingId(id);
  }, []);
  const cancelEdit = useCallback(() => setEditingId(null), []);
  const saveEdit = useCallback(
    async (id: string, text: string) => {
      try {
        await service.editMessage(id, text);
        setEditingId(null);
        return null;
      } catch (error) {
        return describeError(error);
      }
    },
    [service],
  );
  const requestDelete = useCallback((message: Message) => {
    setSelectedId(null);
    setDeleteError(null);
    setDeleteTarget(message);
  }, []);
  const openImage = useCallback((message: Message) => setViewing(message), []);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await service.deleteMessage(deleteTarget.id);
      setDeleteTarget(null);
    } catch (error) {
      setDeleteError(describeError(error));
    } finally {
      setDeleteBusy(false);
    }
  }

  // ---------- 捲動相關 ----------
  const handleAtBottomChange = useCallback((value: boolean) => {
    setAtBottom(value);
    if (value) setNewCount(0);
  }, []);
  const handleNewWhileAway = useCallback((count: number) => setNewCount((n) => n + count), []);

  // 點旁邊或按 Esc 收起手機版的線上名單
  useEffect(() => {
    if (!onlineOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOnlineOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onlineOpen]);

  const offline = connection === 'reconnecting';

  return (
    <div className={styles.room}>
      <div className={styles.main}>
        <header className={styles.header}>
          <div className={styles.titleBlock}>
            <div className={styles.title}>匿名聊天室</div>
            <div className={styles.who}>
              你是 <b>{nickname}</b>
            </div>
          </div>
          <button
            type="button"
            className={`${styles.pill} ${onlineOpen ? styles.pillOpen : ''}`}
            aria-expanded={onlineOpen}
            onClick={() => setOnlineOpen((open) => !open)}
          >
            <span className={styles.dot} />
            {online.length} 人在線
            <Icon name={onlineOpen ? 'chevronUp' : 'chevronDown'} size={16} />
          </button>
          <button type="button" className={styles.changeBtn} onClick={onChangeNickname}>
            <Icon name="pencil" size={20} />
            <span className={styles.changeLabel}>更換代號</span>
          </button>
        </header>

        {onlineOpen && (
          <div className={styles.dropdownAnchor}>
            <button
              type="button"
              className={styles.dropdownScrim}
              aria-label="收起線上名單"
              onClick={() => setOnlineOpen(false)}
            />
            <OnlineList users={online} myUserId={userId} variant="dropdown" />
          </div>
        )}

        {offline && <ConnectionBanner />}

        <div className={styles.body}>
          <PresenceToast toast={toast} onDone={dismissToast} />
          <MessageList
            ref={listRef}
            messages={messages}
            myUserId={userId}
            loaded={loaded}
            hasMore={hasMore}
            loadingOlder={loadingOlder}
            editingId={editingId}
            selectedId={selectedId}
            onLoadOlder={loadOlder}
            onNewWhileAway={handleNewWhileAway}
            onAtBottomChange={handleAtBottomChange}
            onToggleSelect={toggleSelect}
            onStartEdit={startEdit}
            onSaveEdit={saveEdit}
            onCancelEdit={cancelEdit}
            onRequestDelete={requestDelete}
            onOpenImage={openImage}
          />
          {loadFailed && !loaded && (
            <div className={styles.loadFailed} role="alert">
              <Icon name="alert" size={18} />
              訊息載入失敗
              <button type="button" className={styles.retry} onClick={() => void loadFirst()}>
                重試
              </button>
            </div>
          )}
          {newCount > 0 && !atBottom && (
            <button
              type="button"
              className={styles.newBtn}
              onClick={() => {
                listRef.current?.scrollToBottom();
                setNewCount(0);
              }}
            >
              <Icon name="arrowDown" size={16} />
              有 {newCount} 則新訊息
            </button>
          )}
        </div>

        <Composer service={service} disabled={offline} />
      </div>

      <div className={styles.sidebarSlot}>
        <OnlineList users={online} myUserId={userId} variant="sidebar" />
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title="確定要刪除這則訊息？"
          preview={deleteTarget.text || '（圖片）'}
          description="刪除後，所有人都會看到「此訊息已刪除」，內容無法救回。"
          confirmLabel="刪除"
          busy={deleteBusy}
          error={deleteError}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {viewing && viewing.imageUrl && (
        <ImageViewer
          url={viewing.imageUrl}
          downloadUrl={service.imageDownloadUrl(viewing.imageUrl)}
          caption={`${viewing.nickname} · ${formatDayLabel(viewing.createdAt)} ${formatTime(viewing.createdAt)}`}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
