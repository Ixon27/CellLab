import { nanoid } from 'nanoid';
import type { CultureDto, LogDto, LotDto } from '../shared/cell-line';
import {
  COUNT_EXTRA_KEYS,
  FEED_EXTRA_KEYS,
  LINEAGE_EXTRA_KEYS,
  OBSERVATION_EXTRA_KEYS,
  PASSAGE_EXTRA_KEYS,
  RESERVED_EXTRA_KEYS,
  SEEDING_EXTRA_KEYS,
  childCultureIds,
  endLogType,
  isEndStatus,
  feedFromExtra,
  freezeAllocation,
  freezeMix,
  logOperation,
  plateList,
  passageConservation,
  validateCountExtras,
  validateFeedInput,
  validateRecovery,
  validateRepresentativeThaw,
} from '../shared/culture-operations';
import type { FeedRecord, FreezeAllocation, FreezePlanRecord, LotRecovery, RepresentativeThaw } from '../shared/culture-operations';
import { formatVesselUse, validateVesselUse, vesselArea } from '../shared/lab-products';
import type { CultureVesselUse, VesselProduct } from '../shared/lab-products';
import type { CultureRow, LogRow, LotRow } from './cell-lines';
import { activeProfileRow, getLineRow, toCultureDto, toLogDto, toLogDtos, toLotDto } from './cell-lines';
import { db, now, parseJsonColumn, tx } from './db';
import { HttpError } from './http-error';
import { getMediumProduct, getVesselProduct } from './lab-products';
import type { LineageAnnotations } from '../shared/lineage';
import { attachProtocolRun, editProtocolRun } from './protocol-runs';

export type LineageInput = Record<string, unknown>;
export const LOW_VIAL_THRESHOLD = 2;
/** Relative tolerance when a seeded cell count is cross-checked against volume × concentration. */
const SEEDING_VOLUME_TOLERANCE = 0.05;

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
/** Run shared (plain Error) validators and surface their Korean message as a 400. */
function valid<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, error instanceof Error ? error.message : '입력을 확인하세요');
  }
}
function record(raw: unknown, label: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, `${label}을(를) 확인하세요`);
  return raw as Record<string, unknown>;
}

/* ───────────── Vessel assignment ───────────── */

interface ResolvedUse {
  use: CultureVesselUse;
  product: VesselProduct;
  warnings: string[];
}
/** Shape-check a vessel use and resolve its product. */
function resolveUse(raw: unknown, previousProduct?: VesselProduct): ResolvedUse {
  const use = valid(() => validateVesselUse(raw));
  const product = previousProduct?.id === use.vesselProductId ? previousProduct : getVesselProduct(use.vesselProductId);
  if (!product) throw new HttpError(400, '용기 제품을 찾을 수 없습니다');
  const out: string[] = [];
  const { mediumMinMlPerWell: min, mediumMaxMlPerWell: max } = product;
  if (use.mediumMl !== null && min !== null && max !== null) {
    const perWell = use.mediumMl / use.usedWells;
    if (perWell < min - 1e-9 || perWell > max + 1e-9)
      out.push(`well당 배지 ${Math.round(perWell * 1000) / 1000} mL는 제품 권장 범위(${min}–${max} mL)를 벗어납니다`);
  }
  return { use, product, warnings: out };
}
/** Persist the assignment. The product snapshot taken first is kept while the same product stays assigned. */
function saveUse(cultureId: string, resolved: ResolvedUse): void {
  const existing = db.prepare('SELECT vessel_product_id, snapshot FROM culture_vessel_use WHERE culture_id=?').get(cultureId) as
    | { vessel_product_id: string; snapshot: string }
    | undefined;
  const keep = existing?.vessel_product_id === resolved.product.id ? existing.snapshot : null;
  const snapshot = keep && keep.startsWith('{') ? keep : JSON.stringify(resolved.product);
  db.prepare(
    'INSERT INTO culture_vessel_use(culture_id,vessel_product_id,used_wells,medium_ml,snapshot,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(culture_id) DO UPDATE SET vessel_product_id=excluded.vessel_product_id,used_wells=excluded.used_wells,medium_ml=excluded.medium_ml,snapshot=excluded.snapshot,updated_at=excluded.updated_at',
  ).run(cultureId, resolved.use.vesselProductId, resolved.use.usedWells, resolved.use.mediumMl, snapshot, now());
  db.prepare('UPDATE cultures SET vessel=? WHERE id=?').run(formatVesselUse(resolved.product, resolved.use.usedWells), cultureId);
}
/** Vessel text plus an optional structured use; with a product the text is its label and count ("60 mm dish × 2"). */
function vesselSpec(b: LineageInput): { vessel: string; resolved: ResolvedUse | null } {
  if (b.vesselUse !== undefined && b.vesselUse !== null) {
    const resolved = resolveUse(b.vesselUse);
    return { vessel: formatVesselUse(resolved.product, resolved.use.usedWells), resolved };
  }
  return { vessel: text(b.vessel, '배양 용기', true), resolved: null };
}
function useArea(resolved: ResolvedUse | null): number | null {
  return resolved ? vesselArea(resolved.product, resolved.use.usedWells) : null;
}

function insertCulture(
  lineId: string,
  passage: number,
  spec: { vessel: string; resolved: ResolvedUse | null },
  profileId: string | null,
  at: string,
  label: string,
  parentCulture: string | null = null,
  parentLot: string | null = null,
  createdAt: string = now(),
) {
  const id = nanoid(12);
  db.prepare(
    "INSERT INTO cultures(id,cell_line_id,parent_culture_id,parent_lot_id,profile_id,label,passage,vessel,status,started_at,created_at) VALUES(?,?,?,?,?,?,?,?,'active',?,?)",
  ).run(id, lineId, parentCulture, parentLot, profileId, label, passage, spec.vessel, at, createdAt);
  if (spec.resolved) saveUse(id, spec.resolved);
  return toCultureDto(getCulture(id));
}

/**
 * Update a culture's own fields at any time. A structured vessel use replaces the free-text vessel; `vesselUse: null` clears it.
 * The start time moves the culture's thaw record with it. The end (status, time, note) belongs to the record that ended
 * the culture: edit or undo that passage, freeze, plate discard or 수확·폐기·오염 record instead.
 */
export function updateCulture(cultureId: string, b: LineageInput) {
  return tx(() => {
    const culture = getCulture(cultureId);
    let vessel = b.vessel === undefined ? culture.vessel : text(b.vessel, '배양 용기', true);
    const current = toCultureDto(culture).vesselUse;
    let resolved: ResolvedUse | null = null;
    if (b.vesselUse !== undefined && b.vesselUse !== null) resolved = resolveUse(b.vesselUse, current?.product);
    else if (current && b.vesselUse !== null && b.vessel !== undefined && vessel !== culture.vessel)
      throw new HttpError(400, '용기 제품이 지정된 배양입니다. 용기 제품 선택으로 변경하세요');
    if (resolved) vessel = formatVesselUse(resolved.product, resolved.use.usedWells);
    const startedAt = b.startedAt === undefined ? culture.started_at : eventTime(b.startedAt);
    const passage = b.passage === undefined ? culture.passage : numeric(b.passage, 'Passage', 0, Number.MAX_SAFE_INTEGER, true);
    if (b.status !== undefined || b.endedAt !== undefined || b.endNote !== undefined)
      throw new HttpError(400, '배양 종료는 그 종료 기록(수확·폐기·오염·계대·동결)에서 수정하거나 취소하세요');
    if (culture.ended_at && culture.ended_at < startedAt) throw new HttpError(400, '종료 일시가 시작 일시보다 앞섭니다');
    db.prepare('UPDATE cultures SET label=?,vessel=?,notes=?,profile_id=?,started_at=?,passage=? WHERE id=?').run(
      b.label === undefined ? culture.label : text(b.label, '라벨', true),
      vessel,
      b.notes === undefined ? culture.notes : text(b.notes, '메모', false, 10000),
      b.profileId === undefined ? culture.profile_id : profileFor(culture.cell_line_id, b.profileId),
      startedAt,
      passage,
      culture.id,
    );
    if (startedAt !== culture.started_at)
      db.prepare("UPDATE culture_logs SET at=? WHERE culture_id=? AND type='note' AND json_extract(extra,'$.thawLotId') IS NOT NULL").run(
        startedAt,
        culture.id,
      );
    if (resolved) saveUse(culture.id, resolved);
    else if (b.vesselUse === null) db.prepare('DELETE FROM culture_vessel_use WHERE culture_id=?').run(culture.id);
    return toCultureDto(getCulture(culture.id));
  });
}

