import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { CultureRow, LogRow, LotRow } from '../cell-lines';
import type { CultureProfileFields } from '../../shared/culture';
import type { LogDto } from '../../shared/cell-line';
import { PHOTO_MAX_BYTES } from '../../shared/culture-operations';
import { buildLineageGraph } from '../../shared/lineage';
import { activeProfileRow, getLineRow, toCultureDtos, toLogDtos, toLotDtos } from '../cell-lines';
import { db, now, parseJsonColumn } from '../db';
import { HttpError } from '../http-error';
import {
  addLog,
  deleteCulture,
  deleteLot,
  discardPlates,
  endCulture,
  eventTime,
  freezeCulture,
  freezePreview,
  getCulture,
  LOW_VIAL_THRESHOLD,
  passageCulture,
  receiveCulture,
  receiveLot,
  lineageAnnotations,
  removeLog,
  summarizeLogs,
  thawLot,
  updateCulture,
  updateLog,
  updateLot,
} from '../lineage';
import type { LineageInput } from '../lineage';
import { getPhotoRow, readPhoto, removePhotoFiles, savePhoto } from '../photos';

export const lineage = new Hono();
const LOG_TYPES = ['observation', 'medium_change', 'passage', 'freeze', 'harvest', 'treatment', 'mycoplasma', 'note'];

lineage.post('/cell-lines/:id/lots', async (c) => c.json(receiveLot(c.req.param('id'), await c.req.json<LineageInput>()), 201));
lineage.post('/cell-lines/:id/cultures', async (c) => c.json(receiveCulture(c.req.param('id'), await c.req.json<LineageInput>()), 201));
lineage.post('/lots/:id/thaw', async (c) => c.json(thawLot(c.req.param('id'), await c.req.json<LineageInput>()), 201));
lineage.post('/cultures/:id/passage', async (c) => c.json(passageCulture(c.req.param('id'), await c.req.json<LineageInput>()), 201));
lineage.post('/cultures/:id/freeze', async (c) => c.json(freezeCulture(c.req.param('id'), await c.req.json<LineageInput>()), 201));
lineage.post('/cultures/:id/freeze-plan', async (c) => {
  getCulture(c.req.param('id'));
  return c.json(freezePreview(await c.req.json<unknown>()));
});
lineage.post('/cultures/:id/end', async (c) => c.json(endCulture(c.req.param('id'), await c.req.json<LineageInput>())));
lineage.post('/cultures/:id/discard-plates', async (c) => c.json(discardPlates(c.req.param('id'), await c.req.json<LineageInput>()), 201));
lineage.post('/cultures/:id/logs', async (c) => c.json(addLog(c.req.param('id'), await c.req.json<LineageInput>()), 201));
lineage.get('/cultures/:id/logs', (c) => {
  getCulture(c.req.param('id'));
  const rows = db
    .prepare('SELECT * FROM culture_logs WHERE culture_id=? ORDER BY at,created_at,id')
    .all(c.req.param('id')) as unknown as LogRow[];
  return c.json(toLogDtos(rows));
});
/**
 * Line-wide journal, newest first. Optional filters: `limit` (1–2000), `type`, `cultureId`, `before` (ISO time, exclusive).
 */
lineage.get('/cell-lines/:id/logs', (c) => {
  const id = c.req.param('id');
  getLineRow(id);
  const where = ['c.cell_line_id=?'];
  const params: (string | number)[] = [id];
  const type = c.req.query('type');
  if (type !== undefined) {
    if (!LOG_TYPES.includes(type)) throw new HttpError(400, '기록 종류를 확인하세요');
    where.push('l.type=?');
    params.push(type);
  }
  const cultureId = c.req.query('cultureId');
  if (cultureId) {
    where.push('l.culture_id=?');
    params.push(cultureId);
  }
  const before = c.req.query('before');
  if (before) {
    where.push('l.at<?');
    params.push(eventTime(before));
  }
  let limit = '';
  const rawLimit = c.req.query('limit');
  if (rawLimit !== undefined) {
    const n = Number(rawLimit);
    if (!Number.isInteger(n) || n < 1 || n > 2000) throw new HttpError(400, 'limit은 1–2000 사이 정수여야 합니다');
    limit = ` LIMIT ${n}`;
  }
  const rows = db
    .prepare(
      `SELECT l.*,c.label AS culture_label,c.passage AS culture_passage FROM culture_logs l JOIN cultures c ON c.id=l.culture_id WHERE ${where.join(' AND ')} ORDER BY l.at DESC,l.created_at DESC,l.id DESC${limit}`,
    )
    .all(...params) as unknown as (LogRow & { culture_label: string; culture_passage: number })[];
  const dtos = toLogDtos(rows);
  return c.json(dtos.map((dto, i) => ({ ...dto, cultureLabel: rows[i].culture_label, culturePassage: rows[i].culture_passage })));
});
lineage.put('/lots/:id', async (c) => c.json(updateLot(c.req.param('id'), await c.req.json<LineageInput>())));
lineage.put('/cultures/:id', async (c) => c.json(updateCulture(c.req.param('id'), await c.req.json<LineageInput>())));
lineage.put('/logs/:id', async (c) => c.json(updateLog(c.req.param('id'), await c.req.json<LineageInput>())));
/** `restoreVials` (query) overrides how many vials a deleted thawed culture gives back to its lot. */
lineage.delete('/cultures/:id', (c) => {
  const raw = c.req.query('restoreVials');
  removePhotoFiles(deleteCulture(c.req.param('id'), raw === undefined ? undefined : Number(raw)));
  return c.json({ ok: true });
});
lineage.delete('/lots/:id', (c) => {
  removePhotoFiles(deleteLot(c.req.param('id')));
  return c.json({ ok: true });
});
lineage.delete('/logs/:id', (c) => {
  removePhotoFiles(removeLog(c.req.param('id')));
  return c.json({ ok: true });
});

