import type { CultureFieldKey, CultureProfileFields } from './culture';

export type GrowthMode = 'adherent' | 'suspension' | 'mixed';

/** A cell bank entry from Cellosaurus `xref-list` (category "Cell line collections (Providers)"). */
export interface ProviderXref {
  database: string;
  accession: string;
  url: string | null;
}

export interface CellosaurusHit {
  ac: string;
  name: string;
  species: string | null;
  category: string | null;
}

export interface CellosaurusInfo {
  ac: string;
  name: string;
  synonyms: string[];
  species: string | null;
  disease: string | null;
  tissue: string | null;
  category: string | null;
  sex: string | null;
  doublingTime: string | null;
  caution: string | null;
  providers: ProviderXref[];
}

export interface CellLineDto {
  id: string;
  name: string;
  cellosaurusAc: string | null;
  synonyms: string[];
  species: string | null;
  tissue: string | null;
  disease: string | null;
  category: string | null;
  sex: string | null;
  growthMode: GrowthMode;
  sourceBank: string | null;
  catalogNo: string | null;
  providerUrl: string | null;
  providers: ProviderXref[];
  doublingTime: string | null;
  caution: string | null;
  biosafety: string | null;
  maxPassage: number | null;
  tags: string[];
  notes: string;
  sopProtocolId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `GET /api/cell-lines` item. */
export interface CellLineListItem extends CellLineDto {
  activeCultures: number;
  vialsRemaining: number;
  activeProfileName: string | null;
}

/** Where a profile value came from (literature/provider comparison). */
export interface SourceRef {
  field: CultureFieldKey;
  sourceLabel: string;
  url: string;
  quote: string;
}

export type ProfileOrigin = 'manual' | 'literature' | 'provider';

export interface ProfileDto {
  id: string;
  cellLineId: string;
  name: string;
  origin: ProfileOrigin;
  fields: CultureProfileFields;
  sourceRefs: SourceRef[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LotDto {
  id: string;
  cellLineId: string;
  sourceCultureId: string | null;
  origin: 'received' | 'frozen';
  label: string;
  passage: number | null;
  vialsInitial: number;
  vialsRemaining: number;
  cellsPerVial: number | null;
  freezingMedium: string | null;
  location: string;
  supplierLot: string | null;
  eventAt: string;
  notes: string;
  createdAt: string;
}

export type CultureStatus = 'active' | 'split' | 'frozen' | 'harvested' | 'discarded' | 'contaminated';

export interface CultureDto {
  id: string;
  cellLineId: string;
  parentCultureId: string | null;
  parentLotId: string | null;
  profileId: string | null;
  label: string;
  passage: number;
  vessel: string;
  status: CultureStatus;
  startedAt: string;
  endedAt: string | null;
  endNote: string | null;
  notes: string;
  createdAt: string;
}

export type LogType = 'observation' | 'medium_change' | 'passage' | 'freeze' | 'harvest' | 'treatment' | 'mycoplasma' | 'note';

export interface LogDto {
  id: string;
  cultureId: string;
  at: string;
  type: LogType;
  confluencyPct: number | null;
  cellsPerMl: number | null;
  viabilityPct: number | null;
  totalCells: number | null;
  mycoplasma: 'negative' | 'positive' | 'pending' | null;
  /** Free key-value items the user adds to a record. */
  extra: Record<string, string>;
  note: string;
  createdAt: string;
}

/** `GET /api/cell-lines/:id` */
export interface CellLineDetailDto {
  line: CellLineDto;
  profiles: ProfileDto[];
  lots: LotDto[];
  cultures: CultureDto[];
}
