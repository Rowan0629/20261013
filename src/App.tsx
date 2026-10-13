import { useCallback, useEffect, useState } from 'react';
import { ChatRoom } from './components/ChatRoom';
import { DebugPanel } from './components/DebugPanel';
import { NicknameForm } from './components/NicknameForm';
import { describeError, errorText } from './errors';
import { chatService, mockControls } from './services';
import { readSavedNickname, saveNickname } from './utils/storage';

type Phase =
  | { kind: 'booting' }
  | { kind: 'form'; initialName: string; notice: string | null }
  | { kind: 'chat'; nickname: string };

const showDebug = new URLSearchParams(window.location.search).has('debug');

export default function App() {
  const [userId, setUserId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'booting' });

  // 打開網頁：取得匿名身分；瀏覽器記得上次的代號就直接進入，否則顯示輸入代號畫面
  useEffect(() => {
    let cancelled = false;
    const saved = readSavedNickname();
    (async () => {
      try {
        const me = await chatService.start();
        if (cancelled) return;
        setUserId(me.userId);
        if (!saved) {
          setPhase({ kind: 'form', initialName: '', notice: null });
          return;
        }
        const result = await chatService.claimNickname(saved);
        if (cancelled) return;
        if (result === 'ok') {
          setPhase({ kind: 'chat', nickname: saved });
        } else {
          setPhase({
            kind: 'form',
            initialName: saved,
            notice: result === 'taken' ? errorText('nickname_taken') : null,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setPhase({ kind: 'form', initialName: saved ?? '', notice: describeError(error) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 關掉網頁時，盡力通知後端「我走了」，讓代號馬上釋放
  useEffect(() => {
    if (phase.kind !== 'chat') return;
    const release = () => void chatService.releaseNickname().catch(() => undefined);
    window.addEventListener('pagehide', release);
    return () => window.removeEventListener('pagehide', release);
  }, [phase.kind]);

  const handleEnter = useCallback(async (name: string): Promise<string | null> => {
    try {
      const result = await chatService.claimNickname(name);
      if (result === 'taken') return errorText('nickname_taken');
      if (result === 'invalid') return errorText('nickname_invalid');
      saveNickname(name);
      setPhase({ kind: 'chat', nickname: name });
      return null;
    } catch (error) {
      return describeError(error);
    }
  }, []);

  const handleChangeNickname = useCallback(() => {
    const current = phase.kind === 'chat' ? phase.nickname : '';
    // 這裡不釋放舊代號：等新代號登記成功，後端才會一併放掉舊的（一個人同時只占一個代號）。
    // 這樣新代號萬一被占用，舊代號不會被別人搶走。
    // 但人已經離開聊天室了，別人的線上名單不該再顯示他在線，所以要先離開名單。
    void chatService.leavePresence().catch(() => undefined);
    setPhase({ kind: 'form', initialName: current, notice: null });
  }, [phase]);

  const handleNicknameLost = useCallback(() => {
    setPhase((current) => ({
      kind: 'form',
      initialName: current.kind === 'chat' ? current.nickname : '',
      notice: '你的代號已被別人使用，請重新選一個',
    }));
  }, []);

  return (
    <>
      {phase.kind === 'booting' && (
        <main style={{ minHeight: '100%', display: 'grid', placeItems: 'center', color: 'var(--ink-3)' }}>
          載入中…
        </main>
      )}
      {phase.kind === 'form' && (
        <NicknameForm
          // 換了提示就重新建立表單，確保初始值與提示是最新的
          key={`${phase.initialName}|${phase.notice ?? ''}`}
          initialName={phase.initialName}
          notice={phase.notice}
          onSubmit={handleEnter}
        />
      )}
      {phase.kind === 'chat' && userId && (
        <ChatRoom
          service={chatService}
          userId={userId}
          nickname={phase.nickname}
          onChangeNickname={handleChangeNickname}
          onNicknameLost={handleNicknameLost}
        />
      )}
      {showDebug && mockControls && <DebugPanel controls={mockControls} />}
    </>
  );
}
