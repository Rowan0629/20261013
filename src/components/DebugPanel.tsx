import { useState } from 'react';
import type { MockControls } from '../services/mock/mockChatService';
import styles from './DebugPanel.module.css';

/**
 * 階段一的遙控面板（網址後面加 ?debug 才會出現）。
 * 假的人只會隨機行動，這裡讓你不用等，就能測試各種畫面狀態。
 */
export function DebugPanel({ controls }: { controls: MockControls }) {
  const [open, setOpen] = useState(true);
  const [offline, setOffline] = useState(controls.isOffline());

  if (!open) {
    return (
      <button type="button" className={styles.reopen} onClick={() => setOpen(true)}>
        遙控
      </button>
    );
  }

  return (
    <div className={styles.panel} role="group" aria-label="除錯遙控面板">
      <div className={styles.head}>
        <strong>遙控面板（階段一）</strong>
        <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="收起遙控面板">
          收起
        </button>
      </div>
      <div className={styles.buttons}>
        <button
          type="button"
          onClick={() => {
            controls.setOffline(!offline);
            setOffline(!offline);
          }}
        >
          {offline ? '恢復連線' : '模擬斷線'}
        </button>
        <button type="button" onClick={() => controls.botSay(1)}>
          他人說 1 句
        </button>
        <button type="button" onClick={() => controls.botSay(3)}>
          他人連說 3 句
        </button>
        <button type="button" onClick={() => controls.botJoin()}>
          有人進入
        </button>
        <button type="button" onClick={() => controls.botLeave()}>
          有人離開
        </button>
      </div>
    </div>
  );
}
