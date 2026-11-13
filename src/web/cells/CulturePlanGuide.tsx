import { useState } from 'react';
import { Link } from 'wouter';
import type { ProfileDto } from '../../shared/cell-line';
import { PLAN_STAGE_LABELS, PLAN_STATUS_LABELS, mediumRecipe, type CultureExecutionPlan, type PlanStage } from '../../shared/culture-plan';
import { inputCls } from '../components/Dialog';
import type { MediumProductSnapshot } from '../../shared/lab-products';
import { productDetailText } from '../components/MediumProductPicker';
import { stageReadiness } from './culture-plan-state';

const groups = [
  ['bank_reply', '분양처 개별 답변'],
  ['bank_general', '분양처 일반 안내'],
  ['paper', '논문 보고'],
  ['lab', '실험실 결정'],
  ['manufacturer', '제품 정보'],
  ['unresolved', '미확정 · 조건부'],
  ['none', '근거 미등록'],
] as const;
export function PlanConditions({ plan, stage }: { plan: CultureExecutionPlan; stage?: PlanStage }) {
  const conditions = stage ? stageReadiness(plan, stage).conditions : plan.conditions;
  return (
    <div className="space-y-4">
      {groups.map(([kind, title]) => {
        const rows = conditions.filter((c) =>
          kind === 'unresolved'
            ? ['unresolved', 'conditional'].includes(c.status)
            : !['unresolved', 'conditional'].includes(c.status) &&
              (kind === 'none' ? c.sources.length === 0 : c.sources.some((s) => s.kind === kind)),
        );
        if (!rows.length) return null;
        return (
          <section key={kind}>
            <h4 className="mb-2 text-sm font-semibold">{title}</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-fg-muted">
                    <th className="p-2">조건</th>
                    <th className="p-2">값 · 상태</th>
                    <th className="p-2">출처와 적용 범위</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id} className="border-b border-line align-top">
                      <th className="p-2 font-medium">{c.label}</th>
                      <td className="p-2">
                        <p className="whitespace-pre-wrap">{c.value || '미정'}</p>
                        <span className={['conditional', 'unresolved'].includes(c.status) ? 'text-warning' : 'text-fg-muted'}>
                          {PLAN_STATUS_LABELS[c.status]}
                        </span>
                        {c.note && <p className="mt-1 whitespace-pre-wrap text-xs text-fg-muted">{c.note}</p>}
                      </td>
                      <td className="p-2">
                        {c.sources
                          .filter((s) => kind === 'unresolved' || kind === 'none' || s.kind === kind)
                          .map((s, i) => (
                            <details key={i} className="mb-2">
                              <summary className="cursor-pointer">{s.label}</summary>
                              <blockquote className="mt-2 whitespace-pre-wrap border-l-2 border-line pl-3">
                                {s.quote || '원문 문장 미등록'}
                              </blockquote>
                              {s.url && /^https?:\/\//i.test(s.url) && (
                                <a href={s.url} target="_blank" rel="noreferrer" className="text-accent">
                                  등록된 원문 열기
                                </a>
                              )}
                              {!s.url && <p className="text-xs text-fg-muted">원문 링크 미등록 · 제공된 보고의 범위에서 확인하세요.</p>}
                            </details>
                          ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      {conditions.length === 0 && <p className="text-sm text-warning">이 단계에 등록된 조건이 없습니다. 실험실 지침을 확인하세요.</p>}
    </div>
  );
}
function ProductLine({ product }: { product: MediumProductSnapshot }) {
  const detail = productDetailText(product);
  return (
    <p className="mt-1 text-xs text-fg-muted">
      {product.label}
      {detail && ` · ${detail}`}
    </p>
  );
}
export function MediumCalculator({ plan }: { plan: CultureExecutionPlan }) {
  const [volume, setVolume] = useState('100');
  const total = Number(volume);
  const recipe = plan.mediumRecipe && volume.trim() && Number.isFinite(total) && total > 0 ? mediumRecipe(plan, total) : null;
  if (!plan.mediumRecipe) return <p className="text-sm text-warning">조제 비율이 등록되지 않았습니다. 임의의 조성은 제안하지 않습니다.</p>;
  return (
    <section className="rounded-xl border border-line bg-raised p-4">
      <h3 className="mb-2 font-medium">완전 배지 조제 계산</h3>
      <label className="flex items-center gap-2 text-sm">
        총 부피{' '}
        <input
          aria-label="배지 총 부피 mL"
          className={`${inputCls} max-w-32`}
          type="number"
          min="0"
          step="any"
          value={volume}
          onChange={(e) => setVolume(e.target.value)}
        />{' '}
        mL
      </label>
      {recipe ? (
        <>
          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <p>
                {plan.mediumRecipe.baseLabel}
                <br />
                <strong>{Number(recipe.baseMl.toFixed(4))} mL</strong>
              </p>
              {plan.mediumRecipe.baseProduct && <ProductLine product={plan.mediumRecipe.baseProduct} />}
            </div>
            {recipe.components.map((component) => {
              const product = plan.mediumRecipe?.components.find((c) => c.id === component.id)?.product;
              return (
                <div key={component.id}>
                  <p>
                    {component.label} · {component.percent}%<br />
                    <strong>{Number(component.ml.toFixed(4))} mL</strong>
                  </p>
                  {product && <ProductLine product={product} />}
                  {component.finalIngredients ? (
                    component.finalIngredients.map((ingredient, i) => (
                      <p key={i} className="mt-1 text-xs">
                        최종 {ingredient.label}: {Number(ingredient.value.toPrecision(6))} {ingredient.unit}
                      </p>
                    ))
                  ) : (
                    <p className="mt-1 text-xs text-warning">
                      {product ? '제품 농도가 확인되지 않았습니다' : 'stock 농도 미확인 또는 성분 미등록'} · 최종 농도를 확정하지 않습니다.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-fg-muted">
            등록된 부피 비율만 계산합니다. 제품·stock 농도가 명시적으로 확인된 성분만 최종 농도를 표시합니다.
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-warning">0보다 큰 총 부피를 입력하세요.</p>
      )}
    </section>
  );
}
export function CulturePlanGuide({
  profile,
  stage,
  lineId,
  fallback = false,
}: {
  profile: ProfileDto | null;
  stage: PlanStage;
  lineId: string;
  fallback?: boolean;
}) {
  const plan = profile?.executionPlan;
  if (!plan)
    return (
      <aside className="mb-4 rounded-xl border border-line p-4 text-sm">
        <p>실행 계획 미등록 · 일반 SOP는 검증되지 않은 참고 자료이며 이 단계의 실행 지침을 대신하지 않습니다.</p>
        <Link className="text-accent" href={`/cells/${lineId}?tab=profiles`}>
          배양 조건과 실행 계획 설정
        </Link>
      </aside>
    );
  const state = stageReadiness(plan, stage);
  return (
    <section className="mb-4 space-y-3 rounded-xl border border-line bg-raised p-4">
      <div>
        <h3 className="font-semibold">{PLAN_STAGE_LABELS[stage]} · 실행 안내</h3>
        <p className="mt-1 text-xs text-fg-muted">
          사용 조건: {profile.name}
          {fallback ? ' · 연결된 조건이 없어 현재 활성 조건을 참고합니다.' : ''}
        </p>
      </div>
      {state.needsReview && (
        <aside role="alert" className="rounded-lg bg-warning-soft p-3 text-sm text-warning">
          실행 전 확인 필요 ·{' '}
          {state.unresolved.length ? `미확정/조건부 ${state.unresolved.length}개 항목이 있습니다.` : '실행 지침이 등록되지 않았습니다.'}{' '}
          아래 안내는 완전한 검증 SOP 또는 수행 기록이 아닙니다.
        </aside>
      )}
      <p className="whitespace-pre-wrap text-sm leading-relaxed">
        {state.instructions || '제공된 단계별 실행 지침이 없습니다. 분양처 원문과 실험실 SOP 확인 후 입력하세요.'}
      </p>
      <PlanConditions plan={plan} stage={stage} />
    </section>
  );
}
