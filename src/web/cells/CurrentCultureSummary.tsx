import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'wouter';
import type { CellLineDetailDto } from '../../shared/cell-line';
import { PLAN_STAGE_LABELS } from '../../shared/culture-plan';
import { SPEC_STATUS_LABELS, SURFACE_LABELS } from '../../shared/lab-products';
import { api } from '../api';
import { inputCls } from '../components/Dialog';
import {
  CONDITION_STATUS_LABELS,
  buildCurrentCultureView,
  productNumbers,
  sourceBadgeText,
} from './current-culture-state';
import type { SourceBadge, SummaryLog, ValueRow } from './current-culture-state';

/** Journal of the one selected culture. `loaded` = at least one successful response; `failed` = the latest request failed. */
interface Journal {
  cultureId: string;
  logs: SummaryLog[];
  loaded: boolean;
  failed: boolean;
}

const storageKey = (lineId: string) => `cell-lab:current-culture:${lineId}`;
function readStored(lineId: string): string | null {
  try {
    return window.sessionStorage.getItem(storageKey(lineId));
  } catch {
    return null;
  }
}
function writeStored(lineId: string, cultureId: string) {
  try {
    window.sessionStorage.setItem(storageKey(lineId), cultureId);
  } catch {
    // selection simply is not remembered
  }
}
const dateTime = (at: string) =>
  new Date(at).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const dateOnly = (at: string) => new Date(at).toLocaleDateString('ko-KR');
const ml = (v: number) => `${Number(v.toFixed(3))} mL`;

function useNow(everyMs = 60000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(timer);
  }, [everyMs]);
  return now;
}

