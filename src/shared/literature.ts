import type { MadeBy } from './models';
import { CULTURE_FIELDS, normalizeFieldValue } from './culture';
import type { CultureFieldKey, CultureFieldValue } from './culture';

/**
 * 값 사용 상태. 모델이 본문에 근거 문장이 있는 명시적 "사용 안 함"을 보고한 경우에만
 * `explicit_not_used`가 된다. 언급이 없으면 항상 `not_reported`이며 미사용으로 추정하지 않는다.
 */
export type FieldUsage = 'used' | 'not_reported' | 'explicit_not_used';
/** 배지·시약이 쓰인 목적. 근거 id가 검증되지 않으면 `unknown`이다. */
export type MediumPurpose = 'growth' | 'treatment' | 'freezing' | 'unknown';
export const FIELD_USAGES: readonly FieldUsage[] = ['used', 'not_reported', 'explicit_not_used'];
export const MEDIUM_PURPOSES: readonly MediumPurpose[] = ['growth', 'treatment', 'freezing', 'unknown'];
export const FIELD_USAGE_LABELS: Record<FieldUsage, string> = {
  used: '보고됨',
  not_reported: '언급 없음',
  explicit_not_used: '사용 안 함 (원문 명시)',
};
export const MEDIUM_PURPOSE_LABELS: Record<MediumPurpose, string> = {
  growth: '일반 배양',
  treatment: '처리·실험',
  freezing: '동결',
  unknown: '용도 미확인',
};

export interface ExtractedField {
  /** 보고된 값. `explicit_not_used`인 목록 필드는 `[]`, 그 외 필드는 null이다. */
  value: CultureFieldValue;
  evidenceIds: string[];
  rejected: boolean;
  /** 이전 보고서에는 없다. `fieldUsage()`로 읽는다. */
  usage?: FieldUsage;
  purpose?: MediumPurpose;
  /** `purpose`가 unknown이 아닐 때 그 판단의 근거 문장 id. */
  purposeEvidenceIds?: string[];
}

/** 자료가 대상 세포주를 다루는지, 대상 세포의 공급처가 원문에 명시되었는지. 근거 id가 없으면 unknown이다. */
export interface SourceContext {
  targetCell: { status: 'target' | 'other' | 'unknown'; evidenceIds: string[] };
  supplyOrigin: { status: 'stated' | 'unknown'; evidenceIds: string[] };
}
export type SourceStatus = 'ok' | 'no_fulltext' | 'no_evidence' | 'fetch_failed' | 'error';
export interface ReportSource {
  key: string;
  kind: 'paper' | 'provider';
  label: string;
  pmcid: string | null;
  url: string;
  year: number | null;
  status: SourceStatus;
  error: string | null;
  fields: Record<CultureFieldKey, ExtractedField> | null;
  evidence: Record<string, { heading: string; text: string }>;
  /** 이전 보고서에는 없다. `sourceContextOf()`로 읽는다. */
  context?: SourceContext;
}
export interface LiteratureReport {
  version: 1;
  id: string;
  cellLineId: string;
  createdAt: string;
  by: MadeBy | null;
  query: string | null;
  bankFilter: string | null;
  sources: ReportSource[];
}
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const validIds = (raw: unknown, evidenceIds: ReadonlySet<string>): string[] =>
  Array.isArray(raw) ? [...new Set(raw.filter((id): id is string => typeof id === 'string' && evidenceIds.has(id)))] : [];

export const UNKNOWN_SOURCE_CONTEXT: SourceContext = {
  targetCell: { status: 'unknown', evidenceIds: [] },
  supplyOrigin: { status: 'unknown', evidenceIds: [] },
};
export function sourceContextOf(source: Pick<ReportSource, 'context'>): SourceContext {
  return source.context ?? UNKNOWN_SOURCE_CONTEXT;
}
export function fieldUsage(field: ExtractedField | null | undefined): FieldUsage {
  if (!field || field.rejected) return 'not_reported';
  if (field.usage) return field.usage;
  return field.value !== null ? 'used' : 'not_reported';
}
export function fieldPurpose(field: ExtractedField | null | undefined): MediumPurpose {
  return field?.purpose ?? 'unknown';
}

