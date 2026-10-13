import { useEffect } from 'react';
import { useDialog } from '../hooks/useDialog';
import type { Toast } from '../hooks/usePresence';
import { Icon } from './Icon';
import styles from './Overlays.module.css';

const TOAST_MS = 3000;

/** 有人進出時浮現幾秒的提示，不存進歷史訊息 */
export function PresenceToast({ toast, onDone }: { toast: Toast | null; onDone: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(onDone, TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast, onDone]);

  return (
    <div className={styles.toastSlot} role="status" aria-live="polite">
      {toast && (
        <div className={styles.toast} key={toast.id}>
          <span className={styles.toastDot} />
          {toast.text}
        </div>
      )}
    </div>
  );
}

/** 斷線時顯示在上方列下面，恢復後整條消失 */
export function ConnectionBanner() {
  return (
    <div className={styles.banner} role="status">
      <Icon name="wifiOff" size={18} />
      連線中斷，重新連線中…
    </div>
  );
}

interface ConfirmProps {
  title: string;
  preview: string;
  description: string;
  confirmLabel: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 刪除前的確認視窗 */
export function ConfirmDialog(props: ConfirmProps) {
  const ref = useDialog(props.onCancel);
  return (
    <div className={styles.scrim}>
      <div
        ref={ref}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <h2 id="confirm-title" className={styles.dialogTitle}>
          {props.title}
        </h2>
        <div className={styles.dialogPreview}>{props.preview}</div>
        <p className={styles.dialogText}>{props.description}</p>
        {props.error && (
          <div role="alert" className={styles.dialogError}>
            <Icon name="alert" size={16} />
            {props.error}
          </div>
        )}
        <div className={styles.dialogButtons}>
          <button type="button" className={styles.btnCancel} onClick={props.onCancel} data-autofocus>
            取消
          </button>
          <button type="button" className={styles.btnDanger} onClick={props.onConfirm} disabled={props.busy}>
            {props.busy ? '刪除中…' : props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ViewerProps {
  url: string;
  caption: string;
  downloadUrl: string;
  onClose: () => void;
}

/** 全螢幕看圖，可下載；點圖片外的地方、按關閉鈕、按 Esc 都能關閉 */
export function ImageViewer({ url, caption, downloadUrl, onClose }: ViewerProps) {
  const ref = useDialog(onClose);
  return (
    <div ref={ref} className={styles.viewer} role="dialog" aria-modal="true" aria-label="圖片檢視">
      <div className={styles.viewerBar}>
        <button type="button" className={styles.viewerBtn} onClick={onClose} aria-label="關閉" data-autofocus>
          <Icon name="x" size={22} />
        </button>
        <a className={styles.viewerDownload} href={downloadUrl} download>
          <Icon name="download" size={20} />
          下載
        </a>
      </div>
      <div
        className={styles.viewerStage}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <img className={styles.viewerImage} src={url} alt="聊天室中的圖片" />
      </div>
      <div className={styles.viewerCaption}>{caption}</div>
    </div>
  );
}
