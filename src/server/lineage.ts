import { nanoid } from 'nanoid';
import type { LogDto } from '../shared/cell-line';
import type { CultureRow, LogRow, LotRow } from './cell-lines';
import { activeProfileRow, getLineRow, toCultureDto, toLogDto, toLotDto } from './cell-lines';
import { db, now, tx } from './db';
import { HttpError } from './http-error';

export type LineageInput = Record<string, unknown>;
export const LOW_VIAL_THRESHOLD = 2;

export function text(raw: unknown, label: string, required = false, max = 120): string {
  if (raw === undefined || raw === null) {
    if (!required) return '';
    throw new HttpError(400, `${label}을(를) 입력하세요`);
  }
  if (typeof raw !== 'string' || raw.trim().length > max || (required && !raw.trim()))
    throw new HttpError(400, `${label}을(를) 확인하세요`);
  return raw.trim();
}
export function numeric(raw: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER, integer = false): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < min || raw > max || (integer && !Number.isInteger(raw)))
    throw new HttpError(400, `${label}을(를) 확인하세요`);
  return raw;
}
export function eventTime(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim() || !Number.isFinite(Date.parse(raw))) throw new HttpError(400, '일시를 확인하세요');
  return new Date(raw).toISOString();
}
export function getLot(id: string): LotRow {
  const row = db.prepare('SELECT * FROM cryo_lots WHERE id=?').get(id) as LotRow | undefined;
  if (!row) throw new HttpError(404, '동결 재고를 찾을 수 없습니다');
  return row;
}
export function getCulture(id: string): CultureRow {
  const row = db.prepare('SELECT * FROM cultures WHERE id=?').get(id) as CultureRow | undefined;
  if (!row) throw new HttpError(404, '배양을 찾을 수 없습니다');
  return row;
}
export function getLog(id: string): LogRow {
  const row = db.prepare('SELECT * FROM culture_logs WHERE id=?').get(id) as LogRow | undefined;
  if (!row) throw new HttpError(404, '기록을 찾을 수 없습니다');
  return row;
}
export function profileFor(lineId: string, raw: unknown): string | null {
  if (raw === undefined) return activeProfileRow(lineId)?.id ?? null;
  if (raw === null) return null;
  if (typeof raw !== 'string' || !db.prepare('SELECT id FROM culture_profiles WHERE id=? AND cell_line_id=?').get(raw, lineId))
    throw new HttpError(400, '같은 세포주의 배양 조건을 선택하세요');
  return raw;
}
function flag(raw: unknown, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  if (typeof raw !== 'boolean') throw new HttpError(400, '선택 값을 확인하세요');
  return raw;
}
function optionalNumber(raw: unknown, label: string, max = Number.MAX_SAFE_INTEGER, integer = false): number | null {
  return raw === undefined || raw === null ? null : numeric(raw, label, 0, max, integer);
}
function warnings(lineId: string, passage: number): string[] {
  const max = getLineRow(lineId).max_passage;
  return max !== null && passage > max ? [`최대 passage(${max})를 넘었습니다`] : [];
}
function insertCulture(
  lineId: string,
  passage: number,
  vessel: string,
  profileId: string | null,
  at: string,
  label: string,
  parentCulture: string | null = null,
  parentLot: string | null = null,
) {
  const id = nanoid(12);
  db.prepare(
    "INSERT INTO cultures(id,cell_line_id,parent_culture_id,parent_lot_id,profile_id,label,passage,vessel,status,started_at,created_at) VALUES(?,?,?,?,?,?,?,?,'active',?,?)",
  ).run(id, lineId, parentCulture, parentLot, profileId, label, passage, vessel, at, now());
  return toCultureDto(getCulture(id));
}
function insertLot(
  lineId: string,
  b: LineageInput,
  origin: 'received' | 'frozen',
  source: string | null,
  passage: number | null,
  label: string,
  at: string,
) {
  const id = nanoid(12);
  const vials = numeric(b.vials, '바이알 수', 1, Number.MAX_SAFE_INTEGER, true);
  db.prepare(
    'INSERT INTO cryo_lots(id,cell_line_id,source_culture_id,origin,label,passage,vials_initial,vials_remaining,cells_per_vial,freezing_medium,location,supplier_lot,event_at,notes,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run(
    id,
    lineId,
    source,
    origin,
    label,
    passage,
    vials,
    vials,
    optionalNumber(b.cellsPerVial, '바이알당 세포 수'),
    text(b.freezingMedium, '동결 배지', false, 200) || null,
    text(b.location, '보관 위치', origin === 'frozen'),
    text(b.supplierLot, '공급자 로트') || null,
    at,
    text(b.notes, '메모', false, 10000),
    now(),
  );
  return toLotDto(getLot(id));
}
export function logValues(b: LineageInput) {
  const types: LogDto['type'][] = ['observation', 'medium_change', 'passage', 'freeze', 'harvest', 'treatment', 'mycoplasma', 'note'];
  if (!types.includes(b.type as LogDto['type'])) throw new HttpError(400, '기록 종류를 확인하세요');
  if (b.mycoplasma !== undefined && b.mycoplasma !== null && !['negative', 'positive', 'pending'].includes(String(b.mycoplasma)))
    throw new HttpError(400, '마이코플라스마 결과를 확인하세요');
  const extra = b.extra ?? {};
  if (
    typeof extra !== 'object' ||
    extra === null ||
    Array.isArray(extra) ||
    Object.entries(extra).some(([k, v]) => !k.trim() || k.length > 120 || typeof v !== 'string' || v.length > 1000)
  )
    throw new HttpError(400, '자유 항목은 이름과 텍스트 값으로 입력하세요');
  return {
    at: eventTime(b.at),
    type: b.type as LogDto['type'],
    confluency: optionalNumber(b.confluencyPct, 'Confluency', 100),
    cells: optionalNumber(b.cellsPerMl, '세포 농도'),
    viability: optionalNumber(b.viabilityPct, '생존율', 100),
    total: optionalNumber(b.totalCells, '총 세포 수'),
    mycoplasma: (b.mycoplasma ?? null) as LogDto['mycoplasma'],
    extra: JSON.stringify(extra),
    note: text(b.note, '메모', false, 10000),
  };
}
function insertLog(cultureId: string, b: LineageInput) {
  const v = logValues(b);
  const id = nanoid(12);
  db.prepare(
    'INSERT INTO culture_logs(id,culture_id,at,type,confluency_pct,cells_per_ml,viability_pct,total_cells,mycoplasma,extra,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run(id, cultureId, v.at, v.type, v.confluency, v.cells, v.viability, v.total, v.mycoplasma, v.extra, v.note, now());
  return toLogDto(getLog(id));
}

export function receiveLot(lineId: string, b: LineageInput) {
  return tx(() => {
    const line = getLineRow(lineId);
    const label = text(b.label, '라벨') || [line.name, line.source_bank, line.catalog_no, '입고'].filter(Boolean).join(' ');
    return insertLot(
      lineId,
      b,
      'received',
      null,
      optionalNumber(b.passage, 'Passage', Number.MAX_SAFE_INTEGER, true),
      label,
      eventTime(b.receivedAt),
    );
  });
}
export function receiveCulture(lineId: string, b: LineageInput) {
  return tx(() => {
    const line = getLineRow(lineId);
    const p = numeric(b.passage, 'Passage', 0, Number.MAX_SAFE_INTEGER, true);
    const culture = insertCulture(
      lineId,
      p,
      text(b.vessel, '배양 용기', true),
      profileFor(lineId, b.profileId),
      eventTime(b.startedAt),
      text(b.label, '라벨') || `${line.name}-P${p}-입고`,
    );
    return { culture, warnings: warnings(lineId, p) };
  });
}
export function thawLot(lotId: string, b: LineageInput) {
  return tx(() => {
    const lot = getLot(lotId);
    const vials = numeric(b.vials ?? 1, '바이알 수', 1, Number.MAX_SAFE_INTEGER, true);
    if (lot.vials_remaining < vials) throw new HttpError(409, '남은 바이알이 없습니다');
    const p = numeric(b.passage ?? lot.passage ?? 0, 'Passage', 0, Number.MAX_SAFE_INTEGER, true);
    const at = eventTime(b.at);
    const count = db.prepare('SELECT COUNT(*) AS n FROM cultures WHERE parent_lot_id=?').get(lotId);
    const n = Number(count?.n ?? 0) + 1;
    const culture = insertCulture(
      lot.cell_line_id,
      p,
      text(b.vessel, '배양 용기', true),
      profileFor(lot.cell_line_id, b.profileId),
      at,
      `${getLineRow(lot.cell_line_id).name}-P${p}-T${n}`,
      null,
      lotId,
    );
    db.prepare('UPDATE cryo_lots SET vials_remaining=vials_remaining-? WHERE id=?').run(vials, lotId);
    insertLog(culture.id, { at, type: 'note', note: `해동 (${lot.label}, ${vials} vial)` });
    return { culture, lot: toLotDto(getLot(lotId)), warnings: warnings(lot.cell_line_id, p) };
  });
}
export function passageCulture(cultureId: string, b: LineageInput) {
  return tx(() => {
    const parent = getCulture(cultureId);
    if (parent.status !== 'active') throw new HttpError(409, '활성 상태의 배양만 계대할 수 있습니다');
    if (!Array.isArray(b.children) || b.children.length < 1 || b.children.length > 24)
      throw new HttpError(400, '자식 배양은 1–24개여야 합니다');
    const at = eventTime(b.at);
    const keep = flag(b.keepParent, false);
    const children = b.children.map((raw, i) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, '자식 배양 정보를 확인하세요');
      const child = raw as LineageInput;
      return insertCulture(
        parent.cell_line_id,
        parent.passage + 1,
        text(child.vessel, '배양 용기', true),
        parent.profile_id,
        at,
        text(child.label, '라벨') || `${getLineRow(parent.cell_line_id).name}-P${parent.passage + 1}-${String.fromCharCode(65 + i)}`,
        cultureId,
      );
    });
    insertLog(cultureId, { ...b, at, type: 'passage', extra: { splitRatio: text(b.splitRatio, '분주 비율') } });
    if (!keep) db.prepare("UPDATE cultures SET status='split',ended_at=? WHERE id=?").run(at, cultureId);
    return { parent: toCultureDto(getCulture(cultureId)), children, warnings: warnings(parent.cell_line_id, parent.passage + 1) };
  });
}
export function freezeCulture(cultureId: string, b: LineageInput) {
  return tx(() => {
    const culture = getCulture(cultureId);
    if (culture.status !== 'active') throw new HttpError(409, '이미 종료된 배양입니다');
    const at = eventTime(b.at);
    const end = flag(b.endCulture, false);
    const day = at.slice(2, 10).replaceAll('-', '');
    const lot = insertLot(
      culture.cell_line_id,
      b,
      'frozen',
      cultureId,
      culture.passage,
      `${getLineRow(culture.cell_line_id).name}-P${culture.passage}-F${day}`,
      at,
    );
    insertLog(cultureId, { at, type: 'freeze', note: `${lot.vialsInitial} vial 동결 · ${lot.location}` });
    if (end) db.prepare("UPDATE cultures SET status='frozen',ended_at=? WHERE id=?").run(at, cultureId);
    return { lot, culture: toCultureDto(getCulture(cultureId)) };
  });
}
export function endCulture(cultureId: string, b: LineageInput) {
  return tx(() => {
    const culture = getCulture(cultureId);
    if (culture.status !== 'active') throw new HttpError(409, '이미 종료된 배양입니다');
    if (!['harvested', 'discarded', 'contaminated'].includes(String(b.status))) throw new HttpError(400, '종료 상태를 확인하세요');
    db.prepare('UPDATE cultures SET status=?,ended_at=?,end_note=? WHERE id=?').run(
      String(b.status),
      eventTime(b.at),
      text(b.note, '종료 메모', false, 10000),
      cultureId,
    );
    return toCultureDto(getCulture(cultureId));
  });
}
export function addLog(cultureId: string, b: LineageInput) {
  return tx(() => {
    getCulture(cultureId);
    if (b.type === 'passage' || b.type === 'freeze') throw new HttpError(400, '계대·동결 기록은 해당 작업으로 추가하세요');
    return insertLog(cultureId, b);
  });
}
