import { useEffect, useRef } from 'react';

const FOCUSABLE = 'button:not(:disabled), a[href], textarea:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * 對話框的基本無障礙行為：開啟時把焦點移進去、Tab 不會跑到視窗外、按 Esc 關閉、關閉後焦點還給原本的地方。
 * 把回傳的 ref 掛在對話框的外層元素上；要預設聚焦的元素加上 data-autofocus。
 */
export function useDialog(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const root = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    const items = () => (root ? Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)) : []);

    (root?.querySelector<HTMLElement>('[data-autofocus]') ?? items()[0])?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const list = items();
      if (list.length === 0) return;
      const first = list[0]!;
      const last = list[list.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, []);

  return ref;
}
