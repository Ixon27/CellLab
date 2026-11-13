import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Config from '../src/server/config';
import type { CellLineDto, ProfileDto, SourceRef } from '../src/shared/cell-line';
import type { LiteratureReport, ReportSource } from '../src/shared/literature';
import { validateCultureExtraction } from '../src/shared/literature';
import { buildAdoption, purposeMismatch, validateSourceRefs } from '../src/shared/literature-adoption';
vi.mock('../src/server/config', async (importOriginal) => {
  const actual = await importOriginal<typeof Config>();
  return { ...actual, PATHS: { ...actual.PATHS, db: ':memory:' } };
});
import { createApp } from '../src/server/app';
import { db, now } from '../src/server/db';

const ids = new Set(['S1-1', 'S1-2', 'S1-3']);
const evidence = {
  'S1-1': { heading: 'Methods', text: 'Cells were cultured in DMEM with 10% FBS.' },
  'S1-2': { heading: 'Methods', text: 'No antibiotics were used.' },
  'S1-3': { heading: 'Methods', text: 'For starvation, cells were kept in RPMI with 0.5% FBS.' },
};
function report(kind: 'paper' | 'provider' = 'paper'): LiteratureReport {
  const source: ReportSource = {
    key: 'S1',
    kind,
    label: 'Park et al. 2026',
    pmcid: 'PMC1',
    url: 'https://europepmc.org/article/PMC/PMC1',
    year: 2026,
    status: 'ok',
    error: null,
    fields: validateCultureExtraction(
      {
        fields: {
          base_medium: { value: 'DMEM', evidence: ['S1-1'], purpose: 'growth', purpose_evidence: ['S1-1'] },
          serum: { value: 'FBS', evidence: ['S1-1'] },
          supplements: { value: ['2 mM L-glutamine'], evidence: ['S1-1'] },
          antibiotics: { value: [], usage: 'explicit_not_used', evidence: ['S1-2'] },
          dissociation_reagent: { value: 'Trypsin-EDTA 0.25%', evidence: ['S1-3'], purpose: 'treatment', purpose_evidence: ['S1-3'] },
        },
      },
      ids,
    ),
    evidence,
  };
  return { version: 1, id: 'rep1', cellLineId: 'line', createdAt: now(), by: null, query: null, bankFilter: null, sources: [source] };
}
const choice = (reason: string, purposeConfirmed = false) => ({ kind: 'source' as const, sourceKey: 'S1', reason, purposeConfirmed });

