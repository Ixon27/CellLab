import { describe, expect, it } from 'vitest';
import type { ProfileDto } from '../src/shared/cell-line';
import type { CultureExecutionPlan, PlanCondition } from '../src/shared/culture-plan';
import type { VesselProduct } from '../src/shared/lab-products';
import {
  buildCurrentCultureView,
  elapsedLabel,
  nextCheck,
  resolveCurrentCulture,
  sourceBadges,
  vesselView,
} from '../src/web/cells/current-culture-state';
import type { SummaryCulture, SummaryLog } from '../src/web/cells/current-culture-state';

const NOW = Date.parse('2026-11-11T12:00:00.000Z');

function culture(id: string, patch: Partial<SummaryCulture> = {}): SummaryCulture {
  return { id, label: id, passage: 3, vessel: 'T75', status: 'active', profileId: null, startedAt: '2026-11-01T09:00:00.000Z', ...patch };
}
function log(id: string, at: string, patch: Partial<SummaryLog> = {}): SummaryLog {
  return { id, cultureId: 'c1', at, type: 'observation', confluencyPct: null, ...patch };
}
function feed(mode: string, replacesMedium: boolean, patch: Partial<NonNullable<SummaryLog['feed']>> = {}): NonNullable<SummaryLog['feed']> {
  return { mode, removedMl: null, addedMl: null, mediumLabel: null, replacesMedium, ...patch };
}
function condition(id: string, patch: Partial<PlanCondition> = {}): PlanCondition {
  return { id, label: id, value: '', status: 'decision', sources: [], note: '', stages: [], ...patch };
}
function plan(conditions: PlanCondition[], mediumRecipe: CultureExecutionPlan['mediumRecipe'] = null): CultureExecutionPlan {
  const step = { instructions: '', recordLabels: [] };
  return { version: 1, summary: '', conditions, mediumRecipe, steps: { stock: step, thaw: step, feed: step, passage: step, freeze: step } };
}
function profile(id: string, patch: Partial<ProfileDto> = {}): ProfileDto {
  return { id, cellLineId: 'line', name: id, origin: 'manual', fields: {}, sourceRefs: [], isActive: false, createdAt: 'c', updatedAt: 'u', executionPlan: null, ...patch };
}
function view(over: { cultures?: SummaryCulture[]; logs?: SummaryLog[]; profiles?: ProfileDto[]; requested?: string | null; maxPassage?: number | null } = {}) {
  return buildCurrentCultureView({
    line: { maxPassage: over.maxPassage ?? null },
    profiles: over.profiles ?? [],
    cultures: over.cultures ?? [culture('c1')],
    logs: over.logs ?? [],
    requestedCultureId: over.requested ?? null,
    now: NOW,
  });
}

describe('현재 배양 선택', () => {
  it('활성 배양이 하나일 때만 자동 선택하고 여러 개면 합산하지 않고 선택을 요구한다', () => {
    const one = resolveCurrentCulture([culture('a'), culture('b', { status: 'split' })], null);
    expect(one).toMatchObject({ choice: 'only_active', culture: { id: 'a' } });
    const many = resolveCurrentCulture([culture('a'), culture('b')], null);
    expect(many).toMatchObject({ choice: 'needs_choice', culture: null });
    expect(many.choices.map((c) => c.id)).toEqual(['a', 'b']);
    expect(resolveCurrentCulture([culture('a'), culture('b')], 'b')).toMatchObject({ choice: 'selected', culture: { id: 'b' } });
    expect(resolveCurrentCulture([culture('a', { status: 'frozen' })], 'a')).toMatchObject({ choice: 'none_active', culture: null });
  });
  it('종료된 배양을 요청해도 선택으로 인정하지 않는다', () => {
    const result = resolveCurrentCulture([culture('a'), culture('b', { status: 'discarded' }), culture('c')], 'b');
    expect(result.culture).toBeNull();
    expect(result.choice).toBe('needs_choice');
  });
  it('선택되지 않은 상태에서는 기록 기반 값을 만들지 않는다', () => {
    const v = view({ cultures: [culture('c1'), culture('c2')], logs: [log('l', '2026-11-10T00:00:00.000Z', { confluencyPct: 50, type: 'medium_change' })] });
    expect(v.culture).toBeNull();
    expect(v.vessel).toBeNull();
    expect(v.replacement).toBeNull();
    expect(v.confluency).toBeNull();
    expect(v.nextCheck).toBeNull();
  });
});