/* ───────────── Lots ───────────── */

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

interface LotDetailsPatch {
  freezePlan?: FreezePlanRecord | null;
  representativeThaw?: RepresentativeThaw | null;
  recovery?: LotRecovery | null;
}
function upsertLotDetails(
  lotId: string,
  patch: LotDetailsPatch,
): void {
  const row = db.prepare('SELECT * FROM cryo_lot_details WHERE lot_id=?').get(lotId) as
    | {
        freeze_plan: string | null;
        representative_thaw: string | null;
        recovery_status: string | null;
        recovery_observed_at: string | null;
        recovery_note: string;
      }
    | undefined;
  const plan = patch.freezePlan === undefined ? (row?.freeze_plan ?? null) : patch.freezePlan && JSON.stringify(patch.freezePlan);
  const thaw = patch.representativeThaw === undefined ? (row?.representative_thaw ?? null) : patch.representativeThaw && JSON.stringify(patch.representativeThaw);
  const recovery =
    patch.recovery === undefined
      ? { status: row?.recovery_status ?? null, observedAt: row?.recovery_observed_at ?? null, note: row?.recovery_note ?? '' }
      : (patch.recovery ?? { status: null, observedAt: null, note: '' });
  db.prepare(
    'INSERT INTO cryo_lot_details(lot_id,freeze_plan,representative_thaw,recovery_status,recovery_observed_at,recovery_note,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(lot_id) DO UPDATE SET freeze_plan=excluded.freeze_plan,representative_thaw=excluded.representative_thaw,recovery_status=excluded.recovery_status,recovery_observed_at=excluded.recovery_observed_at,recovery_note=excluded.recovery_note,updated_at=excluded.updated_at',
  ).run(lotId, plan, thaw, recovery.status, recovery.observedAt, recovery.note, now());
}

/**
 * Edit a lot at any time: label, time, passage, vial counts, per-vial details, plan and recorded recovery.
 * A frozen lot's time moves its freeze record (and the culture's end, when the freeze ended it) with it.
 */
export function updateLot(lotId: string, b: LineageInput) {
  return tx(() => {
    const lot = getLot(lotId);
    const label = b.label === undefined ? lot.label : text(b.label, '라벨', true);
    const location = b.location === undefined ? lot.location : text(b.location, '보관 위치');
    const notes = b.notes === undefined ? lot.notes : text(b.notes, '메모', false, 10000);
    const initial = b.vialsInitial === undefined ? lot.vials_initial : numeric(b.vialsInitial, '최초 바이알 수', 1, Number.MAX_SAFE_INTEGER, true);
    const vials = b.vialsRemaining === undefined ? lot.vials_remaining : numeric(b.vialsRemaining, '남은 바이알', 0, Number.MAX_SAFE_INTEGER, true);
    if (vials > initial) throw new HttpError(400, `남은 바이알(${vials})이 최초 바이알(${initial})보다 많습니다`);
    const eventAt = b.eventAt === undefined ? lot.event_at : eventTime(b.eventAt);
    const passage = b.passage === undefined ? lot.passage : optionalNumber(b.passage, 'Passage', Number.MAX_SAFE_INTEGER, true);
    const cellsPerVial = b.cellsPerVial === undefined ? lot.cells_per_vial : optionalNumber(b.cellsPerVial, '바이알당 세포 수');
    const freezingMedium = b.freezingMedium === undefined ? lot.freezing_medium : text(b.freezingMedium, '동결 배지', false, 200) || null;
    const supplierLot = b.supplierLot === undefined ? lot.supplier_lot : text(b.supplierLot, '공급자 로트') || null;
    db.prepare(
      'UPDATE cryo_lots SET label=?,location=?,notes=?,vials_initial=?,vials_remaining=?,event_at=?,passage=?,cells_per_vial=?,freezing_medium=?,supplier_lot=? WHERE id=?',
    ).run(label, location, notes, initial, vials, eventAt, passage, cellsPerVial, freezingMedium, supplierLot, lot.id);
    if (eventAt !== lot.event_at) {
      const freeze = freezeLogOf(lot.id);
      if (freeze) {
        db.prepare('UPDATE culture_logs SET at=? WHERE id=?').run(eventAt, freeze.id);
        db.prepare("UPDATE cultures SET ended_at=? WHERE id=? AND status='frozen' AND ended_at=?").run(eventAt, freeze.culture_id, freeze.at);
      }
    }
    const patch: LotDetailsPatch = {};
    if (b.representativeThaw !== undefined)
      patch.representativeThaw = b.representativeThaw === null ? null : valid(() => validateRepresentativeThaw(b.representativeThaw, initial));
    if (b.recovery !== undefined) patch.recovery = b.recovery === null ? null : valid(() => validateRecovery(b.recovery, Date.now()));
    if (patch.representativeThaw !== undefined || patch.recovery !== undefined) upsertLotDetails(lot.id, patch);
    return toLotDto(getLot(lot.id));
  });
}
function freezeLogOf(lotId: string): LogRow | undefined {
  return db.prepare("SELECT * FROM culture_logs WHERE type='freeze' AND json_extract(extra,'$.frozenLotId')=?").get(lotId) as LogRow | undefined;
}

/* ───────────── Logs ───────────── */

export interface LogOptions {
  /** Server-written logs (passage, seeding) may carry reserved extra keys directly. */
  internal?: boolean;
  /** An existing legacy medium_change without a mode may stay that way when edited. */
  legacyFeedOk?: boolean;
  /** Recorded medium volume of the culture; removals above it are rejected. */
  currentMediumMl?: number | null;
  /** Previously stored extra, used to keep a frozen medium description on edit. */
  previousExtra?: Record<string, string>;
  /** System-written extra keys carried over unchanged on edit. */
  preserve?: Record<string, string>;
}
const LOG_TYPES: LogDto['type'][] = ['observation', 'medium_change', 'passage', 'freeze', 'harvest', 'treatment', 'mycoplasma', 'note'];

function mediumDetail(productId: string | null, previous: Record<string, string> | undefined): string | null {
  if (!productId) return null;
  if (previous?.mediumProductId === productId && previous.mediumDetail) return previous.mediumDetail;
  const product = getMediumProduct(productId);
  if (!product) throw new HttpError(400, '배지 제품을 찾을 수 없습니다');
  return [product.manufacturer, product.catalogNo && `Cat# ${product.catalogNo}`, product.lotNo && `Lot ${product.lotNo}`].filter(Boolean).join(' · ') || null;
}