describe('문헌 값 채택', () => {
  it('자료가 1편이어도 어떤 항목도 자동 선택·채택되지 않는다', () => {
    const result = buildAdoption(report(), {}, {});
    expect(result).toMatchObject({ fields: {}, sourceRefs: [], errors: [] });
  });
  it('선택했더라도 사유가 비어 있으면 채택하지 않고 오류를 돌려준다', () => {
    const result = buildAdoption(report(), { base_medium: choice('   ') }, {});
    expect(result.fields).toEqual({});
    expect(result.sourceRefs).toEqual([]);
    expect(result.errors).toEqual([{ field: 'base_medium', message: '채택 사유를 입력하세요' }]);
  });
  it('선택한 항목만 채택하고 사유·근거 id·원문을 SourceRef에 남긴다', () => {
    const result = buildAdoption(report(), { base_medium: choice('  우리 배양 기준과 같음 ') }, {});
    expect(result.errors).toEqual([]);
    expect(result.fields).toEqual({ base_medium: 'DMEM' });
    expect(result.sourceRefs).toEqual([
      {
        field: 'base_medium',
        sourceLabel: 'Park et al. 2026',
        url: 'https://europepmc.org/article/PMC/PMC1',
        quote: evidence['S1-1'].text,
        reason: '우리 배양 기준과 같음',
        evidenceIds: ['S1-1'],
        usage: 'used',
        purpose: 'growth',
        reportId: 'rep1',
        sourceKey: 'S1',
      },
    ]);
  });
  it('처리·동결 용도의 값은 용도 확인 없이 일반 배양 항목으로 채택할 수 없다', () => {
    expect(purposeMismatch('dissociation_reagent', 'treatment')).toBe(true);
    expect(purposeMismatch('freezing_medium', 'freezing')).toBe(false);
    expect(purposeMismatch('base_medium', 'unknown')).toBe(false);
    const blocked = buildAdoption(report(), { dissociation_reagent: choice('사유') }, {});
    expect(blocked.fields).toEqual({});
    expect(blocked.errors[0].field).toBe('dissociation_reagent');
    const allowed = buildAdoption(report(), { dissociation_reagent: choice('사유', true) }, {});
    expect(allowed.fields).toEqual({ dissociation_reagent: 'Trypsin-EDTA 0.25%' });
    expect(allowed.sourceRefs[0]).toMatchObject({ purpose: 'treatment', purposeConfirmed: true, reason: '사유' });
  });
  it('용도가 확인되지 않은 값도 사유를 적으면 채택하며 용도는 unknown으로 남는다', () => {
    const result = buildAdoption(report(), { serum: choice('사유') }, {});
    expect(result.sourceRefs[0]).toMatchObject({ purpose: 'unknown' });
    expect(result.sourceRefs[0].purposeConfirmed).toBeUndefined();
  });
  it('명시적 미사용은 목록 []로 채택하고 언급 없는 항목은 선택할 수 없다', () => {
    const result = buildAdoption(report(), { antibiotics: choice('원문이 사용하지 않았다고 명시'), coating: choice('사유') }, {});
    expect(result.fields.antibiotics).toEqual([]);
    expect(result.sourceRefs).toHaveLength(1);
    expect(result.sourceRefs[0]).toMatchObject({ field: 'antibiotics', usage: 'explicit_not_used', evidenceIds: ['S1-2'] });
    expect(result.errors).toEqual([{ field: 'coating', message: '선택한 자료에 보고된 값이 없습니다' }]);
  });
  it('직접 입력은 비어 있으면 채택하지 않고 SourceRef도 만들지 않는다', () => {
    expect(buildAdoption(report(), { coating: { kind: 'manual' } }, {}).errors[0].field).toBe('coating');
    const ok = buildAdoption(report(), { coating: { kind: 'manual' } }, { coating: 'Gelatin 0.1%' });
    expect(ok.fields).toEqual({ coating: 'Gelatin 0.1%' });
    expect(ok.sourceRefs).toEqual([]);
  });
  it('분양처 자료만 채택하면 provider 출처로 표시한다', () => {
    const result = buildAdoption(report('provider'), { base_medium: choice('분양처 지침') }, {});
    expect(result).toMatchObject({ origin: 'provider', providerOnly: true });
  });
  it('이전 형식의 출처 근거는 그대로 통과한다', () => {
    const legacy = [{ field: 'base_medium', sourceLabel: '실험실 보고', url: '', quote: '원자료 미확인' }];
    expect(validateSourceRefs(legacy)).toEqual(legacy);
  });
});

