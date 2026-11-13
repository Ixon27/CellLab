import type { CultureVesselUse, VesselProduct } from './lab-products';

/* ───────────── Vessel assignment (current culture) ───────────── */

/** The vessel a culture currently occupies. `product` is frozen when the product is first assigned. */
export interface CultureVesselUseDto extends CultureVesselUse {
  product: VesselProduct;
}

/* ───────────── Medium change (feed) ───────────── */

export const FEED_MODES = ['full', 'partial', 'addition'] as const;
export type FeedMode = (typeof FEED_MODES)[number];
export const FEED_MODE_LABELS: Record<FeedMode | 'unspecified', string> = {
  full: '전체 교환',
  partial: '부분 교환',
  addition: '추가만 (기존 배지 유지)',
  unspecified: '방식 미기록 (이전 기록)',
};
export const FEED_MODE_HELP: Record<FeedMode, string> = {
  full: '기존 배지를 모두 제거하고 새 배지를 넣었습니다. 제거 부피와 추가 부피가 모두 필요합니다.',
  partial: '기존 배지 일부를 제거하고 새 배지를 넣었습니다. 제거 부피와 추가 부피가 모두 필요합니다.',
  addition: '기존 배지를 제거하지 않고 새 배지만 더했습니다. 마지막 배지 교체일로 계산하지 않습니다.',
};
export const MAX_MEDIUM_ML = 10000;

export interface FeedRecord {
  /** `unspecified` = legacy medium_change written before the mode existed (treated as a real replacement). */
  mode: FeedMode | 'unspecified';
  removedMl: number | null;
  addedMl: number | null;
  mediumLabel: string | null;
  mediumProductId: string | null;
  /** Manufacturer · catalog · lot text frozen from the medium product when the log was written. */
  mediumDetail: string | null;
  /** false only for `addition`: it never resets the "last medium replacement" clock. */
  replacesMedium: boolean;
}

/** Validated feed input, ready to be stored in log.extra. */
export interface FeedInput {
  mode: FeedMode;
  removedMl: number;
  addedMl: number;
  mediumLabel: string;
  mediumProductId: string | null;
}

export const FEED_EXTRA_KEYS = ['mediumMode', 'removedMl', 'addedMl', 'mediumLabel', 'mediumProductId', 'mediumDetail'] as const;
export const OBSERVATION_EXTRA_KEYS = ['morphology'] as const;
export const PASSAGE_EXTRA_KEYS = ['splitRatio', 'dissociationReagent', 'seededCells', 'childCount'] as const;
export const SEEDING_EXTRA_KEYS = ['seedingCells', 'seedingVolumeMl', 'seedingDensityPerCm2', 'seedingParent'] as const;
/** log.extra names the app writes itself; users cannot use them as free items. */
export const RESERVED_EXTRA_KEYS: readonly string[] = [...FEED_EXTRA_KEYS, ...OBSERVATION_EXTRA_KEYS, ...PASSAGE_EXTRA_KEYS, ...SEEDING_EXTRA_KEYS];

function amount(raw: unknown, label: string, allowZero: boolean): number {
  const value = typeof raw === 'string' && /^\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (!allowZero && value === 0))
    throw new Error(`${label}을(를) ${allowZero ? '0 이상의' : '0보다 큰'} 숫자로 입력하세요`);
  if (value > MAX_MEDIUM_ML) throw new Error(`${label}이(가) 너무 큽니다 (최대 ${MAX_MEDIUM_ML.toLocaleString()} mL)`);
  return value;
}

/**
 * Feed rules: full and partial need a positive removal AND a positive addition,
 * addition-only must not remove anything. `currentMediumMl` (the culture's recorded medium volume)
 * is used only to reject removals that cannot physically happen.
 */