export function logValues(b: LineageInput, o: LogOptions = {}) {
  if (!LOG_TYPES.includes(b.type as LogDto['type'])) throw new HttpError(400, '기록 종류를 확인하세요');
  const type = b.type as LogDto['type'];
  if (b.mycoplasma !== undefined && b.mycoplasma !== null && !['negative', 'positive', 'pending'].includes(String(b.mycoplasma)))
    throw new HttpError(400, '마이코플라스마 결과를 확인하세요');
  const input = b.extra ?? {};
  if (
    typeof input !== 'object' ||
    input === null ||
    Array.isArray(input) ||
    Object.entries(input).some(([k, v]) => !k.trim() || k.length > 120 || typeof v !== 'string' || v.length > 1000)
  )
    throw new HttpError(400, '자유 항목은 이름과 텍스트 값으로 입력하세요');
  const extra: Record<string, string> = { ...(input as Record<string, string>) };
  if (!o.internal) {
    // Operation data arrives typed (`feed`, `morphology`) or as the reserved extra keys; free items may not use those names.
    let feed: unknown = b.feed === null ? undefined : b.feed;
    if (feed === undefined && FEED_EXTRA_KEYS.some((k) => k in extra))
      feed = {
        mode: extra.mediumMode,
        removedMl: extra.removedMl,
        addedMl: extra.addedMl,
        mediumLabel: extra.mediumLabel,
        mediumProductId: extra.mediumProductId,
      };
    for (const key of FEED_EXTRA_KEYS) delete extra[key];
    const morphologyRaw = b.morphology !== undefined && b.morphology !== null ? b.morphology : extra.morphology;
    for (const key of OBSERVATION_EXTRA_KEYS) delete extra[key];
    const reserved = Object.keys(extra).find((k) => RESERVED_EXTRA_KEYS.includes(k));
    if (reserved) throw new HttpError(400, `"${reserved}"은(는) 앱이 사용하는 항목 이름입니다. 다른 이름을 쓰세요`);
    if (type === 'medium_change') {
      if (feed === undefined) {
        if (!o.legacyFeedOk) throw new HttpError(400, '배지 교체 방식(전체·부분·추가)과 부피를 입력하세요');
      } else {
        const v = valid(() => validateFeedInput(feed, o.currentMediumMl ?? null));
        Object.assign(extra, {
          mediumMode: v.mode,
          removedMl: String(v.removedMl),
          addedMl: String(v.addedMl),
          mediumLabel: v.mediumLabel,
        });
        if (v.mediumProductId) extra.mediumProductId = v.mediumProductId;
        const detail = mediumDetail(v.mediumProductId, o.previousExtra);
        if (detail) extra.mediumDetail = detail.slice(0, 300);
      }
    } else if (feed !== undefined) {
      throw new HttpError(400, '배지 교체 정보는 배지 교체 기록에만 입력할 수 있습니다');
    }
    if (morphologyRaw !== undefined && morphologyRaw !== null && morphologyRaw !== '') {
      if (typeof morphologyRaw !== 'string' || morphologyRaw.trim().length > 1000) throw new HttpError(400, '세포 형태 메모를 확인하세요 (1,000자 이하)');
      if (type !== 'observation') throw new HttpError(400, '세포 형태는 관찰 기록에만 입력할 수 있습니다');
      if (morphologyRaw.trim()) extra.morphology = morphologyRaw.trim();
    }
    Object.assign(extra, o.preserve ?? {});
  }
  return {
    at: eventTime(b.at),
    type,
    confluency: optionalNumber(b.confluencyPct, 'Confluency', 100),
    cells: optionalNumber(b.cellsPerMl, '세포 농도'),
    viability: optionalNumber(b.viabilityPct, '생존율', 100),
    total: optionalNumber(b.totalCells, '총 세포 수'),
    mycoplasma: (b.mycoplasma ?? null) as LogDto['mycoplasma'],
    extra: JSON.stringify(extra),
    note: text(b.note, '메모', false, 10000),
  };
}
function insertLog(cultureId: string, b: LineageInput, o: LogOptions = {}) {
  const v = logValues(b, o);
  const id = nanoid(12);
  db.prepare(
    'INSERT INTO culture_logs(id,culture_id,at,type,confluency_pct,cells_per_ml,viability_pct,total_cells,mycoplasma,extra,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run(id, cultureId, v.at, v.type, v.confluency, v.cells, v.viability, v.total, v.mycoplasma, v.extra, v.note, now());
  return toLogDto(getLog(id));
}

export function addLog(cultureId: string, b: LineageInput) {
  return tx(() => {
    const culture = getCulture(cultureId);
    if (b.type === 'passage' || b.type === 'freeze') throw new HttpError(400, '계대·동결 기록은 해당 작업으로 추가하세요');
    const use = toCultureDto(culture).vesselUse;
    // Feeding never touches the passage number: it only appends a log.
    const latest = db.prepare("SELECT MAX(at) AS at FROM culture_logs WHERE culture_id=? AND type='medium_change'").get(cultureId) as { at: string | null };
    const historical = latest.at !== null && eventTime(b.at) < latest.at;
    const log = insertLog(cultureId, b, { currentMediumMl: historical ? null : use?.mediumMl ?? null });
    attachProtocolRun([log.id], cultureId, b.protocolRun);
    return toLogDto(getLog(log.id));
  });
}

/** extra keys the app writes and an edit carries over unchanged (counter values change only through `count`). */
const SYSTEM_EXTRA_KEYS: readonly string[] = [...PASSAGE_EXTRA_KEYS, ...SEEDING_EXTRA_KEYS, ...LINEAGE_EXTRA_KEYS, ...COUNT_EXTRA_KEYS];

/**
 * Edit any record. System-written keys are preserved; thaw/passage/freeze records keep their type, and moving their time
 * moves what they made (thawed culture start, new cultures' start, frozen lot time, the parent's end). A passage record
 * also takes `dissociationReagent`/`splitRatio`. A culture-end record takes `endStatus` and carries its status, time and
 * note to the culture it ended. `count` replaces the counter values. `protocolRun` revises or replaces the protocol the
 * record followed.
 */
export function updateLog(logId: string, b: LineageInput) {
  return tx(() => {
    const row = getLog(logId);
    const stored = toLogDto(row);
    if (b.type !== undefined && b.type !== row.type) {
      if (stored.operation) throw new HttpError(400, '해동·계대·동결·종료 기록의 종류는 바꿀 수 없습니다');
      if (b.type === 'passage' || b.type === 'freeze') throw new HttpError(400, '계대·동결 기록은 해당 작업으로 추가하세요');
    }
    const system = Object.fromEntries(Object.entries(stored.extra).filter(([k]) => SYSTEM_EXTRA_KEYS.includes(k)));
    if (row.type === 'passage') {
      for (const [key, label] of [
        ['dissociationReagent', '계대 시약'],
        ['splitRatio', '분주 비율'],
      ] as const) {
        if (b[key] === undefined) continue;
        const value = text(b[key], label, false, 200);
        if (value) system[key] = value;
        else delete system[key];
      }
    }
    if (b.count !== undefined) {
      for (const key of COUNT_EXTRA_KEYS) delete system[key];
      Object.assign(system, valid(() => validateCountExtras(b.count)));
    }
    const endStatus = stored.operation === 'end' ? (b.endStatus ?? stored.extra.endStatus) : null;
    if (endStatus !== null) {
      if (!isEndStatus(endStatus)) throw new HttpError(400, '종료 상태를 확인하세요');
      system.endStatus = endStatus;
    }
    const freeItems = Object.fromEntries(Object.entries(stored.extra).filter(([k]) => !RESERVED_EXTRA_KEYS.includes(k)));
    const legacyFeed = row.type === 'medium_change' && stored.feed?.mode === 'unspecified';
    const storedFeed =
      row.type === 'medium_change' && stored.feed && stored.feed.mode !== 'unspecified'
        ? {
            mode: stored.feed.mode,
            removedMl: stored.feed.removedMl,
            addedMl: stored.feed.addedMl,
            mediumLabel: stored.feed.mediumLabel,
            mediumProductId: stored.feed.mediumProductId,
          }
        : undefined;
    const merged: LineageInput = {
      at: stored.at,
      type: stored.type,
      confluencyPct: stored.confluencyPct,
      cellsPerMl: stored.cellsPerMl,
      viabilityPct: stored.viabilityPct,
      totalCells: stored.totalCells,
      mycoplasma: stored.mycoplasma,
      note: stored.note,
      extra: freeItems,
      // Operation data of the stored record only carries over while the type stays the same.
      feed: b.type === undefined || b.type === row.type ? storedFeed : undefined,
      morphology: b.type === undefined || b.type === row.type ? (stored.morphology ?? undefined) : undefined,
      ...b,
      ...(isEndStatus(endStatus) ? { type: endLogType(endStatus) } : {}),
    };
    const v = logValues(merged, {
      legacyFeedOk: legacyFeed && (b.type === undefined || b.type === 'medium_change') && b.feed === undefined,
      previousExtra: stored.extra,
      preserve: system,
    });
    if (row.type === 'passage' && system.seededCells && v.total !== null && v.total < Number(system.seededCells))
      throw new HttpError(400, `회수한 생세포 수가 접종 합계(${Number(system.seededCells).toLocaleString('ko-KR')})보다 적습니다`);
    db.prepare(
      'UPDATE culture_logs SET at=?,type=?,confluency_pct=?,cells_per_ml=?,viability_pct=?,total_cells=?,mycoplasma=?,extra=?,note=? WHERE id=?',
    ).run(v.at, v.type, v.confluency, v.cells, v.viability, v.total, v.mycoplasma, v.extra, v.note, row.id);
    if (isEndStatus(endStatus)) {
      if (v.at < getCulture(row.culture_id).started_at) throw new HttpError(400, '종료 일시가 시작 일시보다 앞섭니다');
      db.prepare('UPDATE cultures SET status=?,ended_at=?,end_note=? WHERE id=? AND status=? AND ended_at=?').run(
        endStatus,
        v.at,
        v.note,
        row.culture_id,
        stored.extra.endStatus,
        row.at,
      );
    }
    if (v.at !== row.at) moveOperationTime(row, stored.extra, v.at);
    editProtocolRun(row.id, row.culture_id, b.protocolRun);
    return toLogDto(getLog(row.id));
  });
}
function moveOperationTime(row: LogRow, extra: Record<string, string>, at: string): void {
  db.prepare('UPDATE culture_plates SET at=? WHERE log_id=?').run(at, row.id);
  switch (logOperation(row.type, extra)) {
    case 'thaw':
      db.prepare('UPDATE cultures SET started_at=? WHERE id=?').run(at, row.culture_id);
      break;
    case 'passage':
      for (const id of childCultureIds(extra)) {
        db.prepare('UPDATE cultures SET started_at=? WHERE id=?').run(at, id);
        db.prepare("UPDATE culture_logs SET at=? WHERE culture_id=? AND at=? AND json_extract(extra,'$.seedingParent') IS NOT NULL").run(at, id, row.at);
      }
      db.prepare("UPDATE cultures SET ended_at=? WHERE id=? AND status='split' AND ended_at=?").run(at, row.culture_id, row.at);
      break;
    case 'freeze':
      if (extra.frozenLotId) db.prepare('UPDATE cryo_lots SET event_at=? WHERE id=?').run(at, extra.frozenLotId);
      db.prepare("UPDATE cultures SET ended_at=? WHERE id=? AND status='frozen' AND ended_at=?").run(at, row.culture_id, row.at);
      break;
    case 'discard':
      db.prepare("UPDATE cultures SET ended_at=? WHERE id=? AND status='discarded' AND ended_at=?").run(at, row.culture_id, row.at);
      break;
  }
}

/**
 * Delete a record; returns the photo files whose rows went with it so the caller can unlink them.
 * Deleting a thaw/passage/freeze/plate-discard record undoes that operation (see removeCulture, undoPassage, undoFreeze);
 * deleting a 수확·폐기·오염 record makes the culture it ended active again.
 */
export function removeLog(logId: string): string[] {
  return tx(() => {
    const row = getLog(logId);
    const extra = parseJsonColumn<Record<string, string>>(row.extra, {});
    switch (logOperation(row.type, extra)) {
      case 'thaw':
        return removeCulture(row.culture_id);
      case 'passage':
        return undoPassage(row, extra);
      case 'freeze':
        return undoFreeze(row, extra);
      case 'discard': {
        const files = photoFiles('l.id=?', row.id);
        removeOperationLog(row, 'discarded');
        return files;
      }
      case 'end':
        db.prepare("UPDATE cultures SET status='active',ended_at=NULL,end_note=NULL WHERE id=? AND status=? AND ended_at=?").run(
          row.culture_id,
          extra.endStatus,
          row.at,
        );
        break;
    }
    const files = photoFiles('l.id=?', row.id);
    db.prepare('DELETE FROM culture_logs WHERE id=?').run(row.id);
    return files;
  });
}

/* ───────────── Undo and delete ───────────── */

/** Stored photo file names of the logs matching `where` (over `culture_logs l`). */
function photoFiles(where: string, id: string): string[] {
  return (
    db.prepare(`SELECT p.file_name AS name FROM culture_log_photos p JOIN culture_logs l ON l.id=p.log_id WHERE ${where}`).all(id) as { name: string }[]
  ).map((r) => r.name);
}
/** Nothing may hang off a culture that is about to disappear: its passages and freezes must be undone first. */
function assertNoDescendants(culture: CultureRow): void {
  const labels = (sql: string) => (db.prepare(sql).all(culture.id) as { label: string }[]).map((r) => r.label).join(', ');
  const children = labels('SELECT label FROM cultures WHERE parent_culture_id=?');
  if (children)
    throw new HttpError(409, `${culture.label}에서 계대한 배양(${children})이 있습니다. 그 계대 기록을 먼저 취소하거나 새 배양을 삭제하세요`);
  const lots = labels('SELECT label FROM cryo_lots WHERE source_culture_id=?');
  if (lots) throw new HttpError(409, `${culture.label}에서 동결한 stock(${lots})이 있습니다. 그 동결 기록을 먼저 취소하세요`);
}
/** Removing any consumed plate reopens a culture ended by plate depletion, not a manually ended one. */
function removeOperationLog(row: LogRow, legacyStatus: 'split' | 'frozen' | 'discarded'): void {
  db.prepare(`
    UPDATE cultures SET status='active',ended_at=NULL WHERE id=? AND CASE
      WHEN EXISTS(SELECT 1 FROM culture_plates p WHERE p.culture_id=cultures.id AND p.at=cultures.ended_at
        AND p.status=CASE cultures.status WHEN 'split' THEN 'passaged' WHEN 'discarded' THEN 'discarded' WHEN 'frozen' THEN 'frozen' END)
      THEN EXISTS(SELECT 1 FROM culture_plates WHERE log_id=?)
      ELSE status=? AND ended_at=?
    END
  `).run(row.culture_id, row.id, legacyStatus, row.at);
  db.prepare('DELETE FROM culture_logs WHERE id=?').run(row.id);
}
function undoPassage(row: LogRow, extra: Record<string, string>): string[] {
  const children = childCultureIds(extra)
    .map((id) => db.prepare('SELECT * FROM cultures WHERE id=?').get(id) as CultureRow | undefined)
    .filter((c): c is CultureRow => !!c);
  for (const child of children) assertNoDescendants(child);
  const files = [...children.flatMap((c) => photoFiles('l.culture_id=?', c.id)), ...photoFiles('l.id=?', row.id)];
  for (const child of children) db.prepare('DELETE FROM cultures WHERE id=?').run(child.id);
  removeOperationLog(row, 'split');
  return files;
}
function undoFreeze(row: LogRow, extra: Record<string, string>): string[] {
  const lot = extra.frozenLotId ? (db.prepare('SELECT * FROM cryo_lots WHERE id=?').get(extra.frozenLotId) as LotRow | undefined) : undefined;
  if (lot) {
    const thawed = (db.prepare('SELECT label FROM cultures WHERE parent_lot_id=?').all(lot.id) as { label: string }[]).map((r) => r.label);
    if (thawed.length)
      throw new HttpError(409, `${lot.label}에서 해동한 배양(${thawed.join(', ')})이 있습니다. 그 해동 기록을 먼저 취소하세요`);
    db.prepare('DELETE FROM cryo_lots WHERE id=?').run(lot.id);
  }
  const files = photoFiles('l.id=?', row.id);
  removeOperationLog(row, 'frozen');
  return files;
}

/**
 * Delete a culture with its records. Refused while cultures or lots descend from it.
 * A thawed culture gives its vials back: by default all vials of its thaw once the last culture of that thaw is gone
 * (`restoreVials` overrides, e.g. when an older record lacks the count). The last new culture of a passage undoes that
 * passage. Must run inside a transaction; returns photo files to unlink.
 */
function removeCulture(cultureId: string, restoreVials?: unknown): string[] {
  const culture = getCulture(cultureId);
  assertNoDescendants(culture);
  const files = photoFiles('l.culture_id=?', culture.id);
  const lot = culture.parent_lot_id ? (db.prepare('SELECT * FROM cryo_lots WHERE id=?').get(culture.parent_lot_id) as LotRow | undefined) : undefined;
  if (lot) {
    const used = lot.vials_initial - lot.vials_remaining;
    let vials: number;
    if (restoreVials !== undefined && restoreVials !== null) vials = numeric(restoreVials, '되돌릴 바이알 수', 0, used, true);
    else {
      const siblings = db.prepare('SELECT COUNT(*) AS n FROM cultures WHERE parent_lot_id=? AND created_at=? AND id<>?').get(lot.id, culture.created_at, culture.id) as { n: number };
      const thaw = db.prepare("SELECT extra FROM culture_logs WHERE culture_id=? AND type='note' AND json_extract(extra,'$.thawLotId') IS NOT NULL").get(culture.id) as
        | { extra: string }
        | undefined;
      const recorded = Number(parseJsonColumn<Record<string, string>>(thaw?.extra, {}).thawVials) || 0;
      vials = siblings.n ? 0 : Math.min(used, recorded);
    }
    if (vials) db.prepare('UPDATE cryo_lots SET vials_remaining=vials_remaining+? WHERE id=?').run(vials, lot.id);
  }
  if (culture.parent_culture_id) {
    const passages = db.prepare("SELECT * FROM culture_logs WHERE culture_id=? AND type='passage'").all(culture.parent_culture_id) as unknown as LogRow[];
    for (const passage of passages) {
      const extra = parseJsonColumn<Record<string, string>>(passage.extra, {});
      const ids = childCultureIds(extra);
      if (!ids.includes(culture.id)) continue;
      const rest = ids.filter((id) => id !== culture.id);
      if (rest.length) {
        db.prepare('UPDATE culture_logs SET extra=? WHERE id=?').run(
          JSON.stringify({ ...extra, childCultureIds: rest.join(','), childCount: String(rest.length) }),
          passage.id,
        );
      } else {
        files.push(...photoFiles('l.id=?', passage.id));
        removeOperationLog(passage, 'split');
      }
    }
  }
  db.prepare('DELETE FROM cultures WHERE id=?').run(culture.id);
  return files;
}
export function deleteCulture(cultureId: string, restoreVials?: unknown): string[] {
  return tx(() => removeCulture(cultureId, restoreVials));
}
/** Delete a lot nothing was thawed from. A frozen lot undoes its freeze (the culture it ended is active again). */
export function deleteLot(lotId: string): string[] {
  return tx(() => {
    const lot = getLot(lotId);
    const freeze = freezeLogOf(lot.id);
    if (freeze) return undoFreeze(freeze, parseJsonColumn<Record<string, string>>(freeze.extra, {}));
    const thawed = (db.prepare('SELECT label FROM cultures WHERE parent_lot_id=?').all(lot.id) as { label: string }[]).map((r) => r.label);
    if (thawed.length) throw new HttpError(409, `${lot.label}에서 해동한 배양(${thawed.join(', ')})이 있습니다. 그 해동 기록을 먼저 취소하세요`);
    db.prepare('DELETE FROM cryo_lots WHERE id=?').run(lot.id);
    return [];
  });
}

/* ───────────── Operations ───────────── */

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
    const spec = vesselSpec(b);
    const culture = insertCulture(
      lineId,
      p,
      spec,
      profileFor(lineId, b.profileId),
      eventTime(b.startedAt),
      text(b.label, '라벨') || `${line.name}-P${p}-입고`,
    );
    const notes = text(b.notes, '메모', false, 10000);
    if (notes) db.prepare('UPDATE cultures SET notes=? WHERE id=?').run(notes, culture.id);
    return { culture: toCultureDto(getCulture(culture.id)), warnings: [...warnings(lineId, p), ...(spec.resolved?.warnings ?? [])] };
  });
}
/** A thaw seeds `cultures` (1–24 flasks/dishes) from one event; the old single shape (`vessel`/`vesselUse`/`label` at top level) still works. */
export function thawLot(lotId: string, b: LineageInput) {
  return tx(() => {
    const lot = getLot(lotId);
    const vials = numeric(b.vials ?? 1, '바이알 수', 1, Number.MAX_SAFE_INTEGER, true);
    if (lot.vials_remaining < vials) throw new HttpError(409, '남은 바이알이 없습니다');
    const p = numeric(b.passage ?? lot.passage ?? 0, 'Passage', 0, Number.MAX_SAFE_INTEGER, true);
    const at = eventTime(b.at);
    let targets: Record<string, unknown>[];
    if (b.cultures === undefined) targets = [b];
    else {
      if (!Array.isArray(b.cultures) || b.cultures.length < 1 || b.cultures.length > 24)
        throw new HttpError(400, '해동 후 배양 용기는 1–24개여야 합니다');
      targets = b.cultures.map((raw) => record(raw, '배양 용기 정보'));
    }
    const specs = targets.map((t) => vesselSpec(t));
    const labels = targets.map((t) => text(t.label, '라벨'));
    const note = text(b.note, '메모', false, 10000);
    const profileId = profileFor(lot.cell_line_id, b.profileId);
    // Thaw-event number: all cultures of one thaw share one created_at, so the number of distinct created_at values
    // among the lot's thawed cultures is the number of earlier thaw events. (Counting cultures would overcount a split thaw;
    // started_at is user-entered and may repeat.) A new event's created_at is bumped past any existing one so it stays unique.
    const existing = db.prepare('SELECT DISTINCT created_at FROM cultures WHERE parent_lot_id=?').all(lotId).map((r) => String(r.created_at));
    const n = existing.length + 1;
    let createdAt = now();
    while (existing.includes(createdAt)) createdAt = new Date(Date.parse(createdAt) + 1).toISOString();
    const lineName = getLineRow(lot.cell_line_id).name;
    const base = `${lineName}-P${p}-T${n}`;
    const created = targets.map((_, i) => {
      const culture = insertCulture(
        lot.cell_line_id,
        p,
        specs[i],
        profileId,
        at,
        labels[i] || (targets.length === 1 ? base : `${base}-${String.fromCharCode(65 + i)}`),
        null,
        lotId,
        createdAt,
      );
      const head = `해동 (${lot.label}, ${vials} vial)${targets.length > 1 ? ` · 용기 ${i + 1}/${targets.length}` : ''}`;
      const log = insertLog(
        culture.id,
        { at, type: 'note', note: [head, note].filter(Boolean).join('\n\n'), extra: { thawLotId: lotId, thawVials: String(vials) } },
        { internal: true },
      );
      attachProtocolRun([log.id], culture.id, b.protocolRun);
      return culture;
    });
    db.prepare('UPDATE cryo_lots SET vials_remaining=vials_remaining-? WHERE id=?').run(vials, lotId);
    return {
      culture: toCultureDto(getCulture(created[0].id)),
      cultures: created.map((c) => toCultureDto(getCulture(c.id))),
      lot: toLotDto(getLot(lotId)),
      warnings: [...warnings(lot.cell_line_id, p), ...specs.flatMap((s) => s.resolved?.warnings ?? [])],
    };
  });
}

