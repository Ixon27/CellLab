import type { CatalogCategory } from './catalog';

export type CultureFieldType = 'text' | 'number' | 'list';

export type CultureFieldKey =
  | 'base_medium'
  | 'serum'
  | 'serum_pct'
  | 'supplements'
  | 'antibiotics'
  | 'temp_c'
  | 'co2_pct'
  | 'coating'
  | 'dissociation_reagent'
  | 'split_ratio'
  | 'subculture_confluency_pct'
  | 'seeding_density'
  | 'medium_change'
  | 'freezing_medium'
  | 'source_stated';

export interface CultureFieldDef {
  key: CultureFieldKey;
  label: string;
  type: CultureFieldType;
  catalog?: CatalogCategory;
  unit?: string;
  /** false: shown for comparison only, never stored in a profile. */
  inProfile: boolean;
}

export const CULTURE_FIELDS: readonly CultureFieldDef[] = [
  { key: 'base_medium', label: '기본 배지', type: 'text', catalog: 'base_medium', inProfile: true },
  { key: 'serum', label: '혈청', type: 'text', catalog: 'serum', inProfile: true },
  { key: 'serum_pct', label: '혈청 농도', type: 'number', unit: '%', inProfile: true },
  { key: 'supplements', label: '첨가물', type: 'list', catalog: 'supplement', inProfile: true },
  { key: 'antibiotics', label: '항생제', type: 'list', catalog: 'antibiotic', inProfile: true },
  { key: 'temp_c', label: '온도', type: 'number', unit: '°C', inProfile: true },
  { key: 'co2_pct', label: 'CO₂', type: 'number', unit: '%', inProfile: true },
  { key: 'coating', label: '코팅', type: 'text', catalog: 'coating', inProfile: true },
  { key: 'dissociation_reagent', label: '계대 시약', type: 'text', catalog: 'dissociation', inProfile: true },
  { key: 'split_ratio', label: '분주 비율', type: 'text', inProfile: true },
  { key: 'subculture_confluency_pct', label: '계대 시점 confluency', type: 'number', unit: '%', inProfile: true },
  { key: 'seeding_density', label: '접종 밀도', type: 'text', inProfile: true },
  { key: 'medium_change', label: '배지 교체 주기', type: 'text', inProfile: true },
  { key: 'freezing_medium', label: '동결 배지', type: 'text', catalog: 'freezing_medium', inProfile: true },
  { key: 'source_stated', label: '원문상 세포 출처', type: 'text', inProfile: false },
];

export type CultureFieldValue = string | number | string[] | null;
export type CultureProfileFields = Partial<Record<CultureFieldKey, CultureFieldValue>> & { medium_change_days?: number | null };

const FIELD_BY_KEY = new Map(CULTURE_FIELDS.map((f) => [f.key, f]));

/** Check a profile's fields; throws Error with a Korean message on the first problem. */
export function validateProfileFields(raw: unknown): CultureProfileFields {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('배양 조건 형식이 올바르지 않습니다');
  const out: CultureProfileFields = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key === 'medium_change_days') {
      if (value === null || value === undefined || value === '') out.medium_change_days = null;
      else if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 30) out.medium_change_days = value;
      else throw new Error('배지 교체 기한은 1–30일 사이의 정수여야 합니다');
      continue;
    }
    const def = FIELD_BY_KEY.get(key as CultureFieldKey);
    if (!def) throw new Error(`알 수 없는 배양 조건 항목입니다: ${key}`);
    if (!def.inProfile) continue;
    if (value === null || value === undefined) {
      out[def.key] = null;
    } else if (def.type === 'text') {
      if (typeof value !== 'string') throw new Error(`${def.label}은(는) 문자열이어야 합니다`);
      const text = value.trim();
      if (text.length > 200) throw new Error(`${def.label}은(는) 200자 이하여야 합니다`);
      out[def.key] = text || null;
    } else if (def.type === 'number') {
      const max = def.key === 'temp_c' ? 45 : 100;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) {
        throw new Error(`${def.label}은(는) 0–${max} 사이의 숫자여야 합니다`);
      }
      out[def.key] = value;
    } else {
      if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) throw new Error(`${def.label}은(는) 문자열 목록이어야 합니다`);
      const items = (value as string[]).map((v) => v.trim()).filter(Boolean);
      if (items.length > 20) throw new Error(`${def.label}은(는) 20개 이하여야 합니다`);
      if (items.some((v) => v.length > 120)) throw new Error(`${def.label}의 각 항목은 120자 이하여야 합니다`);
      out[def.key] = items;
    }
  }
  return out;
}

const NONE = '사용 안 함';

/** The complete medium as one line, e.g. "DMEM (high glucose) + 10% FBS + 1% Penicillin-Streptomycin". */
export function completeMediumText(f: CultureProfileFields): string {
  const text = (v: CultureFieldValue | undefined) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const list = (v: CultureFieldValue | undefined) => (Array.isArray(v) ? v.filter((x) => x.trim() && x.trim() !== NONE) : []);
  const serum = text(f.serum);
  const serumPart = serum ? (typeof f.serum_pct === 'number' ? `${f.serum_pct}% ${serum}` : serum) : null;
  return [text(f.base_medium), serumPart, ...list(f.supplements), ...list(f.antibiotics)].filter(Boolean).join(' + ');
}

/** Comparison key: case/space-insensitive, trailing period dropped, lists order-insensitive. */
export function normalizeFieldValue(v: CultureFieldValue): string | null {
  if (v === null) return null;
  if (typeof v === 'number') return String(v);
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim().replace(/\.$/, '').trim();
  if (Array.isArray(v)) {
    const items = v.map(norm).filter(Boolean).sort();
    return items.length ? items.join(' + ') : null;
  }
  return norm(v) || null;
}
