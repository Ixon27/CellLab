import { useEffect, useState } from 'react';
import type { CellLineDto, CellosaurusHit, CellosaurusInfo } from '../../shared/cell-line';
import { api } from '../api';
import { Dialog, inputCls, btnCls, primaryBtnCls } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { CellLineInfoForm, emptyLine } from './CellLineInfoForm';
import type { LineForm } from './CellLineInfoForm';
export function RegisterCellLineDialog({onClose,onCreated}: {onClose():void;onCreated(line:CellLineDto):void}) {
  const [q,setQ] = useState(''); const [hits,setHits] = useState<CellosaurusHit[]>([]); const [form,setForm] = useState<LineForm | null>(null); const [busy,setBusy] = useState(false); const toast = useToast();
  useEffect(() => { let alive = true; const timer = setTimeout(() => { if (q.trim().length < 2) { setHits([]); return; } api<CellosaurusHit[]>(`/api/cellosaurus/search?q=${encodeURIComponent(q)}`).then(v => {if(alive)setHits(v);}).catch(e => {if(alive)toast(String(e),{tone:'error'});}); },300); return () => {alive=false;clearTimeout(timer);}; },[q,toast]);
  async function select(ac:string) { setBusy(true); try {const {ac:cellosaurusAc,...info} = await api<CellosaurusInfo>(`/api/cellosaurus/${ac}`); setForm({...emptyLine,...info,cellosaurusAc});} catch(e){toast(String(e),{tone:'error'});} finally {setBusy(false);} }
  async function save() {if(!form)return;setBusy(true);try {onCreated(await api<CellLineDto>('/api/cell-lines',{method:'POST',json:form}));}catch(e){toast(String(e),{tone:'error'});setBusy(false);}}
  return <Dialog title="세포주 등록" width={780} onClose={onClose} footer={<><button className={btnCls} onClick={onClose}>취소</button><button className={primaryBtnCls} disabled={!form || busy} onClick={save}>저장</button></>}>
    {!form ? <div className="grid gap-3"><input aria-label="Cellosaurus 검색" placeholder="Cellosaurus에서 세포주 검색" className={inputCls} value={q} onChange={e=>setQ(e.target.value)}/>{hits.map(h=><button disabled={busy} className="rounded-lg border border-line p-3 text-left" key={h.ac} onClick={()=>select(h.ac)}><strong>{h.name}</strong> · {h.ac}<div className="text-sm text-fg-muted">{h.species} · {h.category}</div></button>)}<button className={btnCls} onClick={()=>setForm({...emptyLine})}>Cellosaurus 없이 직접 입력</button></div> : <CellLineInfoForm value={form} onChange={setForm}/>}</Dialog>;
}
