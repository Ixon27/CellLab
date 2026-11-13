import type { SourceRef } from './cell-line';
import { CULTURE_FIELDS } from './culture';
import type { CultureFieldKey, CultureProfileFields } from './culture';
import { FIELD_USAGES, MEDIUM_PURPOSES, fieldPurpose, fieldUsage } from './literature';
import type { LiteratureReport, MediumPurpose } from './literature';

const FIELD_KEYS = new Set<string>(CULTURE_FIELDS.map((d) => d.key));
export const REASON_MAX = 2000;

/** 배양 조건 항목이 기대하는 용도. 동결 배지 외 항목은 일반 배양 조건이다. */
export function expectedPurpose(key: CultureFieldKey): MediumPurpose {
  return key === 'freezing_medium' ? 'freezing' : 'growth';
}
/** 원문이 밝힌 용도가 항목의 기대 용도와 다르면 true. unknown은 "다름"이 아니라 "미확인"이므로 false다. */
export function purposeMismatch(key: CultureFieldKey, purpose: MediumPurpose): boolean {
  return purpose !== 'unknown' && purpose !== expectedPurpose(key);
}

export type FieldChoice =
  | { kind: 'source'; sourceKey: string; reason: string; purposeConfirmed: boolean }
  | { kind: 'manual' };
export interface AdoptionError {
  field: CultureFieldKey;
  message: string;
}
export interface AdoptionResult {
  fields: CultureProfileFields;
  sourceRefs: SourceRef[];
  origin: 'literature' | 'provider';
  providerOnly: boolean;
  errors: AdoptionError[];
}

/**
 * 사용자가 명시적으로 고른 항목만 배양 조건으로 옮긴다. 선택하지 않은 항목은 fields에 아예 넣지 않는다.
 * 문헌 값은 사유가 비어 있거나(항상), 다른 용도 값을 확인 없이 쓰려는 경우 오류를 돌려준다.
 */
export function buildAdoption(
  report: LiteratureReport,
  choices: Partial<Record<CultureFieldKey, FieldChoice>>,
  manual: CultureProfileFields,
): AdoptionResult {
  const result: AdoptionResult = { fields: {}, sourceRefs: [], origin: 'literature', providerOnly: false, errors: [] };
  const usedKinds: ('paper' | 'provider')[] = [];
  for (const def of CULTURE_FIELDS) {
    if (!def.inProfile) continue;
    const choice = choices[def.key];
    if (!choice) continue;
    const fail = (message: string) => result.errors.push({ field: def.key, message });
    if (choice.kind === 'manual') {
      const v = manual[def.key];
      if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) fail('직접 입력값이 비어 있습니다');
      else result.fields[def.key] = v as never;
      continue;
    }
    const source = report.sources.find((s) => s.key === choice.sourceKey);
    const field = source?.status === 'ok' ? source.fields?.[def.key] : undefined;
    const usage = fieldUsage(field);
    if (!source || !field || usage === 'not_reported') {
      fail('선택한 자료에 보고된 값이 없습니다');
      continue;
    }
    const reason = choice.reason.trim();
    if (!reason) {
      fail('채택 사유를 입력하세요');
      continue;
    }
    const purpose = fieldPurpose(field);
    const mismatch = purposeMismatch(def.key, purpose);
    if (mismatch && !choice.purposeConfirmed) {
      fail('일반 배양 조건과 용도가 다른 값입니다. 해당 용도를 확인했다고 체크하세요');
      continue;
    }
    result.fields[def.key] = (usage === 'explicit_not_used' ? (def.type === 'list' ? [] : null) : field.value) as never;
    usedKinds.push(source.kind);
    result.sourceRefs.push({
      field: def.key,
      sourceLabel: source.label,
      url: source.url,
      quote: field.evidenceIds.map((id) => source.evidence[id]?.text).filter(Boolean).join(' … '),
      reason,
      evidenceIds: field.evidenceIds,
      usage,
      purpose,
      ...(mismatch ? { purposeConfirmed: true } : {}),
      reportId: report.id,
      sourceKey: source.key,
    });
  }
  result.providerOnly = usedKinds.length > 0 && usedKinds.every((k) => k === 'provider');
  result.origin = usedKinds.filter((k) => k === 'provider').length > usedKinds.length / 2 ? 'provider' : 'literature';
  return result;
}