interface ChildSeeding {
  cells: number;
  volumeMl: number | null;
}
export function passageCulture(cultureId: string, b: LineageInput) {
  return tx(() => passageWithin(cultureId, b));
}

/**
 * Several passages of one culture in one step: each group is a set of plates harvested together with its own count,
 * split and leftover handling. All groups are saved or none; a plate may be in only one group.
 */
export function passagePlateGroups(cultureId: string, b: LineageInput) {
  return tx(() => {
    if (!Array.isArray(b.groups) || b.groups.length < 1 || b.groups.length > 24) throw new HttpError(400, 'plate 묶음은 1–24개여야 합니다');
    const seen = new Set<number>();
    const results = b.groups.map((raw, i) => {
      const group = record(raw, `${i + 1}번째 plate 묶음`);
      if (!Array.isArray(group.sourcePlates) || !group.sourcePlates.length) throw new HttpError(400, `${i + 1}번째 묶음의 plate를 고르세요`);
      for (const no of group.sourcePlates) {
        if (seen.has(Number(no))) throw new HttpError(400, `plate ${no}을(를) 두 묶음에 넣을 수 없습니다`);
        seen.add(Number(no));
      }
      try {
        return passageWithin(cultureId, group);
      } catch (e) {
        if (e instanceof HttpError) throw new HttpError(e.status, `plate ${group.sourcePlates.join(', ')}: ${e.message}`);
        throw e;
      }
    });
    return { results, warnings: [...new Set(results.flatMap((r) => r.warnings))] };
  });
}

