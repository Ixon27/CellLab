import { useState } from 'react';
import { formatCount } from '../../../shared/cell-count';
import {
  LEFTOVER_HANDLINGS,
  LEFTOVER_LABELS,
  passageConservation,
  PLATE_STATUS_LABELS,
  splitShares,
  splitFactor,
  splitRatio,
  type LeftoverHandling,
} from '../../../shared/culture-operations';
import { vesselArea } from '../../../shared/lab-products';
import type { CultureVesselUse, VesselProduct } from '../../../shared/lab-products';
import type { ProtocolRunEdit } from '../../../shared/protocol-run';
import { api } from '../../api';
import { CellCountCalculator } from '../../components/CellCountCalculator';
import {
  CellCounterFields,
  counterResult,
  emptyCounter,
  ScientificInput,
  type CounterDraft,
  type CounterResult,
} from '../../components/CellCounterFields';
import { Field, inputCls, primaryBtnCls, smallBtnCls } from '../../components/Dialog';
import { VesselChangeCalculator } from '../../components/VesselChangeCalculator';
import { VesselUsePicker } from '../../components/VesselUsePicker';
import { executionProfile } from '../culture-plan-state';
import { ProtocolRunSection } from '../ProtocolRun';
import { composeOperationNote, FieldRow, FormError, isoFromInput, localInput, optionalNumber, PlanRecordSection } from './common';
import { freezeRequest, FreezeStockFields, initialFreezeDraft, planFreeze } from './FreezeMix';
import type { OperationProps } from './OperationForms';

/** Parsed counter values plus the message of a bad entry (shown, never thrown at render). */
function readCounter(draft: CounterDraft): { counted: CounterResult | null; problem: string } {
  try {
    return { counted: counterResult(draft), problem: '' };
  } catch (e) {
    return { counted: null, problem: (e as Error).message };
  }
}
const numberOrNull = (text: string) => (text.trim() && Number.isFinite(Number(text)) ? Number(text) : null);

interface Child {
  vessel: string;
  label: string;
  use: CultureVesselUse | null;
  product: VesselProduct | null;
  cells: string;
  /** Suspension volume actually pipetted, when entered; converted to cells with the live concentration. */
  suspensionMl: string;
}
const newChild = (): Child => ({ vessel: '', label: '', use: null, product: null, cells: '', suspensionMl: '' });

/**
 * Passage: count right before (counter screen + confluency), seed new vessels, and decide what happens to the cells
 * not seeded (discard, keep growing in the original vessel, or freeze as stock in the same step).
 */
