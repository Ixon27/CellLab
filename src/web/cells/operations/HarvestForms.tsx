import { useState } from 'react';
import { formatCount } from '../../../shared/cell-count';
import type { CellLineDto, CultureDto } from '../../../shared/cell-line';
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
import { Field, inputCls, primaryBtnCls, smallBtnCls, smallPrimaryBtnCls } from '../../components/Dialog';
import { VesselChangeCalculator } from '../../components/VesselChangeCalculator';
import { VesselUsePicker } from '../../components/VesselUsePicker';
import { executionProfile } from '../culture-plan-state';
import { ProtocolRunSection } from '../ProtocolRun';
import { composeOperationNote, FieldRow, FormError, isoFromInput, localInput, optionalNumber, PlanRecordSection } from './common';
import { freezeRequest, FreezeStockFields, initialFreezeDraft, planFreeze, type FreezeStockDraft } from './FreezeMix';
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
  input: 'target' | 'cells' | 'volume';
}
const newChild = (): Child => ({ vessel: '', label: '', use: null, product: null, cells: '', suspensionMl: '', input: 'target' });
const unitsOf = (c: Child) => c.use?.usedWells ?? 1;

/** Inputs of one passage record. Plate-by-plate passages keep one per plate: the common one unless that plate differs. */
interface PassageDraft {
  confluency: string;
  counter: CounterDraft;
  recovered: string;
  concentration: string;
  manualViability: number | null;
  targetDensity: string;
  children: Child[];
  ratio: string | null;
  leftover: LeftoverHandling;
  freeze: FreezeStockDraft;
}

/** Counts, the 1:N split and the leftover freeze plan of one draft; `plateCount` = how many plates the cells came from. */
function derivePassage(draft: PassageDraft, culture: CultureDto, plateCount: number, line: CellLineDto) {
  const { counted, problem: counterProblem } = readCounter(draft.counter);
  const concentrationN = counted ? counted.liveCellsPerMl : numberOrNull(draft.concentration);
  const suspensionN = numberOrNull(draft.counter.countSuspensionMl);
  const recoveredN = counted ? counted.liveCells : numberOrNull(draft.recovered) ??
    (concentrationN !== null && suspensionN !== null ? concentrationN * suspensionN : null);
  const viabilityPct = counted ? counted.viabilityPct : draft.manualViability;
  const childAreas = draft.children.map((c) => (c.product && c.use ? vesselArea(c.product, c.use.usedWells) : null));
  const density = numberOrNull(draft.targetDensity);
  const children = draft.children.map((c, i) => {
    const units = unitsOf(c);
    if (c.input === 'volume') {
      return { ...c, cells: concentrationN && Number(c.suspensionMl) > 0 ? String(Math.round(Number(c.suspensionMl) * units * concentrationN)) : '' };
    }
    const area = childAreas[i];
    const cells = c.input === 'target'
      ? density && density > 0 && area && concentrationN && recoveredN !== null ? String(Math.round(density * area)) : ''
      : c.cells;
    const suspensionMl = concentrationN && Number(cells) > 0 ? String(Number(cells) / (concentrationN * units)) : '';
    return { ...c, cells, suspensionMl };
  });
  const volumeConflict = children.some((c) => c.use?.mediumMl != null && Number(c.suspensionMl) * unitsOf(c) > c.use.mediumMl + 1e-9);
  const seededKnown = children.every((c) => c.cells.trim() !== '');
  const seeded = children.reduce((sum, c) => sum + (Number(c.cells) || 0), 0);
  const leftoverCells = recoveredN === null || !seededKnown ? null : Math.max(0, recoveredN - seeded);
  // The pellet is always resuspended; each new dish gets the same volume of that suspension.
  const pipettedKnown = children.every((c) => Number(c.suspensionMl) > 0);
  const pipetted = children.reduce((s, c) => s + (Number(c.suspensionMl) || 0) * unitsOf(c), 0);

  // Vessel sizes in one unit: cm² when every vessel has an area on record, else vessel counts.
  const source = culture.vesselUse;
  const multiPlate = culture.plates.length > 1;
  // Only the plates the cells came from count as the area they grew on.
  const fullArea = source ? vesselArea(source.product, source.usedWells) : null;
  const sourceArea = fullArea === null ? null : fullArea * (multiPlate ? plateCount / culture.plates.length : 1);
  const areaKnown = sourceArea !== null && childAreas.every((a) => a !== null);
  const before = areaKnown ? sourceArea : multiPlate ? Math.max(1, plateCount) : (source?.usedWells ?? 1);
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
  const freezePlan =
    draft.leftover === 'frozen' ? planFreeze({ availableCells: leftoverCells, suspensionCellsPerMl: concentrationN, draft: draft.freeze, line }) : null;
  return {
    counted,
    viabilityPct,
    children,
    volumeConflict,
    counterProblem,
    recoveredN,
    concentrationN,
    seededKnown,
    seeded,
    leftoverCells,
    suspensionN,
    childAreas,
    before,
    after,
    auto,
    factor: splitFactor(draft.ratio ?? auto.text),
    freezePlan,
  };
}
type PassageDerived = ReturnType<typeof derivePassage>;

