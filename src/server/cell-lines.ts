import type { CellLineDto, CultureDto, GrowthMode, LogDto, LotDto, ProfileDto, ProviderXref, SourceRef } from '../shared/cell-line';
import type { CultureProfileFields } from '../shared/culture';
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
    isActive: r.is_active === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toLotDto(r: LotRow): LotDto {
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
    createdAt: r.created_at,
  };
}

export function toCultureDto(r: CultureRow): CultureDto {
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
    createdAt: r.created_at,
  };
}

export function toLogDto(r: LogRow): LogDto {
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
    extra: parseJsonColumn<Record<string, string>>(r.extra, {}),
    note: r.note,
    createdAt: r.created_at,
  };
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
