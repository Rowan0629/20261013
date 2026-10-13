import { memo, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { MAX_TEXT_LENGTH } from '../limits';
import type { Message } from '../types';
import { charCount } from '../utils/text';
import { formatTime } from '../utils/time';
import { Icon } from './Icon';
import styles from './MessageItem.module.css';

interface Props {
  message: Message;
  mine: boolean;
  selected: boolean;
  editing: boolean;
  onToggleSelect: (id: string) => void;
  onStartEdit: (id: string) => void;
  /** 回傳錯誤文字；成功回傳 null */
  onSaveEdit: (id: string, text: string) => Promise<string | null>;
  onCancelEdit: () => void;
  onRequestDelete: (message: Message) => void;
  onOpenImage: (message: Message) => void;
}

export const MessageItem = memo(function MessageItem(props: Props) {
  const { message, mine, selected, editing } = props;
  const deleted = message.deletedAt !== null;

  if (editing && mine && !deleted) {
    return <EditCard message={message} onSave={props.onSaveEdit} onCancel={props.onCancelEdit} />;
  }

  const time = (
    <time className={styles.time} dateTime={message.createdAt}>
      {formatTime(message.createdAt)}
    </time>
  );

  const toggle = () => props.onToggleSelect(message.id);
  const onBubbleKey = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggle();
    }
  };

  const hasImage = message.imageUrl !== null;
  const bubble = deleted ? (
    <div className={styles.deleted}>此訊息已刪除</div>
  ) : (
    <div
      className={`${styles.bubble} ${mine ? styles.bubbleMine : styles.bubbleOther} ${hasImage ? styles.bubbleImage : ''}`}
      // 自己的訊息：點一下展開「編輯／刪除」（手機）；電腦版滑過就會出現
      {...(mine
        ? {
            tabIndex: 0,
            onClick: toggle,
            onKeyDown: onBubbleKey,
            ...(hasImage ? {} : { role: 'button', 'aria-expanded': selected }),
          }
        : {})}
    >
      {message.imageUrl && (
        <button
          type="button"
          className={styles.imageBtn}
          aria-label="放大圖片"
          onClick={(event) => {
            event.stopPropagation();
            props.onOpenImage(message);
          }}
        >
          <img className={styles.image} src={message.imageUrl} alt="" loading="lazy" />
        </button>
      )}
      {(message.text || message.editedAt) && (
        <span className={hasImage ? styles.textWithImage : undefined}>
          {message.text}
          {message.editedAt && <span className={styles.edited}>(已編輯)</span>}
        </span>
      )}
    </div>
  );

  const actions = mine && !deleted && (
    <div className={styles.actions}>
      <button type="button" className={styles.actionBtn} onClick={() => props.onStartEdit(message.id)}>
        <Icon name="pencil" size={16} />
        <span className={styles.actionLabel}>編輯</span>
      </button>
      <button
        type="button"
        className={`${styles.actionBtn} ${styles.actionDanger}`}
        onClick={() => props.onRequestDelete(message)}
      >
        <Icon name="trash" size={16} />
        <span className={styles.actionLabel}>刪除</span>
      </button>
    </div>
  );

  return (
    <div className={`${styles.msg} ${mine ? styles.mine : styles.other} ${selected ? styles.selected : ''}`}>
      {!mine && <div className={styles.nick}>{message.nickname}</div>}
      <div className={styles.line}>
        {mine ? (
          <>
            {actions}
            {time}
            {bubble}
          </>
        ) : (
          <>
            {bubble}
            {time}
          </>
        )}
      </div>
    </div>
  );
});

/** 編輯模式：該則訊息變成一張輸入卡 */
function EditCard(props: {
  message: Message;
  onSave: (id: string, text: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const { message } = props;
  const [draft, setDraft] = useState(message.text);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const remaining = MAX_TEXT_LENGTH - charCount(draft);
  const canSave = !saving && draft.trim().length > 0 && remaining >= 0;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const result = await props.onSave(message.id, draft);
    if (result !== null) {
      setError(result);
      setSaving(false);
    }
  }

  return (
    <div className={styles.editCard}>
      <label htmlFor={`edit-${message.id}`} className={styles.editLabel}>
        編輯訊息
      </label>
      <textarea
        id={`edit-${message.id}`}
        ref={ref}
        rows={3}
        className={styles.editInput}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            props.onCancel();
          } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void save();
          }
        }}
      />
      {error && (
        <div role="alert" className={styles.editError}>
          <Icon name="alert" size={16} />
          {error}
        </div>
      )}
      <div className={styles.editFoot}>
        <span className={remaining < 0 ? styles.editOver : styles.editCount}>
          {remaining >= 0 ? `還剩 ${remaining} 字` : `超過 ${-remaining} 字`}
        </span>
        <button type="button" className={styles.editCancel} onClick={props.onCancel}>
          取消
        </button>
        <button type="button" className={styles.editSave} onClick={save} disabled={!canSave}>
          {saving ? '儲存中…' : '儲存'}
        </button>
      </div>
    </div>
  );
}
