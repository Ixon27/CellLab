import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import type { CellLineListItem } from '../../shared/cell-line';
import { api } from '../api';
import { inputCls, primaryBtnCls } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { RegisterCellLineDialog } from '../cells/RegisterCellLineDialog';
export function CellLines() {
  const [lines,setLines]=useState<CellLineListItem[]>([]);const [q,setQ]=useState('');const [register,setRegister]=useState(false);const [,navigate]=useLocation();const toast=useToast();
  useEffect(()=>{api<CellLineListItem[]>('/api/cell-lines').then(setLines).catch(e=>toast(String(e),{tone:'error'}));},[toast]);
  const filtered=lines.filter(l=>[l.name,l.species,...l.tags].join(' ').toLowerCase().includes(q.toLowerCase()));const groups=[...new Set(filtered.map(l=>l.category || '기타'))];
  return <div className="mx-auto grid max-w-6xl gap-6 p-6"><header className="flex items-center justify-between"><h1 className="text-xl font-semibold">세포주</h1><button className={primaryBtnCls} onClick={()=>setRegister(true)}>세포주 등록</button></header><input className={inputCls} aria-label="세포주 검색" placeholder="이름, 태그, 종으로 검색" value={q} onChange={e=>setQ(e.target.value)}/>{groups.map(group=><section key={group}><h2 className="mb-3 font-semibold">{group}</h2><div className="grid gap-3 md:grid-cols-3">{filtered.filter(l=>(l.category || '기타')===group).map(l=><Link key={l.id} href={`/cells/${l.id}`} className="rounded-xl border border-line bg-raised p-4 hover:border-accent"><h3 className="font-semibold">{l.name} {l.caution && <span className="text-danger" title={l.caution}>⚠</span>}</h3><p className="text-sm text-fg-muted">{l.species}</p><p className="text-sm">{l.sourceBank} {l.catalogNo}</p><p className="mt-3 text-sm">활성 배양 {l.activeCultures} · 남은 바이알 {l.vialsRemaining}</p>{l.activeProfileName && <p className="text-xs text-fg-muted">{l.activeProfileName}</p>}</Link>)}</div></section>)}{!filtered.length && <p className="text-fg-muted">등록된 세포주가 없습니다. 세포주를 등록하세요.</p>}{register && <RegisterCellLineDialog onClose={()=>setRegister(false)} onCreated={l=>navigate(`/cells/${l.id}`)}/>}</div>;
}
