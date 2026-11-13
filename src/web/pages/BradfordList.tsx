import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowUpRight, Plus, TestTube } from 'lucide-react';
import { STANDARD_PRESETS } from '../../shared/bradford';
import { api } from '../api';
import { Dialog, btnCls, inputCls, primaryBtnCls } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { PageHeader } from '../components/Workbench';

interface Item {
  id: string;
  title: string;
  performed_at: string;
  sampleCount: number;
  r2: number | null;
}
export function BradfordList() {
  const [items, setItems] = useState<Item[] | null>(null),
    [open, setOpen] = useState(false),
    [title, setTitle] = useState(''),
    [date, setDate] = useState(new Date().toISOString().slice(0, 10)),
    [preset, setPreset] = useState('standard'),
    [busy, setBusy] = useState(false);
  const [, navigate] = useLocation();
  const toast = useToast();
  useEffect(() => {
    api<Item[]>('/api/bradford')
      .then(setItems)
      .catch((e) => toast(e.message, { tone: 'error' }));
  }, [toast]);
  async function create() {
    setBusy(true);
    try {
      const res = await api<{ assay: { id: string } }>('/api/bradford', { method: 'POST', json: { title, performedAt: date, preset } });
      navigate(`/bradford/${res.assay.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : '생성에 실패했습니다', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }
  const start = () => {
    setTitle(`정량 ${date}`);
    setOpen(true);
  };
  const newButton = (
    <button className={primaryBtnCls} onClick={start}>
      <Plus size={14} />새 정량 실험
    </button>
  );
  return (
    <div className="workbench-page">
      <PageHeader eyebrow="Protein assay" title="단백질 정량" note="Bradford · BCA 표준곡선으로 시료 농도를 구하고 Western 로딩으로 넘깁니다." actions={newButton} />
      {items && items.length > 0 && (
        <div className="workbench-panel divide-y divide-line">
          {items.map((item) => (
            <Link key={item.id} href={`/bradford/${item.id}`} className="group flex items-center gap-4 px-4 py-3.5 hover:bg-hover">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-fg-muted">
                <TestTube size={17} strokeWidth={1.5} />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[14px] font-semibold">{item.title}</h2>
                <p className="mt-0.5 text-[12px] tabular-nums text-fg-muted">{item.performed_at.slice(0, 10)}</p>
              </div>
              <div className="flex shrink-0 gap-5 text-right text-[12px] tabular-nums">
                <div>
                  <span className="text-fg-dim">시료</span>
                  <span className="ml-1.5 font-medium">{item.sampleCount}</span>
                </div>
                <div className="w-[76px]">
                  <span className="text-fg-dim">R²</span>
                  <span className={`ml-1.5 font-medium ${item.r2 === null ? 'text-fg-dim' : item.r2 >= 0.98 ? 'text-success' : 'text-warning'}`}>
                    {item.r2?.toFixed(4) ?? '—'}
                  </span>
                </div>
              </div>
              <ArrowUpRight size={14} className="shrink-0 text-fg-dim group-hover:text-fg" aria-hidden />
            </Link>
          ))}
        </div>
      )}
      {!items && <p className="text-[13px] text-fg-muted">정량 실험을 불러오는 중…</p>}
      {items?.length === 0 && (
        <div className="workbench-panel px-8 py-14 text-center">
          <TestTube size={24} strokeWidth={1.3} className="mx-auto mb-3 text-fg-dim" />
          <p className="font-medium">첫 정량 실험을 만드세요</p>
          <p className="mb-5 mt-1 text-[12px] text-fg-muted">플레이트 리더 엑셀 파일을 올리면 96칸 측정값이 바로 들어갑니다.</p>
          {newButton}
        </div>
      )}
      {open && (
        <Dialog
          title="정량 실험 만들기"
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className={btnCls} onClick={() => setOpen(false)}>
                취소
              </button>
              <button disabled={busy || !title.trim()} className={primaryBtnCls} onClick={create}>
                만들기
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-fg-muted">제목</span>
              <input autoFocus className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-fg-muted">실험일</span>
              <input className={`${inputCls} w-40`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-fg-muted">표준 농도</span>
              <select className={inputCls} value={preset} onChange={(e) => setPreset(e.target.value)}>
                {STANDARD_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Dialog>
      )}
    </div>
  );
}