export function PassageForm({ line, culture, profiles, initialAt, defaultCellsPerVial, onSaved }: OperationProps) {
  const [at, setAt] = useState(() => localInput(initialAt ?? Date.now()));
  const [confluency, setConfluency] = useState('');
  const [reagent, setReagent] = useState('');
  const [counter, setCounter] = useState<CounterDraft>(emptyCounter);
  const [recovered, setRecovered] = useState('');
  const [concentration, setConcentration] = useState('');
  const [children, setChildren] = useState<Child[]>([newChild()]);
  const [ratio, setRatio] = useState<string | null>(null);
  const [leftover, setLeftover] = useState<LeftoverHandling>('discarded');
  const activePlates = culture.plates.filter((p) => p.status === 'active').map((p) => p.no);
  const [sourcePlates, setSourcePlates] = useState<number[]>(activePlates);
  const multiPlate = culture.plates.length > 1;
  const restPlates = activePlates.filter((no) => !sourcePlates.includes(no));
  const [freeze, setFreeze] = useState(() => initialFreezeDraft(line, defaultCellsPerVial));
  const [note, setNote] = useState('');
  const [records, setRecords] = useState<Record<string, string>>({});
  const [protocolRun, setProtocolRun] = useState<ProtocolRunEdit>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const profile = executionProfile(profiles, culture).profile;
  const patch = (i: number, values: Partial<Child>) => setChildren((old) => old.map((v, j) => (i === j ? { ...v, ...values } : v)));
  const { counted, problem: counterProblem } = readCounter(counter);
  const recoveredN = counted?.liveCells ?? numberOrNull(recovered);
  const concentrationN = counted?.liveCellsPerMl ?? numberOrNull(concentration);
  const seededKnown = children.every((c) => c.cells.trim() !== '');
  const seeded = children.reduce((s, c) => s + (Number(c.cells) || 0), 0);
  const leftoverCells = recoveredN === null || !seededKnown ? null : Math.max(0, recoveredN - seeded);
  // The pellet is always resuspended; each new dish gets the same volume of that suspension.
  const suspensionN = numberOrNull(counter.countSuspensionMl);
  const unitsOf = (c: Child) => c.use?.usedWells ?? 1;
  const pipettedKnown = children.every((c) => Number(c.suspensionMl) > 0);
  const pipetted = children.reduce((s, c) => s + (Number(c.suspensionMl) || 0) * unitsOf(c), 0);

  // Vessel sizes in one unit: cm² when every vessel has an area on record, else vessel counts.
  const source = culture.vesselUse;
  // Only the chosen vessels count as the area the cells came from.
  const fullArea = source ? vesselArea(source.product, source.usedWells) : null;
  const sourceArea = fullArea === null ? null : fullArea * (multiPlate ? sourcePlates.length / culture.plates.length : 1);
  const childAreas = children.map((c) => (c.product && c.use ? vesselArea(c.product, c.use.usedWells) : null));
  const areaKnown = sourceArea !== null && childAreas.every((a) => a !== null);
  const before = areaKnown ? sourceArea : multiPlate ? Math.max(1, sourcePlates.length) : (source?.usedWells ?? 1);
  const after = areaKnown ? childAreas.map((a) => a ?? 0) : children.map(unitsOf);
  const afterTotal = after.reduce((s, a) => s + a, 0);
  const sizeBasis = areaKnown
    ? `면적 ${Number(before.toFixed(1))} → ${Number(afterTotal.toFixed(1))} cm²`
    : `용기 ${before}개 → ${afterTotal}개 (면적 없는 용기가 있어 개수 기준)`;
  // The ratio is how far the density was divided: from counted cells, else from the share of the suspension pipetted,
  // else assuming every cell went into the new vessels.
  const auto =
    recoveredN !== null && seededKnown && seeded > 0
      ? { text: splitRatio(before * seeded, afterTotal * recoveredN), basis: `밀도 기준 · 회수 ${formatCount(recoveredN)} 중 ${formatCount(seeded)} 접종 · ${sizeBasis}` }
      : suspensionN && pipettedKnown && pipetted > 0
        ? {
            text: splitRatio(before * pipetted, afterTotal * suspensionN),
            basis: `현탁액 기준 · ${suspensionN} mL 중 ${Number(pipetted.toPrecision(4))} mL 접종 · ${sizeBasis}`,
          }
        : { text: splitRatio(before, afterTotal), basis: `세포를 전부 나눠 담은 경우 · ${sizeBasis}` };
  const factor = splitFactor(ratio ?? auto.text);

  const freezePlan =
    leftover === 'frozen' ? planFreeze({ availableCells: leftoverCells, suspensionCellsPerMl: concentrationN, draft: freeze, line }) : null;

  /** Per dish: the suspension volume (and, when counted, the cells) for the chosen 1:N split. */
  function fillByRatio() {
    if (factor === null) return;
    const shares = splitShares(before, after, factor);
    setChildren((old) =>
      old.map((c, i) => ({
        ...c,
        suspensionMl: suspensionN ? String(Number(((suspensionN * shares[i]) / unitsOf(c)).toPrecision(4))) : c.suspensionMl,
        cells: recoveredN !== null ? String(Math.floor(recoveredN * shares[i])) : c.cells,
      })),
    );
    setRatio(ratio ?? auto.text);
  }
  /** Same suspension volume into every dish of a new culture; with a live concentration it gives the cells too. */
  function setPerDishMl(i: number, text: string) {
    const ml = Number(text);
    const units = unitsOf(children[i]);
    patch(i, { suspensionMl: text, cells: text.trim() && ml > 0 && concentrationN ? String(Math.round(ml * units * concentrationN)) : '' });
  }
  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (counterProblem) throw new Error(counterProblem);
      if (multiPlate && !sourcePlates.length) throw new Error('계대한 plate를 하나 이상 고르세요');
      const filled = children.filter((c) => c.cells.trim()).length;
      if (filled && !seededKnown) throw new Error('접종 세포 수는 모든 새 배양에 넣거나 모두 비워 두세요');
      if (children.some((c) => c.cells.trim() && !(Number(c.cells) > 0))) throw new Error('접종 세포 수는 0보다 커야 합니다');
      if (filled && recoveredN === null) throw new Error('접종 세포 수를 적으려면 회수한 생세포 수(계수기 값 또는 직접 입력)가 필요합니다');
      if (filled && recoveredN !== null)
        passageConservation(
          recoveredN,
          children.map((c) => Number(c.cells)),
        );
      if (leftover === 'frozen' && leftoverCells === null) throw new Error('남은 세포를 동결하려면 회수 생세포 수와 접종 세포 수가 필요합니다');
      let freezeBody: Record<string, unknown> | null = null;
      if (leftover === 'frozen' && freezePlan && leftoverCells !== null) {
        const request = freezeRequest(freezePlan, freeze, { recoveredLiveCells: leftoverCells, retainedCells: 0, suspensionCellsPerMl: concentrationN });
        freezeBody = { ...request, note: '계대하고 남은 세포 동결' };
      }
      const result = await api<{ warnings: string[] }>(`/api/cultures/${culture.id}/passage`, {
        method: 'POST',
        json: {
          at: isoFromInput(at),
          confluencyPct: optionalNumber(confluency, 'Confluency'),
          viabilityPct: counted?.viabilityPct ?? null,
          count: counted?.extras ?? (suspensionN ? { countSuspensionMl: suspensionN } : null),
          dissociationReagent: reagent,
          recoveredLiveCells: recoveredN,
          cellsPerMl: concentrationN,
          splitRatio: ratio ?? auto.text,
          children: children.map((c) => ({
            vessel: c.vessel,
            vesselUse: c.use,
            label: c.label,
            seededCells: seededKnown ? Number(c.cells) : null,
            seededVolumeMl: seededKnown && concentrationN && concentrationN > 0 ? Number(c.cells) / concentrationN : null,
          })),
          note: composeOperationNote(note, profile, 'passage', records),
          protocolRun,
          keepParent: leftover === 'kept',
          sourcePlates: multiPlate ? sourcePlates : null,
          freeze: freezeBody,
        },
      });
      if (result.warnings.length) alert(result.warnings.join('\n'));
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="mb-3 rounded-lg bg-sunken p-3 text-sm">
        세포를 회수·계수해 새 용기에 접종합니다. 새 배양은 P{culture.passage + 1}입니다. 배지만 바꾸려면 배지 교체를 사용하세요.
      </p>
      <PlanRecordSection profiles={profiles} culture={culture} stage="passage" lineId={line.id} records={records} onRecords={setRecords} />
      <ProtocolRunSection line={line} profile={profile} folder="passage" value={protocolRun} onChange={setProtocolRun} />
      <FieldRow>
        <Field label="계대 일시">
          <input required type="datetime-local" className={inputCls} value={at} onChange={(e) => setAt(e.target.value)} />
        </Field>
        <Field label="계대 직전 confluency (%)">
          <input type="number" min="0" max="100" step="any" className={inputCls} value={confluency} onChange={(e) => setConfluency(e.target.value)} />
        </Field>
      </FieldRow>
      {multiPlate && (
        <fieldset className="mb-3 rounded-lg border border-line p-3">
          <legend className="px-1 text-sm font-medium">계대한 plate</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {culture.plates.map((p) => (
              <label key={p.no} className={`flex items-center gap-1.5 ${p.status === 'active' ? '' : 'text-fg-dim'}`}>
                <input
                  type="checkbox"
                  disabled={p.status !== 'active'}
                  checked={sourcePlates.includes(p.no)}
                  onChange={(e) =>
                    setSourcePlates((old) => (e.target.checked ? [...old, p.no].sort((a, b) => a - b) : old.filter((n) => n !== p.no)))
                  }
                />
                plate {p.no}
                {p.status !== 'active' && ` (${PLATE_STATUS_LABELS[p.status]})`}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-fg-muted">
            {restPlates.length
              ? `고르지 않은 plate ${restPlates.join(', ')}은(는) 활성으로 남습니다. 버린 plate는 선택 패널의 plate 폐기로 기록하세요.`
              : '고른 plate가 계보에서 새 배양으로 이어집니다.'}
          </p>
        </fieldset>
      )}
      <Field label="사용한 해리 시약·농도">
        <input
          required
          maxLength={200}
          className={inputCls}
          value={reagent}
          onChange={(e) => setReagent(e.target.value)}
          placeholder="제품·농도·실제 처리 조건은 확인한 SOP를 따르세요"
        />
      </Field>
      <Field label="펠릿 현탁 부피 (mL)" hint="계수하든 안 하든 펠릿을 다시 푼 배지 부피를 적습니다. 새 dish에 덜어 넣은 양과 비교해 분주 비율을 계산합니다.">
        <input
          type="number"
          min="0"
          step="any"
          className={inputCls}
          value={counter.countSuspensionMl}
          onChange={(e) => setCounter({ ...counter, countSuspensionMl: e.target.value })}
        />
      </Field>
      <CellCounterFields value={counter} onChange={setCounter} withSuspension={false} />
      {!counted && (
        <details className="mb-3">
          <summary className="cursor-pointer text-sm">계수기 값 없이 직접 입력 · 혈구계산판</summary>
          <FieldRow>
            <Field label="회수한 살아 있는 세포 수">
              <input type="number" min="1" step="any" className={inputCls} value={recovered} onChange={(e) => setRecovered(e.target.value)} />
            </Field>
            <Field label="생세포 농도 (cells/mL, 선택)">
              <input type="number" min="0.000001" step="any" className={inputCls} value={concentration} onChange={(e) => setConcentration(e.target.value)} />
            </Field>
          </FieldRow>
          <p className="mb-3 text-xs text-fg-muted">이미 살아 있는 세포를 센 값입니다. 생존율을 다시 곱하지 않습니다.</p>
          <CellCountCalculator
            vessel={children[0].vessel}
            onApply={(v) => {
              setRecovered(String(v.totalCells));
              setConcentration(String(v.cellsPerMl));
            }}
          />
        </details>
      )}
      {children.map((c, i) => {
        const area = childAreas[i];
        return (
          <fieldset key={i} className="mb-4 rounded-lg border border-line p-3">
            <legend className="px-1 text-sm font-medium">새 배양 {i + 1}</legend>
            <VesselUsePicker
              value={c.use}
              onChange={(use, product) => {
                const ml = Number(c.suspensionMl);
                patch(i, {
                  use,
                  product,
                  ...(ml > 0 && concentrationN ? { cells: String(Math.round(ml * (use?.usedWells ?? 1) * concentrationN)) } : {}),
                });
              }}
            />
            {!c.use && (
              <Field label={`새 배양 ${i + 1} 용기 (직접 입력)`}>
                <input required className={inputCls} value={c.vessel} onChange={(e) => patch(i, { vessel: e.target.value })} />
              </Field>
            )}
            <FieldRow>
              <Field label="dish 1개당 넣은 현탁액 (mL)">
                <input
                  type="number"
                  min="0"
                  step="any"
                  className={inputCls}
                  placeholder="예: 0.2"
                  value={c.suspensionMl}
                  onChange={(e) => setPerDishMl(i, e.target.value)}
                />
              </Field>
              <Field label={`접종 세포 수 (cells, 새 배양 ${i + 1} 전체)`}>
                <ScientificInput label={`새 배양 ${i + 1} 접종 세포 수`} value={c.cells} onChange={(text) => patch(i, { cells: text, suspensionMl: '' })} />
              </Field>
            </FieldRow>
            <p className="mb-2 text-xs text-fg-muted">
              {Number(c.suspensionMl) > 0 && unitsOf(c) > 1 && `현탁액 합계 ${Number((Number(c.suspensionMl) * unitsOf(c)).toPrecision(4))} mL (${unitsOf(c)}개) · `}
              {c.cells
                ? `${concentrationN ? 'Live cell concentration × 현탁액으로 계산 · ' : ''}밀도 ${area ? `${formatCount(Number(c.cells) / area)} cells/cm²` : '면적 미확인'}${
                    unitsOf(c) > 1 ? ` · dish당 ${formatCount(Number(c.cells) / unitsOf(c))} cells` : ''
                  }`
                : concentrationN
                  ? '현탁액 부피를 넣으면 세포 수를 계산합니다.'
                  : '계수하지 않았으면 세포 수는 비워 둡니다. 현탁액 부피만으로도 분주 비율을 계산합니다.'}
            </p>
            <Field label={`새 배양 ${i + 1} 라벨 (선택)`}>
              <input className={inputCls} value={c.label} onChange={(e) => patch(i, { label: e.target.value })} />
            </Field>
            {children.length > 1 && (
              <button type="button" className={smallBtnCls} onClick={() => setChildren((old) => old.filter((_, j) => i !== j))}>
                새 배양 {i + 1} 제외
              </button>
            )}
          </fieldset>
        );
      })}
      <div className="mb-3 flex flex-wrap gap-2">
        <button type="button" className={smallBtnCls} disabled={children.length >= 24} onClick={() => setChildren((v) => [...v, newChild()])}>
          새 배양 추가
        </button>
        <button
          type="button"
          className={smallBtnCls}
          disabled={factor === null || (recoveredN === null && !suspensionN)}
          title={factor === null ? '분주 비율을 1:5처럼 입력하세요' : recoveredN === null && !suspensionN ? '펠릿 현탁 부피를 먼저 넣으세요' : undefined}
          onClick={fillByRatio}
        >
          분주 비율대로 dish당 현탁액·세포 수 채우기
        </button>
      </div>
      <Field label="분주 비율" hint={ratio === null ? `자동 계산: ${auto.basis}` : `직접 입력함 · 자동 계산은 ${auto.text} (${auto.basis})`}>
        <div className="flex gap-2">
          <input className={inputCls} maxLength={120} placeholder="예: 1:5" value={ratio ?? auto.text} onChange={(e) => setRatio(e.target.value)} />
          {ratio !== null && (
            <button type="button" className={smallBtnCls} onClick={() => setRatio(null)}>
              자동값
            </button>
          )}
        </div>
      </Field>
      <p className={`mb-3 text-sm ${recoveredN !== null && seeded > recoveredN ? 'text-danger' : 'text-fg-muted'}`}>
        회수 {recoveredN === null ? '—' : formatCount(recoveredN)} · 접종 합계 {seededKnown ? formatCount(seeded) : '—'} · 남은 세포{' '}
        {leftoverCells === null ? '—' : formatCount(leftoverCells)} cells
      </p>
      <fieldset className="mb-3 rounded-lg border border-line p-3">
        <legend className="px-1 text-sm font-medium">접종하고 남은 세포</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {LEFTOVER_HANDLINGS.map((h) => (
            <label key={h} className="flex items-center gap-1.5">
              <input type="radio" name="leftover" checked={leftover === h} onChange={() => setLeftover(h)} />
              {LEFTOVER_LABELS[h]}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-fg-muted">
          {leftover === 'kept'
            ? `${culture.label}은(는) 활성으로 남습니다.`
            : restPlates.length
              ? `고른 plate는 계대함으로 표시되고 ${culture.label}은(는) 나머지 plate로 활성으로 남습니다.${leftover === 'frozen' ? ' 남은 세포로 만든 stock이 계보에 함께 생깁니다.' : ''}`
              : `${culture.label}은(는) 계대 완료로 종료됩니다.${leftover === 'frozen' ? ' 남은 세포로 만든 stock이 계보에 함께 생깁니다.' : ''}`}
        </p>
        {leftover === 'frozen' && freezePlan && (
          <div className="mt-3">
            <FreezeStockFields line={line} draft={freeze} onChange={setFreeze} plan={freezePlan} sourceCellsPerVial={defaultCellsPerVial} />
          </div>
        )}
      </fieldset>
      <details className="mb-3">
        <summary className="cursor-pointer text-sm">용기 변경 계산 열기 (기록에 자동 적용하지 않음)</summary>
        <VesselChangeCalculator source={{ use: culture.vesselUse }} />
      </details>
      <Field label="메모">
        <textarea className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <FormError>{error}</FormError>
      <button className={primaryBtnCls} disabled={busy}>
        {busy ? '저장 중…' : '계대 저장'}
      </button>
    </form>
  );
}

/**
 * Freeze: count (counter screen + confluency), then the stock settings. The counter's live concentration × pellet
 * suspension volume gives the cells; the line's stock concentration gives the cells per vial; the vial count is chosen
 * within what the cells allow, and the freezing medium's strength fixes how much of it goes in.
 */
export function FreezeForm({ line, culture, profiles, initialAt, defaultCellsPerVial, onSaved }: OperationProps) {
  const [at, setAt] = useState(() => localInput(initialAt ?? Date.now()));
  const [confluency, setConfluency] = useState('');
  const [counter, setCounter] = useState<CounterDraft>(emptyCounter);
  const [recovered, setRecovered] = useState('');
  const [suspension, setSuspension] = useState('');
  const [retained, setRetained] = useState('0');
  const [stock, setStock] = useState(() => initialFreezeDraft(line, defaultCellsPerVial));
  const [end, setEnd] = useState(false);
  const [testVials, setTestVials] = useState('');
  const [testAt, setTestAt] = useState('');
  const [testNote, setTestNote] = useState('');
  const [note, setNote] = useState('');
  const [records, setRecords] = useState<Record<string, string>>({});
  const [protocolRun, setProtocolRun] = useState<ProtocolRunEdit>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const profile = executionProfile(profiles, culture).profile;
  const { counted, problem: counterProblem } = readCounter(counter);
  const recoveredN = counted?.liveCells ?? numberOrNull(recovered);
  const suspensionN = counted?.liveCellsPerMl ?? numberOrNull(suspension);
  const retainedN = numberOrNull(retained) ?? 0;
  const plan = planFreeze({ availableCells: recoveredN, retainedCells: retainedN, suspensionCellsPerMl: suspensionN, draft: stock, line });
  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (counterProblem) throw new Error(counterProblem);
      if (recoveredN === null) throw new Error('Live cell concentration과 펠릿 현탁 부피(또는 회수한 생세포 수)를 넣으세요');
      const request = freezeRequest(plan, stock, { recoveredLiveCells: recoveredN, retainedCells: retainedN, suspensionCellsPerMl: suspensionN });
      const composed = composeOperationNote(note, profile, 'freeze', records);
      await api(`/api/cultures/${culture.id}/freeze`, {
        method: 'POST',
        json: {
          at: isoFromInput(at),
          confluencyPct: optionalNumber(confluency, 'Confluency'),
          viabilityPct: counted?.viabilityPct ?? null,
          cellsPerMl: suspensionN,
          count: counted?.extras ?? (numberOrNull(counter.countSuspensionMl) ? { countSuspensionMl: Number(counter.countSuspensionMl) } : null),
          ...request,
          endCulture: retainedN > 0 ? false : end,
          plan: {
            ...request.plan,
            representativeThaw: testVials.trim()
              ? { vials: Number(testVials), plannedAt: testAt ? isoFromInput(testAt) : null, note: testNote }
              : null,
          },
          note: composed,
          notes: composed,
          protocolRun,
        },
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <PlanRecordSection profiles={profiles} culture={culture} stage="freeze" lineId={line.id} records={records} onRecords={setRecords} />
      <ProtocolRunSection line={line} profile={profile} folder="freeze" value={protocolRun} onChange={setProtocolRun} />
      <fieldset className="op-section">
        <legend>
          <b>1</b>계수
        </legend>
        <FieldRow>
          <Field label="동결 일시">
            <input required type="datetime-local" className={inputCls} value={at} onChange={(e) => setAt(e.target.value)} />
          </Field>
          <Field label="동결 직전 confluency (%)">
            <input type="number" min="0" max="100" step="any" className={inputCls} value={confluency} onChange={(e) => setConfluency(e.target.value)} />
          </Field>
        </FieldRow>
        <Field label="펠릿 현탁 부피 (mL)" hint="펠릿을 다시 풀어 계수한 배지 부피. Live cell concentration × 이 부피 = 회수한 생세포">
          <input
            type="number"
            min="0"
            step="any"
            className={inputCls}
            value={counter.countSuspensionMl}
            onChange={(e) => setCounter({ ...counter, countSuspensionMl: e.target.value })}
          />
        </Field>
        <CellCounterFields value={counter} onChange={setCounter} withSuspension={false} />
        {!counted && (
          <details className="mb-3">
            <summary className="cursor-pointer text-sm">계수기 값 없이 직접 입력</summary>
            <FieldRow>
              <Field label="회수한 살아 있는 세포 수">
                <input type="number" min="0" step="any" className={inputCls} value={recovered} onChange={(e) => setRecovered(e.target.value)} />
              </Field>
              <Field label="현탁액 생세포 농도 (cells/mL, 선택)">
                <input type="number" min="0" step="any" className={inputCls} value={suspension} onChange={(e) => setSuspension(e.target.value)} />
              </Field>
            </FieldRow>
          </details>
        )}
        <Field label="계속 배양할 세포 수" hint="동결하지 않고 남겨 키울 세포. 없으면 0">
          <input required type="number" min="0" step="any" className={inputCls} value={retained} onChange={(e) => setRetained(e.target.value)} />
        </Field>
      </fieldset>
      <fieldset className="op-section">
        <legend>
          <b>2</b>stock 만들기
        </legend>
        <p className="op-section-total">
          회수 생세포 <strong>{recoveredN === null ? '—' : `${formatCount(recoveredN)} cells`}</strong>
          {counted?.viabilityPct != null && ` · 생존율 ${counted.viabilityPct}%`}
          {retainedN > 0 && recoveredN !== null && ` · 동결에 쓸 수 있는 세포 ${formatCount(Math.max(0, recoveredN - retainedN))}`}
        </p>
        <FreezeStockFields line={line} draft={stock} onChange={setStock} plan={plan} retainedCells={retainedN} sourceCellsPerVial={defaultCellsPerVial} />
      </fieldset>
      <fieldset className="op-section">
        <legend>
          <b>3</b>기록
        </legend>
        <label className="mb-3 flex gap-2 text-sm">
          <input type="checkbox" checked={retainedN > 0 ? false : end} disabled={retainedN > 0} onChange={(e) => setEnd(e.target.checked)} />
          동결 후 기존 배양 종료
        </label>
        {retainedN > 0 && (
          <p className="mb-3 text-xs text-fg-muted">남겨 둔 세포가 있으므로 기존 배양은 활성으로 유지합니다. 새 용기로 계대한 작업은 별도로 기록하세요.</p>
        )}
        <details className="mb-3">
          <summary className="cursor-pointer text-sm">대표 바이알 해동 확인 계획 (선택)</summary>
          <div className="mt-2">
            <FieldRow>
              <Field label="확인할 바이알 수">
                <input type="number" min="1" max={plan.vials || undefined} className={inputCls} value={testVials} onChange={(e) => setTestVials(e.target.value)} />
              </Field>
              <Field label="해동 예정 일시">
                <input type="datetime-local" className={inputCls} value={testAt} onChange={(e) => setTestAt(e.target.value)} />
              </Field>
            </FieldRow>
            <Field label="회복 확인 방법·판단 기준">
              <textarea className={inputCls} value={testNote} onChange={(e) => setTestNote(e.target.value)} />
            </Field>
            <p className="mb-2 text-xs text-fg-muted">계획만으로 회복 확인·바이알 소모를 기록하지 않습니다. 해동 후 실제 관찰 결과는 재고 상세에서 입력합니다.</p>
          </div>
        </details>
        <Field label="메모">
          <textarea className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </fieldset>
      <FormError>{error}</FormError>
      <button className={primaryBtnCls} disabled={busy || !plan.allocation || plan.allocation.possibleVials < 1}>
        {busy ? '저장 중…' : `${plan.vials >= 1 ? `${plan.vials} vial ` : ''}동결·배분 저장`}
      </button>
    </form>
  );
}