describe('마지막 실제 배지 교체', () => {
  it('첨가만 기록은 교체 날짜를 바꾸지 않고, 더 최근이면 별도 항목으로만 보인다', () => {
    const v = view({
      logs: [
        log('full', '2026-11-05T09:00:00.000Z', { type: 'medium_change', feed: feed('full', true, { removedMl: 10, addedMl: 10, mediumLabel: 'DMEM' }) }),
        log('add', '2026-11-09T09:00:00.000Z', { type: 'medium_change', feed: feed('addition', false, { addedMl: 2 }) }),
      ],
    });
    expect(v.replacement).toMatchObject({ at: '2026-11-05T09:00:00.000Z', modeLabel: '전량 교체', removedMl: 10, addedMl: 10, mediumLabel: 'DMEM' });
    expect(v.lastAddition).toEqual({ at: '2026-11-09T09:00:00.000Z', elapsed: '2일 전' });
  });
  it('첨가만 기록이 교체보다 오래되었으면 첨가 항목을 표시하지 않는다', () => {
    const v = view({
      logs: [
        log('add', '2026-11-01T09:00:00.000Z', { type: 'medium_change', feed: feed('addition', false) }),
        log('part', '2026-11-04T09:00:00.000Z', { type: 'medium_change', feed: feed('partial', true, { removedMl: 5, addedMl: 5 }) }),
      ],
    });
    expect(v.replacement).toMatchObject({ at: '2026-11-04T09:00:00.000Z', modeLabel: '부분 교체' });
    expect(v.lastAddition).toBeNull();
  });
  it('방식 정보가 없는 기존 배지 교체 기록은 교체로 보되 방식과 양을 추정하지 않는다', () => {
    const v = view({ logs: [log('legacy', '2026-11-03T09:00:00.000Z', { type: 'medium_change' })] });
    expect(v.replacement).toEqual({
      at: '2026-11-03T09:00:00.000Z',
      elapsed: '8일 전',
      modeLabel: '교체 방식 미기록',
      removedMl: null,
      addedMl: null,
      mediumLabel: null,
    });
  });
  it('계대·관찰 기록은 교체로 보지 않고 다른 배양의 기록은 무시한다', () => {
    const v = view({
      logs: [
        log('p', '2026-11-08T09:00:00.000Z', { type: 'passage' }),
        log('o', '2026-11-09T09:00:00.000Z', { type: 'observation' }),
        log('other', '2026-11-10T09:00:00.000Z', { cultureId: 'c2', type: 'medium_change' }),
      ],
    });
    expect(v.replacement).toBeNull();
  });
  it('같은 시각이면 나중에 생성된 기록을 최신으로 본다', () => {
    const at = '2026-11-06T09:00:00.000Z';
    const v = view({
      logs: [
        log('a', at, { type: 'medium_change', createdAt: '2026-11-06T09:01:00.000Z', feed: feed('partial', true, { mediumLabel: '앞' }) }),
        log('b', at, { type: 'medium_change', createdAt: '2026-11-06T09:02:00.000Z', feed: feed('full', true, { mediumLabel: '뒤' }) }),
      ],
    });
    expect(v.replacement?.mediumLabel).toBe('뒤');
  });
});

