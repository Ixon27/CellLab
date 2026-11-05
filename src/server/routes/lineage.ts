import { Hono } from 'hono';
import type { CultureRow, LogRow, LotRow } from '../cell-lines';
import type { CultureProfileFields } from '../../shared/culture';
import type { LogDto } from '../../shared/cell-line';
import { buildLineageGraph } from '../../shared/lineage';
import { activeProfileRow, getLineRow, toCultureDto, toLogDto, toLotDto } from '../cell-lines';
import { db, now, parseJsonColumn, tx } from '../db';
import { HttpError } from '../http-error';
import { addLog, endCulture, freezeCulture, getCulture, getLog, getLot, logValues, LOW_VIAL_THRESHOLD, numeric, passageCulture, profileFor, receiveCulture, receiveLot, text, thawLot } from '../lineage';
import type { LineageInput } from '../lineage';

export const lineage = new Hono();
lineage.post('/cell-lines/:id/lots', async c => c.json(receiveLot(c.req.param('id'), await c.req.json<LineageInput>()), 201));
lineage.post('/cell-lines/:id/cultures', async c => c.json(receiveCulture(c.req.param('id'), await c.req.json<LineageInput>()), 201));
lineage.post('/lots/:id/thaw', async c => c.json(thawLot(c.req.param('id'), await c.req.json<LineageInput>()), 201));
lineage.post('/cultures/:id/passage', async c => c.json(passageCulture(c.req.param('id'), await c.req.json<LineageInput>()), 201));
lineage.post('/cultures/:id/freeze', async c => c.json(freezeCulture(c.req.param('id'), await c.req.json<LineageInput>()), 201));
lineage.post('/cultures/:id/end', async c => c.json(endCulture(c.req.param('id'), await c.req.json<LineageInput>())));
lineage.post('/cultures/:id/logs', async c => c.json(addLog(c.req.param('id'), await c.req.json<LineageInput>()), 201));
lineage.get('/cultures/:id/logs', c => {
  getCulture(c.req.param('id'));
  const rows = db.prepare('SELECT * FROM culture_logs WHERE culture_id=? ORDER BY at,created_at,id').all(c.req.param('id')) as unknown as LogRow[];
  return c.json(rows.map(toLogDto));
});
lineage.put('/lots/:id', async c => {
  const b = await c.req.json<LineageInput>();
  const result = tx(() => {
    const lot = getLot(c.req.param('id'));
    const label = b.label === undefined ? lot.label : text(b.label, '라벨', true);
    const location = b.location === undefined ? lot.location : text(b.location, '보관 위치');
    const notes = b.notes === undefined ? lot.notes : text(b.notes, '메모', false, 10000);
    const vials = b.vialsRemaining === undefined ? lot.vials_remaining : numeric(b.vialsRemaining, '남은 바이알', 0, lot.vials_initial, true);
    db.prepare('UPDATE cryo_lots SET label=?,location=?,notes=?,vials_remaining=? WHERE id=?').run(label, location, notes, vials, lot.id);
    return toLotDto(getLot(lot.id));
  });
  return c.json(result);
});
lineage.put('/cultures/:id', async c => {
  const b = await c.req.json<LineageInput>();
  return c.json(tx(() => {
    const culture = getCulture(c.req.param('id'));
    db.prepare('UPDATE cultures SET label=?,vessel=?,notes=?,profile_id=? WHERE id=?').run(b.label === undefined ? culture.label : text(b.label, '라벨', true), b.vessel === undefined ? culture.vessel : text(b.vessel, '배양 용기', true), b.notes === undefined ? culture.notes : text(b.notes, '메모', false, 10000), b.profileId === undefined ? culture.profile_id : profileFor(culture.cell_line_id, b.profileId), culture.id);
    return toCultureDto(getCulture(culture.id));
  }));
});
lineage.put('/logs/:id', async c => {
  const b = await c.req.json<LineageInput>();
  return c.json(tx(() => {
    const row = getLog(c.req.param('id'));
    if (row.type === 'passage' || row.type === 'freeze') throw new HttpError(400, '계대·동결 기록은 수정할 수 없습니다');
    if (b.type === 'passage' || b.type === 'freeze') throw new HttpError(400, '계대·동결 기록은 해당 작업으로 추가하세요');
    const v = logValues({ ...toLogDto(row), ...b });
    db.prepare('UPDATE culture_logs SET at=?,type=?,confluency_pct=?,cells_per_ml=?,viability_pct=?,total_cells=?,mycoplasma=?,extra=?,note=? WHERE id=?').run(v.at, v.type, v.confluency, v.cells, v.viability, v.total, v.mycoplasma, v.extra, v.note, row.id);
    return toLogDto(getLog(row.id));
  }));
});
lineage.delete('/logs/:id', c => {
  tx(() => {
    const row = getLog(c.req.param('id'));
    if (row.type === 'passage' || row.type === 'freeze') throw new HttpError(400, '계대·동결 기록은 삭제할 수 없습니다');
    db.prepare('DELETE FROM culture_logs WHERE id=?').run(row.id);
  });
  return c.json({ ok: true });
});
lineage.get('/cell-lines/:id/lineage', c => {
  const id = c.req.param('id');
  getLineRow(id);
  const lots = db.prepare('SELECT * FROM cryo_lots WHERE cell_line_id=? ORDER BY event_at,created_at,id').all(id) as unknown as LotRow[];
  const cultures = db.prepare('SELECT * FROM cultures WHERE cell_line_id=? ORDER BY started_at,created_at,id').all(id) as unknown as CultureRow[];
  const logs = db.prepare('SELECT l.* FROM culture_logs l JOIN cultures c ON c.id=l.culture_id WHERE c.cell_line_id=? ORDER BY l.at,l.created_at,l.id').all(id) as unknown as LogRow[];
  const last: Record<string, LogDto> = {};
  for (const l of logs) last[l.culture_id] = toLogDto(l);
  return c.json(buildLineageGraph(lots.map(toLotDto), cultures.map(toCultureDto), last));
});
lineage.get('/dashboard', c => {
  const current = Date.parse(now());
  const cultures = db.prepare('SELECT * FROM cultures WHERE status=\'active\' ORDER BY started_at,id').all() as unknown as CultureRow[];
  const activeCultures = cultures.map(culture => {
    const line = getLineRow(culture.cell_line_id);
    const last = db.prepare('SELECT * FROM culture_logs WHERE culture_id=? ORDER BY at DESC,created_at DESC,id DESC LIMIT 1').get(culture.id) as LogRow | undefined;
    const feed = db.prepare('SELECT at FROM culture_logs WHERE culture_id=? AND type IN (\'medium_change\',\'passage\') ORDER BY at DESC LIMIT 1').get(culture.id) as { at: string } | undefined;
    const profile = activeProfileRow(line.id);
    const fields = parseJsonColumn<CultureProfileFields>(profile?.fields, {});
    const daysSinceFeed = Math.max(0, Math.floor((current - Date.parse(feed?.at ?? culture.started_at)) / 86400000));
    return { id: culture.id, label: culture.label, lineId: line.id, lineName: line.name, passage: culture.passage, vessel: culture.vessel, startedAt: culture.started_at, daysInCulture: Math.max(0, Math.floor((current - Date.parse(culture.started_at)) / 86400000)), lastLog: last ? toLogDto(last) : null, daysSinceFeed, feedOverdue: fields.medium_change_days != null && daysSinceFeed > fields.medium_change_days, overPassage: line.max_passage !== null && culture.passage > line.max_passage };
  });
  const lowStock = db.prepare('SELECT l.id AS lotId,l.label,c.name AS lineName,l.vials_remaining AS vialsRemaining FROM cryo_lots l JOIN cell_lines c ON c.id=l.cell_line_id WHERE l.vials_remaining<=? ORDER BY l.vials_remaining,l.event_at').all(LOW_VIAL_THRESHOLD);
  const recentBradford = db.prepare('SELECT id,title,performed_at AS performedAt FROM bradford_assays ORDER BY performed_at DESC LIMIT 5').all();
  const recentWestern = db.prepare('SELECT id,title,performed_at AS performedAt,status FROM western_runs ORDER BY performed_at DESC LIMIT 5').all();
  return c.json({ activeCultures, lowStock, recentBradford, recentWestern });
});
