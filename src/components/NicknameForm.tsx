import { useEffect, useRef, useState, type FormEvent } from 'react';
import { errorText } from '../errors';
import { NICKNAME_MAX, NICKNAME_PATTERN } from '../limits';
import { charCount } from '../utils/text';
import { requestNotificationPermission } from '../utils/notification';
import { Icon } from './Icon';
import styles from './NicknameForm.module.css';

interface Props {
  initialName: string;
  /** 一進來就要顯示的提示（例如「你的代號已被使用」） */
  notice: string | null;
  /** 回傳錯誤文字；成功則回傳 null（畫面會自己切換，不用處理） */
  onSubmit: (name: string) => Promise<string | null>;
}

export function NicknameForm({ initialName, notice, onSubmit }: Props) {
  const [name, setName] = useState(initialName);
  const [submitError, setSubmitError] = useState<string | null>(notice);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const valid = NICKNAME_PATTERN.test(name);
  const liveError = name.length > 0 && !valid ? errorText('nickname_invalid') : null;
  const error = liveError ?? submitError;
  const count = charCount(name);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!valid || submitting) return;
    requestNotificationPermission();
    setSubmitting(true);
    setSubmitError(null);
    const result = await onSubmit(name);
    // 成功時這個畫面會被換掉，不需要再更新狀態
    if (result !== null) {
      setSubmitError(result);
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.page}>
      <form className={styles.card} onSubmit={handleSubmit} noValidate>
        <div className={styles.brand}>
          <div className={styles.logo}>
            <Icon name="message" size={28} />
          </div>
          <h1 className={styles.title}>匿名聊天室</h1>
          <p className={styles.lead}>不用註冊、不用登入，取一個代號就能進來和大家聊天。</p>
        </div>

        <div className={styles.field}>
          <label htmlFor="nickname" className={styles.label}>
            你的代號
          </label>
          <div className={styles.inputWrap}>
            <input
              id="nickname"
              ref={inputRef}
              type="text"
              value={name}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-invalid={error !== null}
              aria-describedby="nickname-error nickname-rule"
              className={`${styles.input} ${error ? styles.inputError : ''}`}
              onChange={(e) => {
                setName(e.target.value);
                setSubmitError(null);
              }}
            />
            <span className={`${styles.counter} ${count > NICKNAME_MAX ? styles.counterOver : ''}`}>
              {count} / {NICKNAME_MAX}
            </span>
          </div>
          <div id="nickname-error" role="alert" className={styles.error}>
            {error && (
              <>
                <Icon name="alert" size={18} />
                {error}
              </>
            )}
          </div>
          <div id="nickname-rule" className={styles.rule}>
            1–12 個字，只能用中文、英文、數字
          </div>
          <button type="submit" className={styles.submit} disabled={!valid || submitting}>
            {submitting ? '進入中…' : '進入聊天室'}
          </button>
        </div>

        <p className={styles.note}>
          瀏覽器會記住你的代號，下次打開就直接進入。第一次進入時會詢問是否允許通知，讓你在別的分頁時也不錯過新訊息。
        </p>
      </form>
    </main>
  );
}
