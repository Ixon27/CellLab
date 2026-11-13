import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import type { CellLineDto, ProfileDto } from '../../shared/cell-line';
import { CULTURE_FIELDS } from '../../shared/culture';
import { SourceRefDetails } from './SourceRefDetails';
import type { FilledSop } from '../../shared/sop';
import { api } from '../api';
import { btnCls, Dialog, Field, inputCls, primaryBtnCls } from '../components/Dialog';
import { Markdown } from '../components/Markdown';
import { ProtocolOrigin } from '../components/ProtocolPreview';
import { useCopy, useToast } from '../components/Toast';
import type { ProtocolDocument, ProtocolSummary } from '../pages/Protocols';
import { CulturePlanGuide, MediumCalculator } from './CulturePlanGuide';
import { PLAN_STAGE_LABELS, type PlanStage } from '../../shared/culture-plan';

const ORIGIN_LABELS = { manual: '수동 입력', literature: '문헌에서 추출', provider: '분양처에서 추출' };
const SCOPE_LABELS = { general: '일반 골격', cell_specific: '이 세포주용 사본', shared: '공유 템플릿', unselected: '템플릿 미선택' };

export function SopPanel({ line, profiles, onChanged }: { line: CellLineDto; profiles: ProfileDto[]; onChanged(): void }) {
  const [stage, setStage] = useState<PlanStage>('stock');
  const execution = profiles.find((profile) => profile.isActive) ?? null;
  const [sop, setSop] = useState<FilledSop | null>(null);
  const [templates, setTemplates] = useState<ProtocolSummary[]>([]);
  const [changing, setChanging] = useState(false);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [, navigate] = useLocation();
  const copy = useCopy();
  const toast = useToast();
  const load = useCallback(async () => {
    setError('');
    try {
      const [next, options] = await Promise.all([
        api<FilledSop>(`/api/cell-lines/${line.id}/sop`),
        api<ProtocolSummary[]>('/api/protocols?category=culture_sop'),
      ]);
      setSop(next);
      setTemplates(options);
      setSelected(next.protocolId ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : '배양 SOP를 불러오지 못했습니다');
    }
  }, [line.id, line.sopProtocolId, line.updatedAt]);
  useEffect(() => {
    void load();
  }, [load]);

  async function changeTemplate() {
    setBusy(true);
    try {
      await api(`/api/cell-lines/${line.id}`, { method: 'PUT', json: { sopProtocolId: selected || null } });
      setChanging(false);
      onChanged();
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : '템플릿을 바꾸지 못했습니다', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function createCopy() {
    if (!sop?.protocolId) return;
    setBusy(true);
    try {
      const doc = await api<ProtocolDocument>(`/api/cell-lines/${line.id}/sop/copy`, {
        method: 'POST',
        json: { protocolId: sop.protocolId },
      });
      onChanged();
      navigate(`/protocols/${doc.id}?edit=1`);
    } catch (e) {
      toast(e instanceof Error ? e.message : '세포주용 사본을 만들지 못했습니다', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const profile = sop?.profile;
  const filledFields = CULTURE_FIELDS.filter((field) => {
    const value = profile?.fields[field.key];
    return (
      field.inProfile && value !== null && value !== undefined && (Array.isArray(value) ? value.length > 0 : String(value).trim() !== '')
    );
  });
  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">등록된 실행 계획</h2>
        <Link className={btnCls} href={`/cells/${line.id}?tab=execution`}>
          실행·기록 작업 공간
        </Link>
      </header>
      <nav aria-label="SOP 실행 단계" className="flex flex-wrap gap-2">
        {(Object.keys(PLAN_STAGE_LABELS) as PlanStage[]).map((s) => (
          <button key={s} className={s === stage ? primaryBtnCls : btnCls} aria-pressed={s === stage} onClick={() => setStage(s)}>
            {PLAN_STAGE_LABELS[s]}
          </button>
        ))}
      </nav>
      <CulturePlanGuide profile={execution} stage={stage} lineId={line.id} />
      {execution?.executionPlan && <MediumCalculator plan={execution.executionPlan} />}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}{' '}
          <button className={btnCls} onClick={() => void load()}>
            참고 템플릿 다시 불러오기
          </button>
        </p>
      )}
      {!sop && !error && <p className="text-sm text-fg-muted">참고 템플릿을 불러오는 중…</p>}
      {sop && (
        <details className="rounded-xl border border-line p-4">
          <summary className="cursor-pointer text-sm font-medium">템플릿 참고 자료 · 실행 계획과 별개 / 일반 골격은 미검증</summary>
          <div className="mt-4 space-y-4">
            <header className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-fg">{sop.title}</h2>
                <p className="mt-1 text-xs text-fg-muted">
                  {SCOPE_LABELS[sop.scope]} · {sop.templateStatus === 'confirmed' ? '사용자가 확정한 템플릿' : '검토 전 초안'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className={btnCls} disabled={busy} onClick={() => setChanging(true)}>
                  템플릿 선택
                </button>
                {sop.scope === 'cell_specific' && sop.protocolId ? (
                  <Link className={btnCls} href={`/protocols/${sop.protocolId}?edit=1`}>
                    이 세포주용 사본 편집
                  </Link>
                ) : (
                  <button className={btnCls} disabled={busy || !sop.protocolId} onClick={() => void createCopy()}>
                    세포주용 사본 만들고 편집
                  </button>
                )}
                <button className={btnCls} disabled={!sop.markdown} onClick={() => copy(sop.markdown)}>
                  마크다운 복사
                </button>
              </div>
            </header>
            <div className="rounded-xl border border-line bg-raised p-4 text-sm leading-relaxed text-fg-muted">
              <p>Cellosaurus는 세포주 정체성·분양처 정보를 제공하지만 배지·배양 조건이나 세포주별 SOP를 제공하지 않습니다.</p>
              <p className="mt-1">
                이 화면은 선택한 템플릿에 활성 조건값을 표시합니다. 분양처·문헌 근거와 실제 실험실 지침을 확인해야 하며, 값 입력만으로
                절차가 검증되지는 않습니다.
              </p>
            </div>
            {sop.provenance && <ProtocolOrigin protocol={{ id: sop.protocolId ?? undefined, provenance: sop.provenance }} />}
            {sop.warnings.length > 0 && (
              <aside role="alert" className="rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm text-warning">
                <p className="font-medium">
                  {sop.readiness === 'no_profile' || sop.readiness === 'template_required' ? 'SOP 준비 안 됨' : '실험 전 검토 필요'}
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {sop.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </aside>
            )}
            {sop.readiness === 'confirmed' && (
              <p className="text-sm text-fg-muted">
                이 세포주용 사본을 사용자가 확정했고 템플릿의 미설정 변수가 없습니다. 외부 검증 또는 조건별 실험 적합성 보증을 뜻하지
                않습니다.
              </p>
            )}
            <section className="rounded-xl border border-line bg-raised p-4">
              <h3 className="text-sm font-medium text-fg">조건값과 근거</h3>
              {profile ? (
                <>
                  <p className="mt-1 text-sm text-fg-muted">
                    활성 조건: {profile.name} · {ORIGIN_LABELS[profile.origin]}
                  </p>
                  <p className="mt-1 text-xs text-fg-muted">
                    아래 근거는 조건값의 출처입니다. 템플릿의 모든 절차를 검증하는 근거가 아닙니다.
                  </p>
                  <div className="mt-3 space-y-3">
                    {filledFields.length === 0 && <p className="text-sm text-warning">활성 조건에 입력된 배양값이 없습니다.</p>}
                    {filledFields.map((field) => {
                      const value = profile.fields[field.key];
                      const refs = profile.sourceRefs.filter((ref) => ref.field === field.key);
                      return (
                        <div key={field.key} className="border-t border-line pt-3 text-sm">
                          <p className="font-medium text-fg">
                            {field.label}: {Array.isArray(value) ? value.join(', ') : String(value)}
                            {field.unit ? ` ${field.unit}` : ''}
                          </p>
                          {refs.length === 0 ? (
                            <p className="mt-1 text-xs text-fg-muted">외부 근거 미등록 · 입력값을 실험실 지침과 확인하세요.</p>
                          ) : (
                            refs.map((ref, index) => <SourceRefDetails key={`${ref.sourceLabel}-${index}`} sourceRef={ref} />)
                          )}
                        </div>
                      );
                    })}
                    {profile.sourceRefs.some((ref) => ref.usage === 'explicit_not_used' && !filledFields.some((f) => f.key === ref.field)) && (
                      <div className="border-t border-line pt-3 text-sm">
                        <p className="font-medium text-fg">원문이 사용하지 않았다고 명시한 항목</p>
                        {profile.sourceRefs
                          .filter((ref) => ref.usage === 'explicit_not_used' && !filledFields.some((f) => f.key === ref.field))
                          .map((ref, index) => (
                            <div key={`${ref.field}-${index}`} className="mt-1">
                              <p className="text-fg">{CULTURE_FIELDS.find((f) => f.key === ref.field)?.label}</p>
                              <SourceRefDetails sourceRef={ref} />
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <p className="mt-2 text-sm text-warning">
                  활성 배양 조건 없음 · 배양 조건 탭에서 조건 세트를 활성화하세요. 아래는 조건 미적용 골격입니다.
                </p>
              )}
              {sop.missingFields.length > 0 && (
                <p className="mt-3 text-sm text-warning">템플릿 미설정 항목: {sop.missingFields.map((field) => field.label).join(', ')}</p>
              )}
            </section>
            {sop.markdown && (
              <article className="min-w-0 rounded-xl border border-line bg-raised p-6">
                <Markdown text={sop.markdown} />
              </article>
            )}
          </div>
        </details>
      )}
      {changing && (
        <Dialog
          title="배양 SOP 템플릿 선택"
          onClose={() => setChanging(false)}
          dismissible={!busy}
          footer={
            <button className={primaryBtnCls} disabled={busy} onClick={() => void changeTemplate()}>
              선택 저장
            </button>
          }
        >
          <p className="mb-4 text-sm leading-relaxed text-fg-muted">
            선택은 원본을 연결할 뿐 검증을 뜻하지 않습니다. 한 세포주의 절차만 수정할 때는 전용 사본을 만드세요.
          </p>
          <Field label="템플릿">
            <select className={inputCls} value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">{line.growthMode === 'mixed' ? '자동 선택 안 함 (혼합 배양)' : '배양 방식의 일반 골격 (미검증)'}</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} · {t.status === 'draft' ? '초안' : '사용자 확정'}
                </option>
              ))}
            </select>
          </Field>
        </Dialog>
      )}
    </section>
  );
}
