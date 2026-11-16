import { nanoid } from 'nanoid';
import type { LogDto } from '../shared/cell-line';
import {
  FEED_EXTRA_KEYS,
  OBSERVATION_EXTRA_KEYS,
  PASSAGE_EXTRA_KEYS,
  RESERVED_EXTRA_KEYS,
  SEEDING_EXTRA_KEYS,
  feedFromExtra,
  freezeAllocation,
  passageConservation,
  validateFeedInput,
  validateRecovery,
  validateRepresentativeThaw,
} from '../shared/culture-operations';
import type { FeedRecord, FreezeAllocation, FreezePlanRecord, LotRecovery, RepresentativeThaw } from '../shared/culture-operations';
import { assertUsedWells, validateVesselUse, vesselArea } from '../shared/lab-products';
import type { CultureVesselUse, VesselProduct } from '../shared/lab-products';
import type { CultureRow, LogRow, LotRow } from './cell-lines';
import { activeProfileRow, getLineRow, toCultureDto, toLogDto, toLogDtos, toLotDto } from './cell-lines';
import { db, now, parseJsonColumn, tx } from './db';
import { HttpError } from './http-error';
import { getMediumProduct, getVesselProduct } from './lab-products';
import { attachProtocolRun } from './protocol-runs';

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
/** Shape-check a vessel use, resolve its product and enforce used wells ≤ the product's wells. */
function resolveUse(raw: unknown, previousProduct?: VesselProduct): ResolvedUse {
  const use = valid(() => validateVesselUse(raw));
  const product = previousProduct?.id === use.vesselProductId ? previousProduct : getVesselProduct(use.vesselProductId);
  if (!product) throw new HttpError(400, '용기 제품을 찾을 수 없습니다');
  valid(() => assertUsedWells(use, product));
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
  db.prepare('UPDATE cultures SET vessel=? WHERE id=?').run(resolved.product.label, cultureId);
}
/** Vessel text plus an optional structured use; the product label becomes the text when a product is chosen. */
function vesselSpec(b: LineageInput): { vessel: string; resolved: ResolvedUse | null } {
  if (b.vesselUse !== undefined && b.vesselUse !== null) {
    const resolved = resolveUse(b.vesselUse);
    return { vessel: resolved.product.label, resolved };
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

/** Update a culture's own fields. A structured vessel use replaces the free-text vessel; `vesselUse: null` clears it. */
export function updateCulture(cultureId: string, b: LineageInput) {
  return tx(() => {
    const culture = getCulture(cultureId);
    let vessel = b.vessel === undefined ? culture.vessel : text(b.vessel, '배양 용기', true);
    const current = toCultureDto(culture).vesselUse;
    let resolved: ResolvedUse | null = null;
    if (b.vesselUse !== undefined && b.vesselUse !== null) resolved = resolveUse(b.vesselUse, current?.product);
    else if (current && b.vesselUse !== null && b.vessel !== undefined && vessel !== culture.vessel)
      throw new HttpError(400, '용기 제품이 지정된 배양입니다. 용기 제품 선택으로 변경하세요');
    if (resolved) vessel = resolved.product.label;
    db.prepare('UPDATE cultures SET label=?,vessel=?,notes=?,profile_id=? WHERE id=?').run(
      b.label === undefined ? culture.label : text(b.label, '라벨', true),
      vessel,
      b.notes === undefined ? culture.notes : text(b.notes, '메모', false, 10000),
      b.profileId === undefined ? culture.profile_id : profileFor(culture.cell_line_id, b.profileId),
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

/** Edit a lot: label/location/notes, manual vial count, representative-thaw plan and explicitly recorded recovery. */
export function updateLot(lotId: string, b: LineageInput) {
  return tx(() => {
    const lot = getLot(lotId);
    const label = b.label === undefined ? lot.label : text(b.label, '라벨', true);
    const location = b.location === undefined ? lot.location : text(b.location, '보관 위치');
    const notes = b.notes === undefined ? lot.notes : text(b.notes, '메모', false, 10000);
    const vials =
      b.vialsRemaining === undefined ? lot.vials_remaining : numeric(b.vialsRemaining, '남은 바이알', 0, lot.vials_initial, true);
    db.prepare('UPDATE cryo_lots SET label=?,location=?,notes=?,vials_remaining=? WHERE id=?').run(label, location, notes, vials, lot.id);
    const patch: LotDetailsPatch = {};
    if (b.representativeThaw !== undefined)
      patch.representativeThaw = b.representativeThaw === null ? null : valid(() => validateRepresentativeThaw(b.representativeThaw, lot.vials_initial));
    if (b.recovery !== undefined) patch.recovery = b.recovery === null ? null : valid(() => validateRecovery(b.recovery, Date.now()));
    if (patch.representativeThaw !== undefined || patch.recovery !== undefined) upsertLotDetails(lot.id, patch);
    return toLotDto(getLot(lot.id));
  });
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

/** Edit an ordinary log. Passage/freeze logs are protected; system-written keys are preserved. */
export function updateLog(logId: string, b: LineageInput) {
  return tx(() => {
    const row = getLog(logId);
    if (row.type === 'passage' || row.type === 'freeze') throw new HttpError(400, '계대·동결 기록은 수정할 수 없습니다');
    if (b.type === 'passage' || b.type === 'freeze') throw new HttpError(400, '계대·동결 기록은 해당 작업으로 추가하세요');
    const stored = toLogDto(row);
    const system = Object.fromEntries(Object.entries(stored.extra).filter(([k]) => ([...PASSAGE_EXTRA_KEYS, ...SEEDING_EXTRA_KEYS] as string[]).includes(k)));
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
    };
    const v = logValues(merged, {
      legacyFeedOk: legacyFeed && (b.type === undefined || b.type === 'medium_change') && b.feed === undefined,
      previousExtra: stored.extra,
      preserve: system,
    });
    db.prepare(
      'UPDATE culture_logs SET at=?,type=?,confluency_pct=?,cells_per_ml=?,viability_pct=?,total_cells=?,mycoplasma=?,extra=?,note=? WHERE id=?',
    ).run(v.at, v.type, v.confluency, v.cells, v.viability, v.total, v.mycoplasma, v.extra, v.note, row.id);
    return toLogDto(getLog(row.id));
  });
}

/** Delete an ordinary log; returns the photo files whose rows were cascaded away so the caller can unlink them. */
export function removeLog(logId: string): string[] {
  return tx(() => {
    const row = getLog(logId);
    if (row.type === 'passage' || row.type === 'freeze') throw new HttpError(400, '계대·동결 기록은 삭제할 수 없습니다');
    const files = (db.prepare('SELECT file_name AS name FROM culture_log_photos WHERE log_id=?').all(row.id) as { name: string }[]).map((r) => r.name);
    db.prepare('DELETE FROM culture_logs WHERE id=?').run(row.id);
    return files;
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
      const log = insertLog(culture.id, { at, type: 'note', note: [head, note].filter(Boolean).join('\n\n') }, { internal: true });
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
  return tx(() => {
    const parent = getCulture(cultureId);
    if (parent.status !== 'active') throw new HttpError(409, '활성 상태의 배양만 계대할 수 있습니다');
    if (!Array.isArray(b.children) || b.children.length < 1 || b.children.length > 24)
      throw new HttpError(400, '자식 배양은 1–24개여야 합니다');
    const at = eventTime(b.at);
    const keep = flag(b.keepParent, false);
    const reagent = text(b.dissociationReagent, '계대 시약', false, 200);
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
    const children = rawChildren.map((child, i) => {
      const spec = vesselSpec(child);
      allWarnings.push(...(spec.resolved?.warnings ?? []));
      const created = insertCulture(
        parent.cell_line_id,
        parent.passage + 1,
        spec,
        parent.profile_id,
        at,
        text(child.label, '라벨') || `${line.name}-P${parent.passage + 1}-${String.fromCharCode(65 + i)}`,
        cultureId,
      );
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
    const extra: Record<string, string> = { splitRatio: text(b.splitRatio, '분주 비율'), childCount: String(children.length) };
    if (reagent) extra.dissociationReagent = reagent;
    if (seededTotal !== null) extra.seededCells = String(seededTotal);
    const passageLog = insertLog(
      cultureId,
      { at, type: 'passage', confluencyPct: b.confluencyPct, cellsPerMl, viabilityPct: b.viabilityPct, totalCells, note: b.note, mycoplasma: null, extra },
      { internal: true },
    );
    attachProtocolRun([passageLog.id], cultureId, b.protocolRun);
    if (!keep) db.prepare("UPDATE cultures SET status='split',ended_at=? WHERE id=?").run(at, cultureId);
    return { parent: toCultureDto(getCulture(cultureId)), children, warnings: allWarnings };
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
  return tx(() => {
    const culture = getCulture(cultureId);
    if (culture.status !== 'active') throw new HttpError(409, '이미 종료된 배양입니다');
    const at = eventTime(b.at);
    const end = flag(b.endCulture, false);
    const day = at.slice(2, 10).replaceAll('-', '');
    const vials = numeric(b.vials, '바이알 수', 1, Number.MAX_SAFE_INTEGER, true);
    let freezePlan: FreezePlanRecord | null = null;
    let cellsPerVial: unknown = b.cellsPerVial;
    let thawPlan: RepresentativeThaw | null = null;
    if (b.plan !== undefined && b.plan !== null) {
      const raw = record(b.plan, '동결 계획');
      const inputs = planInputs(raw);
      const allocation = valid(() => freezeAllocation(inputs));
      if (inputs.retainedCells > 0 && end)
        throw new HttpError(400, '남겨 둘 세포가 있으면 배양을 종료할 수 없습니다. 배양을 유지한 채 동결만 기록하세요');
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
      freezePlan = {
        ...allocation,
        ...inputs,
        vials,
        usedCells: used,
        leftoverCells: Math.max(0, allocation.availableCells - used),
        resuspendVolumeMl: vials * inputs.volumePerVialMl,
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
        note: [`${lot.vialsInitial} vial 동결 · ${lot.location}`, note].filter(Boolean).join('\n\n'),
      },
      { internal: true },
    );
    attachProtocolRun([freezeLog.id], cultureId, b.protocolRun);
    if (end) db.prepare("UPDATE cultures SET status='frozen',ended_at=? WHERE id=?").run(at, cultureId);
    return { lot: toLotDto(getLot(lot.id)), culture: toCultureDto(getCulture(cultureId)) };
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
