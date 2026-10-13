import type { OnlineUser } from '../types';
import styles from './OnlineList.module.css';

interface Props {
  users: OnlineUser[];
  myUserId: string;
  variant: 'sidebar' | 'dropdown';
}

/** 線上名單。電腦版固定在右側（sidebar）；手機版點「N 人在線」後展開（dropdown） */
export function OnlineList({ users, myUserId, variant }: Props) {
  const dropdown = variant === 'dropdown';
  return (
    <section aria-label="線上名單" className={dropdown ? styles.dropdown : styles.sidebar}>
      <div className={styles.head}>
        {!dropdown && <span className={styles.dot} />}
        <span className={styles.headTitle}>線上 {users.length} 人</span>
        {dropdown && <span className={styles.headHint}>再點一下收起</span>}
      </div>
      <ul className={styles.list}>
        {users.map((user) => {
          const me = user.userId === myUserId;
          return (
            <li key={user.userId} className={`${styles.item} ${me ? styles.itemMe : ''}`}>
              <span className={styles.dot} />
              <span className={styles.name}>{user.nickname}</span>
              {me && <span className={styles.you}>(你)</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