export function validateFeedInput(raw: unknown, currentMediumMl: number | null = null): FeedInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('배지 교체 방식을 선택하세요');
  const f = raw as Record<string, unknown>;
  const mode = f.mode;
  if (typeof mode !== 'string' || !(FEED_MODES as readonly string[]).includes(mode)) throw new Error('배지 교체 방식을 선택하세요');
  const label = typeof f.mediumLabel === 'string' ? f.mediumLabel.trim() : '';
  if (!label || label.length > 200) throw new Error('사용한 배지 이름을 1–200자로 입력하세요');
  let productId: string | null = null;
  if (f.mediumProductId !== undefined && f.mediumProductId !== null && f.mediumProductId !== '') {
    if (typeof f.mediumProductId !== 'string' || f.mediumProductId.length > 120) throw new Error('배지 제품 ID를 확인하세요');
    productId = f.mediumProductId;
  }
  const added = amount(f.addedMl, '추가한 배지 부피', false);
  let removed: number;
  if (mode === 'addition') {
    const given = f.removedMl === undefined || f.removedMl === null || f.removedMl === '' ? 0 : amount(f.removedMl, '제거한 배지 부피', true);
    if (given !== 0) throw new Error('추가만 하는 기록에는 제거 부피를 입력할 수 없습니다. 배지를 제거했다면 부분·전체 교환을 선택하세요');
    removed = 0;
  } else {
    removed = amount(f.removedMl, '제거한 배지 부피', false);
    if (currentMediumMl !== null && removed > currentMediumMl)
      throw new Error(`제거 부피(${removed} mL)가 현재 배지 부피(${currentMediumMl} mL)보다 클 수 없습니다`);
    if (mode === 'partial' && currentMediumMl !== null && removed === currentMediumMl)
      throw new Error('현재 배지를 모두 제거했다면 전체 교환을 선택하세요');
    if (mode === 'full' && currentMediumMl !== null && Math.abs(removed - currentMediumMl) > 1e-6)
      throw new Error('기록상 배지를 전부 제거하지 않았습니다. 부분 교환을 선택하거나 현재 배지량을 확인하세요');
  }
  return { mode: mode as FeedMode, removedMl: removed, addedMl: added, mediumLabel: label, mediumProductId: productId };
}

/** Stored → typed. Missing mode on a medium_change = legacy unspecified replacement. */
export function feedFromExtra(extra: Record<string, string>): FeedRecord {
  const rawMode = extra.mediumMode;
  const mode: FeedRecord['mode'] = (FEED_MODES as readonly string[]).includes(rawMode) ? (rawMode as FeedMode) : 'unspecified';
  const num = (v: string | undefined) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    mode,
    removedMl: num(extra.removedMl),
    addedMl: num(extra.addedMl),
    mediumLabel: extra.mediumLabel || null,
    mediumProductId: extra.mediumProductId || null,
    mediumDetail: extra.mediumDetail || null,
    replacesMedium: mode !== 'addition',
  };
}
/** Apply a chronological feed to a known volume. Unspecified legacy exchanges invalidate the volume, never guess zero. */
export function mediumVolumeAfter(currentMl: number | null, feed: FeedRecord): number | null {
  if (feed.mode === 'unspecified' || feed.addedMl === null || feed.removedMl === null) return null;
  if (feed.mode === 'full') return feed.addedMl;
  if (currentMl === null) return null;
  const next = currentMl - feed.removedMl + feed.addedMl;
  return next >= 0 && Number.isFinite(next) ? next : null;
}

/* ───────────── Observation photos ───────────── */

export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const PHOTO_MAX_PER_LOG = 10;
export const PHOTO_MIME = ['image/png', 'image/jpeg'] as const;
export type PhotoMime = (typeof PHOTO_MIME)[number];
export interface PhotoDto {
  id: string;
  logId: string;
  originalName: string;
  mime: PhotoMime;
  bytes: number;
  createdAt: string;
  /** Same-origin API path; the desktop session attaches credentials. */
  url: string;
}
/** The real image format of the bytes, ignoring any client-declared type. */
export function sniffImage(buf: Uint8Array): PhotoMime | null {
  if (buf.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => buf[i] === b)) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
}

/* ───────────── Passage ───────────── */

