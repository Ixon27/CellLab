import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { computeBradford, validateBradfordData } from '../../shared/bradford';
import { createWesternData, defaultLanes, validateWesternData } from '../../shared/western';
import type { WesternData, WesternRunMeta } from '../../shared/western';
import { db, now, parseJsonColumn } from '../db';
import { HttpError } from '../http-error';

export const western = new Hono();
interface RunRow extends WesternRunMeta {data:string}
function getRun(id:string):RunRow {
  const row=db.prepare('SELECT * FROM western_runs WHERE id=?').get(id) as unknown as RunRow|undefined;
  if(!row)throw new HttpError(404,'Western 실험을 찾을 수 없습니다');
  return row;
}
function view(row:RunRow) {const {data,...run}=row;return {run,data:validateWesternData(parseJsonColumn(data,null))};}
function cleanTitle(v:unknown):string {if(typeof v!=='string'||!v.trim()||v.trim().length>200)throw new HttpError(400,'제목은 1–200자여야 합니다');return v.trim();}
function protocolId(v:unknown):string|null {
  if(v===null)return null;
  if(typeof v!=='string'||!db.prepare('SELECT id FROM protocols WHERE id=?').get(v))throw new HttpError(400,'프로토콜을 찾을 수 없습니다');
  return v;
}
function importBradford(data:WesternData,input:unknown):WesternData {
  if(!input||typeof input!=='object')throw new HttpError(400,'Bradford 선택 정보가 올바르지 않습니다');
  const {id,sampleIndexes}=input as {id:unknown;sampleIndexes:unknown};
  if(typeof id!=='string'||!Array.isArray(sampleIndexes)||!sampleIndexes.length||new Set(sampleIndexes).size!==sampleIndexes.length)throw new HttpError(400,'가져올 시료를 선택하세요');
  const assay=db.prepare('SELECT title,data FROM bradford_assays WHERE id=?').get(id) as {title:string;data:string}|undefined;
  if(!assay)throw new HttpError(404,'Bradford 정량을 찾을 수 없습니다');
  const source=validateBradfordData(parseJsonColumn(assay.data,null)),result=computeBradford(source);
  const notes:string[]=[];
  for(const index of sampleIndexes) {
    if(typeof index!=='number'||!Number.isInteger(index)||index<0||index>=source.samples.length)throw new HttpError(400,'시료 선택이 올바르지 않습니다');
    const sample=source.samples[index],conc=result.samples[index].stockUgPerUl;
    data.samples.push({id:nanoid(12),name:sample.name,concUgPerUl:conc,source:{bradfordId:id,sampleIndex:index}});
    notes.push(`${sample.name}: ${conc??'미정'} µg/µL (희석배수 ${sample.dilution})`);
  }
  data.lanes=defaultLanes(data.samples.map(s=>s.name),data.wells);
  data.record.r07=[data.record.r07,`${assay.title}: ${notes.join(', ')}`].filter(Boolean).join('\n');
  return validateWesternData(data);
}
western.get('/western',(c)=>c.json(db.prepare('SELECT id,title,performed_at,status,protocol_id,created_at,updated_at FROM western_runs ORDER BY performed_at DESC,created_at DESC').all()));
western.post('/western',async(c)=>{
  const body=await c.req.json();
  const timestamp=now(),id=nanoid(12),title=body.title===undefined?`Western ${timestamp.slice(0,10)}`:cleanTitle(body.title);
  let data=createWesternData();
  try {if(body.fromBradford!==undefined)data=importBradford(data,body.fromBradford);}catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,(e as Error).message);}
  const protocol=db.prepare("SELECT id FROM protocols WHERE id='western-blot-v1-1'").get()? 'western-blot-v1-1':null;
  db.prepare('INSERT INTO western_runs(id,title,performed_at,status,protocol_id,data,created_at,updated_at) VALUES(?,?,?,\'planned\',?,?,?,?)').run(id,title,timestamp,protocol,JSON.stringify(data),timestamp,timestamp);
  return c.json(view(getRun(id)),201);
});
western.get('/western/:id',(c)=>c.json(view(getRun(c.req.param('id')))));
western.put('/western/:id',async(c)=>{
  const row=getRun(c.req.param('id')),body=await c.req.json();
  const title=body.title===undefined?row.title:cleanTitle(body.title);
  const performedAt=body.performedAt??row.performed_at;
  if(typeof performedAt!=='string'||!Number.isFinite(Date.parse(performedAt)))throw new HttpError(400,'실험일이 올바르지 않습니다');
  const status=body.status??row.status;
  if(!['planned','in_progress','done'].includes(status))throw new HttpError(400,'진행 상태가 올바르지 않습니다');
  let data;
  try{data=body.data===undefined?view(row).data:validateWesternData(body.data);}catch(e){throw new HttpError(400,(e as Error).message);}
  const protocol=body.protocolId===undefined?row.protocol_id:protocolId(body.protocolId);
  db.prepare('UPDATE western_runs SET title=?,performed_at=?,status=?,protocol_id=?,data=?,updated_at=? WHERE id=?').run(title,performedAt,status,protocol,JSON.stringify(data),now(),row.id);
  return c.json(view(getRun(row.id)));
});
western.delete('/western/:id',(c)=>{const row=getRun(c.req.param('id'));db.prepare('DELETE FROM western_runs WHERE id=?').run(row.id);return c.json({ok:true});});
western.post('/western/:id/import-bradford',async(c)=>{
  const row=getRun(c.req.param('id')),input=await c.req.json();
  let data;
  try{data=importBradford(view(row).data,input);}catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,(e as Error).message);}
  db.prepare('UPDATE western_runs SET data=?,updated_at=? WHERE id=?').run(JSON.stringify(data),now(),row.id);
  return c.json(view(getRun(row.id)));
});
