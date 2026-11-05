import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import type { WesternRunMeta, WesternRunView } from '../../shared/western';
import { api } from '../api';
import { btnCls, dangerBtnCls, Dialog, primaryBtnCls } from '../components/Dialog';
import { useToast } from '../components/Toast';

export function WesternList() {
  const [runs,setRuns]=useState<WesternRunMeta[]>([]),[error,setError]=useState(''),[remove,setRemove]=useState<WesternRunMeta|null>(null);
  const [,navigate]=useLocation(),toast=useToast();
  useEffect(()=>{api<WesternRunMeta[]>('/api/western').then(setRuns).catch(e=>setError(e.message));},[]);
  return <div className="mx-auto max-w-5xl space-y-5 p-6">
    <div className="flex items-center justify-between"><h1 className="text-xl font-semibold">Western blot</h1><button className={primaryBtnCls} onClick={()=>void api<WesternRunView>('/api/western',{method:'POST',json:{}}).then(v=>navigate(`/western/${v.run.id}`)).catch(e=>toast(e.message,{tone:'error'}))}>새 실험</button></div>
    {error&&<p role="alert" className="text-danger">{error}</p>}
    {!runs.length&&!error&&<p className="rounded-xl border border-line p-8 text-fg-muted">새 Western 실험을 만들거나 Bradford 정량에서 시료를 가져오세요.</p>}
    {runs.map(r=><div key={r.id} className="flex items-center gap-3 rounded-xl border border-line bg-raised p-4"><Link className="min-w-0 flex-1" href={`/western/${r.id}`}><strong>{r.title}</strong><p className="mt-1 text-sm text-fg-muted">{r.performed_at.slice(0,10)} · {{planned:'계획',in_progress:'진행 중',done:'완료'}[r.status]}</p></Link><button className={btnCls} onClick={()=>setRemove(r)}>삭제</button></div>)}
    {remove&&<Dialog title="실험 삭제" onClose={()=>setRemove(null)} footer={<button className={dangerBtnCls} onClick={()=>void api(`/api/western/${remove.id}`, {method:'DELETE'}).then(()=>{setRuns(v=>v.filter(r=>r.id!==remove.id));setRemove(null);}).catch(e=>toast(e.message,{tone:'error'}))}>삭제</button>}><p>“{remove.title}” 실험 기록을 삭제할까요? 되돌릴 수 없습니다.</p></Dialog>}
  </div>;
}