export interface PassageRecord {
  dissociationReagent: string | null;
  splitRatio: string | null;
  /** Live cells recovered after dissociation (the count already excludes dead cells; never multiply by viability again). */
  recoveredLiveCells: number | null;
  seededCells: number | null;
  leftoverCells: number | null;
  childCount: number | null;
}

/** Cells to seed and the suspension volume that carries them. */
export function seedingPlan(o: {
  cellsPerMl: number;
  targetCells?: number | null;
  densityPerCm2?: number | null;
  areaCm2?: number | null;
}): { targetCells: number; volumeMl: number; densityPerCm2: number | null } {
  if (!Number.isFinite(o.cellsPerMl) || o.cellsPerMl <= 0) throw new Error('생세포 농도는 0보다 커야 합니다');
  let target: number;
  if (o.targetCells !== undefined && o.targetCells !== null) {
    target = o.targetCells;
  } else if (o.densityPerCm2 !== undefined && o.densityPerCm2 !== null && o.areaCm2 !== undefined && o.areaCm2 !== null) {
    target = o.densityPerCm2 * o.areaCm2;
  } else {
    throw new Error('목표 세포 수 또는 밀도와 용기 면적이 필요합니다');
  }
  if (!Number.isFinite(target) || target < 0) throw new Error('목표 세포 수를 확인하세요');
  const area = o.areaCm2 ?? null;
  return { targetCells: target, volumeMl: target / o.cellsPerMl, densityPerCm2: area && area > 0 ? target / area : null };
}

/** Seeded cells may not exceed the recovered live cells. Returns the unseeded remainder. */
export function passageConservation(recoveredLiveCells: number, seeded: number[]): { seededCells: number; leftoverCells: number } {
  if (!Number.isFinite(recoveredLiveCells) || recoveredLiveCells < 0) throw new Error('회수한 생세포 수를 확인하세요');
  if (seeded.some((n) => !Number.isFinite(n) || n < 0)) throw new Error('접종 세포 수는 0 이상의 유한한 숫자여야 합니다');
  const total = seeded.reduce((sum, n) => sum + n, 0);
  if (total > recoveredLiveCells * (1 + 1e-9) + 1e-6)
    throw new Error(`접종한 세포 수 합계(${Math.round(total).toLocaleString()})가 회수한 생세포 수(${Math.round(recoveredLiveCells).toLocaleString()})보다 많습니다`);
  return { seededCells: total, leftoverCells: Math.max(0, recoveredLiveCells - total) };
}

/* ───────────── Freeze allocation ───────────── */

export interface FreezeAllocationInput {
  recoveredLiveCells: number;
  /** Cells kept back (continuing culture, counting, etc.); never frozen. */
  retainedCells: number;
  targetCellsPerVial: number;
  volumePerVialMl: number;
  /** Cap on the vial count; also the basis of the shortfall. */
  desiredVials?: number | null;
}
export interface FreezeAllocation {
  availableCells: number;
  possibleVials: number;
  vials: number;
  usedCells: number;
  leftoverCells: number;
  shortfallCells: number;
  resuspendVolumeMl: number;
  concentrationCellsPerMl: number;
}

export function freezeAllocation(i: FreezeAllocationInput): FreezeAllocation {
  const { recoveredLiveCells: recovered, retainedCells: retained, targetCellsPerVial: target, volumePerVialMl: volume } = i;
  if (!Number.isFinite(recovered) || recovered < 0) throw new Error('회수한 생세포 수를 확인하세요');
  if (!Number.isFinite(retained) || retained < 0) throw new Error('남겨 둘 세포 수를 확인하세요');
  // retained > recovered is a plan with a shortfall (negative availableCells), not an input error.
  if (!Number.isFinite(target) || target <= 0) throw new Error('바이알당 목표 세포 수는 0보다 커야 합니다');
  if (!Number.isFinite(volume) || volume <= 0) throw new Error('바이알당 부피는 0보다 커야 합니다');
  const desired = i.desiredVials ?? null;
  if (desired !== null && (!Number.isInteger(desired) || desired < 1)) throw new Error('희망 바이알 수는 1 이상의 정수여야 합니다');
  const available = recovered - retained;
  // The epsilon absorbs binary rounding (0.3 / 0.1 must give 3 vials).
  const possible = Math.max(0, Math.floor(available / target + 1e-9));
  const vials = desired === null ? possible : Math.min(desired, possible);
  const wanted = desired ?? Math.max(1, possible);
  return {
    availableCells: available,
    possibleVials: possible,
    vials,
    usedCells: vials * target,
    leftoverCells: Math.max(0, available - vials * target),
    shortfallCells: Math.max(0, wanted * target - available),
    resuspendVolumeMl: vials * volume,
    concentrationCellsPerMl: target / volume,
  };
}