describe('다음 확인 기준일', () => {
  it('마지막 실제 교체일 + 교체 기한(일)로만 계산하고 남은/지난 일수를 정수로 보여 준다', () => {
    expect(nextCheck('2026-11-09T12:00:00.000Z', 3, NOW)).toEqual({
      days: 3,
      basisAt: '2026-11-09T12:00:00.000Z',
      dueAt: '2026-11-12T12:00:00.000Z',
      remainingDays: 1,
    });
    expect(nextCheck('2026-11-08T12:00:00.000Z', 3, NOW)?.remainingDays).toBe(0);
    expect(nextCheck('2026-11-05T12:00:00.000Z', 3, NOW)?.remainingDays).toBe(-3);
  });
  it('교체 기록이나 기한이 없으면 만들지 않는다', () => {
    expect(nextCheck(null, 3, NOW)).toBeNull();
    expect(nextCheck('2026-11-09T12:00:00.000Z', null, NOW)).toBeNull();
    expect(nextCheck('2026-11-09T12:00:00.000Z', undefined, NOW)).toBeNull();
    expect(nextCheck('not a date', 3, NOW)).toBeNull();
  });
  it('첨가만 기록으로는 기준일이 갱신되지 않는다', () => {
    const v = view({
      profiles: [profile('p', { isActive: true, fields: { medium_change_days: 3 } })],
      logs: [
        log('full', '2026-11-05T12:00:00.000Z', { type: 'medium_change', feed: feed('full', true) }),
        log('add', '2026-11-10T12:00:00.000Z', { type: 'medium_change', feed: feed('addition', false) }),
      ],
    });
    expect(v.nextCheck).toMatchObject({ basisAt: '2026-11-05T12:00:00.000Z', remainingDays: -3 });
  });
  it('일수가 없고 자유 입력 주기만 있으면 값을 그대로 전달만 한다', () => {
    const v = view({ profiles: [profile('p', { isActive: true, fields: { medium_change: '주 2회' } })], logs: [log('x', '2026-11-05T12:00:00.000Z', { type: 'medium_change' })] });
    expect(v.nextCheck).toBeNull();
    expect(v.mediumChangeText).toBe('주 2회');
  });
});

describe('마지막 confluency', () => {
  it('값이 있는 가장 최근 측정을 관찰 시각·경과와 함께 돌려주고 null 기록은 건너뛴다', () => {
    const v = view({
      logs: [
        log('old', '2026-11-02T09:00:00.000Z', { confluencyPct: 30 }),
        log('measured', '2026-11-08T12:00:00.000Z', { confluencyPct: 70 }),
        log('newer-null', '2026-11-10T09:00:00.000Z', { confluencyPct: null, type: 'medium_change' }),
      ],
    });
    expect(v.confluency).toEqual({ pct: 70, at: '2026-11-08T12:00:00.000Z', elapsed: '3일 전' });
  });
  it('0%도 유효한 측정이며 측정 기록이 없으면 null이다', () => {
    expect(view({ logs: [log('zero', '2026-11-09T09:00:00.000Z', { confluencyPct: 0 })] }).confluency?.pct).toBe(0);
    expect(view({ logs: [log('none', '2026-11-09T09:00:00.000Z')] }).confluency).toBeNull();
  });
  it('경과 표기는 임의의 기준 없이 시간·일 단위 사실만 말한다', () => {
    expect(elapsedLabel('2026-11-11T11:30:00.000Z', NOW)).toBe('1시간 미만 전');
    expect(elapsedLabel('2026-11-11T07:00:00.000Z', NOW)).toBe('5시간 전');
    expect(elapsedLabel('2026-11-10T07:00:00.000Z', NOW)).toBe('29시간 전');
    expect(elapsedLabel('2026-11-01T12:00:00.000Z', NOW)).toBe('10일 전');
    expect(elapsedLabel('2026-11-12T12:00:00.000Z', NOW)).toBe('기록 시각이 현재보다 이후입니다');
    expect(elapsedLabel('???', NOW)).toBeNull();
  });
});

