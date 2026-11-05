import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { computeBradford, STANDARD_PRESETS, validateBradfordData, type BradfordData } from '../../shared/bradford';
import { db, now, parseJsonColumn } from '../db';
import { HttpError } from '../http-error';

interface AssayRow { id: string; title: string; performed_at: string; data: string; protocol_id: string | null; created_at: string; updated_at: string }
export const bradford = new Hono();
function getAssay(id: string): AssayRow {
  const row=db.prepare('SELECT * FROM bradford_assays WHERE id=?').get(id) as unknown as AssayRow|undefined;
  if(!row) throw new HttpError(404,'정량 실험을 찾을 수 없습니다');
  return row;
}
function detail(row: AssayRow) {
  const data=validateBradfordData(parseJsonColumn(row.data,null));
  const {data: _data,...assay}=row;
  return {assay,data,result:computeBradford(data)};
}
function title(value: unknown): string {
  if(typeof value!=='string'||!value.trim()||value.trim().length>200) throw new HttpError(400,'제목은 1–200자여야 합니다');
  return value.trim();
}
function date(value: unknown): string {
  if(typeof value!=='string'||!Number.isFinite(Date.parse(value))) throw new HttpError(400,'실험일이 올바르지 않습니다');
  return value;
}
bradford.get('/bradford',c=>c.json((db.prepare('SELECT * FROM bradford_assays ORDER BY performed_at DESC, created_at DESC').all() as unknown as AssayRow[]).map(row=>{
  const {assay,data,result}=detail(row);
  return {...assay,sampleCount:data.samples.length,r2:result.fit?.r2??null};
})));
bradford.post('/bradford',async c=>{
  const body=await c.req.json();
  const preset=STANDARD_PRESETS.find(p=>p.id===body.preset);
  if(!preset) throw new HttpError(400,'표준 농도 프리셋을 선택하세요');
  const id=nanoid(12),stamp=now();
  const data: BradfordData={wavelengthNm:preset.id==='bca'?562:595,fit:'linear',subtractBlank:true,standards:preset.concs.map(conc=>({conc,reps:Array.from({length:preset.id==='bca'?3:2},()=>({abs:null,excluded:false}))})),samples:[],notes:''};
  db.prepare('INSERT INTO bradford_assays(id,title,performed_at,data,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,title(body.title),date(body.performedAt),JSON.stringify(data),stamp,stamp);
  return c.json(detail(getAssay(id)),201);
});
bradford.get('/bradford/:id',c=>c.json(detail(getAssay(c.req.param('id')))));
bradford.put('/bradford/:id',async c=>{
  const row=getAssay(c.req.param('id')),body=await c.req.json();
  let data=row.data;
  if(body.data!==undefined) {
    try {data=JSON.stringify(validateBradfordData(body.data));} catch(error) {throw new HttpError(400,error instanceof Error?error.message:'정량 데이터가 올바르지 않습니다');}
  }
  let protocolId=row.protocol_id;
  if(body.protocolId!==undefined) {
    if(body.protocolId!==null && (typeof body.protocolId!=='string'||!db.prepare('SELECT id FROM protocols WHERE id=?').get(body.protocolId))) throw new HttpError(400,'연결할 프로토콜을 찾을 수 없습니다');
    protocolId=body.protocolId;
  }
  db.prepare('UPDATE bradford_assays SET title=?,performed_at=?,data=?,protocol_id=?,updated_at=? WHERE id=?').run(body.title===undefined?row.title:title(body.title),body.performedAt===undefined?row.performed_at:date(body.performedAt),data,protocolId,now(),row.id);
  return c.json(detail(getAssay(row.id)));
});
bradford.delete('/bradford/:id',c=>{const row=getAssay(c.req.param('id'));db.prepare('DELETE FROM bradford_assays WHERE id=?').run(row.id);return c.json({ok:true});});