/** The per-record part of a passage request; throws the first input problem. */
function passageRequest(draft: PassageDraft, d: PassageDerived) {
  if (d.counterProblem) throw new Error(d.counterProblem);
  if (d.volumeConflict) throw new Error('현탁액 부피가 최종 배양 부피보다 큽니다. 목표·현탁액 농도·최종 부피를 확인하세요');
  const { children } = d;
  const filled = children.filter((c) => c.cells.trim()).length;
  if (filled && !d.seededKnown) throw new Error('접종 세포 수는 모든 새 배양에 넣거나 모두 비워 두세요');
  if (children.some((c) => c.cells.trim() && !(Number(c.cells) > 0))) throw new Error('접종 세포 수는 0보다 커야 합니다');
  if (filled && d.recoveredN === null) throw new Error('접종 세포 수를 적으려면 회수한 생세포 수(계수기 값 또는 직접 입력)가 필요합니다');
  if (filled && d.recoveredN !== null)
    passageConservation(
      d.recoveredN,
      children.map((c) => Number(c.cells)),
    );
  if (draft.leftover === 'frozen' && d.leftoverCells === null) throw new Error('남은 세포를 동결하려면 회수 생세포 수와 접종 세포 수가 필요합니다');
  let freeze: Record<string, unknown> | null = null;
  if (draft.leftover === 'frozen' && d.freezePlan && d.leftoverCells !== null) {
    const request = freezeRequest(d.freezePlan, draft.freeze, { recoveredLiveCells: d.leftoverCells, retainedCells: 0, suspensionCellsPerMl: d.concentrationN });
    freeze = { ...request, note: '계대하고 남은 세포 동결' };
  }
  const { concentrationN } = d;
  return {
    confluencyPct: optionalNumber(draft.confluency, 'Confluency'),
    viabilityPct: d.viabilityPct,
    count: d.counted?.extras ?? (d.suspensionN ? { countSuspensionMl: d.suspensionN } : null),
    recoveredLiveCells: d.recoveredN,
    cellsPerMl: concentrationN,
    splitRatio: draft.ratio ?? d.auto.text,
    children: children.map((c) => ({
      vessel: c.vessel,
      vesselUse: c.use,
      label: c.label,
      seededCells: d.seededKnown ? Number(c.cells) : null,
      seededVolumeMl: Number(c.suspensionMl) > 0 ? Number(c.suspensionMl) * unitsOf(c) : null,
    })),
    keepParent: draft.leftover === 'kept',
    freeze,
  };
}

/**
 * Passage: count right before (counter screen + confluency), seed new vessels, and decide what happens to the cells
 * not seeded (discard, keep growing in the original vessel, or freeze as stock in the same step). Several plates are
 * either pooled into one record or passaged plate by plate: common conditions, with any plate given its own.
 */
