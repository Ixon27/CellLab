import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useLocation } from 'wouter';
import * as Plot from '@observablehq/plot';
import { ArrowLeft, ChevronRight, Ellipsis, Plus, Trash2, TriangleAlert, X } from 'lucide-react';
import {
  computeBradford,
  applyPlate,
  removePlateRow,
  parseReplicateRows,
  type BradfordData,
  type BradfordResult,
  type Rep,
  type SampleFlag,
} from '../../shared/bradford';
import type { CellLineDetailDto, CellLineListItem } from '../../shared/cell-line';
import { api } from '../api';
import { Dialog, btnCls, iconBtnCls, inputCls, primaryBtnCls, smallIconBtnCls } from '../components/Dialog';
import { ProtocolPreview } from '../components/ProtocolPreview';
import { PlotFrame } from '../components/PlotFrame';
import { useToast } from '../components/Toast';
import { BradfordMeasure, BradfordPlateMap, plateWells, sampleHue } from '../components/BradfordPlate';
import { BradfordLoading } from '../components/BradfordLoading';
import { SaveStatus, StepRail, StepSection, type SaveState, type WorkflowStep } from '../components/Workbench';
import { useResolvedTheme } from '../state/theme';
import './bradford.css';

interface Detail {
  assay: { id: string; title: string; performed_at: string; protocol_id: string | null };
  data: BradfordData;
  result: BradfordResult;
}
interface Protocol {
  id: string;
  title: string;
  body_md?: string;
  bodyMd?: string;
}
const flagLabels: Record<SampleFlag, string> = {
  above_range: '표준 범위 초과',
  below_range: '표준 범위 미만',
  high_cv: 'CV 10% 초과',
  no_root: '농도 역산 불가',
  no_data: '측정값 없음',
};
const numberText = (value: number | null | undefined, digits = 4) =>
  value == null ? '—' : value.toLocaleString('ko-KR', { maximumFractionDigits: digits });

/** Replicate absorbances typed by hand (no plate). */
function RepInputs({ reps, onChange }: { reps: Rep[]; onChange(reps: Rep[]): void }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {reps.map((rep, i) => (
        <span key={i} className="inline-flex items-center">
          <input
            aria-label={`반복 ${i + 1} 흡광도`}
            type="number"
            step="any"
            className={`${inputCls} w-[76px] ${rep.excluded ? 'line-through opacity-45' : ''}`}
            value={rep.abs ?? ''}
            onChange={(e) =>
              onChange(reps.map((r, j) => (j === i ? { ...r, abs: e.target.value === '' ? null : Number(e.target.value) } : r)))
            }
          />
          <button
            title={rep.excluded ? '계산에 다시 포함' : '계산에서 제외'}
            aria-label={`반복 ${i + 1} ${rep.excluded ? '포함' : '제외'}`}
            aria-pressed={rep.excluded}
            className={`${smallIconBtnCls} ${rep.excluded ? 'text-warning' : ''}`}
            onClick={() => onChange(reps.map((r, j) => (j === i ? { ...r, excluded: !r.excluded } : r)))}
          >
            <X size={12} />
          </button>
        </span>
      ))}
      <button
        className={smallIconBtnCls}
        aria-label="반복 추가"
        title="반복 추가"
        disabled={reps.length >= 6}
        onClick={() => onChange([...reps, { abs: null, excluded: false }])}
      >
        <Plus size={13} />
      </button>
      <button
        className={`${smallIconBtnCls} text-[15px]`}
        aria-label="마지막 반복 삭제"
        title="마지막 반복 삭제"
        disabled={reps.length <= 1}
        onClick={() => onChange(reps.slice(0, -1))}
      >
        −
      </button>
    </div>
  );
}

/** Plate replicates of one row: position and reading side by side. */
function PlateReps({ data, kind, index }: { data: BradfordData; kind: 'standard' | 'sample'; index: number }) {
  const wells = plateWells(data, kind, index);
  if (!wells.length) return <span className="text-fg-dim">well 배정 없음</span>;
  return (
    <>
      {wells.map((w) => (
        <span key={w.position} className="bf-rep" data-excluded={w.excluded || undefined}>
          <small>{w.position}</small>
          {w.value ?? '—'}
        </span>
      ))}
    </>
  );
}

