import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import * as Plot from '@observablehq/plot';
import { computeBradford, parseReplicateRows, type BradfordData, type BradfordResult, type Rep, type SampleFlag } from '../../shared/bradford';
import type { CellLineDetailDto, CellLineListItem } from '../../shared/cell-line';
import { api } from '../api';
import { Dialog, btnCls, dangerBtnCls, inputCls, primaryBtnCls, smallBtnCls } from '../components/Dialog';
import { Markdown } from '../components/Markdown';
import { PlotFrame } from '../components/PlotFrame';
import { useToast } from '../components/Toast';

interface Detail { assay:{id:string;title:string;performed_at:string;protocol_id:string|null}; data:BradfordData;result:BradfordResult }
interface Protocol {id:string;title:string;body_md?:string;bodyMd?:string}
const flagLabels:Record<SampleFlag,string>={above_range:'표준 범위 초과',below_range:'표준 범위 미만',high_cv:'CV 10% 초과',no_root:'농도 역산 불가',no_data:'측정값 없음'};
const numberText=(value:number|null|undefined)=>value==null?'—':value.toLocaleString('ko-KR',{maximumFractionDigits:4});
function RepInputs({reps,onChange}:{reps:Rep[];onChange(reps:Rep[]):void}) {
  return <div className="flex flex-wrap gap-1">{reps.map((rep,i)=><div key={i} className="flex items-center"><input aria-label={`반복 ${i+1} 흡광도`} type="number" step="any" className={`${inputCls} w-24 ${rep.excluded?'opacity-40 line-through':''}`} value={rep.abs??''} onChange={e=>onChange(reps.map((r,j)=>j===i?{...r,abs:e.target.value===''?null:Number(e.target.value)}:r))} onContextMenu={e=>{e.preventDefault();onChange(reps.map((r,j)=>j===i?{...r,excluded:!r.excluded}:r));}}/><button title={rep.excluded?'측정값 포함':'측정값 제외'} aria-pressed={rep.excluded} className={smallBtnCls} onClick={()=>onChange(reps.map((r,j)=>j===i?{...r,excluded:!r.excluded}:r))}>{rep.excluded?'포함':'제외'}</button></div>)}<button className={smallBtnCls} disabled={reps.length>=6} onClick={()=>onChange([...reps,{abs:null,excluded:false}])}>+</button><button className={smallBtnCls} disabled={reps.length<=1} onClick={()=>onChange(reps.slice(0,-1))}>−</button></div>;
}
export function BradfordEditor({id}:{id:string}) {
  const [detail,setDetail]=useState<Detail|null>(null),[error,setError]=useState(''),[saveState,setSaveState]=useState('저장됨');
  const [selected,setSelected]=useState<number[]>([]),[paste,setPaste]=useState<'standards'|'samples'|null>(null),[pasteText,setPasteText]=useState('');
  const [lines,setLines]=useState<CellLineListItem[]>([]),[lineId,setLineId]=useState(''),[cultures,setCultures]=useState<CellLineDetailDto['cultures']>([]);
  const [protocols,setProtocols]=useState<Protocol[]>([]),[protocol,setProtocol]=useState<Protocol|null>(null),[showProtocol,setShowProtocol]=useState(false),[creating,setCreating]=useState(false);
  const revision=useRef(0),savedRevision=useRef(0),saving=useRef(false),latest=useRef<Detail|null>(null);
  const toast=useToast(),[,navigate]=useLocation();
  useEffect(()=>{let live=true;api<Detail>(`/api/bradford/${id}`).then(d=>{if(live){latest.current=d;setDetail(d);}}).catch(e=>setError(e.message));return()=>{live=false;};},[id]);
  useEffect(()=>{api<CellLineListItem[]>('/api/cell-lines').then(setLines).catch(()=>setLines([]));Promise.all([api<Protocol[]>('/api/protocols?category=bradford'),api<Protocol[]>('/api/protocols?category=protein')]).then(p=>setProtocols(p.flat())).catch(e=>toast(e.message,{tone:'error'}));},[toast]);
  useEffect(()=>{setCultures([]);if(lineId) api<CellLineDetailDto>(`/api/cell-lines/${lineId}`).then(d=>setCultures(d.cultures)).catch(()=>setCultures([]));},[lineId]);
  useEffect(()=>{setProtocol(null);if(detail?.assay.protocol_id) api<Protocol>(`/api/protocols/${detail.assay.protocol_id}`).then(setProtocol).catch(e=>toast(e.message,{tone:'error'}));},[detail?.assay.protocol_id,toast]);
  // Serialize saves; never let an older response replace edits made during its request.
  useEffect(()=>{
    if(!detail||revision.current===savedRevision.current)return;
    let disposed=false;
    async function save() {
      if(saving.current){timer=setTimeout(save,100);return;}
      const current=latest.current;if(!current)return;
      const version=revision.current;saving.current=true;setSaveState('저장 중…');
      try {
        const response=await api<Detail>(`/api/bradford/${id}`,{method:'PUT',json:{title:current.assay.title,performedAt:current.assay.performed_at,protocolId:current.assay.protocol_id,data:current.data}});
        savedRevision.current=version;
        if(!disposed&&version===revision.current){latest.current=response;setDetail(response);setSaveState('저장됨');}
      }catch(e){if(!disposed){setSaveState('저장 실패');toast(e instanceof Error?e.message:'저장에 실패했습니다',{tone:'error'});}}finally{saving.current=false;}
    }
    let timer=setTimeout(save,800);return()=>{disposed=true;clearTimeout(timer);};
  },[detail,id,toast]);
  function change(next:Detail){revision.current++;latest.current=next;setDetail(next);setSaveState('저장 대기…');}
  function update(data:BradfordData){if(detail)change({...detail,data});}
  const result=useMemo(()=>detail?computeBradford(detail.data):null,[detail?.data]);
  const chart=useMemo<Plot.PlotOptions>(()=>{
    if(!detail||!result)return {};
    const max=Math.max(...detail.data.standards.map(s=>s.conc),1);
    const curve=result.fit?Array.from({length:100},(_,i)=>{const x=max*i/99;return{x,y:result.fit!.coef.reduce((v,c,j)=>v+c*x**j,0)};}):[];
    const points=result.standards.filter(s=>s.corrected!==null).map(s=>({x:s.conc,y:s.corrected!}));
    const samples=result.samples.filter(s=>s.wellUgPerMl!==null&&s.corrected!==null).map(s=>({x:s.wellUgPerMl!,y:s.corrected!,name:s.name}));
    return{height:320,x:{label:'농도 (µg/mL)'},y:{label:`흡광도 (${detail.data.wavelengthNm} nm)`},marks:[Plot.dot(points,{x:'x',y:'y',fill:'currentColor'}),Plot.line(curve,{x:'x',y:'y',stroke:'steelblue'}),Plot.dot(samples,{x:'x',y:'y',fill:'darkorange',title:'name',symbol:'diamond'})]};
  },[detail?.data,result]);
  function applyPaste(){
    if(!detail||!paste)return;
    try {
      const rows=parseReplicateRows(pasteText);
      const data=structuredClone(detail.data);
      rows.forEach((row,i)=>{
        const reps=row.values.map(abs=>({abs,excluded:false}));
        if(paste==='standards'){
          // A numeric first column is a concentration when it matches an existing row
          // and leaves at least one absorbance column; otherwise rows map by order.
          const matched=!row.label&&row.values.length>1?data.standards.find(s=>s.conc===row.values[0]):undefined;
          const target=matched??data.standards[i];
          if(!target)throw new Error('붙여넣은 표준 행이 너무 많습니다');
          target.reps=matched?reps.slice(1):reps;
          if(target.reps.length<1||target.reps.length>6)throw new Error('각 행에는 반복 측정값 1–6개를 입력하세요');
        }else if(data.samples[i])data.samples[i]={...data.samples[i],name:row.label||data.samples[i].name,reps};
        else data.samples.push({name:row.label||`시료 ${i+1}`,dilution:1,cultureId:null,reps});
      });
      if(data.samples.some(s=>s.reps.length<1||s.reps.length>6))throw new Error('각 행에는 반복 측정값 1–6개를 입력하세요');
      if(data.samples.length>96)throw new Error('시료는 최대 96개입니다');
      update(data);setPaste(null);
    }catch(e){toast(e instanceof Error?e.message:'붙여넣기에 실패했습니다',{tone:'error'});}
  }
  async function makeWestern(){
    if(!detail)return;
    setCreating(true);
    try{
      while(saving.current) {
        const {promise,resolve}=Promise.withResolvers<void>();
        setTimeout(resolve,50);
        await promise;
      }
      const current=latest.current!;
      await api(`/api/bradford/${id}`,{method:'PUT',json:{title:current.assay.title,performedAt:current.assay.performed_at,protocolId:current.assay.protocol_id,data:current.data}});
      const res=await api<{run:{id:string}}>('/api/western',{method:'POST',json:{fromBradford:{id,sampleIndexes:selected}}});
      navigate(`/western/${res.run.id}`);
    }catch(e){toast(e instanceof Error?e.message:'실험 생성에 실패했습니다',{tone:'error'});}finally{setCreating(false);}
  }
  if(error)return <p className="p-6 text-danger">{error}</p>;
  if(!detail||!result)return <p className="p-6 text-fg-muted">정량 데이터를 불러오는 중…</p>;
  const d=detail.data;
  return <div className="mx-auto max-w-7xl space-y-5 p-6"><header className="flex flex-wrap items-center gap-3"><Link href="/bradford" className={btnCls}>목록</Link><input aria-label="실험 제목" className={`${inputCls} flex-1`} value={detail.assay.title} onChange={e=>change({...detail,assay:{...detail.assay,title:e.target.value}})}/><input aria-label="실험일" type="date" className={inputCls} value={detail.assay.performed_at.slice(0,10)} onChange={e=>change({...detail,assay:{...detail.assay,performed_at:e.target.value}})}/><span className="text-xs text-fg-muted" role="status">{saveState}</span><button className={dangerBtnCls} onClick={async()=>{if(!window.confirm('이 정량 실험을 삭제할까요?'))return;try{await api('/api' + `/bradford/${id}`, {method:'DELETE'});navigate('/bradford');}catch(e){toast(e instanceof Error?e.message:'삭제에 실패했습니다',{tone:'error'});}}}>삭제</button></header>
    <section className="flex flex-wrap gap-4 rounded-xl border border-line p-4"><label>적합 <select className={inputCls} value={d.fit} onChange={e=>update({...d,fit:e.target.value as BradfordData['fit']})}><option value="linear">선형</option><option value="quadratic">2차</option></select></label><label><input type="checkbox" checked={d.subtractBlank} onChange={e=>update({...d,subtractBlank:e.target.checked})}/> Blank 보정</label><label>파장 <input type="number" min="1" className={`${inputCls} w-24`} value={d.wavelengthNm} onChange={e=>update({...d,wavelengthNm:Number(e.target.value)})}/> nm</label></section>
    <section className="space-y-3 rounded-xl border border-line p-4"><div className="flex gap-3"><h2 className="flex-1 font-semibold">표준</h2><button className={btnCls} onClick={()=>{setPaste('standards');setPasteText('');}}>엑셀에서 붙여넣기</button><button className={btnCls} disabled={d.standards.length>=24} onClick={()=>update({...d,standards:[...d.standards,{conc:Math.max(...d.standards.map(s=>s.conc))+1,reps:[{abs:null,excluded:false},{abs:null,excluded:false}]}]})}>표준 추가</button></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>농도 (µg/mL)</th><th>반복 흡광도</th><th>평균</th><th>CV (%)</th><th>보정값</th><th/></tr></thead><tbody>{d.standards.map((s,i)=><tr key={i} className="border-t border-line"><td className="py-2"><input type="number" min="0" step="any" className={`${inputCls} w-28`} value={s.conc} onChange={e=>update({...d,standards:d.standards.map((v,j)=>i===j?{...v,conc:Number(e.target.value)}:v)})}/></td><td><RepInputs reps={s.reps} onChange={reps=>update({...d,standards:d.standards.map((v,j)=>i===j?{...v,reps}:v)})}/></td><td>{numberText(result.standards[i].mean)}</td><td>{numberText(result.standards[i].cv)}</td><td>{numberText(result.standards[i].corrected)}</td><td><button className={smallBtnCls} disabled={d.standards.length<=1} onClick={()=>update({...d,standards:d.standards.filter((_,j)=>j!==i)})}>삭제</button></td></tr>)}</tbody></table></div></section>
    <section className="rounded-xl border border-line p-4"><PlotFrame options={chart}/><p className="font-mono text-sm">{result.fit?`y = ${result.fit.coef.map((c,i)=>`${i?' + ':''}${c.toPrecision(6)}${i===1?'x':i===2?'x²':''}`).join('')} · R² = ${result.fit.r2.toFixed(4)}`:'표준곡선 계산에 필요한 측정값을 입력하세요.'}</p>{result.warnings.map(w=><p key={w} className="text-warning">{w}</p>)}</section>
    <section className="space-y-3 rounded-xl border border-line p-4"><div className="flex flex-wrap gap-3"><h2 className="flex-1 font-semibold">시료</h2><button className={btnCls} onClick={()=>{setPaste('samples');setPasteText('');}}>엑셀에서 붙여넣기</button><button className={btnCls} disabled={d.samples.length>=96} onClick={()=>update({...d,samples:[...d.samples,{name:`시료 ${d.samples.length+1}`,dilution:1,cultureId:null,reps:[{abs:null,excluded:false},{abs:null,excluded:false}]}]})}>시료 추가</button><button className={primaryBtnCls} disabled={!selected.length||creating} onClick={makeWestern}>Western 실험 만들기</button></div><label>연결할 배양의 세포주 <select className={inputCls} value={lineId} onChange={e=>setLineId(e.target.value)}><option value="">세포주 선택</option>{lines.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['선택','시료 이름','희석배수','연결 배양','반복 흡광도','평균 / CV (%)','Well µg/mL','원액 µg/mL','원액 µg/µL','상태',''].map((t,i)=><th key={i} className="whitespace-nowrap px-1">{t}</th>)}</tr></thead><tbody>{d.samples.map((s,i)=>{const r=result.samples[i];return <tr key={i} className="border-t border-line"><td><input aria-label={`${s.name} 선택`} type="checkbox" checked={selected.includes(i)} onChange={e=>setSelected(e.target.checked?[...selected,i]:selected.filter(j=>j!==i))}/></td><td className="py-2"><input className={`${inputCls} w-32`} value={s.name} onChange={e=>update({...d,samples:d.samples.map((v,j)=>i===j?{...v,name:e.target.value}:v)})}/></td><td><input type="number" min="0" step="any" className={`${inputCls} w-20`} value={s.dilution} onChange={e=>update({...d,samples:d.samples.map((v,j)=>i===j?{...v,dilution:Number(e.target.value)}:v)})}/></td><td><select className={`${inputCls} w-36`} value={s.cultureId??''} onChange={e=>update({...d,samples:d.samples.map((v,j)=>i===j?{...v,cultureId:e.target.value||null}:v)})}><option value="">연결 없음</option>{s.cultureId&&!cultures.some(c=>c.id===s.cultureId)&&<option value={s.cultureId}>연결된 배양</option>}{cultures.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></td><td><RepInputs reps={s.reps} onChange={reps=>update({...d,samples:d.samples.map((v,j)=>i===j?{...v,reps}:v)})}/></td><td>{numberText(r.mean)} / {numberText(r.cv)}</td><td>{numberText(r.wellUgPerMl)}</td><td>{numberText(r.stockUgPerMl)}</td><td>{numberText(r.stockUgPerUl)}</td><td>{r.flags.map(f=><span key={f} className="m-1 inline-block whitespace-nowrap rounded bg-warning-soft px-1 text-xs text-warning">{flagLabels[f]}</span>)}</td><td><button className={smallBtnCls} onClick={()=>{setSelected([]);update({...d,samples:d.samples.filter((_,j)=>i!==j)});}}>삭제</button></td></tr>;})}</tbody></table></div></section>
    <section className="space-y-3 rounded-xl border border-line p-4"><h2 className="font-semibold">연결 프로토콜</h2><select className={inputCls} value={detail.assay.protocol_id??''} onChange={e=>change({...detail,assay:{...detail.assay,protocol_id:e.target.value||null}})}><option value="">연결 없음</option>{protocols.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select><button className={btnCls} disabled={!protocol} onClick={()=>setShowProtocol(true)}>프로토콜 보기</button><label className="block">메모<textarea className={`${inputCls} mt-2 min-h-24 w-full`} value={d.notes} onChange={e=>update({...d,notes:e.target.value})}/></label></section>
    {paste&&<Dialog title="엑셀에서 붙여넣기" onClose={()=>setPaste(null)} width={650} footer={<button className={primaryBtnCls} onClick={applyPaste}>적용</button>}><p className="mb-2 text-sm text-fg-muted">탭·쉼표·공백으로 구분한 반복값을 붙여넣으세요. 표준은 농도 열을 앞에 넣거나 행 순서대로 입력합니다. 시료는 이름을 앞에 넣을 수 있습니다.</p><textarea autoFocus className={`${inputCls} min-h-60 w-full font-mono`} value={pasteText} onChange={e=>setPasteText(e.target.value)}/></Dialog>}
    {showProtocol&&protocol&&<aside className="fixed inset-y-0 right-0 z-50 w-full max-w-xl overflow-y-auto border-l border-line bg-raised p-6 shadow-xl"><button className={btnCls} onClick={()=>setShowProtocol(false)}>닫기</button><h2 className="my-4 font-semibold">{protocol.title}</h2><Markdown text={protocol.body_md??protocol.bodyMd??''}/></aside>}
  </div>;
}