/** 프로필 `sourceRefs` 입력을 검증·정리한다. 알 수 없는 키는 버리고, 선택 메타데이터가 없는 기존 형식은 그대로 허용한다. */
export function validateSourceRefs(raw: unknown): SourceRef[] {
  const bad = (message = '출처 근거 형식이 올바르지 않습니다') => new Error(message);
  if (!Array.isArray(raw) || raw.length > 500) throw bad();
  return raw.map((r: unknown): SourceRef => {
    if (typeof r !== 'object' || r === null || Array.isArray(r)) throw bad();
    const o = r as Record<string, unknown>;
    if (
      typeof o.field !== 'string' ||
      !FIELD_KEYS.has(o.field) ||
      typeof o.sourceLabel !== 'string' ||
      o.sourceLabel.length > 500 ||
      typeof o.url !== 'string' ||
      o.url.length > 2000 ||
      typeof o.quote !== 'string' ||
      o.quote.length > 20000
    )
      throw bad();
    const ref: SourceRef = { field: o.field as CultureFieldKey, sourceLabel: o.sourceLabel, url: o.url, quote: o.quote };
    if (o.reason !== undefined && o.reason !== null) {
      if (typeof o.reason !== 'string' || o.reason.length > REASON_MAX) throw bad('채택 사유는 2,000자 이하여야 합니다');
      if (o.reason.trim()) ref.reason = o.reason.trim();
    }
    if (o.evidenceIds !== undefined) {
      if (
        !Array.isArray(o.evidenceIds) ||
        o.evidenceIds.length > 50 ||
        o.evidenceIds.some((id) => typeof id !== 'string' || !id || id.length > 64)
      )
        throw bad('근거 문장 id 형식이 올바르지 않습니다');
      if (o.evidenceIds.length) ref.evidenceIds = [...new Set(o.evidenceIds as string[])];
    }
    if (o.usage !== undefined) {
      if (!FIELD_USAGES.includes(o.usage as never)) throw bad('값 사용 상태가 올바르지 않습니다');
      ref.usage = o.usage as SourceRef['usage'];
    }
    if (o.purpose !== undefined) {
      if (!MEDIUM_PURPOSES.includes(o.purpose as never)) throw bad('용도가 올바르지 않습니다');
      ref.purpose = o.purpose as MediumPurpose;
    }
    if (o.purposeConfirmed !== undefined) {
      if (typeof o.purposeConfirmed !== 'boolean') throw bad();
      if (o.purposeConfirmed) ref.purposeConfirmed = true;
    }
    for (const key of ['reportId', 'sourceKey'] as const) {
      const v = o[key];
      if (v === undefined) continue;
      if (typeof v !== 'string' || !v || v.length > 64) throw bad();
      ref[key] = v;
    }
    // 문헌 보고서에서 채택한 값(보고서·근거·상태 메타데이터가 있는 경우)은 사유와 근거 문장이 반드시 있어야 한다.
    const fromReport = isAdoptedRef(ref);
    if (fromReport && !ref.reason) throw bad('문헌에서 채택한 값에는 채택 사유가 필요합니다');
    if (fromReport && !ref.evidenceIds) throw bad('문헌에서 채택한 값에는 근거 문장이 필요합니다');
    if (ref.purpose && purposeMismatch(ref.field, ref.purpose) && ref.purposeConfirmed !== true)
      throw bad('일반 배양 조건과 용도가 다른 값은 용도 확인이 필요합니다');
    return ref;
  });
}

/** 문헌 보고서에서 채택한 근거(보고서·근거 id·사용 상태 메타데이터가 있는 항목). 사용자가 직접 적은 출처와 구분한다. */
export function isAdoptedRef(ref: SourceRef): boolean {
  return ref.reportId !== undefined || ref.sourceKey !== undefined || ref.evidenceIds !== undefined || ref.usage !== undefined;
}
