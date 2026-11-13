import { useState } from 'react';
import { Link } from 'wouter';
import type { CellLineDetailDto } from '../../shared/cell-line';
import { PLAN_STAGE_LABELS, type PlanStage } from '../../shared/culture-plan';
import { btnCls, inputCls, primaryBtnCls } from '../components/Dialog';
import { CulturePlanGuide, MediumCalculator, PlanConditions } from './CulturePlanGuide';
import { executionProfile } from './culture-plan-state';
import { LineageView } from './LineageView';
import { FreezeDialog, LogDialog, PassageDialog, ReceiveLotDialog, ThawDialog } from './dialogs/CultureDialogs';

export function CultureWorkbench({ detail, onChanged }: { detail: CellLineDetailDto; onChanged(): void }) {
  const [stage, setStage] = useState<PlanStage>('stock');
  const [target, setTarget] = useState('');
  const [lineageNode, setLineageNode] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [revision, setRevision] = useState(0);
  const active = detail.profiles.find((p) => p.isActive) ?? null;
  const culture = detail.cultures.find((c) => c.id === target);
  const lot = detail.lots.find((l) => l.id === target);
  const selected = executionProfile(detail.profiles, ['feed', 'passage', 'freeze'].includes(stage) ? culture : undefined);
  const profile = selected.profile;
  const allowed = stage === 'stock' || (stage === 'thaw' ? !!lot && lot.vialsRemaining > 0 : !!culture && culture.status === 'active');
  const props = {
    line: detail.line,
    profiles: detail.profiles,
    culture: stage === 'stock' || stage === 'thaw' ? undefined : culture,
    lot,
    onSaved: () => {
      setRevision((value) => value + 1);
      onChanged();
    },
    onClose: () => setRecording(false),
  };
  return (
    <div className="space-y-5">
      <section className="workbench-panel space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="workbench-eyebrow">조건에서 실제 작업으로</p>
            <h2 className="text-xl font-semibold">실행 안내</h2>
            <p className="mt-1 text-sm text-fg-muted">활성 조건: {active?.name ?? '없음'} · 안내와 실제 수행 기록은 별도로 관리합니다.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className={btnCls} href={`/cells/${detail.line.id}?tab=profiles${profile ? `&profile=${profile.id}` : ''}`}>
              조건·근거 편집
            </Link>
            <Link className={btnCls} href={`/cells/${detail.line.id}?tab=literature`}>
              문헌·분양처 비교
            </Link>
          </div>
        </header>
        {active?.executionPlan ? (
          <>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{active.executionPlan.summary}</p>
            <MediumCalculator plan={active.executionPlan} />
            <h3 className="font-semibold">전체 조건과 판단 근거</h3>
            <p className="text-xs text-fg-muted">
              출처별 근거와 실험실 결정을 구분합니다. 상태는 입력한 판단이며 독립적인 원문 검증을 뜻하지 않습니다. 여러 출처가 있는 조건은
              각 그룹에 표시합니다.
            </p>
            <PlanConditions plan={active.executionPlan} />
          </>
        ) : (
          <p className="text-sm text-warning">
            활성 실행 계획이 없습니다. 조건·근거 편집에서 세포주별 계획을 작성하세요. 일반 SOP만으로 미정인 실험 조건을 채우지 않습니다.
          </p>
        )}
      </section>
      <section className="workbench-panel space-y-4">
        <nav aria-label="실행 단계" className="flex flex-wrap gap-2">
          {(Object.keys(PLAN_STAGE_LABELS) as PlanStage[]).map((s) => (
            <button
              key={s}
              className={stage === s ? primaryBtnCls : btnCls}
              aria-pressed={stage === s}
              onClick={() => {
                setStage(s);
                setRecording(false);
              }}
            >
              {PLAN_STAGE_LABELS[s]}
            </button>
          ))}
        </nav>
        {stage !== 'stock' && (
          <label className="block text-sm">
            {stage === 'thaw' ? '해동할 stock' : '작업할 활성 배양'}
            <select className={`${inputCls} mt-1`} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">대상을 선택하세요</option>
              {stage === 'thaw'
                ? detail.lots
                    .filter((l) => l.vialsRemaining > 0)
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.label} · {l.vialsRemaining} vial
                      </option>
                    ))
                : detail.cultures
                    .filter((c) => c.status === 'active')
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label} · P{c.passage}
                      </option>
                    ))}
            </select>
          </label>
        )}
        <CulturePlanGuide profile={profile} fallback={selected.fallback} stage={stage} lineId={detail.line.id} />
        <button className={primaryBtnCls} disabled={!allowed} onClick={() => setRecording(true)}>
          {PLAN_STAGE_LABELS[stage]} · 실제 작업 기록
        </button>
        <p className="text-xs text-fg-muted">
          기록 창을 열거나 안내를 읽는 것만으로 재고·관찰값은 생성되지 않습니다. 실제 수행한 내용만 저장하세요.
        </p>
      </section>
      <LineageView line={detail.line} focusNodeId={lineageNode} onSelectNode={setLineageNode} onChanged={onChanged} externalRevision={revision} />
      {recording && stage === 'stock' && <ReceiveLotDialog {...props} />}
      {recording && stage === 'thaw' && allowed && <ThawDialog {...props} />}
      {recording && stage === 'feed' && allowed && <LogDialog {...props} logType="medium_change" />}
      {recording && stage === 'passage' && allowed && <PassageDialog {...props} />}
      {recording && stage === 'freeze' && allowed && <FreezeDialog {...props} />}
    </div>
  );
}
