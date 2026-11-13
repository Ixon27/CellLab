import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'wouter';
import { nanoid } from 'nanoid';
import { ArrowLeft, ChevronRight, Info, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { antibodyMix, defaultLanes, eclMix, gelRecipe, loadingPlan, westernAutoRecord, westernMarkdown } from '../../shared/western';
import type { GelRow, WesternData, WesternRunView } from '../../shared/western';
import {
  ACRYLAMIDE_RANGES,
  LOADING_PRESETS,
  SEPARATING_PCT_NOTES,
  STACKING_NOTE,
  WASH_SUMMARY,
  WESTERN_RECORD_FIELDS,
  WESTERN_STEPS,
} from '../../shared/western-defaults';
import type { BradfordData, BradfordResult } from '../../shared/bradford';
import { api } from '../api';
import { btnCls, Dialog, Field, iconBtnCls, inputCls, primaryBtnCls, smallBtnCls, smallGhostBtnCls, smallIconBtnCls } from '../components/Dialog';
import { ProtocolPreview } from '../components/ProtocolPreview';
import { OptionCombobox } from '../components/OptionCombobox';
import { StepTimer } from '../components/StepTimer';
import { useCopy, useToast } from '../components/Toast';
import { SaveStatus, StepRail, StepSection } from '../components/Workbench';
import type { SaveState, WorkflowStep } from '../components/Workbench';
import './western.css';

interface Protocol {
  id: string;
  title: string;
  body_md?: string;
  source_file?: string | null;
}
/** Label above a content-sized control; `unit` trails the control. */
function Fld({ label, unit, children }: { label: string; unit?: string; children: ReactNode }) {
  return (
    <label className="wr-field">
      <span>{label}</span>
      <span className="wr-ctl">
        {children}
        {unit && <em>{unit}</em>}
      </span>
    </label>
  );
}
function RecipeTable({ rows }: { rows: GelRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="pr-table wr-recipe">
        <thead>
          <tr>
            <th>시약</th>
            <th className="num">원문 µL</th>
            <th className="num">현장 µL</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.reagent}>
              <td>{r.reagent}</td>
              <td className="num orig">{r.originalUl}</td>
              <td className="num field" data-diff={r.fieldUl !== r.originalUl || undefined}>
                {r.fieldUl}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function WesternRun({ id }: { id: string }) {
  const [view, setView] = useState<WesternRunView | null>(null),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(''),
    [protocols, setProtocols] = useState<Protocol[]>([]),
    [protocol, setProtocol] = useState<Protocol | null>(null),
    [drawer, setDrawer] = useState(false),
    [importOpen, setImportOpen] = useState(false),
    [finished, setFinished] = useState<string[]>([]),
    [memos, setMemos] = useState<string[]>([]);
  const revision = useRef(0),
    saved = useRef(0),
    latest = useRef<WesternRunView | null>(null),
    queue = useRef<Promise<unknown>>(Promise.resolve());
  const [importing, setImporting] = useState(false);
  const importLock = useRef(false);
  const toast = useToast(),
    copy = useCopy();
  useEffect(() => {
    api<WesternRunView>(`/api/western/${id}`)
      .then((v) => {
        setView(v);
        latest.current = v;
      })
      .catch((e) => setError(e.message));
    api<Protocol[]>('/api/protocols?category=western')
      .then(setProtocols)
      .catch((e) => toast(e.message, { tone: 'error' }));
  }, [id, toast]);
  useEffect(() => {
    if (!view || importing || saved.current === revision.current) return;
    const version = revision.current;
    const timer = setTimeout(() => {
      setSaving('저장 중…');
      const snapshot = view;
      queue.current = queue.current
        .catch(() => {})
        .then(() =>
          api<WesternRunView>(`/api/western/${id}`, {
            method: 'PUT',
            json: {
              title: snapshot.run.title,
              performedAt: snapshot.run.performed_at,
              status: snapshot.run.status,
              protocolId: snapshot.run.protocol_id,
              data: snapshot.data,
            },
          }),
        )
        .then(() => {
          saved.current = version;
          if (revision.current === version) setSaving('저장됨');
        })
        .catch((e) => {
          setSaving('저장 실패');
          toast(e.message, { tone: 'error' });
        });
    }, 800);
    return () => clearTimeout(timer);
  }, [view, id, toast, importing]);
  // Flush the latest unsent edit when leaving this run; writes share the same queue.
  useEffect(
    () => () => {
      const snapshot = latest.current;
      if (snapshot && !importLock.current && saved.current !== revision.current)
        queue.current = queue.current
          .catch(() => {})
          .then(() =>
            api(`/api/western/${id}`, {
              method: 'PUT',
              json: {
                title: snapshot.run.title,
                performedAt: snapshot.run.performed_at,
                status: snapshot.run.status,
                protocolId: snapshot.run.protocol_id,
                data: snapshot.data,
              },
            }),
          )
          .catch((e) => toast(e.message, { tone: 'error' }));
    },
    [id, toast],
  );
  useEffect(() => {
    if (!drawer || !view?.run.protocol_id) {
      setProtocol(null);
      return;
    }
    let alive = true;
    api<Protocol>(`/api/protocols/${view.run.protocol_id}`)
      .then((p) => {
        if (alive) setProtocol(p);
      })
      .catch((e) => toast(e.message, { tone: 'error' }));
    return () => {
      alive = false;
    };
  }, [drawer, view?.run.protocol_id, toast]);
  useEffect(() => {
    if (!drawer) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawer(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [drawer]);
  function change(fn: (v: WesternRunView) => void) {
    if (importLock.current || !latest.current) return;
    const next = structuredClone(latest.current);
    fn(next);
    revision.current++;
    latest.current = next;
    setView(next);
    setSaving('미저장');
  }
  function data(fn: (d: WesternData) => void) {
    change((v) => fn(v.data));
  }
  if (error)
    return (
      <p role="alert" className="p-6 text-danger">
        {error}
      </p>
    );
  if (!view) return <p className="p-6 text-fg-muted">실험을 불러오는 중…</p>;
  const d = view.data,
    auto = westernAutoRecord(d),
    ecl = eclMix(d.membranes),
    minimum = d.loading.proteinUg / (d.loading.finalUl - d.loading.finalUl / d.loading.sampleBufferX);
  const separating = gelRecipe({
    kind: 'separating',
    pct: d.gel.separatingPct,
    scaleMl: d.gel.separatingScale,
    batches: d.gel.batches,
    temedMultiplier: d.gel.temedMultiplier,
  });
  const stacking = gelRecipe({
    kind: 'stacking',
    scaleMl: d.gel.stackingScale,
    batches: d.gel.batches,
    temedMultiplier: d.gel.temedMultiplier,
  });
  const laneKind = (lane: string) => {
    const t = lane.trim();
    return !t || t === '(빈 칸)' ? 'empty' : t === 'Ladder' ? 'ladder' : 'sample';
  };
  const sampleNames = new Set(d.samples.map((s) => s.name));
  const placed = d.lanes.filter((l) => laneKind(l) === 'sample').length;
  const plans = d.samples.map((s) => loadingPlan(s.concUgPerUl, d.loading));
  const primaryCount = d.antibodies.filter((a) => a.kind === 'primary').length;
  const stepsDone = WESTERN_STEPS.filter((s) => d.steps[s.id].done).length;
  const saveState: SaveState =
    saving === '저장 중…' ? 'saving' : saving === '저장 실패' ? 'failed' : saving === '미저장' ? 'pending' : 'saved';
  const bufferMaster = (d.samples.length * d.loading.finalUl) / d.loading.sampleBufferX;
  const steps: WorkflowStep[] = [
    { id: 'wr-gel', title: '겔 조성', done: d.steps['1-5'].done, summary: `${d.gel.separatingPct}% · ${d.gel.separatingScale} mL` },
    {
      id: 'wr-samples',
      title: '시료·로딩',
      done: d.samples.length > 0 && plans.every((p) => p?.ok),
      summary: `시료 ${d.samples.length}개`,
    },
    {
      id: 'wr-lanes',
      title: 'Lane map',
      done: d.samples.length > 0 && d.samples.every((s) => d.lanes.includes(s.name)),
      summary: `${d.wells}웰 · 시료 ${placed}`,
    },
    {
      id: 'wr-antibodies',
      title: '항체',
      done: d.antibodies.length > 0 && d.antibodies.every((a) => a.end),
      summary: `1차 ${primaryCount} · 2차 ${d.antibodies.length - primaryCount}`,
    },
    { id: 'wr-ecl', title: 'ECL', done: d.steps['3-4'].done, summary: `막 ${d.membranes}장 · ${ecl.total} µL` },
    {
      id: 'wr-checklist',
      title: '단계 체크리스트',
      done: stepsDone === WESTERN_STEPS.length,
      summary: `${stepsDone}/${WESTERN_STEPS.length}`,
    },
  ];
  const localTime = (iso: string | null) =>
    iso ? new Date(Date.parse(iso) - new Date(iso).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
  return (
    <div className="workbench-page">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link href="/western" className={iconBtnCls} aria-label="실험 목록" title="실험 목록">
          <ArrowLeft size={16} />
        </Link>
        <input
          aria-label="실험 제목"
          className="workbench-title"
          value={view.run.title}
          onChange={(e) =>
            change((v) => {
              v.run.title = e.target.value;
            })
          }
        />
        <SaveStatus state={saveState} />
        <select
          aria-label="상태"
          className={`${inputCls} w-28`}
          value={view.run.status}
          onChange={(e) =>
            change((v) => {
              v.run.status = e.target.value as WesternRunView['run']['status'];
            })
          }
        >
          <option value="planned">계획</option>
          <option value="in_progress">진행 중</option>
          <option value="done">완료</option>
        </select>
        <input
          aria-label="실험일"
          type="date"
          className={`${inputCls} w-[140px]`}
          value={view.run.performed_at.slice(0, 10)}
          onChange={(e) => {
            if (e.target.value)
              change((v) => {
                v.run.performed_at = `${e.target.value}T00:00:00.000Z`;
              });
          }}
        />
        <button className={btnCls} onClick={() => setDrawer(true)}>
          프로토콜 보기
        </button>
        <button className={btnCls} onClick={() => copy(westernMarkdown(view))}>
          마크다운 복사
        </button>
      </header>

      <StepRail steps={steps} label="Western 단계" />

      <StepSection id="wr-gel" n={1} title="겔 조성">
        <div className="wr-row">
          <Fld label="Separating 농도" unit="%">
            <select
              className={`${inputCls} w-20`}
              value={d.gel.separatingPct}
              onChange={(e) =>
                data((x) => {
                  x.gel.separatingPct = Number(e.target.value) as WesternData['gel']['separatingPct'];
                })
              }
            >
              {[5, 8, 10, 12, 15].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </Fld>
          <Fld label="Separating 규모" unit="mL">
            <select
              className={`${inputCls} w-20`}
              value={d.gel.separatingScale}
              onChange={(e) =>
                data((x) => {
                  x.gel.separatingScale = Number(e.target.value) as 5 | 10;
                })
              }
            >
              {[5, 10].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </Fld>
          <Fld label="Stacking 규모" unit="mL">
            <select
              className={`${inputCls} w-20`}
              value={d.gel.stackingScale}
              onChange={(e) =>
                data((x) => {
                  x.gel.stackingScale = Number(e.target.value) as 5 | 7.5 | 10;
                })
              }
            >
              {[5, 7.5, 10].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </Fld>
          <Fld label="배합 횟수 (1–10)" unit="회">
            <input
              type="number"
              min="1"
              max="10"
              className={`${inputCls} w-20`}
              value={d.gel.batches}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isInteger(n) && n >= 1 && n <= 10)
                  data((x) => {
                    x.gel.batches = n;
                  });
              }}
            />
          </Fld>
          <Fld label="TEMED 배수" unit="배">
            <input
              type="number"
              min="0.01"
              step="0.5"
              className={`${inputCls} w-20`}
              value={d.gel.temedMultiplier}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (n > 0)
                  data((x) => {
                    x.gel.temedMultiplier = n;
                  });
              }}
            />
          </Fld>
        </div>
        <div className="wr-grid2 mt-5">
          <div className="min-w-0">
            <h3 className="wr-sub">Separating gel</h3>
            <RecipeTable rows={separating.rows} />
          </div>
          <div className="min-w-0">
            <h3 className="wr-sub">Stacking gel</h3>
            <RecipeTable rows={stacking.rows} />
          </div>
        </div>
        <div className="wr-notes">
          {d.gel.separatingPct === 8 && (
            <p className="wr-note">
              <TriangleAlert size={13} aria-hidden />
              {SEPARATING_PCT_NOTES[8]}
            </p>
          )}
          <p className="wr-note" data-quiet>
            <Info size={13} aria-hidden />
            {STACKING_NOTE}
          </p>
          <p className="wr-note">
            <TriangleAlert size={13} aria-hidden />
            APS를 먼저 넣고 혼합한 뒤, TEMED를 마지막에 넣고 즉시 붓는다. 현장 TEMED 값은 이미 배수가 반영되어 있다.
          </p>
        </div>
        <details className="wr-fold">
          <summary>
            <ChevronRight size={13} aria-hidden /> 농도별 분리 범위 참고
          </summary>
          <div className="wr-fold-body">
            <table className="pr-table">
              <thead>
                <tr>
                  <th className="num">농도 (%)</th>
                  <th>분리 범위 (kDa)</th>
                </tr>
              </thead>
              <tbody>
                {ACRYLAMIDE_RANGES.map((r) => (
                  <tr key={r.pct}>
                    <td className="num">{r.pct}</td>
                    <td>{r.range}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </StepSection>

      <StepSection
        id="wr-samples"
        n={2}
        title="시료·로딩"
        actions={
          <>
            <button className={btnCls} onClick={() => setImportOpen(true)}>
              Bradford에서 가져오기
            </button>
            <button
              className={btnCls}
              disabled={d.samples.length >= 30}
              onClick={() =>
                data((x) => {
                  x.samples.push({ id: nanoid(12), name: `시료 ${x.samples.length + 1}`, concUgPerUl: null, source: null });
                })
              }
            >
              <Plus size={13} aria-hidden /> 시료 추가
            </button>
          </>
        }
      >
        <div className="wr-row">
          <Fld label="단백질" unit="µg">
            <input
              type="number"
              min="0.001"
              step="any"
              className={`${inputCls} w-24`}
              value={d.loading.proteinUg}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (n > 0)
                  data((x) => {
                    x.loading.proteinUg = n;
                  });
              }}
            />
          </Fld>
          <Fld label="최종 부피" unit="µL">
            <input
              type="number"
              min="0.001"
              step="any"
              className={`${inputCls} w-24`}
              value={d.loading.finalUl}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (n > 0)
                  data((x) => {
                    x.loading.finalUl = n;
                  });
              }}
            />
          </Fld>
          <Fld label="Sample buffer" unit="X">
            <input
              type="number"
              min="1.01"
              step="any"
              className={`${inputCls} w-20`}
              value={d.loading.sampleBufferX}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (n > 1)
                  data((x) => {
                    x.loading.sampleBufferX = n;
                  });
              }}
            />
          </Fld>
          <Fld label="로딩 프리셋">
            <select
              className={`${inputCls} w-64`}
              value=""
              onChange={(e) => {
                const p = LOADING_PRESETS.find((p) => p.id === e.target.value);
                if (p)
                  data((x) => {
                    x.loading = { proteinUg: p.proteinUg, finalUl: p.finalUl, sampleBufferX: p.sampleBufferX };
                  });
              }}
            >
              <option value="">프리셋 선택 (선택 시 현재 조건 변경)</option>
              {LOADING_PRESETS.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Fld>
        </div>
        {d.samples.length === 0 ? (
          <div className="workbench-empty mt-4">시료가 없습니다. 시료를 추가하거나 Bradford 정량 결과를 가져오세요.</div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="pr-table">
              <thead>
                <tr>
                  <th>시료명</th>
                  <th className="num">원액 µg/µL</th>
                  <th className="num">단백질 µL</th>
                  <th className="num">PRO-PREP µL</th>
                  <th className="num">{d.loading.sampleBufferX}X buffer µL</th>
                  <th className="num">합계 µL</th>
                  <th aria-label="삭제" />
                </tr>
              </thead>
              <tbody>
                {d.samples.map((s, i) => {
                  const p = plans[i];
                  return (
                    <tr key={s.id} className={p && !p.ok ? 'wr-bad' : undefined}>
                      <td>
                        <input
                          aria-label="시료명"
                          className={`${inputCls} w-44`}
                          value={s.name}
                          onChange={(e) =>
                            data((x) => {
                              x.samples[i].name = e.target.value;
                            })
                          }
                        />
                        {s.source && <span className="wr-tag">Bradford 연결</span>}
                      </td>
                      <td className="num">
                        <input
                          aria-label="원액 농도"
                          type="number"
                          min="0"
                          step="any"
                          className={`${inputCls} w-24 text-right`}
                          value={s.concUgPerUl ?? ''}
                          onChange={(e) =>
                            data((x) => {
                              x.samples[i].concUgPerUl = e.target.value === '' ? null : Number(e.target.value);
                            })
                          }
                        />
                      </td>
                      <td className="num">{p?.ok ? p.sampleUl.toFixed(1) : '—'}</td>
                      <td className="num">{p?.ok ? p.diluentUl.toFixed(1) : '—'}</td>
                      <td className="num">{p?.ok ? p.bufferUl.toFixed(1) : '—'}</td>
                      <td className="num">
                        {p?.finalUl.toFixed(1) ?? '—'}
                        {p && !p.ok && <div className="text-[11.5px]">농축 또는 로딩 조건 조정 필요</div>}
                      </td>
                      <td>
                        <button
                          className={smallIconBtnCls}
                          aria-label={`${s.name} 삭제`}
                          title="시료 삭제"
                          onClick={() =>
                            data((x) => {
                              x.samples.splice(i, 1);
                            })
                          }
                        >
                          <Trash2 size={13} aria-hidden />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="wr-total">
              <span>
                Buffer 마스터 합계 {bufferMaster.toFixed(1)} µL · 10% 여유분 포함 {(bufferMaster * 1.1).toFixed(1)} µL
              </span>
            </div>
          </div>
        )}
        <p className="wr-note mt-3">
          <TriangleAlert size={13} aria-hidden />
          원액 농도가 {Number(minimum.toFixed(3))} µg/µL 미만이면 농축 또는 로딩 조건 조정이 필요합니다.
        </p>
      </StepSection>

      <StepSection
        id="wr-lanes"
        n={3}
        title="Lane map"
        actions={
          <>
            <label className="flex items-center gap-1.5 text-[12px] text-fg-muted">
              웰 수
              <select
                className={`${inputCls} w-20`}
                value={d.wells}
                onChange={(e) =>
                  data((x) => {
                    x.wells = Number(e.target.value);
                    x.lanes = defaultLanes(
                      x.samples.map((s) => s.name),
                      x.wells,
                    );
                  })
                }
              >
                {[10, 12, 15].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <button
              className={btnCls}
              onClick={() =>
                data((x) => {
                  x.lanes = defaultLanes(
                    x.samples.map((s) => s.name),
                    x.wells,
                  );
                })
              }
            >
              기본 배치로 초기화
            </button>
          </>
        }
      >
        <div className="wr-gel-scroll">
          <div className="wr-gel" style={{ '--wells': d.lanes.length } as CSSProperties} role="group" aria-label="겔 레인 배치">
            {d.lanes.map((lane, i) => (
              <label key={i} className="wr-lane" data-kind={laneKind(lane)}>
                <span className="wr-lane-n">{i + 1}</span>
                <span className="wr-notch" aria-hidden />
                <input
                  aria-label={`레인 ${i + 1}`}
                  title={lane}
                  list={`lane-options-${id}`}
                  className={`${inputCls} wr-lane-in`}
                  value={lane}
                  onChange={(e) =>
                    data((x) => {
                      x.lanes[i] = e.target.value;
                    })
                  }
                />
              </label>
            ))}
          </div>
        </div>
        <p className="wr-legend">
          <span>시료 {placed}</span>
          <span>Ladder {d.lanes.filter((l) => laneKind(l) === 'ladder').length}</span>
          <span>빈 칸 {d.lanes.filter((l) => laneKind(l) === 'empty').length}</span>
          <span>레인 칸에 시료명 또는 Ladder를 입력하거나 목록에서 고릅니다.</span>
        </p>
        <datalist id={`lane-options-${id}`}>
          {['(빈 칸)', 'Ladder', ...sampleNames].map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </StepSection>

      <StepSection
        id="wr-antibodies"
        n={4}
        title="항체"
        actions={
          <button
            className={btnCls}
            disabled={d.antibodies.length >= 20}
            onClick={() =>
              data((x) => {
                x.antibodies.push({
                  id: nanoid(12),
                  kind: 'primary',
                  target: '',
                  product: '',
                  dilutionN: 1000,
                  diluent: '5% BSA/TBST',
                  totalUl: 1000,
                  start: null,
                  end: null,
                });
              })
            }
          >
            <Plus size={13} aria-hidden /> 항체 추가
          </button>
        }
      >
        {d.antibodies.length === 0 && <div className="workbench-empty">항체가 없습니다. 항체 추가로 1차·2차 항체를 등록하세요.</div>}
        {d.antibodies.map((a, i) => {
          const mix = antibodyMix(a.dilutionN, a.totalUl);
          return (
            <div className="wr-ab" key={a.id}>
              <Fld label="종류">
                <select
                  aria-label={`항체 ${i + 1} 종류`}
                  className={`${inputCls} w-20`}
                  value={a.kind}
                  onChange={(e) =>
                    data((x) => {
                      x.antibodies[i].kind = e.target.value as 'primary' | 'secondary';
                    })
                  }
                >
                  <option value="primary">1차</option>
                  <option value="secondary">2차</option>
                </select>
              </Fld>
              <Fld label="표적">
                <input
                  className={`${inputCls} w-36`}
                  value={a.target}
                  onChange={(e) =>
                    data((x) => {
                      x.antibodies[i].target = e.target.value;
                    })
                  }
                />
              </Fld>
              <Fld label="제품">
                <input
                  className={`${inputCls} w-44`}
                  value={a.product}
                  onChange={(e) =>
                    data((x) => {
                      x.antibodies[i].product = e.target.value;
                    })
                  }
                />
              </Fld>
              <Fld label="희석비">
                <span className="wr-ctl">
                  <em>1 :</em>
                  <input
                    type="number"
                    min="1"
                    max="100000"
                    className={`${inputCls} w-24`}
                    value={a.dilutionN}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (n >= 1 && n <= 100000)
                        data((x) => {
                          x.antibodies[i].dilutionN = n;
                        });
                    }}
                  />
                </span>
              </Fld>
              <Fld label="희석액">
                <div className="w-48">
                  <OptionCombobox
                    category="antibody_diluent"
                    value={a.diluent}
                    onChange={(v) =>
                      data((x) => {
                        x.antibodies[i].diluent = v;
                      })
                    }
                  />
                </div>
              </Fld>
              <Fld label="총 부피" unit="µL">
                <input
                  type="number"
                  min="1"
                  max="50000"
                  className={`${inputCls} w-24`}
                  value={a.totalUl}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (n >= 1 && n <= 50000)
                      data((x) => {
                        x.antibodies[i].totalUl = n;
                      });
                  }}
                />
              </Fld>
              <span className="wr-ab-mix">
                항체 {Number(mix.antibodyUl.toFixed(2))} µL + 희석액 {Number(mix.diluentUl.toFixed(2))} µL
              </span>
              {(['start', 'end'] as const).map((key) => (
                <Fld key={key} label={`반응 ${key === 'start' ? '시작' : '종료'}`}>
                  <span className="wr-time">
                    <input
                      type="datetime-local"
                      className={`${inputCls} w-[176px]`}
                      value={localTime(a[key])}
                      onChange={(e) =>
                        data((x) => {
                          x.antibodies[i][key] = e.target.value ? new Date(e.target.value).toISOString() : null;
                        })
                      }
                    />
                    <button
                      type="button"
                      className={smallBtnCls}
                      aria-label={`항체 ${i + 1} ${key === 'start' ? '시작' : '종료'} 시각을 지금으로`}
                      onClick={() =>
                        data((x) => {
                          x.antibodies[i][key] = new Date().toISOString();
                        })
                      }
                    >
                      지금
                    </button>
                  </span>
                </Fld>
              ))}
              <button
                className={`${smallIconBtnCls} wr-ab-del`}
                aria-label={`항체 ${i + 1} 삭제`}
                title="항체 삭제"
                onClick={() =>
                  data((x) => {
                    x.antibodies.splice(i, 1);
                  })
                }
              >
                <Trash2 size={13} aria-hidden />
              </button>
            </div>
          );
        })}
      </StepSection>

      <StepSection id="wr-ecl" n={5} title="ECL">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <Fld label="막 수" unit="장">
            <input
              type="number"
              min="1"
              max="100"
              className={`${inputCls} w-20`}
              value={d.membranes}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isInteger(n) && n >= 1 && n <= 100)
                  data((x) => {
                    x.membranes = n;
                  });
              }}
            />
          </Fld>
          <p className="pb-[5px] text-[13px] tabular-nums">
            용액 1 <b>{ecl.ecl1}</b> µL + 용액 2 <b>{ecl.ecl2}</b> µL + TBST <b>{ecl.tbst}</b> µL = 총 <b>{ecl.total}</b> µL
          </p>
        </div>
      </StepSection>

      <StepSection id="wr-checklist" n={6} title="단계 체크리스트" hint={`${stepsDone}/${WESTERN_STEPS.length} 완료`}>
        {[1, 2, 3].map((phase) => {
          const list = WESTERN_STEPS.filter((s) => s.phase === phase);
          return (
            <div key={phase} role="group" aria-label={`${phase}단계`}>
              <h3 className="wr-phase">
                {phase}단계
                <small>
                  {list.filter((s) => d.steps[s.id].done).length}/{list.length}
                </small>
              </h3>
              {list.map((s) => {
                const state = d.steps[s.id];
                const memoOpen = !!state.note || memos.includes(s.id);
                return (
                  <div
                    key={s.id}
                    className="wr-step"
                    data-done={state.done || undefined}
                    data-finished={finished.includes(s.id) || undefined}
                  >
                    <label className="wr-step-check">
                      <input
                        type="checkbox"
                        checked={state.done}
                        onChange={(e) =>
                          data((x) => {
                            x.steps[s.id].done = e.target.checked;
                            x.steps[s.id].doneAt = e.target.checked ? new Date().toISOString() : null;
                          })
                        }
                      />
                      <span>
                        {s.id} {s.title}
                      </span>
                      {state.doneAt && <small>완료 {new Date(state.doneAt).toLocaleString('ko-KR')}</small>}
                    </label>
                    {s.timerMin && <StepTimer title={s.title} minutes={s.timerMin} onFinish={() => setFinished((v) => [...v, s.id])} />}
                    <button
                      className={smallGhostBtnCls}
                      aria-expanded={memoOpen}
                      aria-label={`${s.title} 메모 ${memoOpen ? '접기' : '열기'}`}
                      disabled={memoOpen && !!state.note}
                      onClick={() => setMemos((v) => (v.includes(s.id) ? v.filter((m) => m !== s.id) : [...v, s.id]))}
                    >
                      메모
                    </button>
                    {memoOpen && (
                      <div className="wr-step-memo">
                        <input
                          aria-label={`${s.title} 메모`}
                          placeholder="단계 메모"
                          className={inputCls}
                          value={state.note}
                          onChange={(e) =>
                            data((x) => {
                              x.steps[s.id].note = e.target.value;
                            })
                          }
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
        <details className="wr-fold">
          <summary>
            <ChevronRight size={13} aria-hidden /> 세척 요약표
          </summary>
          <div className="wr-fold-body">
            <p className="wr-note mb-2" data-quiet>
              <Info size={13} aria-hidden />
              단백질 전이 면을 위로 두고 shaker 위에서 진행하며, 매회 새 1X TBST로 교체합니다.
            </p>
            <table className="pr-table">
              <thead>
                <tr>
                  <th>세척 시점</th>
                  <th className="num">횟수</th>
                  <th className="num">1회 시간</th>
                </tr>
              </thead>
              <tbody>
                {WASH_SUMMARY.map((row) => (
                  <tr key={row[0]}>
                    {row.map((v, i) => (
                      <td className={i ? 'num' : undefined} key={i}>
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="font-semibold">합계</td>
                  <td className="num font-semibold">17–18회</td>
                  <td className="num">—</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </details>
      </StepSection>

      <details className="workbench-section workbench-panel" open={Object.values(d.record).some((v) => v.trim()) || undefined}>
        <summary>
          <ChevronRight size={14} aria-hidden /> 추가 실험 기록 (선택)
        </summary>
        <div className="workbench-section-body space-y-3">
          <p className="wr-note" data-quiet>
            <Info size={13} aria-hidden />
            가져온 Western 문서의 실험 기록란 23개입니다. 겔·시료·항체 등 위 입력과 겹치는 항목은 보충 기록용이며 필수가 아닙니다. 기존 기록은 그대로 보존되며, 자동값 채우기는 빈 칸만 채웁니다.
          </p>
          <button
            className={btnCls}
            onClick={() =>
              data((x) => {
                for (const [key, value] of Object.entries(auto)) if (!x.record[key]?.trim()) x.record[key] = value;
              })
            }
          >
            자동값 채우기
          </button>
          <div className="wr-record">
            {WESTERN_RECORD_FIELDS.map((f) => (
              <label key={f.key} className="wr-field">
                <span>
                  {f.key} {f.label}
                </span>
                <textarea
                  rows={2}
                  className={inputCls}
                  value={d.record[f.key] ?? ''}
                  placeholder={auto[f.key] ?? ''}
                  onChange={(e) =>
                    data((x) => {
                      x.record[f.key] = e.target.value;
                    })
                  }
                />
              </label>
            ))}
          </div>
        </div>
      </details>

      <section className="workbench-section workbench-panel" aria-labelledby="wr-notes-title">
        <header className="workbench-section-head">
          <h2 id="wr-notes-title">전체 메모</h2>
        </header>
        <div className="workbench-section-body">
          <textarea
            aria-label="전체 메모"
            rows={4}
            className={inputCls}
            value={d.notes}
            onChange={(e) =>
              data((x) => {
                x.notes = e.target.value;
              })
            }
          />
        </div>
      </section>
      {drawer && (
        <div className="fixed inset-0 z-50 bg-black/30" onMouseDown={() => setDrawer(false)}>
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="연결 프로토콜"
            className="pr-panel-enter absolute inset-y-0 right-0 w-full max-w-2xl overflow-y-auto border-l border-line bg-raised p-6 shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex justify-between">
              <h2 className="font-semibold">연결 프로토콜</h2>
              <button className={btnCls} onClick={() => setDrawer(false)}>
                닫기
              </button>
            </div>
            <Field label="Western 프로토콜">
              <select
                className={inputCls}
                value={view.run.protocol_id ?? ''}
                onChange={(e) =>
                  change((v) => {
                    v.run.protocol_id = e.target.value || null;
                  })
                }
              >
                <option value="">연결 안 함</option>
                {protocols.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </Field>
            {protocol ? (
              <ProtocolPreview protocol={{ ...protocol, body_md: protocol.body_md ?? '' }} />
            ) : (
              <p className="text-fg-muted">프로토콜을 선택하세요.</p>
            )}
          </aside>
        </div>
      )}
      {importOpen && (
        <BradfordImport
          busy={importing}
          onClose={() => {
            if (!importing) setImportOpen(false);
          }}
          onImport={(assayId, indexes) => {
            if (importLock.current) return;
            importLock.current = true;
            setImporting(true);
            const snapshot = latest.current!;
            queue.current = queue.current
              .catch(() => {})
              .then(() =>
                api(`/api/western/${id}`, {
                  method: 'PUT',
                  json: {
                    data: snapshot.data,
                    title: snapshot.run.title,
                    performedAt: snapshot.run.performed_at,
                    status: snapshot.run.status,
                    protocolId: snapshot.run.protocol_id,
                  },
                }),
              )
              .then(() =>
                api<WesternRunView>(`/api/western/${id}/import-bradford`, {
                  method: 'POST',
                  json: { id: assayId, sampleIndexes: indexes },
                }),
              )
              .then((v) => {
                revision.current++;
                saved.current = revision.current;
                latest.current = v;
                setView(v);
                setImportOpen(false);
                setSaving('저장됨');
              })
              .catch((e) => toast(e.message, { tone: 'error' }))
              .finally(() => {
                importLock.current = false;
                setImporting(false);
              });
          }}
        />
      )}
    </div>
  );
}
function BradfordImport({ onClose, onImport, busy }: { onClose(): void; onImport(id: string, indexes: number[]): void; busy: boolean }) {
  const [assays, setAssays] = useState<{ id: string; title: string }[]>([]),
    [id, setId] = useState(''),
    [assay, setAssay] = useState<{ data: BradfordData; result: BradfordResult } | null>(null),
    [selected, setSelected] = useState<number[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    api<{ id: string; title: string }[]>('/api/bradford')
      .then(setAssays)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    setAssay(null);
    setSelected([]);
    if (!id) return;
    let alive = true;
    api<{ data: BradfordData; result: BradfordResult }>(`/api/bradford/${id}`)
      .then((v) => {
        if (alive) setAssay(v);
      })
      .catch((e) => setError(e.message));
    return () => {
      alive = false;
    };
  }, [id]);
  return (
    <Dialog
      title="Bradford에서 가져오기"
      onClose={onClose}
      dismissible={!busy}
      footer={
        <button className={primaryBtnCls} disabled={busy || !selected.length} onClick={() => onImport(id, selected)}>
          {busy ? '가져오는 중…' : '선택한 시료 가져오기'}
        </button>
      }
    >
      <Field label="정량 실험">
        <select className={inputCls} disabled={busy} value={id} onChange={(e) => setId(e.target.value)}>
          <option value="">실험 선택</option>
          {assays.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </select>
      </Field>
      {error && <p className="text-danger">{error}</p>}
      {assay?.data.samples.map((s, i) => (
        <label className="my-3 flex gap-2" key={i}>
          <input
            type="checkbox"
            disabled={busy}
            checked={selected.includes(i)}
            onChange={(e) => setSelected((v) => (e.target.checked ? [...v, i] : v.filter((n) => n !== i)))}
          />
          {s.name} · {assay.result.samples[i].stockUgPerUl ?? '미정'} µg/µL
        </label>
      ))}
    </Dialog>
  );
}
