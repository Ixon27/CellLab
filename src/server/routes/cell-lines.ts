import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { CULTURE_FIELDS, validateProfileFields } from '../../shared/culture';
import type { CultureProfileFields } from '../../shared/culture';
import type { SourceRef } from '../../shared/cell-line';
import { db, now, tx } from '../db';
import { getLineRow, toLineDto, toProfileDto, toLotDto, toCultureDto } from '../cell-lines';
import type { ProfileRow, CellLineRow, LotRow, CultureRow } from '../cell-lines';
import { ensureOptions } from '../catalog';
import { HttpError } from '../http-error';
import { getCellosaurus, searchCellosaurus } from '../services/cellosaurus';

export const cellLines = new Hono();
const columns: Record<string, string> = { name:'name', cellosaurusAc:'cellosaurus_ac', synonyms:'synonyms', species:'species', tissue:'tissue', disease:'disease', category:'category', sex:'sex', growthMode:'growth_mode', sourceBank:'source_bank', catalogNo:'catalog_no', providerUrl:'provider_url', providers:'providers', doublingTime:'doubling_time', caution:'caution', biosafety:'biosafety', maxPassage:'max_passage', tags:'tags', notes:'notes', sopProtocolId:'sop_protocol_id' };
function lineValues(body: Record<string, unknown>): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!Object.hasOwn(columns, key)) throw new HttpError(400, '알 수 없는 세포주 항목입니다');
    if (['synonyms','tags'].includes(key)) {
      if (!Array.isArray(value) || value.length > 30 || value.some(v => typeof v !== 'string' || v.length > 120)) throw new HttpError(400, '목록 형식이 올바르지 않습니다');
      out[columns[key]] = JSON.stringify(value); continue;
    }
    if (key === 'providers') {
      if (!Array.isArray(value) || value.length > 100 || value.some(v => !v || typeof v.database !== 'string' || typeof v.accession !== 'string' || (v.url !== null && typeof v.url !== 'string'))) throw new HttpError(400, '분양처 정보가 올바르지 않습니다');
      out.providers = JSON.stringify(value); continue;
    }
    if (key === 'maxPassage') {
      if (value !== null && (typeof value !== 'number' || !Number.isInteger(value) || value < 0)) throw new HttpError(400, '최대 passage가 올바르지 않습니다');
      out.max_passage = value as number | null; continue;
    }
    if (value !== null && typeof value !== 'string') throw new HttpError(400, '문자열 항목이 올바르지 않습니다');
    const text = typeof value === 'string' ? value.trim() : null;
    if (key === 'name' && (!text || text.length > 80)) throw new HttpError(400, '세포주 이름은 1–80자여야 합니다');
    if (key === 'growthMode' && !['adherent','suspension','mixed'].includes(text ?? '')) throw new HttpError(400, '배양 방식이 올바르지 않습니다');
    if (key === 'notes' && text === null) throw new HttpError(400, '메모 형식이 올바르지 않습니다');
    if (key === 'providerUrl' && text && !/^https?:\/\//i.test(text)) throw new HttpError(400, '분양처 URL은 http 또는 https 주소여야 합니다');
    if (key === 'sopProtocolId' && text !== null && !db.prepare('SELECT id FROM protocols WHERE id=?').get(text)) throw new HttpError(400, '프로토콜을 찾을 수 없습니다');
    if (text && text.length > (key === 'notes' ? 50000 : 5000)) throw new HttpError(400, '입력값이 너무 깁니다');
    out[columns[key]] = text;
  }
  return out;
}
function profileRow(id: string): ProfileRow {
  const r = db.prepare('SELECT * FROM culture_profiles WHERE id=?').get(id) as ProfileRow | undefined;
  if (!r) throw new HttpError(404, '배양 조건을 찾을 수 없습니다');
  return r;
}
function fields(raw: unknown): CultureProfileFields {
  try { return validateProfileFields(raw); } catch (e) { throw new HttpError(400, e instanceof Error ? e.message : '배양 조건이 올바르지 않습니다'); }
}
function addOptions(f: CultureProfileFields) {
  for (const def of CULTURE_FIELDS) if (def.catalog) {
    const v = f[def.key];
    if (typeof v === 'string') ensureOptions(def.catalog, [v]);
    else if (Array.isArray(v)) ensureOptions(def.catalog, v);
  }
}
function profileName(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.trim().length > 120) throw new HttpError(400, '조건 이름은 1–120자여야 합니다');
  return raw.trim();
}
cellLines.get('/cellosaurus/search', async c => {
  try { return c.json(await searchCellosaurus(c.req.query('q') ?? '')); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(502, 'Cellosaurus에 연결하지 못했습니다'); }
});
cellLines.get('/cellosaurus/:ac', async c => {
  let info;
  try { info = await getCellosaurus(c.req.param('ac')); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(502, 'Cellosaurus에 연결하지 못했습니다'); }
  if (!info) throw new HttpError(404, '세포주를 찾을 수 없습니다');
  return c.json(info);
});
cellLines.get('/cell-lines', c => {
  const rows = db.prepare('SELECT * FROM cell_lines ORDER BY name').all() as unknown as CellLineRow[];
  return c.json(rows.map(r => {
    const active = db.prepare("SELECT count(*) AS n FROM cultures WHERE cell_line_id=? AND status='active'").get(r.id);
    const stock = db.prepare('SELECT coalesce(sum(vials_remaining),0) AS n FROM cryo_lots WHERE cell_line_id=?').get(r.id);
    const profile = db.prepare('SELECT name FROM culture_profiles WHERE cell_line_id=? AND is_active=1').get(r.id);
    return { ...toLineDto(r), activeCultures: Number(active?.n ?? 0), vialsRemaining: Number(stock?.n ?? 0), activeProfileName: profile ? String(profile.name) : null };
  }));
});
cellLines.post('/cell-lines', async c => {
  const body = await c.req.json<Record<string, unknown>>();
  if (!body.name) throw new HttpError(400, '세포주 이름을 입력하세요');
  const values = lineValues(body); const id = nanoid(12); const at = now();
  const cols = Object.keys(values);
  db.prepare(`INSERT INTO cell_lines(id,created_at,updated_at,${cols.join(',')}) VALUES(?,?,?,${cols.map(() => '?').join(',')})`).run(id, at, at, ...Object.values(values));
  return c.json(toLineDto(getLineRow(id)), 201);
});
cellLines.get('/cell-lines/:id', c => {
  const id = c.req.param('id');
  return c.json({ line: toLineDto(getLineRow(id)), profiles: (db.prepare('SELECT * FROM culture_profiles WHERE cell_line_id=? ORDER BY created_at').all(id) as unknown as ProfileRow[]).map(toProfileDto), lots: (db.prepare('SELECT * FROM cryo_lots WHERE cell_line_id=? ORDER BY event_at').all(id) as unknown as LotRow[]).map(toLotDto), cultures: (db.prepare('SELECT * FROM cultures WHERE cell_line_id=? ORDER BY started_at').all(id) as unknown as CultureRow[]).map(toCultureDto) });
});
cellLines.put('/cell-lines/:id', async c => {
  const row = getLineRow(c.req.param('id')); const values = lineValues(await c.req.json<Record<string, unknown>>());
  db.prepare(`UPDATE cell_lines SET ${[...Object.keys(values).map(k => `${k}=?`),'updated_at=?'].join(',')} WHERE id=?`).run(...Object.values(values), now(), row.id);
  return c.json(toLineDto(getLineRow(row.id)));
});
cellLines.delete('/cell-lines/:id', c => { const row = getLineRow(c.req.param('id')); db.prepare('DELETE FROM cell_lines WHERE id=?').run(row.id); return c.json({ok:true}); });
cellLines.post('/cell-lines/:id/profiles', async c => {
  const line = getLineRow(c.req.param('id')); const b = await c.req.json<Record<string, unknown>>();
  const name = profileName(b.name); const f = fields(b.fields);
  if (!['manual','literature','provider'].includes(String(b.origin))) throw new HttpError(400, '조건 출처가 올바르지 않습니다');
  if (b.activate !== undefined && typeof b.activate !== 'boolean') throw new HttpError(400, '활성화 값이 올바르지 않습니다');
  const refs = b.sourceRefs ?? [];
  if (!Array.isArray(refs) || refs.some((r: SourceRef) => !r || !CULTURE_FIELDS.some(d => d.key === r.field) || typeof r.sourceLabel !== 'string' || typeof r.url !== 'string' || typeof r.quote !== 'string')) throw new HttpError(400, '출처 근거 형식이 올바르지 않습니다');
  const id = nanoid(12); const at = now();
  tx(() => {
    const active = b.activate === true || !db.prepare('SELECT id FROM culture_profiles WHERE cell_line_id=?').get(line.id);
    if (active) db.prepare('UPDATE culture_profiles SET is_active=0 WHERE cell_line_id=?').run(line.id);
    addOptions(f);
    db.prepare('INSERT INTO culture_profiles(id,cell_line_id,name,origin,fields,source_refs,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,line.id,name,String(b.origin),JSON.stringify(f),JSON.stringify(refs),active ? 1 : 0,at,at);
  });
  return c.json(toProfileDto(profileRow(id)),201);
});
cellLines.put('/profiles/:id', async c => {
  const row = profileRow(c.req.param('id')); const b = await c.req.json<Record<string,unknown>>();
  const name = b.name === undefined ? row.name : profileName(b.name); const f = b.fields === undefined ? null : fields(b.fields);
  tx(() => { if (f) addOptions(f); db.prepare('UPDATE culture_profiles SET name=?,fields=?,updated_at=? WHERE id=?').run(name,f ? JSON.stringify(f) : row.fields,now(),row.id); });
  return c.json(toProfileDto(profileRow(row.id)));
});
cellLines.post('/profiles/:id/activate', c => {
  const row = profileRow(c.req.param('id'));
  tx(() => { db.prepare('UPDATE culture_profiles SET is_active=0 WHERE cell_line_id=?').run(row.cell_line_id); db.prepare('UPDATE culture_profiles SET is_active=1,updated_at=? WHERE id=?').run(now(),row.id); });
  return c.json(toProfileDto(profileRow(row.id)));
});
cellLines.delete('/profiles/:id', c => {
  const row = profileRow(c.req.param('id'));
  if (row.is_active) throw new HttpError(400, '활성 배양 조건은 삭제할 수 없습니다. 다른 조건을 먼저 활성화하세요');
  db.prepare('DELETE FROM culture_profiles WHERE id=?').run(row.id); return c.json({ok:true});
});
