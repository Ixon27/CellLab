import { CULTURE_FIELDS, completeMediumText } from './culture';
import type { CultureProfileFields } from './culture';
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

const LABELS = new Map<string, string>(CULTURE_FIELDS.map((field) => [field.key, field.label]));
LABELS.set('complete_medium', '완전 배지');
LABELS.set('cell_line', '세포주');
LABELS.set('max_passage', '최대 passage');

export function sopFieldLabel(key: string): string {
  return LABELS.get(key) ?? `사용자 항목 ${key.replace(/_/g, ' ')}`;
}

/** Readonly substitution; editable templates always retain their original placeholders. */
export function previewSop(
  template: string,
  line?: { name: string; max_passage: number | null },
  fields: CultureProfileFields = {},
): SopPreview {
  const values = new Map<string, unknown>(CULTURE_FIELDS.map((field) => [field.key, fields[field.key]]));
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
