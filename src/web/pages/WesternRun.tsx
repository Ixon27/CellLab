import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { nanoid } from 'nanoid';
import { antibodyMix, defaultLanes, eclMix, gelRecipe, loadingPlan, westernAutoRecord, westernMarkdown } from '../../shared/western';
import type { GelRow, WesternData, WesternRunView } from '../../shared/western';
import { ACRYLAMIDE_RANGES, LOADING_PRESETS, SEPARATING_PCT_NOTES, STACKING_NOTE, WASH_SUMMARY, WESTERN_RECORD_FIELDS, WESTERN_STEPS } from '../../shared/western-defaults';
import type { BradfordData, BradfordResult } from '../../shared/bradford';
import { api } from '../api';
import { btnCls, Dialog, Field, inputCls, primaryBtnCls, smallBtnCls } from '../components/Dialog';
import { Markdown } from '../components/Markdown';
import { OptionCombobox } from '../components/OptionCombobox';
import { StepTimer } from '../components/StepTimer';
import { useCopy, useToast } from '../components/Toast';

interface Protocol {id:string;title:string;body_md?:string;bodyMd?:string}
function Section({title,children}:{title:string;children:ReactNode}) {return <section className="space-y-4 rounded-xl border border-line bg-raised p-5"><h2 className="text-base font-semibold">{title}</h2>{children}</section>;}
function RecipeTable({rows}:{rows:GelRow[]}) {return <table className="w-full text-left text-sm"><thead><tr><th>시약</th><th>원문 µL</th><th>현장 µL</th></tr></thead><tbody>{rows.map(r=><tr key={r.reagent} className="border-t border-line"><td className="py-2">{r.reagent}</td><td>{r.originalUl}</td><td className={r.reagent==='TEMED'?'font-bold text-accent':''}>{r.fieldUl}</td></tr>)}</tbody></table>;}
export function WesternRun({id}:{id:string}) {
  const [view,setView]=useState<WesternRunView|null>(null),[error,setError]=useState(''),[saving,setSaving]=useState(''),[protocols,setProtocols]=useState<Protocol[]>([]),[protocol,setProtocol]=useState<Protocol|null>(null),[drawer,setDrawer]=useState(false),[importOpen,setImportOpen]=useState(false),[finished,setFinished]=useState<string[]>([]);
  const revision=useRef(0),saved=useRef(0),latest=useRef<WesternRunView|null>(null),queue=useRef<Promise<unknown>>(Promise.resolve());
  const [importing,setImporting]=useState(false);
  const importLock=useRef(false);
  const toast=useToast(),copy=useCopy();
  useEffect(()=>{api<WesternRunView>(`/api/western/${id}`).then(v=>{setView(v);latest.current=v;}).catch(e=>setError(e.message));api<Protocol[]>('/api/protocols?category=western').then(setProtocols).catch(e=>toast(e.message,{tone:'error'}));},[id,toast]);
  useEffect(()=>{
    if(!view||importing||saved.current===revision.current)return;
    const version=revision.current;
    const timer=setTimeout(()=>{
      setSaving('저장 중…');
      const snapshot=view;
      queue.current=queue.current.catch(()=>{}).then(()=>api<WesternRunView>(`/api/western/${id}`, {method:'PUT',json:{title:snapshot.run.title,performedAt:snapshot.run.performed_at,status:snapshot.run.status,protocolId:snapshot.run.protocol_id,data:snapshot.data}})).then(()=>{saved.current=version;if(revision.current===version)setSaving('저장됨');}).catch(e=>{setSaving('저장 실패');toast(e.message,{tone:'error'});});
    },800);
    return ()=>clearTimeout(timer);
  },[view,id,toast,importing]);
  // Flush the latest unsent edit when leaving this run; writes share the same queue.
  useEffect(()=>()=>{const snapshot=latest.current;if(snapshot&&!importLock.current&&saved.current!==revision.current)queue.current=queue.current.catch(()=>{}).then(()=>api(`/api/western/${id}`, {method:'PUT',json:{title:snapshot.run.title,performedAt:snapshot.run.performed_at,status:snapshot.run.status,protocolId:snapshot.run.protocol_id,data:snapshot.data}})).catch(e=>toast(e.message,{tone:'error'}));},[id,toast]);
  useEffect(()=>{if(!drawer||!view?.run.protocol_id){setProtocol(null);return;}let alive=true;api<Protocol>(`/api/protocols/${view.run.protocol_id}`).then(p=>{if(alive)setProtocol(p);}).catch(e=>toast(e.message,{tone:'error'}));return ()=>{alive=false;};},[drawer,view?.run.protocol_id,toast]);
  useEffect(()=>{
    if(!drawer)return;
    const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setDrawer(false);};
    window.addEventListener('keydown',close);
    return ()=>window.removeEventListener('keydown',close);
  },[drawer]);
  function change(fn:(v:WesternRunView)=>void) {
    if(importLock.current||!latest.current)return;
    const next=structuredClone(latest.current);
    fn(next);
    revision.current++;
    latest.current=next;
    setView(next);
    setSaving('미저장');
  }
  function data(fn:(d:WesternData)=>void) {change(v=>fn(v.data));}
  if(error)return <p role="alert" className="p-6 text-danger">{error}</p>;
  if(!view)return <p className="p-6 text-fg-muted">실험을 불러오는 중…</p>;
  const d=view.data,auto=westernAutoRecord(d),ecl=eclMix(d.membranes),minimum=d.loading.proteinUg/(d.loading.finalUl-d.loading.finalUl/d.loading.sampleBufferX);
  const separating=gelRecipe({kind:'separating',pct:d.gel.separatingPct,scaleMl:d.gel.separatingScale,batches:d.gel.batches,temedMultiplier:d.gel.temedMultiplier});
  const stacking=gelRecipe({kind:'stacking',scaleMl:d.gel.stackingScale,batches:d.gel.batches,temedMultiplier:d.gel.temedMultiplier});
  return <div className="mx-auto max-w-6xl space-y-5 p-6">
    <Link href="/western" className="text-sm text-fg-muted">← 실험 목록</Link>
    <header className="space-y-3"><input aria-label="실험 제목" className={`${inputCls} text-lg font-semibold`} value={view.run.title} onChange={e=>change(v=>{v.run.title=e.target.value;})}/><div className="flex flex-wrap items-center gap-3">
      <label>상태 <select className={inputCls} value={view.run.status} onChange={e=>change(v=>{v.run.status=e.target.value as WesternRunView['run']['status'];})}><option value="planned">계획</option><option value="in_progress">진행 중</option><option value="done">완료</option></select></label>
      <label>실험일 <input type="date" className={inputCls} value={view.run.performed_at.slice(0,10)} onChange={e=>{if(e.target.value)change(v=>{v.run.performed_at=`${e.target.value}T00:00:00.000Z`;});}}/></label>
      <button className={btnCls} onClick={()=>setDrawer(true)}>프로토콜 보기</button><button className={btnCls} onClick={()=>copy(westernMarkdown(view))}>마크다운 복사</button><span aria-live="polite" className="text-xs text-fg-muted">{saving}</span>
    </div></header>
    <Section title="1. 겔 조성"><div className="grid gap-3 sm:grid-cols-3">
      <Field label="Separating 농도 (%)"><select className={inputCls} value={d.gel.separatingPct} onChange={e=>data(x=>{x.gel.separatingPct=Number(e.target.value) as WesternData['gel']['separatingPct'];})}>{[5,8,10,12,15].map(n=><option key={n}>{n}</option>)}</select></Field>
      <Field label="Separating 규모 (mL)"><select className={inputCls} value={d.gel.separatingScale} onChange={e=>data(x=>{x.gel.separatingScale=Number(e.target.value) as 5|10;})}>{[5,10].map(n=><option key={n}>{n}</option>)}</select></Field>
      <Field label="Stacking 규모 (mL)"><select className={inputCls} value={d.gel.stackingScale} onChange={e=>data(x=>{x.gel.stackingScale=Number(e.target.value) as 5|7.5|10;})}>{[5,7.5,10].map(n=><option key={n}>{n}</option>)}</select></Field>
      <Field label="배합 횟수 (1–10)"><input type="number" min="1" max="10" className={inputCls} value={d.gel.batches} onChange={e=>{const n=Number(e.target.value);if(Number.isInteger(n)&&n>=1&&n<=10)data(x=>{x.gel.batches=n;});}}/></Field>
      <Field label="TEMED 배수"><input type="number" min="0.01" step="0.5" className={inputCls} value={d.gel.temedMultiplier} onChange={e=>{const n=Number(e.target.value);if(n>0)data(x=>{x.gel.temedMultiplier=n;});}}/></Field>
    </div><div className="grid gap-6 md:grid-cols-2"><div><h3>Separating gel</h3><RecipeTable rows={separating.rows}/></div><div><h3>Stacking gel</h3><RecipeTable rows={stacking.rows}/></div></div>
      {d.gel.separatingPct===8&&<p className="text-warning">{SEPARATING_PCT_NOTES[8]}</p>}<p className="text-sm text-fg-muted">{STACKING_NOTE}</p>
      <p className="rounded-lg bg-warning-soft p-3 text-sm text-warning">APS를 먼저 넣고 혼합한 뒤, TEMED를 마지막에 넣고 즉시 붓는다. 현장 TEMED 값은 이미 배수가 반영되어 있다.</p>
      <details><summary className="cursor-pointer">농도별 분리 범위 참고</summary><table className="mt-2 text-sm"><thead><tr><th>농도 (%)</th><th>분리 범위 (kDa)</th></tr></thead><tbody>{ACRYLAMIDE_RANGES.map(r=><tr key={r.pct}><td className="pr-8">{r.pct}</td><td>{r.range}</td></tr>)}</tbody></table></details>
    </Section>
    <Section title="2. 시료·로딩"><div className="flex flex-wrap gap-2"><button className={btnCls} disabled={d.samples.length>=30} onClick={()=>data(x=>{x.samples.push({id:nanoid(12),name:`시료 ${x.samples.length+1}`,concUgPerUl:null,source:null});})}>시료 추가</button><button className={btnCls} onClick={()=>setImportOpen(true)}>Bradford에서 가져오기</button></div>
      <Field label="로딩 프리셋"><select className={inputCls} value="" onChange={e=>{const p=LOADING_PRESETS.find(p=>p.id===e.target.value);if(p)data(x=>{x.loading={proteinUg:p.proteinUg,finalUl:p.finalUl,sampleBufferX:p.sampleBufferX};});}}><option value="">프리셋 선택 (선택 시 현재 조건 변경)</option>{LOADING_PRESETS.map(p=><option value={p.id} key={p.id}>{p.label}</option>)}</select></Field>
      <div className="grid gap-3 sm:grid-cols-3">{([['proteinUg','단백질 (µg)'],['finalUl','최종 부피 (µL)'],['sampleBufferX','Buffer X']] as const).map(([key,label])=><Field key={key} label={label}><input type="number" min={key==='sampleBufferX'?1.01:0.001} step="any" className={inputCls} value={d.loading[key]} onChange={e=>{const n=Number(e.target.value);if(n>(key==='sampleBufferX'?1:0))data(x=>{x.loading[key]=n;});}}/></Field>)}</div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['시료명','원액 µg/µL','단백질 µL','PRO-PREP µL',`${d.loading.sampleBufferX}X buffer µL`,'합계 µL',''].map((s,i)=><th key={i} className="px-2 pb-2">{s}</th>)}</tr></thead><tbody>{d.samples.map((s,i)=>{const p=loadingPlan(s.concUgPerUl,d.loading);return <tr key={s.id} className={p&&!p.ok?'bg-danger-soft text-danger':'border-t border-line'}><td className="min-w-40 p-2"><input aria-label="시료명" className={inputCls} value={s.name} onChange={e=>data(x=>{x.samples[i].name=e.target.value;})}/>{s.source&&<span className="text-xs text-fg-muted">Bradford 연결</span>}</td><td className="min-w-28 p-2"><input aria-label="원액 농도" type="number" min="0" step="any" className={inputCls} value={s.concUgPerUl??''} onChange={e=>data(x=>{x.samples[i].concUgPerUl=e.target.value===''?null:Number(e.target.value);})}/></td><td className="p-2">{p?.sampleUl.toFixed(1)??'—'}</td><td className="p-2">{p?.diluentUl.toFixed(1)??'—'}</td><td className="p-2">{p?.bufferUl.toFixed(1)??'—'}</td><td className="p-2">{p?.finalUl.toFixed(1)??'—'}{p&&!p.ok&&<p className="text-xs">농축 또는 로딩 조건 조정 필요</p>}</td><td><button className={smallBtnCls} onClick={()=>data(x=>{x.samples.splice(i,1);})}>삭제</button></td></tr>;})}</tbody><tfoot><tr><td colSpan={7} className="pt-3">Buffer 마스터 합계: {(d.samples.length*d.loading.finalUl/d.loading.sampleBufferX).toFixed(1)} µL · 10% 여유분 포함 {(d.samples.length*d.loading.finalUl/d.loading.sampleBufferX*1.1).toFixed(1)} µL</td></tr></tfoot></table></div>
      <p className="text-sm text-warning">원액 농도가 {Number(minimum.toFixed(3))} µg/µL 미만이면 농축 또는 로딩 조건 조정이 필요합니다.</p>
    </Section>
    <Section title="3. Lane map"><div className="flex gap-3"><label>웰 수 <select className={inputCls} value={d.wells} onChange={e=>data(x=>{x.wells=Number(e.target.value);x.lanes=defaultLanes(x.samples.map(s=>s.name),x.wells);})}>{[10,12,15].map(n=><option key={n}>{n}</option>)}</select></label><button className={btnCls} onClick={()=>data(x=>{x.lanes=defaultLanes(x.samples.map(s=>s.name),x.wells);})}>기본 배치로 초기화</button></div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{d.lanes.map((lane,i)=><Field key={i} label={`레인 ${i+1}`}><input list={`lane-options-${id}`} className={inputCls} value={lane} onChange={e=>data(x=>{x.lanes[i]=e.target.value;})}/></Field>)}</div><datalist id={`lane-options-${id}`}>{['(빈 칸)','Ladder',...new Set(d.samples.map(s=>s.name))].map(s=><option key={s} value={s}/>)}</datalist>
    </Section>
    <Section title="4. 항체"><button className={btnCls} disabled={d.antibodies.length>=20} onClick={()=>data(x=>{x.antibodies.push({id:nanoid(12),kind:'primary',target:'',product:'',dilutionN:1000,diluent:'5% BSA/TBST',totalUl:1000,start:null,end:null});})}>항체 추가</button>
      {d.antibodies.map((a,i)=>{const mix=antibodyMix(a.dilutionN,a.totalUl);return <div className="space-y-3 rounded-lg border border-line p-3" key={a.id}><div className="grid gap-3 sm:grid-cols-3">
        <Field label="종류"><select className={inputCls} value={a.kind} onChange={e=>data(x=>{x.antibodies[i].kind=e.target.value as 'primary'|'secondary';})}><option value="primary">1차</option><option value="secondary">2차</option></select></Field>
        <Field label="표적"><input className={inputCls} value={a.target} onChange={e=>data(x=>{x.antibodies[i].target=e.target.value;})}/></Field><Field label="제품"><input className={inputCls} value={a.product} onChange={e=>data(x=>{x.antibodies[i].product=e.target.value;})}/></Field>
        <Field label="희석비 1:N"><input type="number" min="1" max="100000" className={inputCls} value={a.dilutionN} onChange={e=>{const n=Number(e.target.value);if(n>=1&&n<=100000)data(x=>{x.antibodies[i].dilutionN=n;});}}/></Field>
        <Field label="희석액"><OptionCombobox category="antibody_diluent" value={a.diluent} onChange={v=>data(x=>{x.antibodies[i].diluent=v;})}/></Field>
        <Field label="총 부피 (µL)"><input type="number" min="1" max="50000" className={inputCls} value={a.totalUl} onChange={e=>{const n=Number(e.target.value);if(n>=1&&n<=50000)data(x=>{x.antibodies[i].totalUl=n;});}}/></Field>
      </div><p className="text-sm">항체 {Number(mix.antibodyUl.toFixed(2))} µL + 희석액 {Number(mix.diluentUl.toFixed(2))} µL</p>
        <div className="flex flex-wrap gap-3">{(['start','end'] as const).map(key=><label key={key} className="text-xs">{key==='start'?'시작':'종료'}<input type="datetime-local" className={inputCls} value={a[key]?new Date(Date.parse(a[key]!)-new Date(a[key]!).getTimezoneOffset()*60000).toISOString().slice(0,16):''} onChange={e=>data(x=>{x.antibodies[i][key]=e.target.value?new Date(e.target.value).toISOString():null;})}/><button className={smallBtnCls} onClick={()=>data(x=>{x.antibodies[i][key]=new Date().toISOString();})}>지금</button></label>)}<button className={smallBtnCls} onClick={()=>data(x=>{x.antibodies.splice(i,1);})}>항체 삭제</button></div>
      </div>;})}
    </Section>
    <Section title="5. ECL"><Field label="막 수"><input type="number" min="1" max="100" className={inputCls} value={d.membranes} onChange={e=>{const n=Number(e.target.value);if(Number.isInteger(n)&&n>=1&&n<=100)data(x=>{x.membranes=n;});}}/></Field><p>용액 1 {ecl.ecl1} µL + 용액 2 {ecl.ecl2} µL + TBST {ecl.tbst} µL = 총 {ecl.total} µL</p></Section>
    <Section title="6. 단계 체크리스트">{[1,2,3].map(phase=><div key={phase} className="space-y-3"><h3 className="font-semibold">{phase}단계</h3>{WESTERN_STEPS.filter(s=>s.phase===phase).map(s=>{const state=d.steps[s.id];return <div key={s.id} className={`space-y-2 rounded-lg border p-3 ${finished.includes(s.id)?'border-warning bg-warning-soft':'border-line'}`}><label className="flex items-center gap-2"><input type="checkbox" checked={state.done} onChange={e=>data(x=>{x.steps[s.id].done=e.target.checked;x.steps[s.id].doneAt=e.target.checked?new Date().toISOString():null;})}/><span>{s.id} {s.title}</span></label>{state.doneAt&&<p className="text-xs text-fg-muted">완료: {new Date(state.doneAt).toLocaleString('ko-KR')}</p>}{s.timerMin&&<StepTimer title={s.title} minutes={s.timerMin} onFinish={()=>setFinished(v=>[...v,s.id])}/>}<input aria-label={`${s.title} 메모`} placeholder="단계 메모" className={inputCls} value={state.note} onChange={e=>data(x=>{x.steps[s.id].note=e.target.value;})}/></div>;})}</div>)}
      <details><summary className="cursor-pointer">세척 요약표</summary><p className="my-2 text-sm text-fg-muted">단백질 전이 면을 위로 두고 shaker 위에서 진행하며, 매회 새 1X TBST로 교체합니다.</p><table className="w-full text-left text-sm"><thead><tr><th>세척 시점</th><th>횟수</th><th>1회 시간</th></tr></thead><tbody>{WASH_SUMMARY.map(row=><tr key={row[0]}>{row.map((v,i)=><td className="py-1" key={i}>{v}</td>)}</tr>)}</tbody><tfoot><tr><td>합계</td><td>17–18회</td><td>—</td></tr></tfoot></table></details>
    </Section>
    <Section title="7. 실험 기록란"><button className={btnCls} onClick={()=>data(x=>{for(const [key,value] of Object.entries(auto))if(!x.record[key]?.trim())x.record[key]=value;})}>자동값 채우기</button><div className="grid gap-3 md:grid-cols-2">{WESTERN_RECORD_FIELDS.map(f=><Field label={`${f.key} ${f.label}`} key={f.key}><textarea rows={3} className={inputCls} value={d.record[f.key]??''} placeholder={auto[f.key]??''} onChange={e=>data(x=>{x.record[f.key]=e.target.value;})}/></Field>)}</div><Field label="전체 메모"><textarea rows={4} className={inputCls} value={d.notes} onChange={e=>data(x=>{x.notes=e.target.value;})}/></Field></Section>
    {drawer&&<div className="fixed inset-0 z-50 bg-black/30" onMouseDown={()=>setDrawer(false)}><aside role="dialog" aria-modal="true" aria-label="연결 프로토콜" className="pr-panel-enter absolute inset-y-0 right-0 w-full max-w-2xl overflow-y-auto border-l border-line bg-raised p-6 shadow-xl" onMouseDown={e=>e.stopPropagation()}><div className="mb-4 flex justify-between"><h2 className="font-semibold">연결 프로토콜</h2><button className={btnCls} onClick={()=>setDrawer(false)}>닫기</button></div><Field label="Western 프로토콜"><select className={inputCls} value={view.run.protocol_id??''} onChange={e=>change(v=>{v.run.protocol_id=e.target.value||null;})}><option value="">연결 안 함</option>{protocols.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></Field>{protocol?<Markdown text={protocol.body_md??protocol.bodyMd??''}/>:<p className="text-fg-muted">프로토콜을 선택하세요.</p>}</aside></div>}
    {importOpen&&<BradfordImport busy={importing} onClose={()=>{if(!importing)setImportOpen(false);}} onImport={(assayId,indexes)=>{
      if(importLock.current)return;
      importLock.current=true;
      setImporting(true);
      const snapshot=latest.current!;
      queue.current=queue.current.catch(()=>{})
        .then(()=>api(`/api/western/${id}`,{method:'PUT',json:{data:snapshot.data,title:snapshot.run.title,performedAt:snapshot.run.performed_at,status:snapshot.run.status,protocolId:snapshot.run.protocol_id}}))
        .then(()=>api<WesternRunView>(`/api/western/${id}/import-bradford`,{method:'POST',json:{id:assayId,sampleIndexes:indexes}}))
        .then(v=>{revision.current++;saved.current=revision.current;latest.current=v;setView(v);setImportOpen(false);setSaving('저장됨');})
        .catch(e=>toast(e.message,{tone:'error'}))
        .finally(()=>{importLock.current=false;setImporting(false);});
    }}/>}
  </div>;
}
function BradfordImport({onClose,onImport,busy}:{onClose():void;onImport(id:string,indexes:number[]):void;busy:boolean}) {
  const [assays,setAssays]=useState<{id:string;title:string}[]>([]),[id,setId]=useState(''),[assay,setAssay]=useState<{data:BradfordData;result:BradfordResult}|null>(null),[selected,setSelected]=useState<number[]>([]),[error,setError]=useState('');
  useEffect(()=>{api<{id:string;title:string}[]>('/api/bradford').then(setAssays).catch(e=>setError(e.message));},[]);
  useEffect(()=>{setAssay(null);setSelected([]);if(!id)return;let alive=true;api<{data:BradfordData;result:BradfordResult}>(`/api/bradford/${id}`).then(v=>{if(alive)setAssay(v);}).catch(e=>setError(e.message));return ()=>{alive=false;};},[id]);
  return <Dialog title="Bradford에서 가져오기" onClose={onClose} dismissible={!busy} footer={<button className={primaryBtnCls} disabled={busy||!selected.length} onClick={()=>onImport(id,selected)}>{busy?'가져오는 중…':'선택한 시료 가져오기'}</button>}><Field label="정량 실험"><select className={inputCls} disabled={busy} value={id} onChange={e=>setId(e.target.value)}><option value="">실험 선택</option>{assays.map(a=><option key={a.id} value={a.id}>{a.title}</option>)}</select></Field>{error&&<p className="text-danger">{error}</p>}{assay?.data.samples.map((s,i)=><label className="my-3 flex gap-2" key={i}><input type="checkbox" disabled={busy} checked={selected.includes(i)} onChange={e=>setSelected(v=>e.target.checked?[...v,i]:v.filter(n=>n!==i))}/>{s.name} · {assay.result.samples[i].stockUgPerUl??'미정'} µg/µL</label>)}</Dialog>;
}