/* Observation photos: PNG/JPEG only, stored under the app file store, served by id (never by path). */
lineage.post('/logs/:id/photos', bodyLimit({ maxSize: PHOTO_MAX_BYTES + 65536, onError: () => { throw new HttpError(400, '사진은 8 MB 이하여야 합니다'); } }), async (c) => {
  const declared = Number(c.req.header('content-length') ?? 0);
  if (declared > PHOTO_MAX_BYTES + 64 * 1024) throw new HttpError(400, `사진은 ${PHOTO_MAX_BYTES / 1024 / 1024} MB 이하여야 합니다`);
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) throw new HttpError(400, '첨부할 사진을 선택하세요');
  return c.json(await savePhoto(c.req.param('id'), file), 201);
});
lineage.get('/photos/:id/file', (c) => {
  const row = getPhotoRow(c.req.param('id'));
  return new Response(new Uint8Array(readPhoto(row)), {
    headers: {
      'Content-Type': row.mime,
      'Content-Disposition': `inline; filename="photo.${row.mime === 'image/png' ? 'png' : 'jpg'}"`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, max-age=3600',
    },
  });
});
lineage.delete('/photos/:id', (c) => {
  const row = getPhotoRow(c.req.param('id'));
  db.prepare('DELETE FROM culture_log_photos WHERE id=?').run(row.id);
  removePhotoFiles([row.file_name]);
  return c.json({ ok: true });
});

lineage.get('/cell-lines/:id/lineage', (c) => {
  const id = c.req.param('id');
  getLineRow(id);
  const lots = db.prepare('SELECT * FROM cryo_lots WHERE cell_line_id=? ORDER BY event_at,created_at,id').all(id) as unknown as LotRow[];
  const cultures = db
    .prepare('SELECT * FROM cultures WHERE cell_line_id=? ORDER BY started_at,created_at,id')
    .all(id) as unknown as CultureRow[];
  // Newest measurement per culture, so a later log without confluency never blanks the node.
  const measured = db
    .prepare(
      'SELECT l.* FROM culture_logs l JOIN cultures c ON c.id=l.culture_id WHERE c.cell_line_id=? AND l.confluency_pct IS NOT NULL ORDER BY l.at,l.created_at,l.id',
    )
    .all(id) as unknown as LogRow[];
  const last: Record<string, LogDto> = {};
  for (const dto of toLogDtos(measured)) last[dto.cultureId] = dto;
  return c.json(buildLineageGraph(toLotDtos(lots), toCultureDtos(cultures), last, lineageAnnotations(id)));
});
lineage.get('/dashboard', (c) => {
  const current = Date.parse(now());
  const cultures = db.prepare("SELECT * FROM cultures WHERE status='active' ORDER BY started_at,id").all() as unknown as CultureRow[];
  const logsByCulture = new Map<string, LogRow[]>();
  if (cultures.length) {
    const rows = db
      .prepare(
        `SELECT * FROM culture_logs WHERE culture_id IN (${cultures.map(() => '?').join(',')}) ORDER BY at DESC,created_at DESC,id DESC`,
      )
      .all(...cultures.map((culture) => culture.id)) as unknown as LogRow[];
    for (const row of rows) logsByCulture.set(row.culture_id, [...(logsByCulture.get(row.culture_id) ?? []), row]);
  }
  const activeCultures = cultures.map((culture) => {
    const line = getLineRow(culture.cell_line_id);
    const summary = summarizeLogs(logsByCulture.get(culture.id) ?? []);
    const profile = activeProfileRow(line.id);
    const fields = parseJsonColumn<CultureProfileFields>(profile?.fields, {});
    // Feed timing follows real medium replacement (or a passage); addition-only logs never reset it.
    const daysSinceFeed = Math.max(0, Math.floor((current - Date.parse(summary.lastFeed?.at ?? culture.started_at)) / 86400000));
    return {
      id: culture.id,
      label: culture.label,
      lineId: line.id,
      lineName: line.name,
      passage: culture.passage,
      vessel: culture.vessel,
      startedAt: culture.started_at,
      daysInCulture: Math.max(0, Math.floor((current - Date.parse(culture.started_at)) / 86400000)),
      lastLog: summary.lastLog,
      lastConfluency: summary.lastConfluency,
      lastFeed: summary.lastFeed,
      lastAddition: summary.lastAddition,
      daysSinceFeed,
      feedOverdue: fields.medium_change_days != null && daysSinceFeed > fields.medium_change_days,
      overPassage: line.max_passage !== null && culture.passage > line.max_passage,
    };
  });
  const lowStock = db
    .prepare(
      'SELECT l.id AS lotId,l.label,c.name AS lineName,l.vials_remaining AS vialsRemaining FROM cryo_lots l JOIN cell_lines c ON c.id=l.cell_line_id WHERE l.vials_remaining<=? ORDER BY l.vials_remaining,l.event_at',
    )
    .all(LOW_VIAL_THRESHOLD);
  const recentBradford = db
    .prepare('SELECT id,title,performed_at AS performedAt FROM bradford_assays ORDER BY performed_at DESC LIMIT 5')
    .all();
  const recentWestern = db
    .prepare('SELECT id,title,performed_at AS performedAt,status FROM western_runs ORDER BY performed_at DESC LIMIT 5')
    .all();
  return c.json({ activeCultures, lowStock, recentBradford, recentWestern });
});