/** One passage record; runs inside the caller's transaction. */
function passageWithin(cultureId: string, b: LineageInput) {
  const parent = getCulture(cultureId);
  if (parent.status !== 'active') throw new HttpError(409, '활성 상태의 배양만 계대할 수 있습니다');
  if (!Array.isArray(b.children) || b.children.length < 1 || b.children.length > 24)
    throw new HttpError(400, '자식 배양은 1–24개여야 합니다');
  const at = eventTime(b.at);
  const keep = flag(b.keepParent, false);
  const freeze = b.freeze === undefined || b.freeze === null ? null : record(b.freeze, '남은 세포 동결');
  if (freeze && keep) throw new HttpError(400, '남은 세포는 기존 용기에 두거나 동결하거나 둘 중 하나만 고르세요');
  const count = valid(() => validateCountExtras(b.count));
  const reagent = text(b.dissociationReagent, '계대 시약', false, 200);
  // Which of the culture's vessels the cells came from (default: every vessel still in culture).
  const plates = toCultureDto(parent).plates;
  const activePlates = plates.filter((p) => p.status === 'active').map((p) => p.no);
  const sourcePlates = b.sourcePlates === undefined || b.sourcePlates === null ? activePlates : platesFrom(b.sourcePlates, activePlates, plates.length, '계대');
  // The hemocytometer count is of live cells, so recoveredLiveCells is that count × volume and is never multiplied by viability again.
  const recovered = optionalNumber(b.recoveredLiveCells, '회수한 생세포 수');
  const legacyTotal = optionalNumber(b.totalCells, '총 세포 수');
  if (recovered !== null && legacyTotal !== null && recovered !== legacyTotal)
    throw new HttpError(400, '회수한 생세포 수와 총 세포 수가 서로 다릅니다');
  const totalCells = recovered ?? legacyTotal;
  const cellsPerMl = optionalNumber(b.cellsPerMl, '세포 농도');
  const rawChildren = b.children.map((raw) => record(raw, '자식 배양 정보'));
  const seededGiven = rawChildren.filter((c) => c.seededCells !== undefined && c.seededCells !== null).length;
  if (seededGiven !== 0 && seededGiven !== rawChildren.length)
    throw new HttpError(400, '접종 세포 수는 모든 자식 배양에 입력하거나 모두 비워 두세요');
  const seeding: (ChildSeeding | null)[] = rawChildren.map((child, i) => {
    if (seededGiven === 0) return null;
    const cells = numeric(child.seededCells, `${i + 1}번째 자식의 접종 세포 수`);
    const volumeMl = optionalNumber(child.seededVolumeMl, `${i + 1}번째 자식의 접종 부피`);
    if (volumeMl === 0) throw new HttpError(400, `${i + 1}번째 자식의 접종 부피는 0보다 커야 합니다`);
    if (volumeMl !== null && cellsPerMl !== null) {
      const expected = cellsPerMl * volumeMl;
      if (Math.abs(cells - expected) > SEEDING_VOLUME_TOLERANCE * Math.max(cells, expected))
        throw new HttpError(400, `${i + 1}번째 자식의 접종 세포 수가 부피 × 농도와 맞지 않습니다`);
    }
    return { cells, volumeMl };
  });
  let seededTotal: number | null = null;
  if (seededGiven > 0) {
    if (recovered === null && legacyTotal === null) throw new HttpError(400, '접종 세포 수를 기록하려면 회수한 생세포 수를 입력하세요');
    seededTotal = valid(() => passageConservation(totalCells!, seeding.map((s) => s!.cells))).seededCells;
  }
  const parentLabel = parent.label;
  const line = getLineRow(parent.cell_line_id);
  const allWarnings = warnings(parent.cell_line_id, parent.passage + 1);
  // Earlier passages of other plates already used some letters; default labels never repeat a sibling's.
  const usedLabels = new Set(
    (db.prepare('SELECT label FROM cultures WHERE parent_culture_id=?').all(cultureId) as { label: string }[]).map((r) => r.label.toLowerCase()),
  );
  const defaultLabel = () => {
    for (let k = 0; ; k++) {
      // A…Z, then AA, AB, …
      const letter = (k < 26 ? '' : String.fromCharCode(64 + Math.floor(k / 26))) + String.fromCharCode(65 + (k % 26));
      const label = `${line.name}-P${parent.passage + 1}-${letter}`;
      if (!usedLabels.has(label.toLowerCase())) return label;
    }
  };
  const children = rawChildren.map((child, i) => {
    const spec = vesselSpec(child);
    allWarnings.push(...(spec.resolved?.warnings ?? []));
    const label = text(child.label, '라벨') || defaultLabel();
    usedLabels.add(label.toLowerCase());
    const created = insertCulture(parent.cell_line_id, parent.passage + 1, spec, parent.profile_id, at, label, cultureId);
    const s = seeding[i];
    if (s) {
      const area = useArea(spec.resolved);
      const extra: Record<string, string> = { seedingCells: String(s.cells), seedingParent: parentLabel };
      if (s.volumeMl !== null) extra.seedingVolumeMl = String(s.volumeMl);
      if (area) extra.seedingDensityPerCm2 = String(s.cells / area);
      insertLog(created.id, { at, type: 'note', note: `${parentLabel}에서 계대 · 접종 ${Math.round(s.cells).toLocaleString('ko-KR')} cells`, extra }, { internal: true });
    }
    return created;
  });
  const extra: Record<string, string> = {
    splitRatio: text(b.splitRatio, '분주 비율'),
    childCount: String(children.length),
    childCultureIds: children.map((c) => c.id).join(','),
    leftoverHandling: freeze ? 'frozen' : keep ? 'kept' : 'discarded',
    ...count,
  };
  if (reagent) extra.dissociationReagent = reagent;
  if (seededTotal !== null) extra.seededCells = String(seededTotal);
  if (plates.length > 1) extra.sourcePlates = sourcePlates.join(',');
  // Leftover cells frozen in the same step: a freeze record and stock from the parent, before it is marked split.
  let frozenLot: LotDto | null = null;
  if (freeze) {
    const leftover = totalCells === null ? null : totalCells - (seededTotal ?? 0);
    const planned = numeric(record(freeze.plan, '동결 계획').recoveredLiveCells, '동결할 세포 수');
    if (leftover !== null && planned > leftover * (1 + 1e-9) + 1e-6)
      throw new HttpError(400, `동결할 세포 수가 접종하고 남은 세포(${Math.round(leftover).toLocaleString('ko-KR')})보다 많습니다`);
    frozenLot = freezeWithin(cultureId, { ...freeze, at, endCulture: false, sourcePlates }).lot;
  }
  const passageLog = insertLog(
    cultureId,
    { at, type: 'passage', confluencyPct: b.confluencyPct, cellsPerMl, viabilityPct: b.viabilityPct, totalCells, note: b.note, mycoplasma: null, extra },
    { internal: true },
  );
  attachProtocolRun([passageLog.id], cultureId, b.protocolRun);
  // Passaged vessels leave the culture; it ends only when no vessel is left (or all cells stay put with keepParent).
  if (!keep) {
    const mark = db.prepare("INSERT INTO culture_plates(culture_id,plate_no,status,at,log_id) VALUES(?,?,'passaged',?,?)");
    if (plates.length > 1) for (const no of sourcePlates) mark.run(cultureId, no, at, passageLog.id);
    if (activePlates.every((no) => sourcePlates.includes(no))) db.prepare("UPDATE cultures SET status='split',ended_at=? WHERE id=?").run(at, cultureId);
  }
  return { parent: toCultureDto(getCulture(cultureId)), children, lot: frozenLot, warnings: allWarnings };
}

