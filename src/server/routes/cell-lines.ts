import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { CULTURE_FIELDS, normalizeFieldValue, validateProfileFields } from '../../shared/culture';
import type { CultureProfileFields } from '../../shared/culture';
import type { SourceRef } from '../../shared/cell-line';
import { isAdoptedRef, validateSourceRefs } from '../../shared/literature-adoption';
import { parseLiteratureReport } from '../../shared/literature';
import type { LiteratureReport } from '../../shared/literature';
import { validateExecutionPlan } from '../../shared/culture-plan';
import { db, now, parseJsonColumn, tx } from '../db';
import { getLineRow, toLineDto, toProfileDto, toCultureDtos, toLotDtos } from '../cell-lines';
import type { ProfileRow, CellLineRow, LotRow, CultureRow } from '../cell-lines';
import { ensureOptions } from '../catalog';
import { HttpError } from '../http-error';
import { photoFilesForLine, removePhotoFiles } from '../photos';
import { getCellosaurus, searchCellosaurus } from '../services/cellosaurus';

export const cellLines = new Hono();
const columns: Record<string, string> = {
  name: 'name',
  cellosaurusAc: 'cellosaurus_ac',
  synonyms: 'synonyms',
  species: 'species',
  tissue: 'tissue',
  disease: 'disease',
  category: 'category',
  sex: 'sex',
  growthMode: 'growth_mode',
  sourceBank: 'source_bank',
  catalogNo: 'catalog_no',
  providerUrl: 'provider_url',
  providers: 'providers',
  doublingTime: 'doubling_time',
  caution: 'caution',
  biosafety: 'biosafety',
  maxPassage: 'max_passage',
  stockCellsPerMl: 'stock_cells_per_ml',
  tags: 'tags',
  notes: 'notes',
  sopProtocolId: 'sop_protocol_id',
};
function lineValues(body: Record<string, unknown>): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!Object.hasOwn(columns, key)) throw new HttpError(400, '알 수 없는 세포주 항목입니다');
    if (['synonyms', 'tags'].includes(key)) {
      if (!Array.isArray(value) || value.length > 30 || value.some((v) => typeof v !== 'string' || v.length > 120))
        throw new HttpError(400, '목록 형식이 올바르지 않습니다');
      out[columns[key]] = JSON.stringify(value);
      continue;
    }
    if (key === 'providers') {
      if (
        !Array.isArray(value) ||
        value.length > 100 ||
        value.some(
          (v) => !v || typeof v.database !== 'string' || typeof v.accession !== 'string' || (v.url !== null && typeof v.url !== 'string'),
        )
      )
        throw new HttpError(400, '분양처 정보가 올바르지 않습니다');
      out.providers = JSON.stringify(value);
      continue;
    }
    if (key === 'maxPassage') {
      if (value !== null && (typeof value !== 'number' || !Number.isInteger(value) || value < 0))
        throw new HttpError(400, '최대 passage가 올바르지 않습니다');
      out.max_passage = value as number | null;
      continue;
    }
    if (key === 'stockCellsPerMl') {
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1e10))
        throw new HttpError(400, 'stock 세포 농도(cells/mL)는 0보다 큰 숫자여야 합니다');
      out.stock_cells_per_ml = value as number | null;
      continue;
    }
    if (value !== null && typeof value !== 'string') throw new HttpError(400, '문자열 항목이 올바르지 않습니다');
    const text = typeof value === 'string' ? value.trim() : null;
    if (key === 'name' && (!text || text.length > 80)) throw new HttpError(400, '세포주 이름은 1–80자여야 합니다');
    if (key === 'growthMode' && !['adherent', 'suspension', 'mixed'].includes(text ?? ''))
      throw new HttpError(400, '배양 방식이 올바르지 않습니다');
    if (key === 'notes' && text === null) throw new HttpError(400, '메모 형식이 올바르지 않습니다');
    if (key === 'providerUrl' && text && !/^https?:\/\//i.test(text))
      throw new HttpError(400, '분양처 URL은 http 또는 https 주소여야 합니다');
    if (key === 'sopProtocolId' && text !== null && !db.prepare('SELECT id FROM protocols WHERE id=?').get(text))
      throw new HttpError(400, '프로토콜을 찾을 수 없습니다');
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
function executionPlan(raw: unknown) {
  try { return validateExecutionPlan(raw); }
  catch (e) { throw new HttpError(400, e instanceof Error ? e.message : '실행 계획이 올바르지 않습니다'); }
}
function sourceRefs(raw: unknown): SourceRef[] {
  let refs: SourceRef[];
  try {
    refs = validateSourceRefs(raw);
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : '출처 근거 형식이 올바르지 않습니다');
  }
  // 보고서가 아직 있으면 인용한 근거 id가 그 자료에 실제로 있는지 확인한다. 보고서가 삭제된 뒤에도 저장된 근거는 유지된다.
  const reports = new Map<string, LiteratureReport | null>();
  for (const ref of refs) {
    if (!ref.reportId || !ref.sourceKey || !ref.evidenceIds) continue;
    if (!reports.has(ref.reportId)) {
      const row = db.prepare('SELECT content FROM literature_reports WHERE id=?').get(ref.reportId) as { content: string } | undefined;
      reports.set(ref.reportId, row ? parseLiteratureReport(row.content) : null);
    }
    const report = reports.get(ref.reportId);
    if (!report) continue;
    const source = report.sources.find((s) => s.key === ref.sourceKey);
    if (!source || ref.evidenceIds.some((id) => !(id in source.evidence)))
      throw new HttpError(400, '문헌 보고서에 없는 근거 문장입니다');
  }
  return refs;
}
/** 문헌에서 채택한 근거는 그 값에 대한 것이므로, 값이 바뀌는 PUT에서 sourceRefs를 따로 보내지 않으면 바뀐 항목의 채택 근거를 함께 제거한다. */
function withoutStaleAdoptions(row: ProfileRow, next: CultureProfileFields): SourceRef[] {
  const previous = parseJsonColumn<CultureProfileFields>(row.fields, {});
  return parseJsonColumn<SourceRef[]>(row.source_refs, []).filter(
    (ref) => !isAdoptedRef(ref) || normalizeFieldValue(next[ref.field] ?? null) === normalizeFieldValue(previous[ref.field] ?? null),
  );
}
function fields(raw: unknown): CultureProfileFields {
  try {
    return validateProfileFields(raw);
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : '배양 조건이 올바르지 않습니다');
  }
}
function addOptions(f: CultureProfileFields) {
  for (const def of CULTURE_FIELDS)
    if (def.catalog) {
      const v = f[def.key];
      if (typeof v === 'string') ensureOptions(def.catalog, [v]);
      else if (Array.isArray(v)) ensureOptions(def.catalog, v);
    }
}
function profileName(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.trim().length > 120) throw new HttpError(400, '조건 이름은 1–120자여야 합니다');
  return raw.trim();
}
cellLines.get('/cellosaurus/search', async (c) => {
  try {
    return c.json(await searchCellosaurus(c.req.query('q') ?? ''));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, 'Cellosaurus에 연결하지 못했습니다');
  }
});
cellLines.get('/cellosaurus/:ac', async (c) => {
  let info;
  try {
    info = await getCellosaurus(c.req.param('ac'));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, 'Cellosaurus에 연결하지 못했습니다');
  }
  if (!info) throw new HttpError(404, '세포주를 찾을 수 없습니다');
  return c.json(info);
});
cellLines.get('/cell-lines', (c) => {
  const rows = db.prepare('SELECT * FROM cell_lines ORDER BY name').all() as unknown as CellLineRow[];
  return c.json(
    rows.map((r) => {
      const active = db.prepare("SELECT count(*) AS n FROM cultures WHERE cell_line_id=? AND status='active'").get(r.id);
      const stock = db.prepare('SELECT coalesce(sum(vials_remaining),0) AS n FROM cryo_lots WHERE cell_line_id=?').get(r.id);
      const profile = db.prepare('SELECT name FROM culture_profiles WHERE cell_line_id=? AND is_active=1').get(r.id);
      return {
        ...toLineDto(r),
        activeCultures: Number(active?.n ?? 0),
        vialsRemaining: Number(stock?.n ?? 0),
        activeProfileName: profile ? String(profile.name) : null,
      };
    }),
  );
});
cellLines.post('/cell-lines', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  if (!body.name) throw new HttpError(400, '세포주 이름을 입력하세요');
  const values = lineValues(body);
  const id = nanoid(12);
  const at = now();
  const cols = Object.keys(values);
  db.prepare(`INSERT INTO cell_lines(id,created_at,updated_at,${cols.join(',')}) VALUES(?,?,?,${cols.map(() => '?').join(',')})`).run(
    id,
    at,
    at,
    ...Object.values(values),
  );
  return c.json(toLineDto(getLineRow(id)), 201);
});
cellLines.get('/cell-lines/:id', (c) => {
  const id = c.req.param('id');
  return c.json({
    line: toLineDto(getLineRow(id)),
    profiles: (
      db.prepare('SELECT * FROM culture_profiles WHERE cell_line_id=? ORDER BY created_at').all(id) as unknown as ProfileRow[]
    ).map(toProfileDto),
    lots: toLotDtos(db.prepare('SELECT * FROM cryo_lots WHERE cell_line_id=? ORDER BY event_at').all(id) as unknown as LotRow[]),
    cultures: toCultureDtos(db.prepare('SELECT * FROM cultures WHERE cell_line_id=? ORDER BY started_at').all(id) as unknown as CultureRow[]),
  });
});
cellLines.put('/cell-lines/:id', async (c) => {
  const row = getLineRow(c.req.param('id'));
  const values = lineValues(await c.req.json<Record<string, unknown>>());
  db.prepare(`UPDATE cell_lines SET ${[...Object.keys(values).map((k) => `${k}=?`), 'updated_at=?'].join(',')} WHERE id=?`).run(
    ...Object.values(values),
    now(),
    row.id,
  );
  return c.json(toLineDto(getLineRow(row.id)));
});
cellLines.delete('/cell-lines/:id', (c) => {
  const row = getLineRow(c.req.param('id'));
  const photoFiles = photoFilesForLine(row.id);
  db.prepare('DELETE FROM cell_lines WHERE id=?').run(row.id);
  removePhotoFiles(photoFiles);
  return c.json({ ok: true });
});
cellLines.post('/cell-lines/:id/profiles', async (c) => {
  const line = getLineRow(c.req.param('id'));
  const b = await c.req.json<Record<string, unknown>>();
  const name = profileName(b.name);
  const f = fields(b.fields);
  if (!['manual', 'literature', 'provider'].includes(String(b.origin))) throw new HttpError(400, '조건 출처가 올바르지 않습니다');
  if (b.activate !== undefined && typeof b.activate !== 'boolean') throw new HttpError(400, '활성화 값이 올바르지 않습니다');
  const refs = sourceRefs(b.sourceRefs ?? []);
  const plan = executionPlan(b.executionPlan);
  const id = nanoid(12);
  const at = now();
  tx(() => {
    const active = b.activate === true || !db.prepare('SELECT id FROM culture_profiles WHERE cell_line_id=?').get(line.id);
    if (active) db.prepare('UPDATE culture_profiles SET is_active=0 WHERE cell_line_id=?').run(line.id);
    addOptions(f);
    db.prepare(
      'INSERT INTO culture_profiles(id,cell_line_id,name,origin,fields,source_refs,execution_plan,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    ).run(id, line.id, name, String(b.origin), JSON.stringify(f), JSON.stringify(refs), plan === null ? null : JSON.stringify(plan), active ? 1 : 0, at, at);
  });
  return c.json(toProfileDto(profileRow(id)), 201);
});
cellLines.get('/profiles/:id', (c) => c.json(toProfileDto(profileRow(c.req.param('id')))));
cellLines.put('/profiles/:id', async (c) => {
  const row = profileRow(c.req.param('id'));
  const b = await c.req.json<Record<string, unknown>>();
  const name = b.name === undefined ? row.name : profileName(b.name);
  const f = b.fields === undefined ? null : fields(b.fields);
  const refs =
    b.sourceRefs !== undefined
      ? JSON.stringify(sourceRefs(b.sourceRefs))
      : f
        ? JSON.stringify(withoutStaleAdoptions(row, f))
        : row.source_refs;
  const plan = b.executionPlan === undefined ? row.execution_plan : executionPlan(b.executionPlan);
  const storedPlan = typeof plan === 'string' || plan === null ? plan : JSON.stringify(plan);
  tx(() => {
    if (f) addOptions(f);
    db.prepare('UPDATE culture_profiles SET name=?,fields=?,source_refs=?,execution_plan=?,updated_at=? WHERE id=?').run(
      name,
      f ? JSON.stringify(f) : row.fields,
      refs,
      storedPlan,
      now(),
      row.id,
    );
  });
  return c.json(toProfileDto(profileRow(row.id)));
});
cellLines.post('/profiles/:id/activate', (c) => {
  const row = profileRow(c.req.param('id'));
  tx(() => {
    db.prepare('UPDATE culture_profiles SET is_active=0 WHERE cell_line_id=?').run(row.cell_line_id);
    db.prepare('UPDATE culture_profiles SET is_active=1,updated_at=? WHERE id=?').run(now(), row.id);
  });
  return c.json(toProfileDto(profileRow(row.id)));
});
cellLines.delete('/profiles/:id', (c) => {
  const row = profileRow(c.req.param('id'));
  if (row.is_active) throw new HttpError(400, '활성 배양 조건은 삭제할 수 없습니다. 다른 조건을 먼저 활성화하세요');
  db.prepare('DELETE FROM culture_profiles WHERE id=?').run(row.id);
  return c.json({ ok: true });
});
