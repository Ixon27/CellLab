import { describe, expect, it } from 'vitest';
import {
  fieldPurpose,
  fieldUsage,
  parseLiteratureReport,
  reportedValues,
  sourceContextOf,
  validateCultureExtraction,
  validateSourceContext,
} from '../src/shared/literature';
import type { ReportSource } from '../src/shared/literature';
const ids = new Set(['S1-1', 'S1-2']);
function source(value: string | string[], key: string, field = 'base_medium'): ReportSource {
  return {
    key,
    kind: 'paper',
    label: key,
    pmcid: 'PMC1',
    url: 'https://example.org',
    year: 2026,
    status: 'ok',
    error: null,
    fields: validateCultureExtraction({ fields: { [field]: { value, evidence: ['S1-1'] } } }, ids),
    evidence: { 'S1-1': { heading: 'Methods', text: 'Cells were cultured in DMEM.' } },
  };
}
describe('추출 결과 검증', () => {
  it('알 수 없는 근거는 거부한다', () => {
    expect(validateCultureExtraction({ fields: { base_medium: { value: 'DMEM', evidence: ['unknown'] } } }, ids).base_medium).toEqual({
      value: null,
      rejected: true,
      evidenceIds: [],
      usage: 'not_reported',
      purpose: 'unknown',
      purposeEvidenceIds: [],
    });
  });
  it('숫자 문자열을 숫자로 바꾼다', () => {
    expect(validateCultureExtraction({ fields: { serum_pct: { value: '10', evidence: ['S1-1', 'unknown'] } } }, ids).serum_pct).toMatchObject({
      value: 10,
      evidenceIds: ['S1-1'],
      rejected: false,
      usage: 'used',
    });
  });
  it('목록 타입 오류를 거부하고 없는 필드는 빈 값으로 둔다', () => {
    const result = validateCultureExtraction(
      { fields: { supplements: { value: 'glutamine', evidence: ['S1-1'] }, ignored: { value: 'x' } } },
      ids,
    );
    expect(result.supplements.rejected).toBe(true);
    expect(result.supplements.value).toBeNull();
    expect(result.coating).toEqual({
      value: null,
      evidenceIds: [],
      rejected: false,
      usage: 'not_reported',
      purpose: 'unknown',
      purposeEvidenceIds: [],
    });
  });
  it('fields가 없으면 재요청할 수 있게 예외를 던진다', () => {
    expect(() => validateCultureExtraction({}, ids)).toThrow('추출 결과 형식이 올바르지 않습니다');
  });
  it('보고서 형식을 검사한다', () => {
    expect(() => parseLiteratureReport({})).toThrow('문헌 보고서 형식이 올바르지 않습니다');
  });
});
describe('사용 상태: 언급 없음과 명시적 미사용 구분', () => {
  it('근거 문장이 있는 명시적 미사용만 explicit_not_used이고 목록은 []로 표현한다', () => {
    const r = validateCultureExtraction(
      {
        fields: {
          antibiotics: { value: [], usage: 'explicit_not_used', evidence: ['S1-2'] },
          coating: { value: null, usage: 'explicit_not_used', evidence: ['S1-2'] },
        },
      },
      ids,
    );
    expect(r.antibiotics).toMatchObject({ value: [], usage: 'explicit_not_used', rejected: false, evidenceIds: ['S1-2'] });
    expect(r.coating).toMatchObject({ value: null, usage: 'explicit_not_used', rejected: false });
  });
  it('근거 없는 미사용 주장·생략·빈 목록은 미사용으로 추정하지 않는다', () => {
    const r = validateCultureExtraction(
      {
        fields: {
          antibiotics: { value: [], usage: 'explicit_not_used', evidence: ['unknown'] },
          supplements: { value: [], evidence: ['S1-1'] },
          coating: { value: null, usage: 'not_reported', evidence: [] },
        },
      },
      ids,
    );
    expect(r.antibiotics).toMatchObject({ value: null, usage: 'not_reported', rejected: true, evidenceIds: [] });
    expect(r.supplements).toMatchObject({ value: null, usage: 'not_reported' });
    expect(r.coating.usage).toBe('not_reported');
    expect(r.serum.usage).toBe('not_reported');
    expect(r.serum.rejected).toBe(false);
  });
  it('값을 가지면서 미사용이라는 모순된 응답은 둘 다 채택하지 않는다', () => {
    const r = validateCultureExtraction({ fields: { serum: { value: 'FBS', usage: 'explicit_not_used', evidence: ['S1-1'] } } }, ids);
    expect(r.serum).toMatchObject({ value: null, usage: 'not_reported', rejected: true });
  });
  it('보고 요약은 언급 없음·명시 미사용·제외를 따로 센다', () => {
    const notUsed: ReportSource = {
      ...source('x', 'S2'),
      fields: validateCultureExtraction({ fields: { base_medium: { value: null, usage: 'explicit_not_used', evidence: ['S1-1'] } } }, ids),
    };
    const silent: ReportSource = { ...source('x', 'S3'), fields: validateCultureExtraction({ fields: {} }, ids) };
    const summary = reportedValues([source('DMEM', 'S1'), notUsed, silent], 'base_medium');
    expect(summary).toMatchObject({ analyzed: 3, reported: 1, notReported: 1, rejected: 0 });
    expect(summary.explicitNotUsed.map((s) => s.key)).toEqual(['S2']);
  });
});
describe('문헌에서 보고된 값 요약', () => {
  it('1편만 보고해도 합의가 아니라 보고 1편/분석 n편으로 표현한다', () => {
    const summary = reportedValues([source('DMEM', 'S1')], 'base_medium');
    expect(summary).toMatchObject({ analyzed: 1, reported: 1 });
    expect(summary.groups).toEqual([{ value: 'DMEM', count: 1, sources: [{ key: 'S1', purpose: 'unknown' }] }]);
    expect(summary).not.toHaveProperty('value');
  });
  it('대소문자만 다른 값은 묶고 최빈값을 고르지 않고 자료 순서를 유지한다', () => {
    const summary = reportedValues([source('RPMI', 'S1'), source('DMEM', 'S2'), source('dmem', 'S3')], 'base_medium');
    expect(summary.groups.map((g) => [g.value, g.count])).toEqual([
      ['RPMI', 1],
      ['DMEM', 2],
    ]);
    expect(reportedValues([], 'base_medium')).toMatchObject({ analyzed: 0, reported: 0, groups: [] });
  });
  it('단위가 다른 값은 환산하지 않고 서로 다른 값으로 둔다', () => {
    const summary = reportedValues(
      [source(['2 mM puromycin'], 'S1', 'supplements'), source(['2 µg/mL puromycin'], 'S2', 'supplements'), source(['2000 µM puromycin'], 'S3', 'supplements')],
      'supplements',
    );
    expect(summary.groups).toHaveLength(3);
  });
  it('분석에 실패한 자료는 분모에 넣지 않는다', () => {
    const failed: ReportSource = { ...source('DMEM', 'S2'), status: 'no_fulltext', fields: null };
    expect(reportedValues([source('DMEM', 'S1'), failed], 'base_medium')).toMatchObject({ analyzed: 1, reported: 1 });
  });
});
describe('용도·자료 맥락 메타데이터', () => {
  it('용도는 검증된 근거 id가 있을 때만 인정하고 아니면 unknown이다', () => {
    const r = validateCultureExtraction(
      {
        fields: {
          base_medium: { value: 'DMEM', evidence: ['S1-1'], purpose: 'growth', purpose_evidence: ['S1-1'] },
          serum: { value: 'FBS', evidence: ['S1-1'], purpose: 'treatment', purpose_evidence: ['unknown'] },
          serum_pct: { value: 10, evidence: ['S1-1'], purpose: 'freezing' },
          freezing_medium: { value: '10% DMSO', evidence: ['S1-2'], purpose: 'freezing', purpose_evidence: ['S1-2'] },
        },
      },
      ids,
    );
    expect(r.base_medium).toMatchObject({ purpose: 'growth', purposeEvidenceIds: ['S1-1'] });
    expect(r.serum.purpose).toBe('unknown');
    expect(r.serum_pct.purpose).toBe('unknown');
    expect(r.freezing_medium.purpose).toBe('freezing');
  });
  it('공급처·대상 세포는 근거 id가 검증될 때만 명시로 인정한다', () => {
    expect(
      validateSourceContext(
        { source_context: { target_cell: { status: 'target', evidence: ['S1-1'] }, supply_origin: { status: 'stated', evidence: ['S1-2'] } } },
        ids,
      ),
    ).toEqual({ targetCell: { status: 'target', evidenceIds: ['S1-1'] }, supplyOrigin: { status: 'stated', evidenceIds: ['S1-2'] } });
    expect(
      validateSourceContext(
        { source_context: { target_cell: { status: 'target', evidence: ['unknown'] }, supply_origin: { status: 'stated', evidence: [] } } },
        ids,
      ),
    ).toEqual({ targetCell: { status: 'unknown', evidenceIds: [] }, supplyOrigin: { status: 'unknown', evidenceIds: [] } });
    expect(validateSourceContext({ fields: {} }, ids).supplyOrigin.status).toBe('unknown');
  });
  it('메타데이터가 없는 이전 보고서는 용도·공급처·대상 세포를 모두 unknown으로 읽고 미사용을 추정하지 않는다', () => {
    const legacy = {
      version: 1,
      id: 'r1',
      cellLineId: 'l1',
      createdAt: '2026-01-01T00:00:00.000Z',
      by: null,
      query: null,
      bankFilter: null,
      sources: [
        {
          key: 'S1',
          kind: 'paper',
          label: 'old',
          pmcid: 'PMC1',
          url: '',
          year: 2020,
          status: 'ok',
          error: null,
          fields: {
            base_medium: { value: 'DMEM', evidenceIds: ['S1-1'], rejected: false },
            antibiotics: { value: null, evidenceIds: [], rejected: false },
          },
          evidence: { 'S1-1': { heading: '', text: 'DMEM' } },
        },
      ],
    };
    const report = parseLiteratureReport(JSON.stringify(legacy));
    const s = report.sources[0];
    expect(sourceContextOf(s)).toEqual({ targetCell: { status: 'unknown', evidenceIds: [] }, supplyOrigin: { status: 'unknown', evidenceIds: [] } });
    expect(fieldPurpose(s.fields!.base_medium)).toBe('unknown');
    expect(fieldUsage(s.fields!.base_medium)).toBe('used');
    expect(fieldUsage(s.fields!.antibiotics)).toBe('not_reported');
    expect(reportedValues(report.sources, 'antibiotics').explicitNotUsed).toEqual([]);
  });
});