/** Validated, de-duplicated plate numbers that are all still active. */
function platesFrom(raw: unknown, active: number[], total: number, action: string): number[] {
  if (!Array.isArray(raw) || !raw.length) throw new HttpError(400, `${action}할 plate를 하나 이상 고르세요`);
  const chosen = [...new Set(raw.map((n) => numeric(n, 'plate 번호', 1, total, true)))].sort((a, b) => a - b);
  const gone = chosen.find((n) => !active.includes(n));
  if (gone) throw new HttpError(400, `plate ${gone}은(는) 이미 계대·동결·폐기되어 활성 상태가 아닙니다`);
  return chosen;
}

/** Discard some vessels of a culture; discarding the last one ends the culture as discarded. Undo = delete the record. */
export function discardPlates(cultureId: string, b: LineageInput) {
  return tx(() => {
    const culture = getCulture(cultureId);
    if (culture.status !== 'active') throw new HttpError(409, '종료된 배양입니다');
    const plates = toCultureDto(culture).plates;
    const active = plates.filter((p) => p.status === 'active').map((p) => p.no);
    const chosen = platesFrom(b.plates, active, plates.length, '폐기');
    const at = eventTime(b.at);
    const note = text(b.note, '메모', false, 10000);
    const log = insertLog(
      cultureId,
      { at, type: 'note', note: [`plate ${chosen.join(', ')} 폐기`, note].filter(Boolean).join('\n\n'), extra: { discardedPlates: chosen.join(',') } },
      { internal: true },
    );
    const mark = db.prepare("INSERT INTO culture_plates(culture_id,plate_no,status,at,log_id) VALUES(?,?,'discarded',?,?)");
    for (const no of chosen) mark.run(cultureId, no, at, log.id);
    if (chosen.length === active.length) db.prepare("UPDATE cultures SET status='discarded',ended_at=? WHERE id=?").run(at, cultureId);
    return toCultureDto(getCulture(cultureId));
  });
}