function Sources({ badges }: { badges: SourceBadge[] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
      {badges.map((b) => (
        <span key={b.kind} className="inline-flex min-w-0 items-center gap-1">
          <span
            data-source-kind={b.kind}
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] leading-4 ${
              b.kind === 'unknown' ? 'bg-warning-soft text-warning' : 'bg-sunken text-fg-muted shadow-[inset_0_0_0_1px_var(--pr-line)]'
            }`}
          >
            {sourceBadgeText(b)}
          </span>
          {b.labels.length > 0 && <span className="min-w-0 break-words text-[11px] text-fg-dim">{b.labels.join(' · ')}</span>}
        </span>
      ))}
    </span>
  );
}
function Item({ title, wide, children }: { title: string; wide?: boolean; children: ReactNode }) {
  return (
    <section className={`min-w-0 space-y-1.5 rounded-lg bg-raised p-3 ${wide ? 'sm:col-span-2' : ''}`}>
      <h3 className="text-[11px] font-semibold tracking-wide text-fg-dim">{title}</h3>
      {children}
    </section>
  );
}
function Env({ row }: { row: ValueRow }) {
  return (
    <div className="space-y-0.5">
      <p className="text-sm">
        <span className="text-fg-muted">{row.label} </span>
        {row.value ? <strong className="font-semibold tabular-nums">{row.value}</strong> : <span className="text-warning">미등록</span>}
        {row.via && <span className="text-[11px] text-fg-dim"> · {row.via}</span>}
      </p>
      <Sources badges={row.sources} />
    </div>
  );
}

export function CurrentCultureSummary({ detail }: { detail: CellLineDetailDto }) {
  const lineId = detail.line.id;
  const [requested, setRequested] = useState<string | null>(() => readStored(lineId));
  const [journal, setJournal] = useState<Journal | null>(null);
  const now = useNow();
  const r = useMemo(
    () =>
      buildCurrentCultureView({
        line: detail.line,
        profiles: detail.profiles,
        cultures: detail.cultures,
        logs: journal?.logs ?? [],
        requestedCultureId: requested,
        now,
      }),
    [detail, journal, requested, now],
  );
  const { culture, profile, vessel } = r;
  const cultureId = culture?.id ?? null;
  // One journal request for the one selected culture; reloaded whenever the parent reloads the line (any record saved).
  useEffect(() => {
    if (!cultureId) {
      setJournal(null);
      return;
    }
    let alive = true;
    setJournal((prev) => (prev?.cultureId === cultureId ? prev : { cultureId, logs: [], loaded: false, failed: false }));
    api<SummaryLog[]>(`/api/cell-lines/${lineId}/logs?cultureId=${encodeURIComponent(cultureId)}`)
      .then((logs) => alive && setJournal({ cultureId, logs, loaded: true, failed: false }))
      .catch(() => alive && setJournal((prev) => (prev?.cultureId === cultureId ? { ...prev, failed: true } : prev)));
    return () => {
      alive = false;
    };
  }, [lineId, cultureId, detail]);

  // A journal that is not loaded is never presented as "no record".
  const current = journal && journal.cultureId === cultureId ? journal : null;
  const pending = (empty: ReactNode) =>
    current?.loaded ? empty : <span className="text-fg-muted">{current?.failed ? '기록을 불러오지 못했습니다' : '기록을 불러오는 중'}</span>;
  const basis = {
    linked: '선택한 배양에 연결된 조건',
    active_fallback: '이 배양에 연결된 조건이 없어 현재 활성 조건으로 대체',
    active_no_culture: '배양을 선택하지 않아 현재 활성 조건 기준',
    none: '',
  }[r.profileBasis];

  function choose(id: string) {
    setRequested(id || null);
    if (id) writeStored(lineId, id);
  }

  return (
    <section className="workbench-panel space-y-3 p-4" aria-label="현재 배양 요약" data-testid="current-culture-summary">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="workbench-eyebrow">현재 배양 요약</p>
          <p className="mt-0.5 text-xs text-fg-muted">
            {profile ? (
              <>
                조건 세트{' '}
                <Link className="text-accent" href={`/cells/${lineId}?tab=profiles&profile=${profile.id}`}>
                  {profile.name}
                </Link>
                {basis && ` · ${basis}`}
              </>
            ) : (
              '등록된 배양 조건 세트가 없습니다.'
            )}
          </p>
        </div>
        {r.choices.length > 0 && (
          <label className="block text-xs text-fg-muted">
            요약할 활성 배양
            <select className={`${inputCls} mt-1 min-w-52`} value={culture?.id ?? ''} onChange={(e) => choose(e.target.value)} aria-label="요약할 활성 배양">
              {r.choice === 'needs_choice' && <option value="">배양을 선택하세요</option>}
              {r.choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} · P{c.passage}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>
      {r.choice === 'none_active' && <p className="text-xs text-fg-muted">활성 배양 없음 · 조건 세트에 등록된 값만 표시합니다.</p>}
      {r.choice === 'needs_choice' && (
        <p className="text-xs text-fg-muted">활성 배양 {r.choices.length}개 · 배양을 고르면 그 배양의 기록만 표시합니다.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {culture && (
          <>
            <Item title="배양 용기">
              {vessel?.recorded ? (
                <div className="space-y-0.5 text-sm">
                  <p className="font-medium">{vessel.label}</p>
                  <p>
                    {vessel.wellsPerUnit && vessel.wellsPerUnit > 1 ? '사용 well' : '용기'} <strong className="tabular-nums">{vessel.usedWells}</strong>
                    {vessel.wellsPerUnit && vessel.wellsPerUnit > 1 ? ` (plate당 ${vessel.wellsPerUnit} well)` : '개'} · 기록 기준 배지량{' '}
                    {vessel.mediumMl !== null ? <strong className="tabular-nums">{ml(vessel.mediumMl)}</strong> : <span className="text-warning">부피 미기록</span>}
                  </p>
                  {vessel.areaCm2 !== null && <p className="text-xs text-fg-muted">사용 면적 {vessel.areaCm2} cm²</p>}
                  {vessel.specMediumMlPerWell && (
                    <p className="text-xs text-fg-muted">
                      제품 사양의 well당 배지량 {vessel.specMediumMlPerWell.min ?? '?'}–{vessel.specMediumMlPerWell.max ?? '?'} mL
                    </p>
                  )}
                  <p className="text-xs text-fg-dim">
                    {[vessel.productNumbers, vessel.specStatus && SPEC_STATUS_LABELS[vessel.specStatus], vessel.surfaceTreatment && SURFACE_LABELS[vessel.surfaceTreatment]]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
              ) : (
                <div className="space-y-0.5 text-sm">
                  <p className="font-medium">{vessel?.label ?? culture.vessel}</p>
                  <p className="text-xs text-fg-muted">사용 well 수·배지 부피 미기록</p>
                </div>
              )}
            </Item>
            <Item title="마지막 배지 교체">
              <div className="space-y-0.5 text-sm">
                {r.replacement ? (
                  <>
                    <p>
                      <strong className="font-semibold tabular-nums">{dateTime(r.replacement.at)}</strong>
                      {r.replacement.elapsed && <span className="text-fg-muted"> · {r.replacement.elapsed}</span>}
                    </p>
                    <p className="text-xs text-fg-muted">
                      {[
                        r.replacement.modeLabel,
                        r.replacement.removedMl !== null && `제거 ${ml(r.replacement.removedMl)}`,
                        r.replacement.addedMl !== null && `추가 ${ml(r.replacement.addedMl)}`,
                        r.replacement.mediumLabel && `배지 ${r.replacement.mediumLabel}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </>
                ) : (
                  pending(<span className="text-fg-muted">교체 기록 없음 · 배양 시작 {dateOnly(culture.startedAt)}</span>)
                )}
                {r.lastAddition && (
                  <p className="text-xs text-fg-dim">
                    이후 첨가만: {dateTime(r.lastAddition.at)}
                    {r.lastAddition.elapsed && ` · ${r.lastAddition.elapsed}`} (교체 기준일에 반영 안 함)
                  </p>
                )}
              </div>
            </Item>
            <Item title="다음 확인 기준일 (참고)">
              {r.nextCheck ? (
                <div className="space-y-0.5 text-sm">
                  <p>
                    <strong className="font-semibold tabular-nums">{dateOnly(r.nextCheck.dueAt)}</strong>
                    <span className="text-fg-muted">
                      {' '}
                      · {r.nextCheck.remainingDays > 0 ? `${r.nextCheck.remainingDays}일 남음` : r.nextCheck.remainingDays === 0 ? '기준일 도달' : `기준일 ${-r.nextCheck.remainingDays}일 지남`}
                    </span>
                  </p>
                  <p className="text-xs text-fg-muted">
                    마지막 교체 {dateOnly(r.nextCheck.basisAt)} + 교체 기한 {r.nextCheck.days}일
                  </p>
                </div>
              ) : (
                <p className="text-sm text-fg-muted">
                  {r.mediumChangeText ? `교체 주기: ${r.mediumChangeText} · ` : ''}
                  {typeof profile?.fields.medium_change_days === 'number' ? pending('교체 기록이 없어 계산하지 않음') : '교체 기한(일) 미설정'}
                </p>
              )}
            </Item>
            <Item title="마지막 confluency">
              {r.confluency ? (
                <div className="space-y-0.5 text-sm">
                  <p>
                    <strong className="font-semibold tabular-nums">{r.confluency.pct}%</strong>
                    <span className="text-fg-muted"> · {dateTime(r.confluency.at)}</span>
                  </p>
                  <p className="text-xs text-fg-muted">{r.confluency.elapsed ? `${r.confluency.elapsed} 관찰 당시 값` : '관찰 당시 값'}</p>
                </div>
              ) : (
                <p className="text-sm">{pending(<span className="text-fg-muted">측정 기록 없음</span>)}</p>
              )}
            </Item>
          </>
        )}
        <Item title="완전 배지 · 제품" wide>
          {!r.medium.parts.length && (r.medium.text ? <p className="text-sm font-medium">{r.medium.text}</p> : <p className="text-sm text-warning">배지 조성 미등록</p>)}
          {r.medium.parts.length > 0 && (
            <ul className="space-y-1 text-sm">
              {r.medium.parts.map((p, i) => (
                <li key={i} className="min-w-0">
                  <span>{p.label || '(이름 없음)'}</span>
                  {p.percent !== null && <span className="text-fg-muted"> · {p.percent}%</span>}
                  {p.product ? (
                    <span className="block text-xs text-fg-muted">
                      {productNumbers(p.product) || '제조사·번호 미입력'}
                      {p.product.ingredients.length > 0 && <> · 성분 {p.product.ingredientsConfirmed ? '입력상 확인' : '미확인'}</>}
                      <span className="text-fg-dim"> · 등록 당시 스냅샷 {dateOnly(p.product.capturedAt)}</span>
                      {p.product.sourceLabel && <span className="block">제품 등록 근거: {p.product.sourceLabel}</span>}
                    </span>
                  ) : (
                    <span className="block text-xs text-fg-dim">제품번호 미등록</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Sources badges={r.medium.sources} />
        </Item>
        <Item title="배양 환경">
          <Env row={r.temperature} />
          <Env row={r.co2} />
        </Item>
        <Item title="계대 기준">
          {r.passageCriteria.length ? (
            <ul className="space-y-1.5 text-sm">
              {r.passageCriteria.map((c) => (
                <li key={c.key} className="min-w-0 space-y-0.5">
                  <p>
                    <span className="text-fg-muted">{c.label} </span>
                    <strong className="font-semibold">{c.value}</strong>
                    {c.status && <span className="text-xs text-fg-muted"> · {CONDITION_STATUS_LABELS[c.status]}</span>}
                  </p>
                  <Sources badges={c.sources} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg-muted">미등록 · 배양 조건에서 입력</p>
          )}
        </Item>
        {r.unresolved.length > 0 && (
          <Item title="미확정 · 조건부 조건">
            <ul className="space-y-1 text-sm">
              {r.unresolved.map((u) => (
                <li key={u.id} className="min-w-0">
                  <span className="text-warning">{CONDITION_STATUS_LABELS[u.status]}</span> · {u.label}
                  <span className="block text-xs text-fg-muted">
                    {u.value || '값 미입력'}
                    {u.stages.length > 0 && ` · ${u.stages.map((s) => PLAN_STAGE_LABELS[s]).join(', ')}`}
                  </span>
                </li>
              ))}
            </ul>
          </Item>
        )}
      </div>
      <p className="text-[11px] text-fg-dim">입력한 조건과 기록을 그대로 보여 줍니다. 상태 표시는 사용자 판단이며 앱이 검증하지 않습니다.</p>
    </section>
  );
}