describe('배양 용기', () => {
  const product: VesselProduct = {
    id: 'ref:12-well',
    label: '12-well · 참고 사양',
    format: '12-well',
    manufacturer: 'Maker',
    catalogNo: 'C-12',
    surfaceTreatment: 'treated',
    wellsPerUnit: 12,
    areaCm2PerWell: 3.8,
    mediumMinMlPerWell: null,
    mediumMaxMlPerWell: null,
    specStatus: 'reference',
    sourceLabel: '',
    url: null,
  };
  it('기존 자유 입력 용기는 well 수·부피를 만들지 않는다', () => {
    expect(vesselView({ vessel: 'T75' })).toMatchObject({ recorded: false, label: 'T75', usedWells: null, mediumMl: null, areaCm2: null });
  });
  it('저장된 제품 스냅샷의 사용 well·배지 부피·면적을 보여 주고 사양 범위가 없으면 만들지 않는다', () => {
    const v = vesselView({ vessel: '12-well', vesselUse: { vesselProductId: product.id, usedWells: 3, mediumMl: 4.5, product } });
    expect(v).toMatchObject({ recorded: true, usedWells: 3, wellsPerUnit: 12, mediumMl: 4.5, areaCm2: 11.4, specMediumMlPerWell: null, specStatus: 'reference' });
    const known = vesselView({ vessel: 'x', vesselUse: { vesselProductId: 'p', usedWells: 1, mediumMl: null, product: { ...product, mediumMinMlPerWell: 1, mediumMaxMlPerWell: 2, areaCm2PerWell: null } } });
    expect(known).toMatchObject({ mediumMl: null, areaCm2: null, specMediumMlPerWell: { min: 1, max: 2 } });
  });
});

describe('조건 세트와 출처', () => {
  it('선택한 배양에 연결된 조건을 우선하고 없으면 활성 조건을 명시적으로 대체한다', () => {
    const linked = profile('linked');
    const active = profile('active', { isActive: true });
    expect(view({ profiles: [active, linked], cultures: [culture('c1', { profileId: 'linked' })] })).toMatchObject({ profile: { id: 'linked' }, profileBasis: 'linked' });
    expect(view({ profiles: [active, linked] })).toMatchObject({ profile: { id: 'active' }, profileBasis: 'active_fallback' });
    expect(view({ profiles: [active], cultures: [culture('c1'), culture('c2')] })).toMatchObject({ profile: { id: 'active' }, profileBasis: 'active_no_culture' });
    expect(view({ profiles: [linked] })).toMatchObject({ profile: null, profileBasis: 'none' });
  });
  it('값의 출처 참조가 없으면 출처 미등록 배지만 보인다', () => {
    const p = profile('p', { isActive: true, fields: { temp_c: 37, co2_pct: 5 } });
    const v = view({ profiles: [p] });
    expect(v.temperature).toMatchObject({ value: '37 °C', via: null });
    expect(v.co2.value).toBe('5%');
    expect(v.temperature.sources).toEqual([{ kind: 'unknown', labels: [] }]);
    expect(view({ profiles: [profile('empty', { isActive: true })] }).temperature).toMatchObject({ value: null, via: null });
  });
  it('이름만 같은 실행 계획의 근거를 프로필 값에 붙이지 않고 계획에서 읽은 값에는 실제 근거를 붙인다', () => {
    const p = profile('p', {
      isActive: true,
      fields: { temp_c: 37 },
      executionPlan: plan([
        condition('t', { label: '온도', value: '39 °C', sources: [{ kind: 'bank_reply', label: '분양처 회신', quote: '', url: null }] }),
        condition('c', { label: 'CO2 농도', value: '5%', sources: [{ kind: 'paper', label: 'Kim 2024', quote: '', url: null }] }),
        condition('m', { label: '기본 배지', sources: [{ kind: 'manufacturer', label: '제품 시트', quote: '', url: null }] }),
        condition('f', { label: '배지 교체 주기', sources: [{ kind: 'lab', label: '실험실 SOP', quote: '', url: null }] }),
      ]),
    });
    const v = view({ profiles: [p] });
    expect(v.temperature.value).toBe('37 °C');
    expect(v.temperature.sources).toEqual([{ kind: 'unknown', labels: [] }]);
    expect(v.co2).toMatchObject({ value: '5%', sources: [{ kind: 'paper', labels: ['Kim 2024'] }] });
    expect(v.medium.sources).toEqual([{ kind: 'unknown', labels: [] }]);
  });
  it('프로필의 출처 참조는 프로필 출처 유형으로, 수동 조건은 분류 미상으로 표시한다', () => {
    const refs = [{ field: 'temp_c' as const, sourceLabel: 'ATCC 페이지', url: '', quote: '' }];
    expect(sourceBadges(profile('a', { origin: 'provider', sourceRefs: refs }), ['temp_c'], null)).toEqual([{ kind: 'bank_general', labels: ['ATCC 페이지'] }]);
    expect(sourceBadges(profile('b', { origin: 'literature', sourceRefs: refs }), ['temp_c'], null)).toEqual([{ kind: 'paper', labels: ['ATCC 페이지'] }]);
    const manual = sourceBadges(profile('c', { origin: 'manual', sourceRefs: refs }), ['temp_c'], null);
    expect(manual).toEqual([{ kind: 'unknown', labels: ['ATCC 페이지'] }]);
    expect(sourceBadges(profile('d', { origin: 'provider', sourceRefs: refs }), ['co2_pct'], null)).toEqual([{ kind: 'unknown', labels: [] }]);
  });
  it('배지 제품 번호는 계획에 저장된 스냅샷 그대로이고 제품이 없으면 값을 만들지 않는다', () => {
    const snapshot = {
      id: 'p1',
      kind: 'base_medium' as const,
      label: 'DMEM (등록 당시 이름)',
      manufacturer: 'Maker',
      catalogNo: '11965',
      lotNo: 'L1',
      ingredients: [],
      ingredientsConfirmed: false,
      sourceLabel: '',
      url: null,
      capturedAt: '2026-01-01T00:00:00.000Z',
    };
    const recipe = {
      baseLabel: 'DMEM',
      baseProduct: snapshot,
      components: [
        { id: 'a', label: 'FBS', percent: 10, stockConfirmed: false, stockIngredients: [] },
      ],
    } as CultureExecutionPlan['mediumRecipe'];
    const v = view({ profiles: [profile('p', { isActive: true, fields: { base_medium: 'DMEM', serum: 'FBS', serum_pct: 10 }, executionPlan: plan([], recipe) })] });
    expect(v.medium.parts[0]).toMatchObject({ label: 'DMEM', product: { catalogNo: '11965', lotNo: 'L1', label: 'DMEM (등록 당시 이름)', capturedAt: '2026-01-01T00:00:00.000Z' } });
    expect(v.medium.parts[1]).toMatchObject({ label: 'FBS', percent: 10, product: null, stockConfirmed: false });
  });
});

