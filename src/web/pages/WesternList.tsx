import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Plus, Rows3, Trash2 } from 'lucide-react';
import type { WesternRunMeta, WesternRunView } from '../../shared/western';
import { api } from '../api';
import { btnCls, solidDangerBtnCls, Dialog, primaryBtnCls, smallIconBtnCls } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { PageHeader } from '../components/Workbench';

const STATUS: Record<WesternRunMeta['status'], { label: string; cls: string }> = {
  planned: { label: '계획', cls: 'bg-hover text-fg-muted' },
  in_progress: { label: '진행 중', cls: 'bg-accent-soft text-accent' },
  done: { label: '완료', cls: 'bg-success-soft text-success' },
};

export function WesternList() {
  const [runs, setRuns] = useState<WesternRunMeta[] | null>(null),
    [error, setError] = useState(''),
    [remove, setRemove] = useState<WesternRunMeta | null>(null);
  const [, navigate] = useLocation(),
    toast = useToast();
  useEffect(() => {
    api<WesternRunMeta[]>('/api/western')
      .then(setRuns)
      .catch((e) => setError(e.message));
  }, []);
  const newButton = (
    <button
      className={primaryBtnCls}
      onClick={() =>
        void api<WesternRunView>('/api/western', { method: 'POST', json: {} })
          .then((v) => navigate(`/western/${v.run.id}`))
          .catch((e) => toast(e.message, { tone: 'error' }))
      }
    >
      <Plus size={14} />새 실험
    </button>
  );
  return (
    <div className="workbench-page">
      <PageHeader eyebrow="Immunoblot" title="Western blot" note="겔 조성부터 로딩·항체·단계 체크까지 한 실험씩 기록합니다." actions={newButton} />
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      {!runs && !error && <p className="text-[13px] text-fg-muted">실험을 불러오는 중…</p>}
      {runs?.length === 0 && (
        <div className="workbench-panel px-8 py-14 text-center">
          <Rows3 size={24} strokeWidth={1.3} className="mx-auto mb-3 text-fg-dim" />
          <p className="font-medium">첫 Western 실험을 만드세요</p>
          <p className="mb-5 mt-1 text-[12px] text-fg-muted">Bradford 정량의 마지막 단계에서 시료를 넘겨 시작할 수도 있습니다.</p>
          {newButton}
        </div>
      )}
      {runs && runs.length > 0 && (
        <div className="workbench-panel divide-y divide-line">
          {runs.map((r) => (
            <div key={r.id} className="group flex items-center gap-3 px-4 hover:bg-hover">
              <Link className="flex min-w-0 flex-1 items-center gap-4 py-3.5" href={`/western/${r.id}`}>
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-fg-muted">
                  <Rows3 size={17} strokeWidth={1.5} />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-[14px] font-semibold">{r.title}</h2>
                  <p className="mt-0.5 text-[12px] tabular-nums text-fg-muted">{r.performed_at.slice(0, 10)}</p>
                </div>
                <span className={`inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium ${STATUS[r.status].cls}`}>
                  {STATUS[r.status].label}
                </span>
              </Link>
              <button
                className={`${smallIconBtnCls} opacity-0 focus-visible:opacity-100 group-hover:opacity-100`}
                aria-label={`${r.title} 삭제`}
                title="실험 삭제"
                onClick={() => setRemove(r)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      {remove && (
        <Dialog
          title="실험 삭제"
          onClose={() => setRemove(null)}
          footer={(close) => (
            <>
              <button className={btnCls} onClick={close}>
                취소
              </button>
              <button
                className={solidDangerBtnCls}
                onClick={() =>
                  void api(`/api/western/${remove.id}`, { method: 'DELETE' })
                    .then(() => {
                      setRuns((v) => v?.filter((r) => r.id !== remove.id) ?? v);
                      setRemove(null);
                    })
                    .catch((e) => toast(e.message, { tone: 'error' }))
                }
              >
                삭제
              </button>
            </>
          )}
        >
          <p>“{remove.title}” 실험 기록을 삭제할까요? 되돌릴 수 없습니다.</p>
        </Dialog>
      )}
    </div>
  );
}