export interface RepresentativeThaw {
  /** Vials from this lot to thaw as a recovery check. */
  vials: number;
  plannedAt: string | null;
  note: string;
}
/** Allocation as stored on the lot: the user's actual vial count replaces the planned one. */
export interface FreezePlanRecord extends FreezeAllocation {
  recoveredLiveCells: number;
  retainedCells: number;
  targetCellsPerVial: number;
  volumePerVialMl: number;
  desiredVials: number | null;
}
export type RecoveryStatus = 'unverified' | 'confirmed' | 'poor';
export const RECOVERY_LABELS: Record<RecoveryStatus, string> = {
  unverified: '회복 미확인',
  confirmed: '회복 확인',
  poor: '회복 불량',
};
export interface LotRecovery {
  status: RecoveryStatus;
  /** When the recovery was actually observed; null only for `unverified`. */
  observedAt: string | null;
  note: string;
}

export function validateRepresentativeThaw(raw: unknown, lotVials: number): RepresentativeThaw {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('대표 바이알 해동 계획을 확인하세요');
  const r = raw as Record<string, unknown>;
  if (typeof r.vials !== 'number' || !Number.isInteger(r.vials) || r.vials < 1 || r.vials > lotVials)
    throw new Error(`대표 해동 바이알 수는 1–${lotVials} 사이 정수여야 합니다`);
  let plannedAt: string | null = null;
  if (r.plannedAt !== undefined && r.plannedAt !== null && r.plannedAt !== '') {
    if (typeof r.plannedAt !== 'string' || !Number.isFinite(Date.parse(r.plannedAt))) throw new Error('해동 예정일을 확인하세요');
    plannedAt = new Date(r.plannedAt).toISOString();
  }
  const note = r.note === undefined || r.note === null ? '' : r.note;
  if (typeof note !== 'string' || note.length > 1000) throw new Error('해동 계획 메모는 1,000자 이하로 입력하세요');
  return { vials: r.vials, plannedAt, note: note.trim() };
}

export function validateRecovery(raw: unknown, nowMs: number): LotRecovery {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('회복 확인 정보를 확인하세요');
  const r = raw as Record<string, unknown>;
  if (r.status !== 'unverified' && r.status !== 'confirmed' && r.status !== 'poor') throw new Error('회복 상태를 확인하세요');
  const note = r.note === undefined || r.note === null ? '' : r.note;
  if (typeof note !== 'string' || note.length > 2000) throw new Error('회복 메모는 2,000자 이하로 입력하세요');
  if (r.status === 'unverified') {
    if (r.observedAt !== undefined && r.observedAt !== null && r.observedAt !== '') throw new Error('미확인 상태에는 관찰 시각을 입력할 수 없습니다');
    return { status: 'unverified', observedAt: null, note: note.trim() };
  }
  if (typeof r.observedAt !== 'string' || !Number.isFinite(Date.parse(r.observedAt))) throw new Error('회복을 관찰한 시각을 입력하세요');
  const observed = Date.parse(r.observedAt);
  if (observed > nowMs + 5 * 60000) throw new Error('관찰 시각은 미래일 수 없습니다');
  if (!note.trim()) throw new Error('회복 확인·불량 기록에는 관찰 내용을 메모로 남기세요');
  return { status: r.status, observedAt: new Date(observed).toISOString(), note: note.trim() };
}