export function PassageForm({ line, culture, profiles, initialAt, defaultCellsPerVial, onSaved }: OperationProps) {
  const [at, setAt] = useState(() => localInput(initialAt ?? Date.now()));
  const [reagent, setReagent] = useState('');
  const [common, setCommon] = useState<PassageDraft>(() => ({
    confluency: '',
    counter: emptyCounter(),
    recovered: '',
    concentration: '',
    manualViability: null,
    targetDensity: line.passageCellsPerCm2 === null ? '' : String(line.passageCellsPerCm2),
    children: [newChild()],
    ratio: null,
    leftover: 'discarded',
    freeze: initialFreezeDraft(defaultCellsPerVial),
  }));
  const activePlates = culture.plates.filter((p) => p.status === 'active').map((p) => p.no);
  const [sourcePlates, setSourcePlates] = useState<number[]>(activePlates);
  const [perPlate, setPerPlate] = useState(false);
  /** Plate-by-plate mode: plates whose conditions differ from the common ones. */
  const [own, setOwn] = useState<Record<number, PassageDraft>>({});
  /** Plate-by-plate mode: the plate being edited; null = the common conditions. */
  const [tab, setTab] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [records, setRecords] = useState<Record<string, string>>({});
  const [protocolRun, setProtocolRun] = useState<ProtocolRunEdit>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const profile = executionProfile(profiles, culture).profile;
  const multiPlate = culture.plates.length > 1;
  const byPlate = multiPlate && perPlate && sourcePlates.length > 1;

  // One passage record per plate, or one for all chosen plates pooled.
  const groups = byPlate ? sourcePlates.map((no) => ({ plates: [no], draft: own[no] ?? common })) : [{ plates: sourcePlates, draft: common }];
  const editing = byPlate && tab !== null && sourcePlates.includes(tab) ? tab : null;
  const editDraft = editing === null ? common : own[editing];
  const updateDraft = (fn: (old: PassageDraft) => PassageDraft) =>
    editing === null ? setCommon(fn) : setOwn((old) => ({ ...old, [editing]: fn(old[editing]) }));

  const leaving = groups.filter((g) => g.draft.leftover !== 'kept').flatMap((g) => g.plates);
  const remaining = activePlates.filter((no) => !leaving.includes(no));
  const unchosen = activePlates.filter((no) => !sourcePlates.includes(no));
  const outcome = [
    byPlate ? `plate별로 계대 기록 ${groups.length}개를 만듭니다.` : '',
    !remaining.length
      ? `${culture.label}은(는) 계대 완료로 종료됩니다.`
      : multiPlate
        ? `plate ${remaining.join(', ')}은(는) 활성으로 남습니다.${unchosen.length ? ' 버린 plate는 선택 패널의 plate 폐기로 기록하세요.' : ''}`
        : `${culture.label}은(는) 활성으로 남습니다.`,
    groups.some((g) => g.draft.leftover === 'frozen') ? '남은 세포로 만든 stock이 계보에 함께 생깁니다.' : '',
  ]
    .filter(Boolean)
    .join(' ');

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (multiPlate && !sourcePlates.length) throw new Error('계대한 plate를 하나 이상 고르세요');
      const shared = {
        at: isoFromInput(at),
        dissociationReagent: reagent,
        note: composeOperationNote(note, profile, 'passage', records),
        protocolRun,
      };
      const bodies = groups.map((g) => {
        try {
          return { ...shared, ...passageRequest(g.draft, derivePassage(g.draft, culture, g.plates.length, line)), sourcePlates: multiPlate ? g.plates : null };
        } catch (e) {
          throw new Error(byPlate ? `plate ${g.plates[0]}: ${(e as Error).message}` : (e as Error).message);
        }
      });
      const result = byPlate
        ? await api<{ warnings: string[] }>(`/api/cultures/${culture.id}/passage-groups`, { method: 'POST', json: { groups: bodies } })
        : await api<{ warnings: string[] }>(`/api/cultures/${culture.id}/passage`, { method: 'POST', json: bodies[0] });
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
      <Field label="계대 일시">
        <input required type="datetime-local" className={inputCls} value={at} onChange={(e) => setAt(e.target.value)} />
      </Field>
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
          {sourcePlates.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="radio" name="plate-mode" checked={!perPlate} onChange={() => setPerPlate(false)} />
                모아서 한 번에 계수·분주
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="plate-mode" checked={perPlate} onChange={() => setPerPlate(true)} />
                plate별로 따로 (공통 조건 + plate별 수정)
              </label>
            </div>
          )}
          <p className="mt-1 text-xs text-fg-muted">
            {byPlate
              ? 'plate마다 계대 기록과 새 배양을 따로 만들어 계보에서 각 plate가 자기 새 배양으로 이어집니다. 값은 plate 1개 기준입니다.'
              : sourcePlates.length > 1
                ? '고른 plate의 세포를 모아 한 번 계수하고 나눠 담은 것으로 기록합니다.'
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
      {byPlate && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <button type="button" className={editing === null ? smallPrimaryBtnCls : smallBtnCls} aria-pressed={editing === null} onClick={() => setTab(null)}>
            공통 조건
          </button>
          {sourcePlates.map((no) => (
            <button key={no} type="button" className={editing === no ? smallPrimaryBtnCls : smallBtnCls} aria-pressed={editing === no} onClick={() => setTab(no)}>
              plate {no} · {own[no] ? '따로 입력' : '공통'}
            </button>
          ))}
        </div>
      )}
      {editing !== null && (
        <label className="mb-3 flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={!own[editing]}
            onChange={(e) => {
              const checked = e.target.checked;
              setOwn((old) => {
                const next = { ...old };
                if (checked) delete next[editing];
                else next[editing] = structuredClone(common);
                return next;
              });
            }}
          />
          plate {editing}에 공통 조건 그대로 적용
        </label>
      )}
      {editDraft ? (
        <>
          {byPlate && (
            <p className="mb-3 rounded-lg bg-sunken p-3 text-xs text-fg-muted">
              {editing === null
                ? `공통 조건을 쓰는 plate(${sourcePlates.filter((no) => !own[no]).join(', ') || '없음'})마다 이 값으로 계대 기록과 새 배양을 하나씩 만듭니다.`
                : `plate ${editing}만의 값입니다. 공통 조건을 복사해 시작했으며, 이후 공통 조건을 바꿔도 이 plate에는 반영되지 않습니다.`}
            </p>
          )}
          <PassageDraftFields
            key={editing ?? 'common'}
            name={`leftover-${editing ?? 'common'}`}
            draft={editDraft}
            update={updateDraft}
            d={derivePassage(editDraft, culture, byPlate ? 1 : sourcePlates.length, line)}
            line={line}
          />
        </>
      ) : (
        <p className="mb-3 rounded-lg bg-sunken p-3 text-sm">
          plate {editing}은(는) 공통 조건 탭의 값으로 기록합니다. 이 plate만 다른 값이 있으면 위 체크를 풀어 공통 조건을 복사한 뒤 바꾸세요.
        </p>
      )}
      <p className="mb-3 text-sm text-fg-muted">{outcome}</p>
      <details className="mb-3">
        <summary className="cursor-pointer text-sm">용기 변경 계산 열기 (기록에 자동 적용하지 않음)</summary>
        <VesselChangeCalculator source={{ use: culture.vesselUse }} />
      </details>
      <Field label="메모">
        <textarea className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <FormError>{error}</FormError>
      <button className={primaryBtnCls} disabled={busy}>
        {busy ? '저장 중…' : byPlate ? `계대 저장 (plate ${groups.length}개)` : '계대 저장'}
      </button>
    </form>
  );
}