/** 추출 응답 전체에서 `source_context`를 읽어 검증한다. 형식이 틀리거나 근거 id가 없으면 unknown이다. */
export function validateSourceContext(rawExtraction: unknown, evidenceIds: ReadonlySet<string>): SourceContext {
  const raw = isObject(rawExtraction) ? rawExtraction.source_context : null;
  if (!isObject(raw)) return UNKNOWN_SOURCE_CONTEXT;
  const target = isObject(raw.target_cell) ? raw.target_cell : {};
  const supply = isObject(raw.supply_origin) ? raw.supply_origin : {};
  const targetIds = validIds(target.evidence, evidenceIds);
  const supplyIds = validIds(supply.evidence, evidenceIds);
  return {
    targetCell:
      (target.status === 'target' || target.status === 'other') && targetIds.length
        ? { status: target.status, evidenceIds: targetIds }
        : { status: 'unknown', evidenceIds: [] },
    supplyOrigin:
      supply.status === 'stated' && supplyIds.length
        ? { status: 'stated', evidenceIds: supplyIds }
        : { status: 'unknown', evidenceIds: [] },
  };
}

export function validateCultureExtraction(raw: unknown, evidenceIds: ReadonlySet<string>): Record<CultureFieldKey, ExtractedField> {
  if (!isObject(raw) || !isObject(raw.fields)) throw new Error('추출 결과 형식이 올바르지 않습니다');
  const out = {} as Record<CultureFieldKey, ExtractedField>;
  for (const def of CULTURE_FIELDS) {
    const item = raw.fields[def.key];
    let value: CultureFieldValue = null;
    let rejected = false;
    let ids: string[] = [];
    let usage: FieldUsage = 'not_reported';
    let purpose: MediumPurpose = 'unknown';
    let purposeIds: string[] = [];
    if (item !== undefined && item !== null) {
      if (!isObject(item)) rejected = true;
      else {
        const v = item.value;
        const emptyList = def.type === 'list' && Array.isArray(v) && v.length === 0;
        if (v !== null && v !== undefined && !emptyList) {
          if (def.type === 'text' && typeof v === 'string' && v.length <= 200) value = v.trim() || null;
          else if (
            def.type === 'number' &&
            (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) &&
            Number.isFinite(Number(v))
          )
            value = Number(v);
          else if (def.type === 'list' && Array.isArray(v) && v.length <= 20 && v.every((x) => typeof x === 'string' && x.length <= 120))
            value = v;
          else rejected = true;
        }
        ids = validIds(item.evidence, evidenceIds);
        const declaredNotUsed = item.usage === 'explicit_not_used';
        if (value !== null && declaredNotUsed) {
          // "사용 안 함"이면서 값을 가진 모순된 응답은 어느 쪽도 채택하지 않는다.
          value = null;
          rejected = true;
        } else if (value !== null && !ids.length) {
          value = null;
          rejected = true;
        } else if (value !== null) usage = 'used';
        else if (declaredNotUsed) {
          // 언급 생략에서 미사용을 추정하지 않는다: 근거 문장이 있는 명시적 보고만 인정한다.
          if (!rejected && ids.length) {
            usage = 'explicit_not_used';
            value = def.type === 'list' ? [] : null;
          } else rejected = true;
        }
        if (usage === 'not_reported') ids = rejected ? [] : ids;
        if (usage !== 'not_reported' && MEDIUM_PURPOSES.includes(item.purpose as MediumPurpose) && item.purpose !== 'unknown') {
          purposeIds = validIds(item.purpose_evidence ?? item.purposeEvidence, evidenceIds);
          if (purposeIds.length) purpose = item.purpose as MediumPurpose;
        }
      }
    }
    out[def.key] = { value, evidenceIds: ids, rejected, usage, purpose, purposeEvidenceIds: purposeIds };
  }
  return out;
}

function normalizeStoredField(raw: unknown): ExtractedField {
  const f = (isObject(raw) ? raw : {}) as Partial<ExtractedField>;
  const value = (f.value ?? null) as CultureFieldValue;
  const rejected = f.rejected === true;
  const usage: FieldUsage = FIELD_USAGES.includes(f.usage as FieldUsage) ? (f.usage as FieldUsage) : value !== null && !rejected ? 'used' : 'not_reported';
  const purpose = MEDIUM_PURPOSES.includes(f.purpose as MediumPurpose) ? (f.purpose as MediumPurpose) : 'unknown';
  const purposeEvidenceIds = Array.isArray(f.purposeEvidenceIds) ? f.purposeEvidenceIds.filter((id) => typeof id === 'string') : [];
  return {
    value,
    evidenceIds: Array.isArray(f.evidenceIds) ? f.evidenceIds.filter((id) => typeof id === 'string') : [],
    rejected,
    usage,
    purpose: purpose !== 'unknown' && !purposeEvidenceIds.length ? 'unknown' : purpose,
    purposeEvidenceIds,
  };
}
function normalizeStoredContext(raw: unknown): SourceContext {
  if (!isObject(raw)) return UNKNOWN_SOURCE_CONTEXT;
  const ids = (v: unknown) => (isObject(v) && Array.isArray(v.evidenceIds) ? v.evidenceIds.filter((id): id is string => typeof id === 'string') : []);
  const target = isObject(raw.targetCell) ? raw.targetCell : {};
  const supply = isObject(raw.supplyOrigin) ? raw.supplyOrigin : {};
  const targetIds = ids(target);
  const supplyIds = ids(supply);
  return {
    targetCell:
      (target.status === 'target' || target.status === 'other') && targetIds.length
        ? { status: target.status, evidenceIds: targetIds }
        : { status: 'unknown', evidenceIds: [] },
    supplyOrigin:
      supply.status === 'stated' && supplyIds.length
        ? { status: 'stated', evidenceIds: supplyIds }
        : { status: 'unknown', evidenceIds: [] },
  };
}

