import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent } from 'react';
import { describeError } from '../errors';
import { COUNTER_SHOW_AT, MAX_TEXT_LENGTH } from '../limits';
import type { ChatService } from '../services/ChatService';
import { checkImage, formatBytes } from '../utils/image';
import { charCount } from '../utils/text';
import { Icon } from './Icon';
import styles from './Composer.module.css';

interface Props {
  service: ChatService;
  /** 斷線時停用 */
  disabled: boolean;
}

const MAX_HEIGHT = 140;

export function Composer({ service, disabled }: Props) {
  const [text, setText] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 電腦（有滑鼠）：Enter 送出、Shift+Enter 換行。手機：Enter 就是換行，用送出鈕送出
  const enterSends = useMemo(
    () => window.matchMedia('(hover: hover) and (pointer: fine)').matches,
    [],
  );

  const count = charCount(text);
  const remaining = MAX_TEXT_LENGTH - count;
  const hasContent = text.trim().length > 0 || image !== null;
  const canSend = !disabled && !sending && hasContent && remaining >= 0;

  // 輸入框隨內容長高，但有上限
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // box-sizing 是 border-box，高度要把上下邊框也算進去，不然一行字就會被判定為溢出而出現捲軸
    const borders = el.offsetHeight - el.clientHeight;
    el.style.height = `${Math.min(el.scrollHeight + borders, MAX_HEIGHT)}px`;
  }, [text]);

  // 圖片預覽網址用完要釋放
  useEffect(() => {
    if (!image) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(image);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  async function attach(file: File) {
    setError(null);
    try {
      await checkImage(file);
      setImage(file);
    } catch (e) {
      setError(describeError(e));
    }
  }

  function onPickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // 讓同一張圖可以再選一次
    if (file) void attach(file);
  }

  function onPaste(event: ClipboardEvent) {
    const file = Array.from(event.clipboardData.files).find((f) => f.type.startsWith('image/'));
    if (file) {
      event.preventDefault();
      void attach(file);
    }
  }

  async function send() {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      await service.sendMessage({ text: text.trim() || undefined, image: image ?? undefined });
      setText('');
      setImage(null);
    } catch (e) {
      // 失敗時保留輸入內容，不讓使用者白打
      setError(describeError(e));
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && enterSends && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  }

  return (
    <footer className={styles.composer}>
      {disabled && <div className={styles.offlineNote}>連線恢復後才能送出</div>}

      {image && previewUrl && (
        <div className={styles.preview}>
          <img className={styles.previewImg} src={previewUrl} alt="已選圖片的預覽" />
          <div className={styles.previewInfo}>
            <div className={styles.previewName}>{image.name}</div>
            <div className={styles.previewSize}>{formatBytes(image.size)}</div>
          </div>
          <button type="button" className={styles.iconBtn} aria-label="移除圖片" onClick={() => setImage(null)}>
            <Icon name="x" size={20} />
          </button>
        </div>
      )}

      {(error || remaining <= COUNTER_SHOW_AT) && (
        <div className={styles.status}>
          <div role="alert" className={styles.error}>
            {error && (
              <>
                <Icon name="alert" size={16} />
                {error}
              </>
            )}
          </div>
          {remaining <= COUNTER_SHOW_AT && (
            <div className={remaining < 0 ? styles.countOver : styles.count}>
              {remaining >= 0 ? `還剩 ${remaining} 字` : `超過 ${-remaining} 字`}
            </div>
          )}
        </div>
      )}

      <div className={styles.row}>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          hidden
          onChange={onPickFile}
        />
        <button
          type="button"
          className={styles.ghostBtn}
          aria-label="加入圖片"
          disabled={disabled}
          onClick={() => fileRef.current?.click()}
        >
          <Icon name="image" size={20} />
        </button>
        <textarea
          ref={textareaRef}
          className={styles.input}
          rows={1}
          aria-label="訊息內容"
          placeholder="輸入訊息…"
          value={text}
          disabled={disabled}
          onChange={(event) => {
            setText(event.target.value);
            setError(null);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        <button type="button" className={styles.sendBtn} aria-label="送出" disabled={!canSend} onClick={send}>
          <Icon name="send" size={20} />
        </button>
      </div>

      <div className={styles.hint}>Enter 送出 · Shift+Enter 換行 · 也可以直接貼上圖片</div>
    </footer>
  );
}
