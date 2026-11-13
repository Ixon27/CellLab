import { describe, expect, it } from 'vitest';
import type { ProfileDto } from '../src/shared/cell-line';
import type { CultureExecutionPlan } from '../src/shared/culture-plan';
import { executionProfile, stageReadiness } from '../src/web/cells/culture-plan-state';

function profile(id: string, isActive = false): ProfileDto {
  return { id, cellLineId: 'line', name: id, isActive, origin: 'manual', fields: {}, sourceRefs: [], createdAt: 'created', updatedAt: 'updated', executionPlan: null };
}
function plan(): CultureExecutionPlan {
  return { version: 1, summary: '', mediumRecipe: null, conditions: [
    { id: 'a', label: '항목 A', value: '입력값', status: 'decision', sources: [], note: '', stages: ['feed'] },
    { id: 'b', label: '항목 B', value: '', status: 'unresolved', sources: [], note: '', stages: ['passage'] },
  ], steps: { stock: { instructions: '', recordLabels: [] }, thaw: { instructions: '', recordLabels: [] }, feed: { instructions: '사용자가 입력한 지침', recordLabels: ['실제값'] }, passage: { instructions: '확인 후 수행', recordLabels: [] }, freeze: { instructions: '', recordLabels: [] } } };
}
describe('실행 계획의 사용 맥락', () => {
  it('진행 중인 배양은 비활성 조건이라도 연결된 프로필을 우선한다', () => {
    const linked = profile('linked');
    const active = profile('active', true);
    expect(executionProfile([active, linked], { profileId: linked.id })).toEqual({ profile: linked, fallback: false });
    expect(executionProfile([active], { profileId: 'deleted' })).toEqual({ profile: active, fallback: true });
    expect(executionProfile([], { profileId: null })).toEqual({ profile: null, fallback: true });
  });
  it('단계 관련 조건만 평가하며 조건부·미정과 빈 지침을 실행 전 검토로 구분한다', () => {
    const value = plan();
    expect(stageReadiness(value, 'feed').needsReview).toBe(false);
    expect(stageReadiness(value, 'passage').unresolved.map((c) => c.id)).toEqual(['b']);
    expect(stageReadiness(value, 'thaw').needsReview).toBe(true);
    value.conditions[0].status = 'conditional';
    expect(stageReadiness(value, 'feed').needsReview).toBe(true);
    value.conditions[0].status = 'confirmed';
    value.steps.feed.instructions = '';
    expect(stageReadiness(value, 'feed').needsReview).toBe(true);
  });
});
