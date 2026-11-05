import { useEffect, useRef, useState } from 'react';
import { smallBtnCls } from './Dialog';
import { useToast } from './Toast';

export function StepTimer({ title, minutes, onFinish }: { title: string; minutes: number; onFinish?(): void }) {
  const [remaining, setRemaining] = useState(minutes * 60),
    [running, setRunning] = useState(false);
  const deadline = useRef(0),
    finish = useRef(onFinish),
    toast = useToast();
  finish.current = onFinish;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      const next = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000));
      setRemaining(next);
      if (next === 0) {
        setRunning(false);
        toast(`⏰ ${title} 타이머 종료`);
        finish.current?.();
      }
    }, 250);
    return () => clearInterval(timer);
  }, [running, title, toast]);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="font-mono tabular-nums" role="timer" aria-label={`${title} 남은 시간`}>
        {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
      </span>
      <button
        className={smallBtnCls}
        disabled={!remaining}
        onClick={() => {
          if (running) {
            setRemaining(Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000)));
            setRunning(false);
          } else {
            deadline.current = Date.now() + remaining * 1000;
            setRunning(true);
          }
        }}
      >
        {running ? '일시정지' : '시작'}
      </button>
      <button
        className={smallBtnCls}
        onClick={() => {
          setRunning(false);
          setRemaining(minutes * 60);
        }}
      >
        리셋
      </button>
    </div>
  );
}
