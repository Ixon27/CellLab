import { describe, expect, it, vi } from 'vitest';
import type * as Config from '../src/server/config';
import type { BradfordData } from '../src/shared/bradford';
import type { WesternRunView } from '../src/shared/western';
vi.mock('../src/server/config', async (importOriginal) => {
  const actual = await importOriginal<typeof Config>();
  return { ...actual, PATHS: { ...actual.PATHS, db: ':memory:' } };
});
import { createApp } from '../src/server/app';
import { db, now } from '../src/server/db';
import {
  antibodyMix,
  createWesternData,
  defaultLanes,
  eclMix,
  gelRecipe,
  loadingPlan,
  validateWesternData,
  validateWesternLoading,
  westernAutoRecord,
  westernMarkdown,
} from '../src/shared/western';
import { DEFAULT_LOADING, LOADING_PRESETS, WASH_SUMMARY, WESTERN_RECORD_FIELDS } from '../src/shared/western-defaults';

const app = createApp();
describe('Western 계산', () => {
  it.each([
    [1, 20, 0],
    [2, 10, 10],
    [4, 5, 15],
  ])('농도 %s 로딩량', (c, sample, diluent) => {
    expect(loadingPlan(c, DEFAULT_LOADING)).toMatchObject({ sampleUl: sample, diluentUl: diluent, bufferUl: 5, finalUl: 25, ok: true });
  });
  it('저농도와 농도 미정 처리', () => {
    expect(loadingPlan(0.8, DEFAULT_LOADING)).toMatchObject({ ok: false, minConc: 1 });
    expect(loadingPlan(null, DEFAULT_LOADING)).toBeNull();
    expect(loadingPlan(0, DEFAULT_LOADING)).toBeNull();
  });
  it.each([
    { proteinUg: 0, finalUl: 25, sampleBufferX: 5 },
    { proteinUg: -1, finalUl: 25, sampleBufferX: 5 },
    { proteinUg: Infinity, finalUl: 25, sampleBufferX: 5 },
    { proteinUg: 20, finalUl: NaN, sampleBufferX: 5 },
    { proteinUg: 20, finalUl: 0, sampleBufferX: 5 },
    { proteinUg: 20, finalUl: 25, sampleBufferX: 1 },
    { proteinUg: 20, finalUl: 25, sampleBufferX: Infinity },
  ])('로딩 조건의 잘못된 경계 거부: %j', (loading) => {
    expect(() => validateWesternLoading(loading)).toThrow();
    expect(() => validateWesternData({ ...createWesternData(), loading })).toThrow();
  });
  it('양수 소수와 1 초과 buffer 배수를 보존하고 불가능한 조제를 내보내지 않음', () => {
    const loading = { proteinUg: 0.0001, finalUl: 0.0001, sampleBufferX: 1.0001 };
    expect(validateWesternLoading(loading)).toEqual(loading);
    const data = createWesternData();
    data.samples.push({ id: 'low', name: '저농도', concUgPerUl: 0.8, source: null });
    expect(westernAutoRecord(data).r08).toContain('농축 또는 로딩 조건 조정 필요');
    expect(westernAutoRecord(data).r08).not.toContain('-5.0');
  });
  it('분리겔 원문·현장 조성', () => {
    const r = gelRecipe({ kind: 'separating', pct: 10, scaleMl: 10, batches: 1, temedMultiplier: 2 });
    expect(r.rows.find((r) => r.reagent === 'TEMED')).toEqual({ reagent: 'TEMED', originalUl: 5, fieldUl: 10 });
    expect(r.rows.find((r) => r.reagent === 'D.W')?.originalUl).toBe(4017);
    expect(r.totalFieldUl - r.totalOriginalUl).toBe(5);
  });
  it('스태킹겔 배합 배수', () => {
    const r = gelRecipe({ kind: 'stacking', scaleMl: 7.5, batches: 2, temedMultiplier: 2 });
    expect(r.rows.find((r) => r.reagent === 'TEMED')?.fieldUl).toBe(30);
    expect(r.rows.find((r) => r.reagent === 'APS')?.fieldUl).toBe(75);
  });
  it('항체·ECL 계산', () => {
    expect(antibodyMix(1000, 1000)).toEqual({ antibodyUl: 1, diluentUl: 999 });
    expect(eclMix(2)).toEqual({ ecl1: 200, ecl2: 200, tbst: 200, total: 600 });
  });
  it('레인 초기화와 확장', () => {
    const lanes = defaultLanes(['a', 'b']);
    expect(lanes).toHaveLength(10);
    expect(lanes[1]).toBe('Ladder');
    expect(defaultLanes(Array.from({ length: 12 }, (_, i) => `시료 ${i}`))).toHaveLength(16);
  });
  it('실험실 노트 로딩 프리셋과 원문 기록란', () => {
    expect(LOADING_PRESETS[1]).toMatchObject({ proteinUg: 20, finalUl: 15, sampleBufferX: 5 });
    expect(WESTERN_RECORD_FIELDS).toHaveLength(23);
    expect(WASH_SUMMARY).toHaveLength(7);
    expect(WESTERN_RECORD_FIELDS[22]).toEqual({ key: 'r23', label: '다음 표적 / 재검출 횟수' });
  });
  it('데이터 검증과 모르는 단계 제거', () => {
    const d = createWesternData();
    d.steps.unknown = { done: false, doneAt: null, note: '' };
    expect(validateWesternData(d).steps).not.toHaveProperty('unknown');
    expect(() => validateWesternData({ ...d, wells: 11 })).toThrow();
    expect(() => validateWesternData({ ...d, samples: Array(31).fill({}) })).toThrow();
    expect(() =>
      validateWesternData({
        ...d,
        antibodies: [
          { id: 'a', kind: 'primary', target: '', product: '', dilutionN: 100001, diluent: '', totalUl: 100, start: null, end: null },
        ],
      }),
    ).toThrow();
  });
});
describe('Western API', () => {
  it('Bradford 시료 농도와 희석배수 기록 가져오기', async () => {
    const timestamp = now();
    const d: BradfordData = {
      wavelengthNm: 595,
      fit: 'linear',
      subtractBlank: true,
      standards: [0, 125, 250, 500, 1000].map((conc) => ({
        conc,
        reps: [
          { abs: 0.05 + 0.001 * conc, excluded: false },
          { abs: 0.05 + 0.001 * conc, excluded: false },
        ],
      })),
      samples: [
        {
          name: 'HeLa',
          dilution: 5,
          cultureId: null,
          reps: [
            { abs: 0.55, excluded: false },
            { abs: 0.55, excluded: false },
          ],
        },
      ],
      notes: '',
    };
    db.prepare('INSERT INTO bradford_assays(id,title,performed_at,data,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(
      'western-assay',
      '정량 실험',
      timestamp,
      JSON.stringify(d),
      timestamp,
      timestamp,
    );
    const res = await app.request('/api/western', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromBradford: { id: 'western-assay', sampleIndexes: [0] } }),
    });
    expect(res.status).toBe(201);
    const v = (await res.json()) as WesternRunView;
    expect(v.run.id).toHaveLength(12);
    expect(v.data.samples[0].concUgPerUl).toBeCloseTo(2.5);
    expect(v.data.samples[0].source).toEqual({ bradfordId: 'western-assay', sampleIndex: 0 });
    expect(v.data.record.r07).toContain('희석배수 5');
    const md = westernMarkdown(v);
    expect(md).toContain('## 로딩표');
    expect(md).toContain('r07');
    expect(md).toContain('정량 실험');
    expect(md).toContain('8.0');
    expect((await app.request(`/api/western/${v.run.id}`)).status).toBe(200);
    const override = { proteinUg: 30, finalUl: 20, sampleBufferX: 4 };
    const customResponse = await app.request('/api/western', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromBradford: { id: 'western-assay', sampleIndexes: [0] }, loading: override }),
    });
    expect(customResponse.status).toBe(201);
    const custom = (await customResponse.json()) as WesternRunView;
    expect(custom.data.loading).toEqual(override);
    expect(custom.data.samples[0].concUgPerUl).toBeCloseTo(2.5);
    expect(loadingPlan(custom.data.samples[0].concUgPerUl, custom.data.loading)).toMatchObject({
      sampleUl: 12, diluentUl: 3, bufferUl: 5, finalUl: 20, ok: true,
    });
    expect(custom.data.record.r08).toContain('12.0 / 3.0 / 5.0');
    expect(custom.data.record.r09).toContain('30 µg / 20 µL / 4X');
    const persisted = await app.request(`/api/western/${custom.run.id}`);
    expect(((await persisted.json()) as WesternRunView).data.loading).toEqual(override);
    const put = await app.request(`/api/western/${v.run.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '수정한 실험', status: 'in_progress' }),
    });
    expect(((await put.json()) as WesternRunView).run.title).toBe('수정한 실험');
    const append = await app.request(`/api/western/${v.run.id}/import-bradford`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'western-assay', sampleIndexes: [0] }),
    });
    expect(((await append.json()) as WesternRunView).data.samples).toHaveLength(2);
    expect((await app.request(`/api/western/${v.run.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await app.request(`/api/western/${v.run.id}`)).status).toBe(404);
  });
  it.each([
    { proteinUg: 0, finalUl: 20, sampleBufferX: 5 },
    { proteinUg: 20, finalUl: -1, sampleBufferX: 5 },
    { proteinUg: 20, finalUl: 20, sampleBufferX: 1 },
    { proteinUg: 20, finalUl: 20, sampleBufferX: 0 },
    { proteinUg: '20', finalUl: 20, sampleBufferX: 5 },
    { proteinUg: null, finalUl: 20, sampleBufferX: 5 },
  ])('생성 시 잘못된 로딩 override 거부: %j', async (loading) => {
    const response = await app.request('/api/western', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loading }),
    });
    expect(response.status).toBe(400);
  });
  it('override 없는 신규 실험은 기존 기본값 유지', async () => {
    const response = await app.request('/api/western', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(response.status).toBe(201);
    expect(((await response.json()) as WesternRunView).data.loading).toEqual(DEFAULT_LOADING);
  });
  it('잘못된 Bradford 선택은 400', async () => {
    const res = await app.request('/api/western', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromBradford: { id: 'western-assay', sampleIndexes: [] } }),
    });
    expect(res.status).toBe(400);
  });
});
