import { useCallback, useEffect, useState } from 'react';
import { Link } from 'wouter';
import type { CellLineDto } from '../../shared/cell-line';
import { api } from '../api';
import { btnCls, Dialog, Field, inputCls, primaryBtnCls } from '../components/Dialog';
import { Markdown } from '../components/Markdown';
import { useCopy, useToast } from '../components/Toast';
import type { ProtocolSummary } from '../pages/Protocols';

interface FilledSop { protocolId: string; title: string; markdown: string }

export function SopPanel({ line, onChanged }: { line: CellLineDto; onChanged(): void }) {
  const [sop, setSop] = useState<FilledSop | null>(null);
  const [templates, setTemplates] = useState<ProtocolSummary[]>([]);
  const [changing, setChanging] = useState(false);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const copy = useCopy();
  const toast = useToast();
  const load = useCallback(async () => {
    setError('');
    try {
      const [next, options] = await Promise.all([api<FilledSop>(`/api/cell-lines/${line.id}/sop`), api<ProtocolSummary[]>('/api/protocols?category=culture_sop')]);
      setSop(next); setTemplates(options); setSelected(line.sopProtocolId ?? '');
    } catch (e) { setError(e instanceof Error ? e.message : '배양 SOP를 불러오지 못했습니다'); }
  }, [line.id, line.sopProtocolId, line.updatedAt]);
  useEffect(() => { void load(); }, [load]);

  async function changeTemplate() {
    setBusy(true);
    try {
      await api(`/api/cell-lines/${line.id}`, { method: 'PUT', json: { sopProtocolId: selected || null } });
      setChanging(false); onChanged(); await load();
    } catch (e) { toast(e instanceof Error ? e.message : '템플릿을 바꾸지 못했습니다', { tone: 'error' }); }
    finally { setBusy(false); }
  }

  if (error) return <div role="alert" className="p-4 text-danger">{error} <button className={btnCls} onClick={() => void load()}>다시 시도</button></div>;
  if (!sop) return <p className="p-4 text-fg-muted">배양 SOP를 불러오는 중…</p>;
  return <section className="space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-fg">{sop.title}</h2><p className="mt-1 text-xs text-fg-muted">활성 배양 조건을 적용한 결과입니다. 미정 항목은 실험 전 확인하세요.</p></div><div className="flex flex-wrap gap-2"><button className={btnCls} onClick={() => setChanging(true)}>템플릿 변경</button><Link className={btnCls} href={`/protocols/${sop.protocolId}?edit=1`}>템플릿 편집</Link><button className={btnCls} onClick={() => copy(sop.markdown)}>마크다운 복사</button></div></header>
    <article className="min-w-0 rounded-xl border border-line bg-raised p-6"><Markdown text={sop.markdown} /></article>
    {changing && <Dialog title="배양 SOP 템플릿 변경" onClose={() => setChanging(false)} dismissible={!busy} footer={<button className={primaryBtnCls} disabled={busy} onClick={() => void changeTemplate()}>적용</button>}><Field label="템플릿"><select className={inputCls} value={selected} onChange={(e) => setSelected(e.target.value)}><option value="">배양 방식에 맞는 기본 템플릿</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.title} · {t.status === 'draft' ? '초안' : '확정'}</option>)}</select></Field></Dialog>}
  </section>;
}
