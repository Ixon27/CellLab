import { PLAN_STAGE_LABELS, PLAN_STATUS_LABELS } from '../../shared/culture-plan';
import type { CultureExecutionPlan, PlanCondition, PlanSource, PlanStage, PlanStatus } from '../../shared/culture-plan';
import { btnCls, dangerBtnCls, inputCls } from '../components/Dialog';
import { MediumRecipeEditor } from './MediumRecipeEditor';

const stages = Object.keys(PLAN_STAGE_LABELS) as PlanStage[];
const sourceLabels: Record<PlanSource['kind'], string> = {
  bank_reply: '분양처 개별 답변',
  bank_general: '분양처 일반 지침',
  paper: '논문',
  lab: '실험실',
  manufacturer: '제조사',
};
function emptyPlan(): CultureExecutionPlan {
  return {
    version: 1,
    summary: '',
    conditions: [],
    steps: {
      stock: { instructions: '', recordLabels: [] },
      thaw: { instructions: '', recordLabels: [] },
      feed: { instructions: '', recordLabels: [] },
      passage: { instructions: '', recordLabels: [] },
      freeze: { instructions: '', recordLabels: [] },
    },
    mediumRecipe: null,
  };
}
export function ExecutionPlanEditor({
  value,
  onChange,
}: {
  value: CultureExecutionPlan | null;
  onChange(value: CultureExecutionPlan | null): void;
}) {
  const plan = value;
  function condition(index: number, patch: Partial<PlanCondition>) {
    if (plan) onChange({ ...plan, conditions: plan.conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)) });
  }
  function source(index: number, si: number, patch: Partial<PlanSource>) {
    if (plan) condition(index, { sources: plan.conditions[index].sources.map((s, i) => (i === si ? { ...s, ...patch } : s)) });
  }
  return (
    <section className="grid gap-3 rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">실행 조건 · 근거 · 단계별 기록</h3>
        {!plan ? (
          <button className={btnCls} onClick={() => onChange(emptyPlan())}>
            실행 계획 작성
          </button>
        ) : (
          <button className={dangerBtnCls} onClick={() => onChange(null)}>
            실행 계획 제거
          </button>
        )}
      </div>
      <p className="text-sm text-fg-muted">
        기본 비교 항목과 별도로 같은 조건 세트에 저장됩니다. 확인되지 않은 절차나 수치는 빈칸으로 두고, 근거의 범위와 실험실 결정을
        구분하세요. 제거·수정은 아래 저장 버튼으로 반영됩니다.
      </p>
      {plan && (
        <>
          <label className="grid gap-1 text-sm">
            운영 요약
            <textarea
              className={inputCls}
              rows={3}
              maxLength={10000}
              value={plan.summary}
              onChange={(e) => onChange({ ...plan, summary: e.target.value })}
            />
          </label>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="p-2">현재 조건</th>
                  <th className="p-2">판단·적용 단계</th>
                  <th className="p-2">출처와 근거</th>
                </tr>
              </thead>
              <tbody>
                {plan.conditions.map((c) => (
                  <tr key={c.id} className="border-b border-line align-top">
                    <td className="p-2">
                      <div className="font-medium">{c.label}</div>
                      <div className="whitespace-pre-wrap">{c.value || '미정'}</div>
                      {c.note && <p className="mt-1 text-xs text-fg-muted whitespace-pre-wrap">{c.note}</p>}
                    </td>
                    <td className="p-2">
                      {PLAN_STATUS_LABELS[c.status]}
                      <div className="mt-1 text-xs text-fg-muted">
                        {c.stages.map((s) => PLAN_STAGE_LABELS[s]).join(' · ') || '적용 단계 미지정'}
                      </div>
                    </td>
                    <td className="p-2">
                      {c.sources.length ? (
                        c.sources.map((s, i) => (
                          <div key={i} className="mb-2">
                            <div>
                              {sourceLabels[s.kind]} ·{' '}
                              {s.url ? (
                                <a href={s.url} target="_blank" rel="noreferrer" className="text-accent underline">
                                  {s.label}
                                </a>
                              ) : (
                                s.label
                              )}
                            </div>
                            <blockquote className="whitespace-pre-wrap text-xs text-fg-muted">{s.quote || '근거 문장 미입력'}</blockquote>
                          </div>
                        ))
                      ) : (
                        <span className="text-fg-muted">출처 미입력</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!plan.conditions.length && <p className="p-3 text-sm text-fg-muted">등록된 실행 조건이 없습니다.</p>}
          </div>
          <details className="rounded-lg border border-line p-3">
            <summary className="cursor-pointer font-medium text-sm">조건·출처 편집</summary>
            <div className="mt-4 grid gap-4">
              {plan.conditions.map((c, index) => (
                <fieldset key={c.id} className="grid gap-3 rounded-lg bg-sunken p-3">
                  <legend className="text-sm font-medium">조건 {index + 1}</legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1 text-sm">
                      항목 이름
                      <input
                        className={inputCls}
                        maxLength={300}
                        value={c.label}
                        onChange={(e) => condition(index, { label: e.target.value })}
                      />
                    </label>
                    <label className="grid gap-1 text-sm">
                      현재 값
                      <input
                        className={inputCls}
                        maxLength={3000}
                        value={c.value}
                        onChange={(e) => condition(index, { value: e.target.value })}
                      />
                    </label>
                  </div>
                  <label className="grid gap-1 text-sm">
                    판단 상태
                    <select
                      className={inputCls}
                      value={c.status}
                      onChange={(e) => condition(index, { status: e.target.value as PlanStatus })}
                    >
                      {Object.entries(PLAN_STATUS_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex flex-wrap gap-3 text-sm">
                    {stages.map((stage) => (
                      <label key={stage} className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={c.stages.includes(stage)}
                          onChange={(e) =>
                            condition(index, { stages: e.target.checked ? [...c.stages, stage] : c.stages.filter((s) => s !== stage) })
                          }
                        />
                        {PLAN_STAGE_LABELS[stage]}
                      </label>
                    ))}
                  </div>
                  <label className="grid gap-1 text-sm">
                    판단 이유·주의 사항
                    <textarea
                      className={inputCls}
                      maxLength={5000}
                      value={c.note}
                      onChange={(e) => condition(index, { note: e.target.value })}
                    />
                  </label>
                  {c.sources.map((s, si) => (
                    <fieldset key={si} className="grid gap-2 rounded-lg border border-line p-3">
                      <legend className="text-xs">출처 {si + 1}</legend>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="grid gap-1 text-xs">
                          종류
                          <select
                            className={inputCls}
                            value={s.kind}
                            onChange={(e) => source(index, si, { kind: e.target.value as PlanSource['kind'] })}
                          >
                            {Object.entries(sourceLabels).map(([key, label]) => (
                              <option key={key} value={key}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="grid gap-1 text-xs">
                          출처 이름
                          <input
                            className={inputCls}
                            maxLength={300}
                            value={s.label}
                            onChange={(e) => source(index, si, { label: e.target.value })}
                          />
                        </label>
                      </div>
                      <label className="grid gap-1 text-xs">
                        원문 또는 사용자 제공 보고 (직접 확인 여부 명시)
                        <textarea
                          className={inputCls}
                          maxLength={10000}
                          value={s.quote}
                          onChange={(e) => source(index, si, { quote: e.target.value })}
                        />
                      </label>
                      <label className="grid gap-1 text-xs">
                        원문 URL (선택)
                        <input
                          className={inputCls}
                          type="url"
                          value={s.url ?? ''}
                          onChange={(e) => source(index, si, { url: e.target.value || null })}
                        />
                      </label>
                      <button className={dangerBtnCls} onClick={() => condition(index, { sources: c.sources.filter((_, i) => i !== si) })}>
                        출처 제거
                      </button>
                    </fieldset>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    <button
                      className={btnCls}
                      disabled={c.sources.length >= 30}
                      onClick={() => condition(index, { sources: [...c.sources, { kind: 'lab', label: '', quote: '', url: null }] })}
                    >
                      출처 추가
                    </button>
                    <button
                      className={dangerBtnCls}
                      onClick={() => onChange({ ...plan, conditions: plan.conditions.filter((_, i) => i !== index) })}
                    >
                      조건 제거
                    </button>
                  </div>
                </fieldset>
              ))}
              <button
                className={btnCls}
                disabled={plan.conditions.length >= 100}
                onClick={() =>
                  onChange({
                    ...plan,
                    conditions: [
                      ...plan.conditions,
                      { id: crypto.randomUUID(), label: '', value: '', status: 'unresolved', sources: [], note: '', stages: [] },
                    ],
                  })
                }
              >
                조건 추가
              </button>
            </div>
          </details>
          <details className="rounded-lg border border-line p-3">
            <summary className="cursor-pointer font-medium text-sm">단계별 지침·기록 항목 편집</summary>
            <div className="mt-4 grid gap-4">
              {stages.map((stage) => (
                <fieldset key={stage} className="grid gap-2">
                  <legend className="font-medium text-sm">{PLAN_STAGE_LABELS[stage]}</legend>
                  <label className="grid gap-1 text-sm">
                    확인된 지침
                    <textarea
                      className={inputCls}
                      rows={4}
                      maxLength={20000}
                      value={plan.steps[stage].instructions}
                      onChange={(e) =>
                        onChange({ ...plan, steps: { ...plan.steps, [stage]: { ...plan.steps[stage], instructions: e.target.value } } })
                      }
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    실행 시 기록할 항목 (한 줄에 하나)
                    <textarea
                      className={inputCls}
                      rows={3}
                      value={plan.steps[stage].recordLabels.join('\n')}
                      onChange={(e) =>
                        onChange({
                          ...plan,
                          steps: { ...plan.steps, [stage]: { ...plan.steps[stage], recordLabels: e.target.value.split('\n') } },
                        })
                      }
                    />
                  </label>
                </fieldset>
              ))}
            </div>
          </details>
          <details className="rounded-lg border border-line p-3">
            <summary className="cursor-pointer font-medium text-sm">배지 조제 계산 설정</summary>
            <div className="mt-4 grid gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!plan.mediumRecipe}
                  onChange={(e) => onChange({ ...plan, mediumRecipe: e.target.checked ? { baseLabel: '', components: [] } : null })}
                />
                배지 조제 계산 사용
              </label>
              <MediumRecipeEditor recipe={plan.mediumRecipe} onChange={(mediumRecipe) => onChange({ ...plan, mediumRecipe })} />
            </div>
          </details>
        </>
      )}
    </section>
  );
}