describe('계대 기준과 미확정 조건', () => {
  it('조건 세트의 계대 값과 계대 단계의 확정 조건을 모으고, 미확정은 별도 목록으로 분리한다', () => {
    const p = profile('p', {
      isActive: true,
      fields: { subculture_confluency_pct: 80, split_ratio: '1:4' },
      executionPlan: plan([
        condition('a', { label: '계대 시점', value: '80% 도달', stages: ['passage'], status: 'confirmed', sources: [{ kind: 'bank_reply', label: '회신', quote: '', url: null }] }),
        condition('b', { label: '분주 시약', value: '', stages: ['passage', 'thaw'], status: 'unresolved' }),
        condition('c', { label: '동결 밀도', value: '미정 값', stages: ['freeze'], status: 'conditional' }),
        condition('d', { label: '해동 방법', stages: ['thaw'], status: 'decision' }),
      ]),
    });
    const v = view({ profiles: [p], maxPassage: 20 });
    expect(v.passageCriteria.map((c) => c.key)).toEqual(['field:subculture_confluency_pct', 'field:split_ratio', 'cond:a', 'line:max-passage']);
    expect(v.passageCriteria[0]).toMatchObject({ value: '80%', status: null, sources: [{ kind: 'unknown', labels: [] }] });
    expect(v.passageCriteria[2]).toMatchObject({ value: '80% 도달', status: 'confirmed', sources: [{ kind: 'bank_reply', labels: ['회신'] }] });
    expect(v.passageCriteria[3].value).toBe('20 (이 배양 P3)');
    expect(v.unresolved.map((u) => [u.id, u.status])).toEqual([['b', 'unresolved'], ['c', 'conditional']]);
  });
  it('계대 기준이 전혀 없으면 빈 목록이다', () => {
    const v = view({ profiles: [profile('p', { isActive: true })] });
    expect(v.passageCriteria).toEqual([]);
    expect(v.unresolved).toEqual([]);
  });
});