/** Parse the optional freeze plan of a freeze request into a validated allocation. */
function planInputs(raw: Record<string, unknown>) {
  const desired = raw.desiredVials === undefined || raw.desiredVials === null ? null : numeric(raw.desiredVials, '희망 바이알 수', 1, 10000, true);
  return {
    recoveredLiveCells: numeric(raw.recoveredLiveCells, '회수한 생세포 수'),
    retainedCells: numeric(raw.retainedCells ?? 0, '남겨 둘 세포 수'),
    targetCellsPerVial: numeric(raw.targetCellsPerVial, '바이알당 목표 세포 수', Number.MIN_VALUE),
    volumePerVialMl: numeric(raw.volumePerVialMl, '바이알당 부피(mL)', Number.MIN_VALUE),
    desiredVials: desired,
  };
}
/** Pure preview of a freeze allocation (no data is changed). */
export function freezePreview(raw: unknown): FreezeAllocation {
  return valid(() => freezeAllocation(planInputs(record(raw, '동결 계획'))));
}

export function freezeCulture(cultureId: string, b: LineageInput) {
  return tx(() => freezeWithin(cultureId, b));
}
/**
 * Freeze cells of an active culture into a new stock lot. With a plan the vial count is checked against the cells; a
 * plan with `suspensionCellsPerMl` also stores how each vial is filled (counted suspension + freezing medium). Must run
 * inside a transaction (a passage may freeze its leftover cells in the same step).
 */
