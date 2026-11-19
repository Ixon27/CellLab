import type { CellLineDto, CultureDto, GrowthMode, LogDto, LotDto, ProfileDto, ProviderXref, SourceRef } from '../shared/cell-line';
import { countFromExtra, feedFromExtra, isLeftoverHandling, logOperation, mediumVolumeAfter, plateCountOf } from '../shared/culture-operations';
import type { PlateStatus } from '../shared/culture-operations';
import type { FreezePlanRecord, PhotoDto, RecoveryStatus, RepresentativeThaw } from '../shared/culture-operations';
import type { VesselProduct } from '../shared/lab-products';
import type { CultureProfileFields } from '../shared/culture';
import { validateExecutionPlan } from '../shared/culture-plan';
import type { ProtocolRun } from '../shared/protocol-run';
import { db, parseJsonColumn } from './db';
import { HttpError } from './http-error';

export interface CellLineRow {
  id: string;
  name: string;
  cellosaurus_ac: string | null;
  synonyms: string;
  species: string | null;
  tissue: string | null;
  disease: string | null;
  category: string | null;
  sex: string | null;
  growth_mode: GrowthMode;
  source_bank: string | null;
  catalog_no: string | null;
  provider_url: string | null;
  providers: string;
  doubling_time: string | null;
  caution: string | null;
  biosafety: string | null;
  max_passage: number | null;
  stock_cells_per_ml: number | null;
  tags: string;
  notes: string;
  sop_protocol_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProfileRow {
  id: string;
  cell_line_id: string;
  name: string;
  origin: ProfileDto['origin'];
  fields: string;
  source_refs: string;
  execution_plan: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface LotRow {
  id: string;
  cell_line_id: string;
  source_culture_id: string | null;
  origin: LotDto['origin'];
  label: string;
  passage: number | null;
  vials_initial: number;
  vials_remaining: number;
  cells_per_vial: number | null;
  freezing_medium: string | null;
  location: string;
  supplier_lot: string | null;
  event_at: string;
  notes: string;
  created_at: string;
}

export interface CultureRow {
  id: string;
  cell_line_id: string;
  parent_culture_id: string | null;
  parent_lot_id: string | null;
  profile_id: string | null;
  label: string;
  passage: number;
  vessel: string;
  status: CultureDto['status'];
  started_at: string;
  ended_at: string | null;
  end_note: string | null;
  notes: string;
  created_at: string;
}

export interface LogRow {
  id: string;
  culture_id: string;
  at: string;
  type: LogDto['type'];
  confluency_pct: number | null;
  cells_per_ml: number | null;
  viability_pct: number | null;
  total_cells: number | null;
  mycoplasma: LogDto['mycoplasma'];
  extra: string;
  note: string;
  created_at: string;
}

export function toLineDto(r: CellLineRow): CellLineDto {
  return {
    id: r.id,
    name: r.name,
    cellosaurusAc: r.cellosaurus_ac,
    synonyms: parseJsonColumn<string[]>(r.synonyms, []),
    species: r.species,
    tissue: r.tissue,
    disease: r.disease,
    category: r.category,
    sex: r.sex,
    growthMode: r.growth_mode,
    sourceBank: r.source_bank,
    catalogNo: r.catalog_no,
    providerUrl: r.provider_url,
    providers: parseJsonColumn<ProviderXref[]>(r.providers, []),
    doublingTime: r.doubling_time,
    caution: r.caution,
    biosafety: r.biosafety,
    maxPassage: r.max_passage,
    stockCellsPerMl: r.stock_cells_per_ml,
    tags: parseJsonColumn<string[]>(r.tags, []),
    notes: r.notes,
    sopProtocolId: r.sop_protocol_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toProfileDto(r: ProfileRow): ProfileDto {
  return {
    id: r.id,
    cellLineId: r.cell_line_id,
    name: r.name,
    origin: r.origin,
    fields: parseJsonColumn<CultureProfileFields>(r.fields, {}),
    sourceRefs: parseJsonColumn<SourceRef[]>(r.source_refs, []),
    executionPlan: validateExecutionPlan(parseJsonColumn<unknown>(r.execution_plan, null)),
    isActive: r.is_active === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface VesselUseRow {
  culture_id: string;
  vessel_product_id: string;
  used_wells: number;
  medium_ml: number | null;
  snapshot: string;
  updated_at: string;
}
export interface LotDetailRow {
  lot_id: string;
  freeze_plan: string | null;
  representative_thaw: string | null;
  recovery_status: RecoveryStatus | null;
  recovery_observed_at: string | null;
  recovery_note: string;
}
export interface PhotoRow {
  id: string;
  log_id: string;
  file_name: string;
  original_name: string;
  mime: PhotoDto['mime'];
  bytes: number;
  created_at: string;
}

/** Rows whose `column` is one of `ids` (table and column are internal constants, never user input). */
function selectIn<T>(table: string, column: string, ids: string[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    out.push(...(db.prepare(`SELECT * FROM ${table} WHERE ${column} IN (${chunk.map(() => '?').join(',')})`).all(...chunk) as unknown as T[]));
  }
  return out;
}
const numberOrNull = (v: string | undefined) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

export function toLotDtos(rows: LotRow[]): LotDto[] {
  const details = new Map(selectIn<LotDetailRow>('cryo_lot_details', 'lot_id', rows.map((r) => r.id)).map((d) => [d.lot_id, d]));
  return rows.map((r) => {
    const d = details.get(r.id);
    return {
      id: r.id,
      cellLineId: r.cell_line_id,
      sourceCultureId: r.source_culture_id,
      origin: r.origin,
      label: r.label,
      passage: r.passage,
      vialsInitial: r.vials_initial,
      vialsRemaining: r.vials_remaining,
      cellsPerVial: r.cells_per_vial,
      freezingMedium: r.freezing_medium,
      location: r.location,
      supplierLot: r.supplier_lot,
      eventAt: r.event_at,
      notes: r.notes,
      freezePlan: parseJsonColumn<FreezePlanRecord | null>(d?.freeze_plan, null),
      representativeThaw: parseJsonColumn<RepresentativeThaw | null>(d?.representative_thaw, null),
      recovery: d?.recovery_status
        ? { status: d.recovery_status, observedAt: d.recovery_observed_at, note: d.recovery_note }
        : null,
      createdAt: r.created_at,
    };
  });
}
export function toLotDto(r: LotRow): LotDto {
  return toLotDtos([r])[0];
}

export function toCultureDtos(rows: CultureRow[]): CultureDto[] {
  const uses = new Map(selectIn<VesselUseRow>('culture_vessel_use', 'culture_id', rows.map((r) => r.id)).map((u) => [u.culture_id, u]));
  const feedRows = selectIn<LogRow>('culture_logs', 'culture_id', rows.map((r) => r.id))
    .filter((log) => log.type === 'medium_change')
    .sort((a, b) => a.at.localeCompare(b.at) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const medium = new Map<string, number | null>();
  for (const use of uses.values()) medium.set(use.culture_id, use.medium_ml);
  for (const log of feedRows) {
    const use = uses.get(log.culture_id);
    if (use && log.created_at >= use.updated_at)
      medium.set(log.culture_id, mediumVolumeAfter(medium.get(log.culture_id) ?? null, feedFromExtra(parseJsonColumn<Record<string, string>>(log.extra, {}))));
  }
  const plateRows = selectIn<{ culture_id: string; plate_no: number; status: PlateStatus; at: string }>('culture_plates', 'culture_id', rows.map((r) => r.id));
  return rows.map((r) => {
    const u = uses.get(r.id);
    const product = u ? parseJsonColumn<VesselProduct | null>(u.snapshot, null) : null;
    const use = u && product ? { vesselProductId: u.vessel_product_id, usedWells: u.used_wells, mediumMl: medium.get(r.id) ?? null, product } : null;
    return {
      id: r.id,
      cellLineId: r.cell_line_id,
      parentCultureId: r.parent_culture_id,
      parentLotId: r.parent_lot_id,
      profileId: r.profile_id,
      label: r.label,
      passage: r.passage,
      vessel: r.vessel,
      status: r.status,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      endNote: r.end_note,
      notes: r.notes,
      vesselUse: use,
      plates: Array.from({ length: plateCountOf(use) }, (_, i) => {
        const row = plateRows.find((p) => p.culture_id === r.id && p.plate_no === i + 1);
        return { no: i + 1, status: row?.status ?? 'active', at: row?.at ?? null };
      }),
      createdAt: r.created_at,
    };
  });
}
export function toCultureDto(r: CultureRow): CultureDto {
  return toCultureDtos([r])[0];
}

export function toPhotoDto(p: PhotoRow): PhotoDto {
  return {
    id: p.id,
    logId: p.log_id,
    originalName: p.original_name,
    mime: p.mime,
    bytes: p.bytes,
    createdAt: p.created_at,
    url: `/api/photos/${p.id}/file`,
  };
}

interface ProtocolRunRow {
  log_id: string;
  protocol_id: string | null;
  title: string;
  version: string;
  protocol_updated_at: string;
  steps: string;
}

export function toLogDtos(rows: LogRow[]): LogDto[] {
  const photos = new Map<string, PhotoDto[]>();
  for (const p of selectIn<PhotoRow>('culture_log_photos', 'log_id', rows.map((r) => r.id)).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))) {
    const list = photos.get(p.log_id) ?? [];
    list.push(toPhotoDto(p));
    photos.set(p.log_id, list);
  }
  const runs = new Map(
    selectIn<ProtocolRunRow>('culture_log_protocols', 'log_id', rows.map((r) => r.id)).map((p): [string, ProtocolRun] => [
      p.log_id,
      {
        protocolId: p.protocol_id,
        title: p.title,
        version: p.version,
        protocolUpdatedAt: p.protocol_updated_at,
        steps: parseJsonColumn<ProtocolRun['steps']>(p.steps, []),
      },
    ]),
  );
  return rows.map((r) => {
    const extra = parseJsonColumn<Record<string, string>>(r.extra, {});
    const seeded = numberOrNull(extra.seededCells);
    return {
      id: r.id,
      cultureId: r.culture_id,
      at: r.at,
      type: r.type,
      confluencyPct: r.confluency_pct,
      cellsPerMl: r.cells_per_ml,
      viabilityPct: r.viability_pct,
      totalCells: r.total_cells,
      mycoplasma: r.mycoplasma,
      extra,
      note: r.note,
      feed: r.type === 'medium_change' ? feedFromExtra(extra) : null,
      morphology: extra.morphology || null,
      photos: photos.get(r.id) ?? [],
      passage:
        r.type === 'passage'
          ? {
              dissociationReagent: extra.dissociationReagent || null,
              splitRatio: extra.splitRatio || null,
              recoveredLiveCells: r.total_cells,
              seededCells: seeded,
              leftoverCells: r.total_cells !== null && seeded !== null ? Math.max(0, r.total_cells - seeded) : null,
              childCount: numberOrNull(extra.childCount),
              leftoverHandling: isLeftoverHandling(extra.leftoverHandling) ? extra.leftoverHandling : null,
            }
          : null,
      operation: logOperation(r.type, extra),
      count: countFromExtra(extra),
      thaw: r.type === 'note' && extra.thawLotId ? { lotId: extra.thawLotId, vials: numberOrNull(extra.thawVials) } : null,
      protocolRun: runs.get(r.id) ?? null,
      createdAt: r.created_at,
    };
  });
}
export function toLogDto(r: LogRow): LogDto {
  return toLogDtos([r])[0];
}

/** The cell line row, or 404. */
export function getLineRow(id: string): CellLineRow {
  const row = db.prepare('SELECT * FROM cell_lines WHERE id=?').get(id) as CellLineRow | undefined;
  if (!row) throw new HttpError(404, '세포주를 찾을 수 없습니다');
  return row;
}

/** The line's active culture profile, if any. */
export function activeProfileRow(lineId: string): ProfileRow | undefined {
  return db.prepare('SELECT * FROM culture_profiles WHERE cell_line_id=? AND is_active=1').get(lineId) as ProfileRow | undefined;
}
