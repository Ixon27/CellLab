import { describe, expect, it } from 'vitest';
import { consensus, parseLiteratureReport, validateCultureExtraction } from '../src/shared/literature';
import type { ReportSource } from '../src/shared/literature';
const ids = new Set(['S1-1']);
function source(value: string, key: string): ReportSource {
  return {
    key,
    kind: 'paper',
    label: key,
    pmcid: 'PMC1',
    url: 'https://example.org',
    year: 2026,
    status: 'ok',
    error: null,
    fields: validateCultureExtraction({ fields: { base_medium: { value, evidence: ['S1-1'] } } }, ids),
    evidence: { 'S1-1': { heading: 'Methods', text: 'Cells were cultured in DMEM.' } },
  };
}
describe('추출 결과 검증', () => {
  it('알 수 없는 근거는 거부한다', () => {
    expect(validateCultureExtraction({ fields: { base_medium: { value: 'DMEM', evidence: ['unknown'] } } }, ids).base_medium).toEqual({
      value: null,
      rejected: true,
      evidenceIds: [],
    });
  });
  it('숫자 문자열을 숫자로 바꾼다', () => {
    expect(validateCultureExtraction({ fields: { serum_pct: { value: '10', evidence: ['S1-1', 'unknown'] } } }, ids).serum_pct).toEqual({
      value: 10,
      evidenceIds: ['S1-1'],
      rejected: false,
    });
  });
  it('목록 타입 오류를 거부하고 없는 필드는 빈 값으로 둔다', () => {
    const result = validateCultureExtraction(
      { fields: { supplements: { value: 'glutamine', evidence: ['S1-1'] }, ignored: { value: 'x' } } },
      ids,
    );
    expect(result.supplements.rejected).toBe(true);
    expect(result.supplements.value).toBeNull();
    expect(result.coating).toEqual({ value: null, evidenceIds: [], rejected: false });
  });
  it('fields가 없으면 재요청할 수 있게 예외를 던진다', () => {
    expect(() => validateCultureExtraction({}, ids)).toThrow('추출 결과 형식이 올바르지 않습니다');
  });
  it('합의값은 대소문자를 무시하고 동률이면 앞 자료를 고른다', () => {
    expect(consensus([source('DMEM', 'S1'), source('RPMI', 'S2')], 'base_medium')).toEqual({ value: 'DMEM', count: 1, total: 2 });
    expect(consensus([source('DMEM', 'S1'), source('dmem', 'S2'), source('RPMI', 'S3')], 'base_medium')).toEqual({
      value: 'DMEM',
      count: 2,
      total: 3,
    });
    expect(consensus([], 'base_medium')).toBeNull();
  });
  it('보고서 형식을 검사한다', () => {
    expect(() => parseLiteratureReport({})).toThrow('문헌 보고서 형식이 올바르지 않습니다');
  });
});
