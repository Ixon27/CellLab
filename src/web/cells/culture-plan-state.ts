import type { CultureDto, ProfileDto } from '../../shared/cell-line';
import type { CultureExecutionPlan, PlanStage } from '../../shared/culture-plan';
import { CONDITION_SNAPSHOT_HEADING, PLAN_STAGE_LABELS, PLAN_STATUS_LABELS } from '../../shared/culture-plan';

export function executionProfile(profiles: ProfileDto[], culture?: Pick<CultureDto, 'profileId'>) {
  const linked = culture?.profileId ? profiles.find((p) => p.id === culture.profileId) : undefined;
  return { profile: linked ?? profiles.find((p) => p.isActive) ?? null, fallback: !!culture && !linked };
}
export function stageReadiness(plan: CultureExecutionPlan, stage: PlanStage) {
  const conditions = plan.conditions.filter((c) => c.stages.includes(stage));
  const unresolved = conditions.filter((c) => c.status === 'unresolved' || c.status === 'conditional');
  return { conditions, unresolved, instructions: plan.steps[stage].instructions, needsReview: unresolved.length > 0 || conditions.length === 0 || !plan.steps[stage].instructions.trim() };
}
export function executionSnapshot(profile: ProfileDto | null, stage: PlanStage): string {
  if (!profile?.executionPlan) return '';
  const plan = profile.executionPlan;
  const lines = [
    '',
    CONDITION_SNAPSHOT_HEADING,
    `조건 세트: ${profile.name} (${profile.id})`,
    `조건 수정 시각: ${profile.updatedAt}`,
    `작업: ${PLAN_STAGE_LABELS[stage]}`,
    `등록 지침: ${plan.steps[stage].instructions || '미등록'}`,
  ];
  for (const condition of plan.conditions.filter((c) => c.stages.includes(stage))) {
    lines.push(`${condition.label}: ${condition.value || '미정'} · ${PLAN_STATUS_LABELS[condition.status]}`);
    if (condition.note) lines.push(`  확인 사항: ${condition.note}`);
    for (const source of condition.sources) lines.push(`  근거: ${source.label}${source.url ? ` · ${source.url}` : ''}`);
  }
  if (plan.mediumRecipe) {
    lines.push(`배지 구성: ${plan.mediumRecipe.baseLabel}`);
    const baseProduct = plan.mediumRecipe.baseProduct;
    if (baseProduct) {
      lines.push(`  기본배지 제품: ${baseProduct.manufacturer || '제조사 미등록'} · ${baseProduct.catalogNo ? `Cat. ${baseProduct.catalogNo}` : '제품번호 미등록'}${baseProduct.lotNo ? ` · Lot ${baseProduct.lotNo}` : ''}`);
      if (baseProduct.sourceLabel) lines.push(`  제품 근거: ${baseProduct.sourceLabel}${baseProduct.url ? ` · ${baseProduct.url}` : ''}`);
    }
    for (const component of plan.mediumRecipe.components) {
      lines.push(`  ${component.label}: ${component.percent}% · stock ${component.stockConfirmed ? '확인' : '미확인'}`);
      if (component.product) {
        const product = component.product;
        lines.push(`    제품: ${product.manufacturer || '제조사 미등록'} · ${product.catalogNo ? `Cat. ${product.catalogNo}` : '제품번호 미등록'}${product.lotNo ? ` · Lot ${product.lotNo}` : ''}`);
        if (product.sourceLabel) lines.push(`    제품 근거: ${product.sourceLabel}${product.url ? ` · ${product.url}` : ''}`);
      }
      for (const ingredient of component.stockIngredients) {
        lines.push(`    원액 ${ingredient.label}: ${ingredient.value} ${ingredient.unit}`);
      }
    }
  }
  return `\n${lines.join('\n')}`;
}