export function BradfordEditor({ id }: { id: string }) {
  const [concentrationUnit, setConcentrationUnit] = useState<'ug' | 'mg'>('ug');
  const [detail, setDetail] = useState<Detail | null>(null),
    [error, setError] = useState(''),
    [saveState, setSaveState] = useState<SaveState>('saved');
  const [selected, setSelected] = useState<number[]>([]),
    [paste, setPaste] = useState<'standards' | 'samples' | null>(null),
    [pasteText, setPasteText] = useState('');
  const [lines, setLines] = useState<CellLineListItem[]>([]),
    [lineId, setLineId] = useState(''),
    [cultures, setCultures] = useState<CellLineDetailDto['cultures']>([]);
  const [protocols, setProtocols] = useState<Protocol[]>([]),
    [protocol, setProtocol] = useState<Protocol | null>(null),
    [showProtocol, setShowProtocol] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const revision = useRef(0),
    savedRevision = useRef(0),
    saving = useRef(false),
    latest = useRef<Detail | null>(null);
  const toast = useToast(),
    [, navigate] = useLocation();
  const theme = useResolvedTheme();
  useEffect(() => {
    let live = true;
    api<Detail>(`/api/bradford/${id}`)
      .then((d) => {
        if (live) {
          latest.current = d;
          setDetail(d);
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      live = false;
    };
  }, [id]);
  useEffect(() => {
    api<CellLineListItem[]>('/api/cell-lines')
      .then(setLines)
      .catch(() => setLines([]));
    Promise.all([api<Protocol[]>('/api/protocols?category=bradford'), api<Protocol[]>('/api/protocols?category=protein')])
      .then((p) => setProtocols(p.flat()))
      .catch((e) => toast(e.message, { tone: 'error' }));
  }, [toast]);
  useEffect(() => {
    setCultures([]);
    if (lineId)
      api<CellLineDetailDto>(`/api/cell-lines/${lineId}`)
        .then((d) => setCultures(d.cultures))
        .catch(() => setCultures([]));
  }, [lineId]);
  useEffect(() => {
    setProtocol(null);
    if (detail?.assay.protocol_id)
      api<Protocol>(`/api/protocols/${detail.assay.protocol_id}`)
        .then(setProtocol)
        .catch((e) => toast(e.message, { tone: 'error' }));
  }, [detail?.assay.protocol_id, toast]);
  useEffect(() => {
    if (!menuOpen) return;
    const onPress = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPress);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPress);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);
  // Serialize saves; never let an older response replace edits made during its request.
  useEffect(() => {
    if (!detail || revision.current === savedRevision.current) return;
    let disposed = false;
    async function save() {
      if (saving.current) {
        timer = setTimeout(save, 100);
        return;
      }
      const current = latest.current;
      if (!current) return;
      const version = revision.current;
      saving.current = true;
      setSaveState('saving');
      try {
        const response = await api<Detail>(`/api/bradford/${id}`, {
          method: 'PUT',
          json: {
            title: current.assay.title,
            performedAt: current.assay.performed_at,
            protocolId: current.assay.protocol_id,
            data: current.data,
          },
        });
        savedRevision.current = version;
        if (!disposed && version === revision.current) {
          latest.current = response;
          setDetail(response);
          setSaveState('saved');
        }
      } catch (e) {
        if (!disposed) {
          setSaveState('failed');
          toast(e instanceof Error ? e.message : '저장에 실패했습니다', { tone: 'error' });
        }
      } finally {
        saving.current = false;
      }
    }
    let timer = setTimeout(save, 800);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [detail, id, toast]);
  function change(next: Detail) {
    revision.current++;
    latest.current = next;
    setDetail(next);
    setSaveState('pending');
  }
  function update(data: BradfordData) {
    if (detail) change({ ...detail, data: applyPlate(data) });
  }
  const result = useMemo(() => (detail ? computeBradford(detail.data) : null), [detail?.data]);
  const chart = useMemo<Plot.PlotOptions | null>(() => {
    if (!detail || !result) return null;
    const points = result.standards.filter((s) => s.corrected !== null).map((s) => ({ x: s.conc, y: s.corrected! }));
    if (!points.length) return null;
    const tokens = getComputedStyle(document.documentElement);
    const accent = tokens.getPropertyValue('--pr-accent').trim();
    const max = Math.max(...detail.data.standards.map((s) => s.conc), 1);
    const curve = result.fit
      ? Array.from({ length: 100 }, (_, i) => {
          const x = (max * i) / 99;
          return { x, y: result.fit!.coef.reduce((v, c, j) => v + c * x ** j, 0) };
        })
      : [];
    const samples = result.samples.flatMap((s, i) =>
      s.wellUgPerMl !== null && s.corrected !== null ? [{ x: s.wellUgPerMl, y: s.corrected, name: s.name, hue: sampleHue(i) }] : [],
    );
    const floor = Math.min(0, ...points.map((p) => p.y), ...samples.map((s) => s.y));
    return {
      height: 300,
      marginTop: 28,
      marginRight: 18,
      x: { label: '농도 (µg/mL)', grid: true, nice: true },
      y: { label: `${detail.data.subtractBlank ? 'Blank 보정 ' : ''}흡광도 (${detail.data.wavelengthNm} nm)`, grid: true, nice: true },
      marks: [
        Plot.line(curve, { x: 'x', y: 'y', stroke: accent, strokeWidth: 2 }),
        // Drop lines read each sample's concentration off the x axis.
        Plot.ruleX(samples, { x: 'x', y1: floor, y2: 'y', stroke: 'hue', strokeOpacity: 0.6, strokeDasharray: '3,3' }),
        Plot.dot(points, { x: 'x', y: 'y', r: 4, fill: 'currentColor', title: (p) => `표준 ${p.x} µg/mL\n흡광도 ${p.y.toFixed(4)}` }),
        Plot.dot(samples, {
          x: 'x',
          y: 'y',
          r: 5,
          symbol: 'diamond',
          fill: 'hue',
          stroke: theme === 'dark' ? '#16171d' : '#fff',
          title: (s) => `${s.name}\n${s.x.toFixed(1)} µg/mL`,
        }),
      ],
    };
  }, [detail?.data, result, theme]);
  function applyPaste() {
    if (!detail || !paste) return;
    try {
      const rows = parseReplicateRows(pasteText);
      const data = structuredClone(detail.data);
      rows.forEach((row, i) => {
        const reps = row.values.map((abs) => ({ abs, excluded: false }));
        if (paste === 'standards') {
          // A numeric first column is a concentration when it matches an existing row
          // and leaves at least one absorbance column; otherwise rows map by order.
          const matched = !row.label && row.values.length > 1 ? data.standards.find((s) => s.conc === row.values[0]) : undefined;
          const target = matched ?? data.standards[i];
          if (!target) throw new Error('붙여넣은 표준 행이 너무 많습니다');
          target.reps = matched ? reps.slice(1) : reps;
          if (target.reps.length < 1 || target.reps.length > 6) throw new Error('각 행에는 반복 측정값 1–6개를 입력하세요');
        } else if (data.samples[i]) data.samples[i] = { ...data.samples[i], name: row.label || data.samples[i].name, reps };
        else data.samples.push({ name: row.label || `시료 ${i + 1}`, dilution: 1, cultureId: null, reps });
      });
      if (data.samples.some((s) => s.reps.length < 1 || s.reps.length > 6)) throw new Error('각 행에는 반복 측정값 1–6개를 입력하세요');
      if (data.samples.length > 96) throw new Error('시료는 최대 96개입니다');
      update(data);
      setPaste(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : '붙여넣기에 실패했습니다', { tone: 'error' });
    }
  }
  async function makeWestern(loading: NonNullable<BradfordData['loading']>) {
    if (!detail) return;
    try {
      while (saving.current) {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 50);
        await promise;
      }
      const current = latest.current!;
      await api(`/api/bradford/${id}`, {
        method: 'PUT',
        json: {
          title: current.assay.title,
          performedAt: current.assay.performed_at,
          protocolId: current.assay.protocol_id,
          data: current.data,
        },
      });
      const res = await api<{ run: { id: string } }>('/api/western', {
        method: 'POST',
        json: { fromBradford: { id, sampleIndexes: selected }, loading },
      });
      navigate(`/western/${res.run.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : '실험 생성에 실패했습니다', { tone: 'error' });
    }
  }
  async function remove() {
    setMenuOpen(false);
    if (!window.confirm('이 정량 실험을 삭제할까요?')) return;
    try {
      await api(`/api/bradford/${id}`, { method: 'DELETE' });
      navigate('/bradford');
    } catch (e) {
      toast(e instanceof Error ? e.message : '삭제에 실패했습니다', { tone: 'error' });
    }
  }
  if (error) return <p className="p-6 text-danger">{error}</p>;
  if (!detail || !result) return <p className="p-6 text-fg-muted">정량 데이터를 불러오는 중…</p>;
  const d = detail.data;
  const plate = d.plate;
  const unitFactor = concentrationUnit === 'mg' ? 1000 : 1;
  const showCulture = !!lineId || d.samples.some((s) => s.cultureId);

  const measured = plate
    ? plate.values.filter((v) => v !== null).length
    : [...d.standards, ...d.samples].reduce((n, row) => n + row.reps.filter((r) => r.abs !== null).length, 0);
  const mapped = (kind: 'standard' | 'sample', count: number) =>
    Array.from({ length: count }, (_, i) => i).filter((i) => plate?.mappings.some((m) => m?.kind === kind && m.index === i)).length;
  const standardsMapped = mapped('standard', d.standards.length),
    samplesMapped = mapped('sample', d.samples.length);
  const pointsNeeded = d.fit === 'linear' ? 3 : 4;
  const pointsReady = result.standards.filter((s) => s.corrected !== null).length;
  const quantified = result.samples.filter((s) => s.stockUgPerUl !== null).length;
  const steps: WorkflowStep[] = [
    {
      id: 'bf-measure',
      title: '측정값',
      done: measured > 0,
      summary: plate ? `${measured}/96칸` : measured ? `반복값 ${measured}개` : '직접 입력',
    },
    ...(plate
      ? [
          {
            id: 'bf-map',
            title: 'well 배정',
            done: standardsMapped >= pointsNeeded && samplesMapped > 0,
            summary: `표준 ${standardsMapped}/${d.standards.length} · 시료 ${samplesMapped}/${d.samples.length}`,
          },
        ]
      : []),
    {
      id: 'bf-curve',
      title: '표준곡선',
      done: !!result.fit,
      summary: result.fit ? `R² ${result.fit.r2.toFixed(4)}` : `표준 ${pointsReady}/${pointsNeeded}점`,
    },
    {
      id: 'bf-samples',
      title: '시료 농도',
      done: quantified > 0,
      summary: d.samples.length ? `${quantified}/${d.samples.length}개 계산` : '시료 없음',
    },
    {
      id: 'bf-western',
      title: 'Western 로딩',
      done: selected.length > 0,
      summary: selected.length ? `${selected.length}개 선택` : '보낼 시료 선택',
    },
  ];
  const stepNumber = (stepId: string) => steps.findIndex((s) => s.id === stepId) + 1;

  return (
    <div className="workbench-page">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link href="/bradford" className={iconBtnCls} aria-label="Bradford 목록" title="Bradford 목록">
          <ArrowLeft size={16} />
        </Link>
        <input
          aria-label="실험 제목"
          className="workbench-title"
          value={detail.assay.title}
          onChange={(e) => change({ ...detail, assay: { ...detail.assay, title: e.target.value } })}
        />
        <SaveStatus state={saveState} />
        <input
          aria-label="실험일"
          type="date"
          className={`${inputCls} w-[140px]`}
          value={detail.assay.performed_at.slice(0, 10)}
          onChange={(e) => change({ ...detail, assay: { ...detail.assay, performed_at: e.target.value } })}
        />
        <div className="relative" ref={menuRef}>
          <button className={iconBtnCls} aria-label="더 보기" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
            <Ellipsis size={16} />
          </button>
          {menuOpen && (
            <div role="menu" className="pr-pop absolute right-0 top-[calc(100%+6px)] z-50 min-w-44 rounded-xl border border-line bg-raised p-1 shadow-pop">
              <button
                role="menuitem"
                className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-[13px] text-danger hover:bg-danger-soft"
                onClick={() => void remove()}
              >
                <Trash2 size={14} aria-hidden /> 정량 실험 삭제
              </button>
            </div>
          )}
        </div>
      </header>

      <StepRail steps={steps} label="정량 단계" />

      <StepSection id="bf-measure" n={stepNumber('bf-measure')} title="측정값">
        <BradfordMeasure data={d} onChange={update} />
      </StepSection>

      {plate && (
        <StepSection id="bf-map" n={stepNumber('bf-map')} title="well 배정" hint="어느 칸이 어떤 표준·시료인지 칠해 주세요">
          <BradfordPlateMap data={d} onChange={update} />
        </StepSection>
      )}

      <StepSection
        id="bf-curve"
        n={stepNumber('bf-curve')}
        title="표준곡선"
        actions={
          <>
            <label className="flex items-center gap-1.5 text-[12.5px] text-fg-muted">
              <input type="checkbox" checked={d.subtractBlank} onChange={(e) => update({ ...d, subtractBlank: e.target.checked })} />
              Blank 보정
            </label>
            <div className="pr-seg" role="group" aria-label="적합 방식">
              <button aria-pressed={d.fit === 'linear'} onClick={() => update({ ...d, fit: 'linear' })}>
                선형
              </button>
              <button aria-pressed={d.fit === 'quadratic'} onClick={() => update({ ...d, fit: 'quadratic' })}>
                2차
              </button>
            </div>
          </>
        }
      >
        <div className="bf-curve">
          <div className="min-w-0">
            {chart ? (
              <PlotFrame options={chart} />
            ) : (
              <p className="workbench-empty" style={{ minHeight: 300 }}>
                표준 {pointsNeeded}점 이상에 측정값이 들어오면
                <br />
                여기에 곡선이 그려집니다.
              </p>
            )}
            {result.fit && (
              <dl className="bf-stat">
                <div>
                  <dt>R²</dt>
                  <dd className={result.fit.r2 >= 0.98 ? 'text-success' : 'text-warning'}>{result.fit.r2.toFixed(4)}</dd>
                </div>
                <div>
                  <dt>식</dt>
                  <dd className="font-mono text-[12px] font-medium">
                    y = {result.fit.coef.map((c, i) => `${i ? ' + ' : ''}${c.toPrecision(5)}${i === 1 ? 'x' : i === 2 ? 'x²' : ''}`).join('')}
                  </dd>
                </div>
                <div>
                  <dt>표준점</dt>
                  <dd>{result.fit.n}</dd>
                </div>
              </dl>
            )}
            {result.warnings.map((w) => (
              <p key={w} className="mt-2 flex items-start gap-1.5 text-[12.5px] text-warning">
                <TriangleAlert size={14} className="mt-px shrink-0" aria-hidden />
                {w}
              </p>
            ))}
          </div>
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h3 className="flex-1 text-[12.5px] font-semibold">표준</h3>
              <select
                aria-label="농도 단위"
                className={`${inputCls} w-[104px]`}
                value={concentrationUnit}
                onChange={(e) => setConcentrationUnit(e.target.value === 'mg' ? 'mg' : 'ug')}
              >
                <option value="ug">µg/mL</option>
                <option value="mg">mg/mL</option>
              </select>
              {!plate && (
                <button
                  className={btnCls}
                  onClick={() => {
                    setPaste('standards');
                    setPasteText('');
                  }}
                >
                  엑셀에서 붙여넣기
                </button>
              )}
              <button
                className={btnCls}
                disabled={d.standards.length >= 24}
                onClick={() =>
                  update({
                    ...d,
                    standards: [
                      ...d.standards,
                      {
                        conc: Math.max(...d.standards.map((s) => s.conc)) + 1,
                        reps: [
                          { abs: null, excluded: false },
                          { abs: null, excluded: false },
                        ],
                      },
                    ],
                  })
                }
              >
                <Plus size={13} aria-hidden /> 표준
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="pr-table">
                <thead>
                  <tr>
                    <th>농도 ({concentrationUnit === 'mg' ? 'mg/mL' : 'µg/mL'})</th>
                    <th>{plate ? 'well · 흡광도' : '반복 흡광도'}</th>
                    <th className="num">평균</th>
                    <th className="num">CV %</th>
                    <th className="num">보정값</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {d.standards.map((s, i) => (
                    <tr key={i}>
                      <td>
                        <input
                          aria-label={`표준 ${i + 1} 농도`}
                          type="number"
                          min="0"
                          step="any"
                          className={`${inputCls} w-[84px]`}
                          value={s.conc / unitFactor}
                          onChange={(e) =>
                            update({ ...d, standards: d.standards.map((v, j) => (i === j ? { ...v, conc: Number(e.target.value) * unitFactor } : v)) })
                          }
                        />
                      </td>
                      <td>
                        {plate ? (
                          <PlateReps data={d} kind="standard" index={i} />
                        ) : (
                          <RepInputs
                            reps={s.reps}
                            onChange={(reps) => update({ ...d, standards: d.standards.map((v, j) => (i === j ? { ...v, reps } : v)) })}
                          />
                        )}
                      </td>
                      <td className="num">{numberText(result.standards[i].mean)}</td>
                      <td className="num">{numberText(result.standards[i].cv, 1)}</td>
                      <td className="num">{numberText(result.standards[i].corrected)}</td>
                      <td>
                        <button
                          className={smallIconBtnCls}
                          aria-label={`표준 ${s.conc} µg/mL 삭제`}
                          title="표준 삭제"
                          disabled={d.standards.length <= 1}
                          onClick={() => update(removePlateRow(d, 'standard', i))}
                        >
                          <X size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </StepSection>

      <StepSection
        id="bf-samples"
        n={stepNumber('bf-samples')}
        title="시료 농도"
        actions={
          <>
            <select aria-label="연결할 배양의 세포주" className={`${inputCls} w-44`} value={lineId} onChange={(e) => setLineId(e.target.value)}>
              <option value="">배양 연결 안 함</option>
              {lines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} 배양에 연결
                </option>
              ))}
            </select>
            {!plate && (
              <button
                className={btnCls}
                onClick={() => {
                  setPaste('samples');
                  setPasteText('');
                }}
              >
                엑셀에서 붙여넣기
              </button>
            )}
            <button
              className={btnCls}
              disabled={d.samples.length >= 96}
              onClick={() =>
                update({
                  ...d,
                  samples: [
                    ...d.samples,
                    {
                      name: `시료 ${d.samples.length + 1}`,
                      dilution: 1,
                      cultureId: null,
                      reps: [
                        { abs: null, excluded: false },
                        { abs: null, excluded: false },
                      ],
                    },
                  ],
                })
              }
            >
              <Plus size={13} aria-hidden /> 시료
            </button>
          </>
        }
      >
        {d.samples.length ? (
          <div className="overflow-x-auto">
            <table className="pr-table">
              <thead>
                <tr>
                  <th>시료</th>
                  <th>희석배수</th>
                  {showCulture && <th>연결 배양</th>}
                  <th>{plate ? 'well · 흡광도' : '반복 흡광도'}</th>
                  <th className="num">평균</th>
                  <th className="num">CV %</th>
                  <th className="num">Well µg/mL</th>
                  <th className="num">원액 µg/µL</th>
                  <th>확인</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d.samples.map((s, i) => {
                  const r = result.samples[i];
                  return (
                    <tr key={i}>
                      <td>
                        <span className="flex items-center gap-2">
                          <i className="bf-dot" style={{ '--sample-hue': sampleHue(i) } as CSSProperties} aria-hidden />
                          <input
                            aria-label={`시료 ${i + 1} 이름`}
                            className={`${inputCls} w-36`}
                            value={s.name}
                            onChange={(e) => update({ ...d, samples: d.samples.map((v, j) => (i === j ? { ...v, name: e.target.value } : v)) })}
                          />
                        </span>
                      </td>
                      <td>
                        <input
                          aria-label={`${s.name} 희석배수`}
                          type="number"
                          min="0"
                          step="any"
                          className={`${inputCls} w-[68px]`}
                          value={s.dilution}
                          onChange={(e) =>
                            update({ ...d, samples: d.samples.map((v, j) => (i === j ? { ...v, dilution: Number(e.target.value) } : v)) })
                          }
                        />
                      </td>
                      {showCulture && (
                        <td>
                          <select
                            aria-label={`${s.name} 연결 배양`}
                            className={`${inputCls} w-36`}
                            value={s.cultureId ?? ''}
                            onChange={(e) =>
                              update({ ...d, samples: d.samples.map((v, j) => (i === j ? { ...v, cultureId: e.target.value || null } : v)) })
                            }
                          >
                            <option value="">연결 없음</option>
                            {s.cultureId && !cultures.some((c) => c.id === s.cultureId) && <option value={s.cultureId}>연결된 배양</option>}
                            {cultures.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                        </td>
                      )}
                      <td>
                        {plate ? (
                          <PlateReps data={d} kind="sample" index={i} />
                        ) : (
                          <RepInputs
                            reps={s.reps}
                            onChange={(reps) => update({ ...d, samples: d.samples.map((v, j) => (i === j ? { ...v, reps } : v)) })}
                          />
                        )}
                      </td>
                      <td className="num">{numberText(r.mean)}</td>
                      <td className="num">{numberText(r.cv, 1)}</td>
                      <td className="num">{numberText(r.wellUgPerMl, 1)}</td>
                      <td className="num">
                        <span className="bf-result">{numberText(r.stockUgPerUl, 3)}</span>
                      </td>
                      <td>
                        {r.flags.map((f) => (
                          <span key={f} className="mr-1 inline-block whitespace-nowrap rounded-md bg-warning-soft px-1.5 py-0.5 text-[11px] text-warning">
                            {flagLabels[f]}
                          </span>
                        ))}
                      </td>
                      <td>
                        <button
                          className={smallIconBtnCls}
                          aria-label={`${s.name} 삭제`}
                          title="시료 삭제"
                          onClick={() => {
                            setSelected([]);
                            update(removePlateRow(d, 'sample', i));
                          }}
                        >
                          <X size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="workbench-empty">
            아직 시료가 없습니다.
            <br />
            {plate ? '2단계 왼쪽 목록의 + 로 시료를 만들고 well을 칠하세요.' : '오른쪽 위 ‘시료’ 버튼으로 추가하고 반복 흡광도를 입력하세요.'}
          </p>
        )}
      </StepSection>

      <StepSection id="bf-western" n={stepNumber('bf-western')} title="Western 로딩" hint="고른 시료의 조제량을 계산해 Western 실험으로 넘깁니다">
        <BradfordLoading data={d} result={result} onChange={update} onCreateWestern={makeWestern} selected={selected} onSelectedChange={setSelected} />
      </StepSection>

      <details className="workbench-section workbench-panel" open={!!detail.assay.protocol_id || !!d.notes || undefined}>
        <summary>
          <ChevronRight size={14} aria-hidden /> 프로토콜 · 메모
        </summary>
        <div className="workbench-section-body space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="연결 프로토콜"
              className={`${inputCls} w-72`}
              value={detail.assay.protocol_id ?? ''}
              onChange={(e) => change({ ...detail, assay: { ...detail.assay, protocol_id: e.target.value || null } })}
            >
              <option value="">연결한 프로토콜 없음</option>
              {protocols.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
            <button className={btnCls} disabled={!protocol} onClick={() => setShowProtocol(true)}>
              프로토콜 보기
            </button>
          </div>
          <textarea
            aria-label="메모"
            placeholder="메모"
            className={`${inputCls} min-h-24`}
            value={d.notes}
            onChange={(e) => update({ ...d, notes: e.target.value })}
          />
        </div>
      </details>

      {paste && (
        <Dialog
          title="엑셀에서 붙여넣기"
          onClose={() => setPaste(null)}
          width={650}
          footer={
            <button className={primaryBtnCls} onClick={applyPaste}>
              적용
            </button>
          }
        >
          <p className="mb-2 text-sm text-fg-muted">
            탭·쉼표·공백으로 구분한 반복값을 붙여넣으세요. 표준은 농도 열을 앞에 넣거나 행 순서대로 입력합니다. 시료는 이름을 앞에 넣을 수
            있습니다. 붙여넣기 농도 열은 항상 µg/mL 기준입니다 (mg/mL × 1000).
          </p>
          <textarea autoFocus className={`${inputCls} min-h-60 font-mono`} value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
        </Dialog>
      )}
      {showProtocol && protocol && (
        <aside className="fixed inset-y-0 right-0 z-50 w-full max-w-xl overflow-y-auto border-l border-line bg-raised p-6 shadow-xl">
          <button className={btnCls} onClick={() => setShowProtocol(false)}>
            닫기
          </button>
          <h2 className="my-4 font-semibold">{protocol.title}</h2>
          <ProtocolPreview protocol={{ ...protocol, body_md: protocol.body_md ?? protocol.bodyMd ?? '' }} />
        </aside>
      )}
    </div>
  );
}
