import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { STANDARD_PRESETS } from '../../shared/bradford';
import { api } from '../api';
import { Dialog, btnCls, inputCls, primaryBtnCls } from '../components/Dialog';
import { useToast } from '../components/Toast';

interface Item { id:string; title:string; performed_at:string; sampleCount:number; r2:number|null }
export function BradfordList() {
  const [items,setItems]=useState<Item[]>([]),[open,setOpen]=useState(false),[title,setTitle]=useState(''),[date,setDate]=useState(new Date().toISOString().slice(0,10)),[preset,setPreset]=useState('standard'),[busy,setBusy]=useState(false);
  const [,navigate]=useLocation();const toast=useToast();
  useEffect(()=>{api<Item[]>('/api/bradford').then(setItems).catch(e=>toast(e.message,{tone:'error'}));},[toast]);
  async function create() {
    setBusy(true);
    try {const res=await api<{assay:{id:string}}>('/api/bradford',{method:'POST',json:{title,performedAt:date,preset}});navigate(`/bradford/${res.assay.id}`);} catch(e) {toast(e instanceof Error?e.message:'생성에 실패했습니다',{tone:'error'});} finally {setBusy(false);}
  }
  return <div className="mx-auto max-w-6xl space-y-5 p-6"><header className="flex items-center justify-between"><div><h1 className="text-xl font-semibold">단백질 정량</h1><p className="text-sm text-fg-muted">Bradford · BCA 표준곡선과 시료 농도를 관리합니다.</p></div><button className={primaryBtnCls} onClick={()=>{setTitle(`정량 ${date}`);setOpen(true);}}>새 정량 실험</button></header>
    {!items.length?<p className="rounded-xl border border-line p-8 text-fg-muted">정량 실험을 만들어 표준과 시료 흡광도를 입력하세요.</p>:<div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>제목</th><th>실험일</th><th>시료 수</th><th>R²</th></tr></thead><tbody>{items.map(item=><tr key={item.id} className="border-t border-line"><td className="py-3"><Link href={`/bradford/${item.id}`} className="text-accent">{item.title}</Link></td><td>{item.performed_at.slice(0,10)}</td><td>{item.sampleCount}</td><td>{item.r2?.toFixed(4)??'—'}</td></tr>)}</tbody></table></div>}
    {open&&<Dialog title="정량 실험 만들기" onClose={()=>setOpen(false)} footer={<button disabled={busy||!title.trim()} className={primaryBtnCls} onClick={create}>만들기</button>}><div className="space-y-3"><label className="block">제목<input className={`${inputCls} w-full`} value={title} onChange={e=>setTitle(e.target.value)}/></label><label className="block">실험일<input className={`${inputCls} w-full`} type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label className="block">표준 농도<select className={`${inputCls} w-full`} value={preset} onChange={e=>setPreset(e.target.value)}>{STANDARD_PRESETS.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label><button className={btnCls} onClick={()=>setOpen(false)}>취소</button></div></Dialog>}
  </div>;
}