describe('프로필 sourceRefs 저장', () => {
  const app = createApp();
  let lineId: string;
  const request = (path: string, method: string, body?: unknown) =>
    app.request(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const adopted = (): SourceRef[] => buildAdoption(report(), { base_medium: choice('같은 조건'), antibiotics: choice('명시적 미사용') }, {}).sourceRefs;
  beforeEach(async () => {
    db.prepare('DELETE FROM cell_lines').run();
    db.prepare('DELETE FROM literature_reports').run();
    lineId = ((await (await request('/api/cell-lines', 'POST', { name: 'HeLa', growthMode: 'adherent' })).json()) as CellLineDto).id;
  });
  it('POST·PUT·복제에서 사유와 근거 id를 보존한다', async () => {
    const refs = adopted();
    const created = await request(`/api/cell-lines/${lineId}/profiles`, 'POST', { name: '문헌 기반', origin: 'literature', fields: {}, sourceRefs: refs });
    expect(created.status).toBe(201);
    const profile = (await created.json()) as ProfileDto;
    expect(profile.sourceRefs).toEqual(refs);
    // 이름만 바꾸는 PUT은 sourceRefs를 건드리지 않는다.
    const renamed = (await (await request(`/api/profiles/${profile.id}`, 'PUT', { name: '이름 변경' })).json()) as ProfileDto;
    expect(renamed.sourceRefs).toEqual(refs);
    // PUT으로 사유를 고치면 반영된다.
    const edited = refs.map((r) => (r.field === 'base_medium' ? { ...r, reason: '수정한 사유' } : r));
    const updated = (await (await request(`/api/profiles/${profile.id}`, 'PUT', { sourceRefs: edited })).json()) as ProfileDto;
    expect(updated.sourceRefs.find((r) => r.field === 'base_medium')?.reason).toBe('수정한 사유');
    expect(updated.sourceRefs.find((r) => r.field === 'antibiotics')).toMatchObject({ usage: 'explicit_not_used', evidenceIds: ['S1-2'] });
    // 복제(GET한 DTO를 그대로 POST)해도 메타데이터가 유지된다.
    const clone = (await (
      await request(`/api/cell-lines/${lineId}/profiles`, 'POST', { name: '복제', origin: updated.origin, fields: updated.fields, sourceRefs: updated.sourceRefs })
    ).json()) as ProfileDto;
    expect(clone.sourceRefs).toEqual(updated.sourceRefs);
  });
  it('문헌에서 채택한 값에 사유나 근거 id가 없으면 400이다', async () => {
    const base = adopted()[0];
    for (const bad of [{ ...base, reason: '  ' }, { ...base, reason: undefined }, { ...base, evidenceIds: [] }, { ...base, usage: 'bogus' }]) {
      const res = await request(`/api/cell-lines/${lineId}/profiles`, 'POST', { name: 'x', origin: 'literature', fields: {}, sourceRefs: [bad] });
      expect(res.status).toBe(400);
    }
    const created = (await (await request(`/api/cell-lines/${lineId}/profiles`, 'POST', { name: 'ok', origin: 'manual', fields: {}, sourceRefs: [] })).json()) as ProfileDto;
    expect((await request(`/api/profiles/${created.id}`, 'PUT', { sourceRefs: [{ ...base, reason: '' }] })).status).toBe(400);
  });
  it('다른 용도의 값은 용도 확인 없이 저장할 수 없다', async () => {
    const ref: SourceRef = { ...adopted()[0], field: 'dissociation_reagent', purpose: 'treatment' };
    const res = await request(`/api/cell-lines/${lineId}/profiles`, 'POST', { name: 'x', origin: 'literature', fields: {}, sourceRefs: [ref] });
    expect(res.status).toBe(400);
    const ok = await request(`/api/cell-lines/${lineId}/profiles`, 'POST', {
      name: 'x',
      origin: 'literature',
      fields: {},
      sourceRefs: [{ ...ref, purposeConfirmed: true }],
    });
    expect(ok.status).toBe(201);
  });
  it('보고서가 남아 있으면 없는 근거 id 인용을 거부하고, 삭제된 뒤에는 저장된 근거를 유지한다', async () => {
    const rep = { ...report(), cellLineId: lineId };
    db.prepare('INSERT INTO literature_reports(id,cell_line_id,content,created_at) VALUES(?,?,?,?)').run(rep.id, lineId, JSON.stringify(rep), rep.createdAt);
    const forged = { ...adopted()[0], evidenceIds: ['S1-99'] };
    const body = (sourceRefs: SourceRef[]) => ({ name: 'x', origin: 'literature', fields: {}, sourceRefs });
    expect((await request(`/api/cell-lines/${lineId}/profiles`, 'POST', body([forged]))).status).toBe(400);
    expect((await request(`/api/cell-lines/${lineId}/profiles`, 'POST', body([adopted()[0]]))).status).toBe(201);
    db.prepare('DELETE FROM literature_reports').run();
    expect((await request(`/api/cell-lines/${lineId}/profiles`, 'POST', body([forged]))).status).toBe(201);
  });
  it('값을 바꾸는 PUT은 바뀐 항목의 문헌 채택 근거만 제거하고 직접 적은 출처·다른 항목 근거는 유지한다', async () => {
    const manualRef: SourceRef = { field: 'base_medium', sourceLabel: '실험실 보고', url: '', quote: '원자료 미확인' };
    const refs = [...adopted(), manualRef];
    const profile = (await (
      await request(`/api/cell-lines/${lineId}/profiles`, 'POST', { name: 'x', origin: 'literature', fields: { base_medium: 'DMEM', antibiotics: [] }, sourceRefs: refs })
    ).json()) as ProfileDto;
    const changed = (await (await request(`/api/profiles/${profile.id}`, 'PUT', { fields: { base_medium: 'RPMI 1640', antibiotics: [] } })).json()) as ProfileDto;
    expect(changed.sourceRefs.map((r) => `${r.field}:${r.reportId ?? 'manual'}`)).toEqual(['antibiotics:rep1', 'base_medium:manual']);
    const sameValue = (await (await request(`/api/profiles/${profile.id}`, 'PUT', { fields: { base_medium: 'RPMI 1640', antibiotics: [] }, name: 'y' })).json()) as ProfileDto;
    expect(sameValue.sourceRefs).toHaveLength(2);
  });
});