/** 저장된 보고서를 읽는다. 용도·사용 상태·자료 맥락 메타데이터가 없는 이전 보고서는 모두 unknown/추정 없음으로 채운다. */
export function parseLiteratureReport(raw: unknown): LiteratureReport {
  const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (
    !isObject(value) ||
    value.version !== 1 ||
    typeof value.id !== 'string' ||
    typeof value.cellLineId !== 'string' ||
    typeof value.createdAt !== 'string' ||
    !Array.isArray(value.sources)
  )
    throw new Error('문헌 보고서 형식이 올바르지 않습니다');
  for (const s of value.sources) {
    if (
      !isObject(s) ||
      typeof s.key !== 'string' ||
      !['paper', 'provider'].includes(String(s.kind)) ||
      typeof s.label !== 'string' ||
      typeof s.url !== 'string' ||
      !['ok', 'no_fulltext', 'no_evidence', 'fetch_failed', 'error'].includes(String(s.status)) ||
      !isObject(s.evidence) ||
      (s.fields !== null && !isObject(s.fields))
    )
      throw new Error('문헌 보고서 자료 형식이 올바르지 않습니다');
    if (s.fields)
      s.fields = Object.fromEntries(Object.entries(s.fields as Record<string, unknown>).map(([k, f]) => [k, normalizeStoredField(f)]));
    s.context = normalizeStoredContext(s.context);
  }
  return value as unknown as LiteratureReport;
}

export interface ReportedGroup {
  value: CultureFieldValue;
  count: number;
  sources: { key: string; purpose: MediumPurpose }[];
}
export interface ReportedSummary {
  /** 분석에 성공한(status ok) 자료 수. 보고 수의 분모이며 일치 여부를 뜻하지 않는다. */
  analyzed: number;
  /** 값을 보고한 자료 수. */
  reported: number;
  explicitNotUsed: { key: string; purpose: MediumPurpose }[];
  /** 분석됐지만 이 항목은 언급하지 않은 자료 수(사용하지 않았다는 뜻이 아니다). */
  notReported: number;
  /** 근거 불충분으로 제외된 자료 수. */
  rejected: number;
  /** 자료에 나온 순서대로 묶은 서로 다른 값. 최빈값을 고르거나 순위를 매기지 않는다. 단위가 다르면 다른 값이다. */
  groups: ReportedGroup[];
}
/**
 * 문헌에서 보고된 값을 요약한다. 합의값·최빈값을 만들지 않는다.
 * 같은 값 판정은 `normalizeFieldValue`(대소문자·공백·끝 마침표)뿐이며 단위 환산은 하지 않는다.
 */
export function reportedValues(sources: ReportSource[], key: CultureFieldKey): ReportedSummary {
  const summary: ReportedSummary = { analyzed: 0, reported: 0, explicitNotUsed: [], notReported: 0, rejected: 0, groups: [] };
  const byNormalized = new Map<string, ReportedGroup>();
  for (const source of sources) {
    if (source.status !== 'ok' || !source.fields) continue;
    summary.analyzed++;
    const field = source.fields[key];
    const usage = fieldUsage(field);
    const purpose = fieldPurpose(field);
    if (field?.rejected) summary.rejected++;
    else if (usage === 'explicit_not_used') summary.explicitNotUsed.push({ key: source.key, purpose });
    else if (usage === 'used' && field.value !== null) {
      const normalized = normalizeFieldValue(field.value);
      if (normalized === null) {
        summary.notReported++;
        continue;
      }
      summary.reported++;
      const entry = byNormalized.get(normalized);
      if (entry) {
        entry.count++;
        entry.sources.push({ key: source.key, purpose });
      } else {
        const group = { value: field.value, count: 1, sources: [{ key: source.key, purpose }] };
        byNormalized.set(normalized, group);
        summary.groups.push(group);
      }
    } else summary.notReported++;
  }
  return summary;
}
