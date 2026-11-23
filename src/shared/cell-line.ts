import type { CultureFieldKey, CultureProfileFields } from './culture';
import type { CultureExecutionPlan } from './culture-plan';
import type { FieldUsage, MediumPurpose } from './literature';
import type {
  CellCountExtras,
  CultureVesselUseDto,
  FeedRecord,
  FreezePlanRecord,
  LogOperation,
  LotRecovery,
  PassageRecord,
  PhotoDto,
  PlateStatus,
  RepresentativeThaw,
} from './culture-operations';
import type { ProtocolRun } from './protocol-run';

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
  /** Cells per mL of a frozen stock vial for this line (each vial is filled to the vial volume, 1 mL by default). */
  stockCellsPerMl: number | null;
  /** Target live cells per cm² of destination culture area at passage. */
  passageCellsPerCm2: number | null;
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
  /** 채택 사유. 문헌 보고서에서 채택한 값에는 필수다(서버 검증). */
  reason?: string;
  /** 채택한 값의 근거 문장 id (보고서 자료 `sourceKey` 범위). */
  evidenceIds?: string[];
  /** 채택 당시 원문의 값 상태. explicit_not_used는 원문에 명시된 "사용 안 함"이다. */
  usage?: FieldUsage;
  /** 배지·시약이 보고된 용도. 일반 배양 항목에 처리·동결 값을 쓰려면 `purposeConfirmed`가 필요하다. */
  purpose?: MediumPurpose;
  purposeConfirmed?: boolean;
  reportId?: string;
  sourceKey?: string;
}

export type ProfileOrigin = 'manual' | 'literature' | 'provider';

export interface ProfileDto {
  id: string;
  cellLineId: string;
  name: string;
  origin: ProfileOrigin;
  fields: CultureProfileFields;
  sourceRefs: SourceRef[];
  executionPlan?: CultureExecutionPlan | null;
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
  /** Freeze allocation recorded when the lot was frozen from a culture; null for received/legacy lots. */
  freezePlan: FreezePlanRecord | null;
  representativeThaw: RepresentativeThaw | null;
  /** Null = recovery never recorded. */
  recovery: LotRecovery | null;
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
  /** Current vessel assignment with a frozen product snapshot; null for legacy/free-text vessels. */
  vesselUse: CultureVesselUseDto | null;
  /** The culture's vessels (dishes/flasks, or whole multi-well plates) one by one; 1 for free-text vessels. */
  plates: { no: number; status: PlateStatus; at: string | null }[];
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
  /** Typed view of medium_change extra; null for other types. */
  feed: FeedRecord | null;
  /** Observation morphology text, if recorded. */
  morphology: string | null;
  photos: PhotoDto[];
  /** Typed view of a passage log; null for other types. */
  passage: PassageRecord | null;
  /** Lineage operation this record stands for (thaw note, passage, freeze); editing or deleting it changes the lineage. */
  operation: LogOperation | null;
  /** Automated counter values recorded with this record (besides live concentration, viability and live cells). */
  count: CellCountExtras | null;
  /** The thaw this note records: source lot and vials used by the whole thaw (null = not recorded). */
  thaw: { lotId: string; vials: number | null } | null;
  /** Protocol followed in this record, with this run's step changes; null when none was attached. */
  protocolRun: ProtocolRun | null;
  createdAt: string;
}

/** A culture log joined to its culture for the line-wide daily journal. */
export interface CellLineLogDto extends LogDto {
  cultureLabel: string;
  culturePassage: number;
}

/** `GET /api/cell-lines/:id` */
export interface CellLineDetailDto {
  line: CellLineDto;
  profiles: ProfileDto[];
  lots: LotDto[];
  cultures: CultureDto[];
}
