import { describe, expect, it } from 'vitest';
import { mediumRecipe, validateExecutionPlan } from '../src/shared/culture-plan';
import type { CultureExecutionPlan } from '../src/shared/culture-plan';
function plan(): CultureExecutionPlan {
  return { version: 1, summary: '실험실의 일반 실행 계획', conditions: [{ id: 'general', label: '점검 항목', value: '', status: 'unresolved', sources: [{ kind: 'lab', label: '사용자 보고', quote: '원자료 확인 전', url: null }], note: '', stages: ['stock', 'thaw'] }], steps: { stock: { instructions: '', recordLabels: [] }, thaw: { instructions: '', recordLabels: [] }, feed: { instructions: '', recordLabels: [] }, passage: { instructions: '', recordLabels: [] }, freeze: { instructions: '', recordLabels: [] } }, mediumRecipe: { baseLabel: '시험용 기본 배지', components: [{ id: 'a', label: '시험용 첨가물', percent: 4, stockConfirmed: false, stockIngredients: [{ label: '성분 A', value: 250, unit: '단위/mL' }] }] } };
}
describe('일반 배양 실행 계획', () => {
  it('없는 계획은 null이며 모든 단계와 근거를 왕복한다', () => {
    expect(validateExecutionPlan(undefined)).toBeNull();
    expect(validateExecutionPlan(null)).toBeNull();
    expect(validateExecutionPlan(plan())).toEqual(plan());
  });
  it('총량에 따른 조제량을 계산하고 확인 전 농도는 숨긴다', () => {
    const p = plan();
    expect(mediumRecipe(p, 50)).toEqual({ totalMl: 50, baseMl: 48, components: [{ id: 'a', label: '시험용 첨가물', percent: 4, ml: 2, finalIngredients: null }] });
    p.mediumRecipe!.components[0].stockConfirmed = true;
    expect(mediumRecipe(p, 50)!.components[0].finalIngredients).toEqual([{ label: '성분 A', value: 10, unit: '단위/mL' }]);
    for (const total of [0, -1, Infinity, NaN, 100001]) expect(() => mediumRecipe(p, total)).toThrow();
  });
  it('잘못된 구조, 중복 id, 범위와 근거 URL을 거부한다', () => {
    const changes: ((p: CultureExecutionPlan) => void)[] = [
      (p) => { p.conditions.push(p.conditions[0]); },
      (p) => { p.conditions = Array.from({ length: 101 }, (_, i) => ({ ...p.conditions[0], id: String(i) })); },
      (p) => { p.conditions[0].status = 'invented' as never; },
      (p) => { p.conditions[0].stages = ['invented' as never]; },
      (p) => { p.conditions[0].sources[0].url = 'javascript:alert(1)'; },
      (p) => { p.conditions[0].label = 'x'.repeat(301); },
      (p) => { p.mediumRecipe!.components[0].percent = NaN; },
      (p) => { p.mediumRecipe!.components[0].percent = 100; },
      (p) => { p.mediumRecipe!.components.push(p.mediumRecipe!.components[0]); },
      (p) => { p.mediumRecipe!.components[0].stockIngredients[0].value = 0; },
      (p) => { p.mediumRecipe!.components[0].stockConfirmed = true; p.mediumRecipe!.components[0].stockIngredients = []; },
    ];
    for (const change of changes) { const p = plan(); change(p); expect(() => validateExecutionPlan(p)).toThrow(); }
  });
});