function freezeWithin(cultureId: string, b: LineageInput): { lot: LotDto; culture: CultureDto } {
  const culture = getCulture(cultureId);
  if (culture.status !== 'active') throw new HttpError(409, '이미 종료된 배양입니다');
  const at = eventTime(b.at);
  const end = flag(b.endCulture, false);
  const plates = toCultureDto(culture).plates;
  const activePlates = plates.filter((p) => p.status === 'active').map((p) => p.no);
  const sourcePlates = b.sourcePlates == null ? activePlates : platesFrom(b.sourcePlates, activePlates, plates.length, '동결');
  const day = at.slice(2, 10).replaceAll('-', '');
  const vials = numeric(b.vials, '바이알 수', 1, Number.MAX_SAFE_INTEGER, true);
  const count = valid(() => validateCountExtras(b.count));
  let freezePlan: FreezePlanRecord | null = null;
  let cellsPerVial: unknown = b.cellsPerVial;
  let thawPlan: RepresentativeThaw | null = null;
  if (b.plan !== undefined && b.plan !== null) {
    const raw = record(b.plan, '동결 계획');
    const inputs = planInputs(raw);
    const allocation = valid(() => freezeAllocation(inputs));
    if (inputs.retainedCells > 0 && end)
      throw new HttpError(400, '남겨 둘 세포가 있으면 동결한 plate를 종료할 수 없습니다. plate를 유지한 채 동결만 기록하세요');
    if (vials > allocation.possibleVials)
      throw new HttpError(
        400,
        allocation.possibleVials === 0
          ? `계획한 세포 수로는 바이알을 만들 수 없습니다 (${Math.ceil(allocation.shortfallCells).toLocaleString('ko-KR')}개 부족)`
          : `계획한 세포 수로는 최대 ${allocation.possibleVials}개 바이알만 만들 수 있습니다 (입력 ${vials}개)`,
      );
    if (typeof b.cellsPerVial === 'number' && Math.abs(b.cellsPerVial - inputs.targetCellsPerVial) > 1e-6 * inputs.targetCellsPerVial)
      throw new HttpError(400, '바이알당 세포 수가 동결 계획의 목표와 다릅니다');
    cellsPerVial = inputs.targetCellsPerVial;
    const used = vials * inputs.targetCellsPerVial;
    const suspension = optionalNumber(raw.suspensionCellsPerMl, '현탁액 생세포 농도');
    const strength = optionalNumber(raw.freezingMediumX, '동결 배지 농도(X)');
    if (suspension && strength === null) throw new HttpError(400, '동결 배지 농도(X)를 입력하세요');
    freezePlan = {
      ...allocation,
      ...inputs,
      vials,
      usedCells: used,
      leftoverCells: Math.max(0, allocation.availableCells - used),
      resuspendVolumeMl: vials * inputs.volumePerVialMl,
      mix:
        suspension && strength !== null
          ? valid(() =>
              freezeMix({
                suspensionCellsPerMl: suspension,
                targetCellsPerVial: inputs.targetCellsPerVial,
                volumePerVialMl: inputs.volumePerVialMl,
                vials,
                freezingMediumX: strength,
                freezingMediumDmsoPct: optionalNumber(raw.freezingMediumDmsoPct, '동결 배지 DMSO 농도', 100),
              }),
            )
          : null,
    };
    if (raw.representativeThaw !== undefined && raw.representativeThaw !== null)
      thawPlan = valid(() => validateRepresentativeThaw(raw.representativeThaw, vials));
  } else if (b.representativeThaw !== undefined && b.representativeThaw !== null) {
    thawPlan = valid(() => validateRepresentativeThaw(b.representativeThaw, vials));
  }
  const lot = insertLot(
    culture.cell_line_id,
    { ...b, cellsPerVial },
    'frozen',
    cultureId,
    culture.passage,
    `${getLineRow(culture.cell_line_id).name}-P${culture.passage}-F${day}`,
    at,
  );
  upsertLotDetails(lot.id, { freezePlan, representativeThaw: thawPlan, recovery: { status: 'unverified', observedAt: null, note: '' } });
  const note = text(b.note, '메모', false, 10000);
  const freezeLog = insertLog(
    cultureId,
    {
      at,
      type: 'freeze',
      confluencyPct: b.confluencyPct,
      cellsPerMl: b.cellsPerMl,
      viabilityPct: b.viabilityPct,
      totalCells: freezePlan?.recoveredLiveCells ?? b.totalCells,
      note: [`${lot.vialsInitial} vial 동결 · ${lot.location}`, note].filter(Boolean).join('\n\n'),
      extra: { frozenLotId: lot.id, ...count, ...(plates.length > 1 ? { sourcePlates: sourcePlates.join(',') } : {}) },
    },
    { internal: true },
  );
  attachProtocolRun([freezeLog.id], cultureId, b.protocolRun);
  if (end) {
    if (plates.length > 1) {
      const mark = db.prepare("INSERT INTO culture_plates(culture_id,plate_no,status,at,log_id) VALUES(?,?,'frozen',?,?)");
      for (const no of sourcePlates) mark.run(cultureId, no, at, freezeLog.id);
    }
    if (sourcePlates.length === activePlates.length) db.prepare("UPDATE cultures SET status='frozen',ended_at=? WHERE id=?").run(at, cultureId);
  }
  return { lot: toLotDto(getLot(lot.id)), culture: toCultureDto(getCulture(cultureId)) };
}
/** End a culture by hand (수확·폐기·오염). The end is a record: editing it moves the end, deleting it reopens the culture. */
export function endCulture(cultureId: string, b: LineageInput) {
  return tx(() => {
    const culture = getCulture(cultureId);
    if (culture.status !== 'active') throw new HttpError(409, '이미 종료된 배양입니다');
    if (!isEndStatus(b.status)) throw new HttpError(400, '종료 상태를 확인하세요');
    const log = insertLog(cultureId, { at: b.at, type: endLogType(b.status), note: b.note, extra: { endStatus: b.status } }, { internal: true });
    if (log.at < culture.started_at) throw new HttpError(400, '종료 일시가 시작 일시보다 앞섭니다');
    db.prepare('UPDATE cultures SET status=?,ended_at=?,end_note=? WHERE id=?').run(b.status, log.at, log.note, cultureId);
    return toCultureDto(getCulture(cultureId));
  });
}

/* ───────────── Journal summaries ───────────── */

export interface LogSummary {
  lastLog: LogDto | null;
  /** Latest non-null confluency measurement with its own time (not just the latest log). */
  lastConfluency: { pct: number; at: string } | null;
  /** Latest real medium replacement (legacy, full, partial) or passage. Addition-only never counts. */
  lastFeed: { at: string; mode: FeedRecord['mode'] | 'passage' } | null;
  lastAddition: { at: string } | null;
}
/** `rows` must be ordered newest first. */
export function summarizeLogs(rows: LogRow[]): LogSummary {
  let lastConfluency: LogSummary['lastConfluency'] = null;
  let lastFeed: LogSummary['lastFeed'] = null;
  let lastAddition: LogSummary['lastAddition'] = null;
  for (const row of rows) {
    if (!lastConfluency && row.confluency_pct !== null) lastConfluency = { pct: row.confluency_pct, at: row.at };
    if (row.type === 'passage' && !lastFeed) lastFeed = { at: row.at, mode: 'passage' };
    if (row.type === 'medium_change') {
      const feed = feedFromExtra(parseJsonColumn<Record<string, string>>(row.extra, {}));
      if (feed.replacesMedium && !lastFeed) lastFeed = { at: row.at, mode: feed.mode };
      if (!feed.replacesMedium && !lastAddition) lastAddition = { at: row.at };
    }
  }
  return { lastLog: rows[0] ? toLogDtos([rows[0]])[0] : null, lastConfluency, lastFeed, lastAddition };
}

/** Which record drew each lineage edge and how many protocol steps it changed; ordinary records with changes per culture. */
export function lineageAnnotations(lineId: string): LineageAnnotations {
  const rows = db
    .prepare(
      'SELECT l.id,l.culture_id,l.type,l.extra,p.steps FROM culture_logs l JOIN cultures c ON c.id=l.culture_id LEFT JOIN culture_log_protocols p ON p.log_id=l.id WHERE c.cell_line_id=?',
    )
    .all(lineId) as { id: string; culture_id: string; type: string; extra: string; steps: string | null }[];
  const out: LineageAnnotations = { operations: {}, changedRecords: {} };
  for (const row of rows) {
    const extra = parseJsonColumn<Record<string, string>>(row.extra, {});
    const op = { logId: row.id, protocolChanges: parseJsonColumn<{ modified: string | null }[]>(row.steps, []).filter((s) => s.modified !== null).length };
    switch (logOperation(row.type, extra)) {
      case 'thaw':
        out.operations[`thaw:${extra.thawLotId}:${row.culture_id}`] = op;
        break;
      case 'passage':
        for (const child of childCultureIds(extra)) out.operations[`passage:${row.culture_id}:${child}`] = { ...op, sourcePlates: plateList(extra.sourcePlates) };
        break;
      case 'discard':
        break;
      case 'freeze':
        if (extra.frozenLotId) out.operations[`freeze:${row.culture_id}:${extra.frozenLotId}`] = { ...op, sourcePlates: plateList(extra.sourcePlates) };
        break;
      default:
        if (op.protocolChanges) out.changedRecords[row.culture_id] = (out.changedRecords[row.culture_id] ?? 0) + 1;
    }
  }
  return out;
}
