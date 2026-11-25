import { formatCount } from './cell-count';
import { CULTURE_FIELDS, completeMediumText } from './culture';
import type { CultureFieldValue, CultureProfileFields } from './culture';
import type { ProfileDto } from './cell-line';
import type { ProtocolProvenance } from './protocol';

export interface FilledSop {
  protocolId: string | null;
  title: string;
  markdown: string;
  templateStatus: 'draft' | 'confirmed' | null;
  scope: 'general' | 'cell_specific' | 'shared' | 'unselected';
  readiness: 'no_profile' | 'template_required' | 'needs_review' | 'confirmed';
  provenance: ProtocolProvenance | null;
  profile: ProfileDto | null;
  missingFields: SopMissingField[];
  warnings: string[];
}

export interface SopMissingField {
  key: string;
  label: string;
}
export interface SopPreview {
  markdown: string;
  missingFields: SopMissingField[];
}

/**
 * Variables only an operation record fills (counted at the bench, not part of a condition set). In a protocol they read
 * the run's own numbers; outside a run they stay unset.
 */
export const RUN_FIELDS = [
  { key: 'recovered_cells', label: '회수한 생세포 수' },
  { key: 'freeze_vials', label: '동결 바이알 수' },
  { key: 'cells_per_vial', label: '바이알당 세포 수' },
  { key: 'frozen_cells', label: '동결한 세포 수' },
  { key: 'volume_per_vial', label: '바이알당 부피' },
  { key: 'total_freeze_volume', label: '동결 현탁 총 부피' },
  { key: 'suspension_per_vial', label: '바이알당 세포액' },
  { key: 'freezing_medium_per_vial', label: '바이알당 동결 배지' },
] as const;

const LABELS = new Map<string, string>(CULTURE_FIELDS.map((field) => [field.key, field.label]));
LABELS.set('complete_medium', '완전 배지');
LABELS.set('cell_line', '세포주');
LABELS.set('max_passage', '최대 passage');
for (const field of RUN_FIELDS) LABELS.set(field.key, field.label);

/** Every variable key a protocol can use, with its label (condition set, line, then run values). */
export const SOP_VARIABLES: { key: string; label: string }[] = [...LABELS].map(([key, label]) => ({ key, label }));

export function sopFieldLabel(key: string): string {
  return LABELS.get(key) ?? `사용자 항목 ${key.replace(/_/g, ' ')}`;
}

/** Values a protocol is filled from: condition-set fields, plus a run's own values (see performedFields). */
export type SopValues = Record<string, CultureFieldValue | undefined>;

/** Readonly substitution; editable templates always retain their original placeholders. */
export function previewSop(
  template: string,
  line?: { name: string; max_passage: number | null },
  fields: SopValues = {},
): SopPreview {
  const values = new Map<string, unknown>(Object.entries(fields));
  values.set('complete_medium', completeMediumText(fields));
  values.set('cell_line', line?.name);
  values.set('max_passage', line?.max_passage);
  const missing = new Map<string, SopMissingField>();
  const markdown = template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_placeholder, key: string) => {
    const value = values.get(key);
    const text = Array.isArray(value) ? value.join(', ') : value === null || value === undefined ? '' : String(value);
    if (text.trim()) return text;
    const label = sopFieldLabel(key);
    missing.set(key, { key, label });
    return `**(미설정: ${label.replace(/[\\*_`[\]]/g, '\\$&')})**`;
  });
  return { markdown, missingFields: [...missing.values()] };
}

export function fillSop(template: string, line: { name: string; max_passage: number | null }, fields: CultureProfileFields): string {
  return previewSop(template, line, fields).markdown;
}

/** What one operation actually used, as counted and decided at the bench. */
export interface PerformedRun {
  splitRatio?: string | null;
  dissociationReagent?: string | null;
  confluencyPct?: number | null;
  recoveredLiveCells?: number | null;
  /** Seeding density of each new vessel (cells/cm²); null where the vessel has no area. */
  seedingDensitiesPerCm2?: (number | null)[];
  freezingMedium?: string | null;
  vials?: number | null;
  cellsPerVial?: number | null;
  volumePerVialMl?: number | null;
  /** How each vial was filled from a counted suspension, when it was. */
  suspensionPerVialMl?: number | null;
  freezingMediumPerVialMl?: number | null;
}

const positive = (n: number | null | undefined): n is number => n !== null && n !== undefined && Number.isFinite(n) && n > 0;
const ml = (n: number) => `${Number(n.toPrecision(4))} mL`;

/**
 * The run's own values under the keys a protocol fills from, so `{{split_ratio}}` reads the ratio this passage used
 * rather than the condition set's range and `{{freeze_vials}}` the vials this freeze made. Only values the run recorded
 * are returned; the rest keep coming from the condition set.
 */
export function performedFields(run: PerformedRun): SopValues {
  const out: SopValues = {};
  if (run.splitRatio?.trim()) out.split_ratio = run.splitRatio.trim();
  if (run.dissociationReagent?.trim()) out.dissociation_reagent = run.dissociationReagent.trim();
  if (run.freezingMedium?.trim()) out.freezing_medium = run.freezingMedium.trim();
  if (run.confluencyPct !== null && run.confluencyPct !== undefined && Number.isFinite(run.confluencyPct))
    out.subculture_confluency_pct = run.confluencyPct;
  if (positive(run.recoveredLiveCells)) out.recovered_cells = `${formatCount(run.recoveredLiveCells)} cells`;
  const densities = [...new Set((run.seedingDensitiesPerCm2 ?? []).filter(positive).map((d) => `${formatCount(d)} cells/cm²`))];
  if (densities.length) out.seeding_density = densities.join(', ');
  if (positive(run.vials)) out.freeze_vials = String(run.vials);
  if (positive(run.cellsPerVial)) out.cells_per_vial = `${formatCount(run.cellsPerVial)} cells`;
  if (positive(run.vials) && positive(run.cellsPerVial)) out.frozen_cells = `${formatCount(run.vials * run.cellsPerVial)} cells`;
  if (positive(run.volumePerVialMl)) out.volume_per_vial = ml(run.volumePerVialMl);
  if (positive(run.vials) && positive(run.volumePerVialMl)) out.total_freeze_volume = ml(run.vials * run.volumePerVialMl);
  if (positive(run.suspensionPerVialMl)) out.suspension_per_vial = ml(run.suspensionPerVialMl);
  if (positive(run.freezingMediumPerVialMl)) out.freezing_medium_per_vial = ml(run.freezingMediumPerVialMl);
  return out;
}