/** Count, new vessels, split and leftover handling of one passage record. */
function PassageDraftFields({
  draft,
  update,
  d,
  line,
  name,
}: {
  draft: PassageDraft;
  update(fn: (old: PassageDraft) => PassageDraft): void;
  d: PassageDerived;
  line: CellLineDto;
  /** Radio group name, unique per draft. */
  name: string;
}) {
  const set = (patch: Partial<PassageDraft>) => update((old) => ({ ...old, ...patch }));
  const patchChild = (i: number, values: Partial<Child>) =>
    update((old) => ({ ...old, children: old.children.map((v, j) => (i === j ? { ...v, ...values } : v)) }));
  const { counter, ratio } = draft;
  const { children } = d;
  const { recoveredN, suspensionN, seededKnown, seeded, leftoverCells, factor, auto } = d;

  /** Per dish: the suspension volume (and, when counted, the cells) for the chosen 1:N split. */
  function fillByRatio() {
    if (factor === null) return;
    const shares = splitShares(d.before, d.after, factor);
    update((old) => ({
      ...old,
      ratio: old.ratio ?? auto.text,
      children: old.children.map((c, i) => ({
        ...c,
        input: suspensionN && (recoveredN === null || d.concentrationN) ? 'volume' : 'cells',
        suspensionMl: suspensionN ? String(Number(((suspensionN * shares[i]) / unitsOf(c)).toPrecision(4))) : c.suspensionMl,
        cells: recoveredN !== null ? String(Math.floor(recoveredN * shares[i])) : c.cells,
      })),
    }));
  }
  function setPerDishMl(i: number, text: string) {
    patchChild(i, { input: 'volume', suspensionMl: text });
  }
  return (
    <>
      <Field label="계대 직전 confluency (%)">
        <input
          type="number"
          min="0"
          max="100"
          step="any"
          className={inputCls}
          value={draft.confluency}
          onChange={(e) => set({ confluency: e.target.value })}
        />
      </Field>
      <Field label="펠릿 현탁 부피 (mL)" hint="계수하든 안 하든 펠릿을 다시 푼 배지 부피를 적습니다. 새 dish에 덜어 넣은 양과 비교해 분주 비율을 계산합니다.">
        <input
          type="number"
          min="0"
          step="any"
          className={inputCls}
          value={counter.countSuspensionMl}
          onChange={(e) => set({ counter: { ...counter, countSuspensionMl: e.target.value } })}
        />
      </Field>
      <CellCounterFields value={counter} onChange={(next) => set({ counter: next })} withSuspension={false} />
      {!d.counted && (
        <details className="mb-3">
          <summary className="cursor-pointer text-sm">계수기 값 없이 직접 입력 · 혈구계산판</summary>
          <FieldRow>
            <Field label="회수한 살아 있는 세포 수">
              <input type="number" min="1" step="any" className={inputCls} value={draft.recovered} onChange={(e) => set({ recovered: e.target.value })} />
            </Field>
            <Field label="생세포 농도 (cells/mL, 선택)">
              <input
                type="number"
                min="0.000001"
                step="any"
                className={inputCls}
                value={draft.concentration}
                onChange={(e) => set({ concentration: e.target.value, manualViability: null })}
              />
            </Field>
          </FieldRow>
          <p className="mb-3 text-xs text-fg-muted">이미 살아 있는 세포를 센 값입니다. 생존율을 다시 곱하지 않습니다.</p>
          <CellCountCalculator
            volume={counter.countSuspensionMl}
            onApply={(v) => set({ recovered: '', concentration: String(v.cellsPerMl), manualViability: v.viabilityPct })}
          />
        </details>
      )}
      <Field label="계대 목표 파종 밀도 (cells/cm²)" hint="세포주 정보의 기본값입니다. 이번 계대만 바꾸거나 비울 수 있습니다.">
        <ScientificInput label="계대 목표 파종 밀도" value={draft.targetDensity} onChange={(targetDensity) => set({ targetDensity })} />
      </Field>
      {children.map((c, i) => {
        const area = d.childAreas[i];
        const units = unitsOf(c);
        const finalMl = c.use?.mediumMl == null ? null : c.use.mediumMl / units;
        const suspensionMl = numberOrNull(c.suspensionMl);
        const addedMl = finalMl === null || !suspensionMl ? null : finalMl - suspensionMl;
        return (
          <fieldset key={i} className="mb-4 rounded-lg border border-line p-3">
            <legend className="px-1 text-sm font-medium">새 배양 {i + 1}</legend>
            <VesselUsePicker
              value={c.use}
              finalVolume
              onChange={(use, product) => patchChild(i, { use, product })}
            />
            {!c.use && (
              <Field label={`새 배양 ${i + 1} 용기 (직접 입력)`}>
                <input required className={inputCls} value={c.vessel} onChange={(e) => patchChild(i, { vessel: e.target.value })} />
              </Field>
            )}
            <FieldRow>
              <Field label={`${c.product && c.product.wellsPerUnit > 1 ? 'well' : 'dish'} 1개당 넣을 현탁액 (mL)`}>
                <input
                  type="number"
                  min="0"
                  step="any"
                  className={inputCls}
                  placeholder="예: 0.2"
                  value={c.input === 'volume' || suspensionMl === null ? c.suspensionMl : String(Number(suspensionMl.toPrecision(6)))}
                  onChange={(e) => setPerDishMl(i, e.target.value)}
                />
              </Field>
              <Field label={`접종 세포 수 (cells, 새 배양 ${i + 1} 전체)`}>
                <ScientificInput label={`새 배양 ${i + 1} 접종 세포 수`} value={c.cells} onChange={(text) => patchChild(i, { input: 'cells', cells: text })} />
              </Field>
            </FieldRow>
            <p className="mb-2 text-xs text-fg-muted">
              {c.input === 'target'
                ? !draft.targetDensity.trim()
                  ? '목표 밀도, 접종 세포 수, 또는 현탁액 부피를 넣으세요.'
                  : area === null ? '면적이 등록된 용기를 고르면 목표 접종량을 계산합니다.'
                  : !c.cells ? '목표 부피를 계산하려면 계수값을 넣으세요.'
                  : '목표 밀도 × 새 배양 총면적'
                : c.input === 'cells' ? '입력한 세포 수 기준' : '입력한 현탁액 기준'}
              {c.cells && ` · ${formatCount(Number(c.cells) / units)} cells/개${area ? ` · ${formatCount(Number(c.cells) / area)} cells/cm²` : ''}`}
              {suspensionMl !== null && suspensionMl > 0 && ` · 현탁액 합계 ${Number((suspensionMl * units).toPrecision(6))} mL`}
              {addedMl !== null && addedMl >= -1e-9 && ` · 1개당 배지 ${Number(Math.max(0, addedMl).toPrecision(6))} mL + 현탁액 = 최종 ${Number(finalMl!.toPrecision(6))} mL`}
            </p>
            {addedMl !== null && addedMl < -1e-9 && <p className="mb-2 text-sm text-danger">필요한 현탁액이 최종 배양 부피를 넘습니다.</p>}
            {c.input !== 'target' && draft.targetDensity.trim() && (
              <button type="button" className={`${smallBtnCls} mb-2`} onClick={() => { patchChild(i, { input: 'target' }); set({ ratio: null }); }}>
                목표 밀도로 계산
              </button>
            )}
            <Field label={`새 배양 ${i + 1} 라벨 (선택)`}>
              <input className={inputCls} value={c.label} onChange={(e) => patchChild(i, { label: e.target.value })} />
            </Field>
            {children.length > 1 && (
              <button type="button" className={smallBtnCls} onClick={() => update((old) => ({ ...old, children: old.children.filter((_, j) => i !== j) }))}>
                새 배양 {i + 1} 제외
              </button>
            )}
          </fieldset>
        );
      })}
      <div className="mb-3 flex flex-wrap gap-2">
        <button
          type="button"
          className={smallBtnCls}
          disabled={children.length >= 24}
          onClick={() => update((old) => ({ ...old, children: [...old.children, newChild()] }))}
        >
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
          <input className={inputCls} maxLength={120} placeholder="예: 1:5" value={ratio ?? auto.text} onChange={(e) => set({ ratio: e.target.value })} />
          {ratio !== null && (
            <button type="button" className={smallBtnCls} onClick={() => set({ ratio: null })}>
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
              <input type="radio" name={name} checked={draft.leftover === h} onChange={() => set({ leftover: h })} />
              {LEFTOVER_LABELS[h]}
            </label>
          ))}
        </div>
        {draft.leftover === 'kept' && <p className="mt-1 text-xs text-fg-muted">세포를 덜어 낸 용기는 계대 후에도 활성으로 남습니다.</p>}
        {draft.leftover === 'frozen' && d.freezePlan && (
          <div className="mt-3">
            <FreezeStockFields line={line} draft={draft.freeze} onChange={(freeze) => set({ freeze })} plan={d.freezePlan} />
          </div>
        )}
      </fieldset>
    </>
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
  const [manualViability, setManualViability] = useState<number | null>(null);
  const [retained, setRetained] = useState('0');
  const [stock, setStock] = useState(() => initialFreezeDraft(defaultCellsPerVial));
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
  const suspensionN = counted ? counted.liveCellsPerMl : numberOrNull(suspension);
  const volume = numberOrNull(counter.countSuspensionMl);
  const recoveredN = counted ? counted.liveCells : numberOrNull(recovered) ?? (suspensionN !== null && volume !== null ? suspensionN * volume : null);
  const viabilityPct = counted ? counted.viabilityPct : manualViability;
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
          viabilityPct,
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
            <summary className="cursor-pointer text-sm">계수기 값 없이 직접 입력 · 혈구계산판</summary>
            <FieldRow>
              <Field label="회수한 살아 있는 세포 수">
                <input type="number" min="0" step="any" className={inputCls} value={recovered} onChange={(e) => setRecovered(e.target.value)} />
              </Field>
              <Field label="현탁액 생세포 농도 (cells/mL, 선택)">
                <input type="number" min="0" step="any" className={inputCls} value={suspension} onChange={(e) => { setSuspension(e.target.value); setManualViability(null); }} />
              </Field>
            </FieldRow>
            <CellCountCalculator
              volume={counter.countSuspensionMl}
              onApply={(v) => {
                setRecovered('');
                setSuspension(String(v.cellsPerMl));
                setManualViability(v.viabilityPct);
              }}
            />
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
          {viabilityPct !== null && ` · 생존율 ${viabilityPct}%`}
          {retainedN > 0 && recoveredN !== null && ` · 동결에 쓸 수 있는 세포 ${formatCount(Math.max(0, recoveredN - retainedN))}`}
        </p>
        <FreezeStockFields line={line} draft={stock} onChange={setStock} plan={plan} retainedCells={retainedN} />
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
