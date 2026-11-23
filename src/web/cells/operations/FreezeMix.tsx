import { formatCount } from '../../../shared/cell-count';
import type { CellLineDto } from '../../../shared/cell-line';
import { freezeAllocation, freezeMix, type FreezeAllocation, type FreezeMix } from '../../../shared/culture-operations';
import { MAX_FREEZING_MEDIUM_X, type MediumProduct } from '../../../shared/lab-products';
import { ScientificInput } from '../../components/CellCounterFields';
import { Field, inputCls, smallBtnCls } from '../../components/Dialog';
import { MediumProductPicker } from '../../components/MediumProductPicker';
import { FieldRow } from './common';
import './freeze.css';

const ml = (v: number) => (v < 1 ? `${Number((v * 1000).toFixed(1))} µL` : `${Number(v.toFixed(3))} mL`);
const numberOrNull = (text: string) => (text.trim() && Number.isFinite(Number(text)) ? Number(text) : null);

/** Text of the stock settings, as typed. A null target follows the line or the source vial. */
export interface FreezeStockDraft {
  targetCellsPerMl: string | null;
  sourceCellsPerVial: number | null;
  volumeMl: string;
  productId: string | null;
  medium: string;
  strengthX: string;
  dmsoPct: string;
  /** '' = as many vials as the cells allow. */
  vials: string;
  location: string;
}
export function initialFreezeDraft(sourceCellsPerVial?: number | null): FreezeStockDraft {
  return {
    targetCellsPerMl: null,
    sourceCellsPerVial: sourceCellsPerVial ?? null,
    volumeMl: '1',
    productId: null,
    medium: '',
    strengthX: '1',
    dmsoPct: '',
    vials: '',
    location: '',
  };
}
function targetConcentration(draft: FreezeStockDraft, line: CellLineDto): number | null {
  if (draft.targetCellsPerMl !== null) return numberOrNull(draft.targetCellsPerMl);
  if (line.stockCellsPerMl !== null) return line.stockCellsPerMl;
  const volume = numberOrNull(draft.volumeMl);
  return draft.sourceCellsPerVial && volume ? draft.sourceCellsPerVial / volume : null;
}

function draftCellsPerVial(draft: FreezeStockDraft, line: CellLineDto): number | null {
  const concentration = targetConcentration(draft, line);
  const volume = numberOrNull(draft.volumeMl);
  if (draft.targetCellsPerMl === null && line.stockCellsPerMl === null) return draft.sourceCellsPerVial;
  return concentration !== null && volume !== null ? concentration * volume : null;
}
/** DMSO % a product states for itself (an ingredient named DMSO in %), if any. */
function productDmso(product: MediumProduct): number | null {
  return product.ingredients.find((i) => /dmso/i.test(i.label) && i.unit.trim() === '%')?.value ?? null;
}

export interface FreezePlanView {
  allocation: FreezeAllocation | null;
  /** How the vials are filled from the counted suspension; null without a suspension concentration. */
  mix: FreezeMix | null;
  /** Vials actually frozen: the chosen count, else every vial the cells allow. */
  vials: number;
  strengthX: number | null;
  targetCellsPerVial: number | null;
  error: string;
}
/** Vials the cells allow and, from a counted suspension, how much suspension, growth medium and freezing medium go in. */
export function planFreeze(i: {
  availableCells: number | null;
  retainedCells?: number;
  suspensionCellsPerMl: number | null;
  draft: FreezeStockDraft;
  line: CellLineDto;
}): FreezePlanView {
  const target = draftCellsPerVial(i.draft, i.line);
  const volume = numberOrNull(i.draft.volumeMl);
  const strengthX = numberOrNull(i.draft.strengthX);
  const empty = { allocation: null, mix: null, vials: 0, strengthX, targetCellsPerVial: target };
  if (i.availableCells === null || !target || !volume) return { ...empty, error: '' };
  try {
    const allocation = freezeAllocation({ recoveredLiveCells: i.availableCells, retainedCells: i.retainedCells ?? 0, targetCellsPerVial: target, volumePerVialMl: volume });
    const chosen = numberOrNull(i.draft.vials);
    const vials = chosen ?? allocation.possibleVials;
    if (strengthX === null || strengthX < 1 || strengthX > MAX_FREEZING_MEDIUM_X)
      return { allocation, mix: null, vials, strengthX, targetCellsPerVial: target, error: `동결 배지 농도는 1–${MAX_FREEZING_MEDIUM_X}X로 입력하세요` };
    const mix =
      i.suspensionCellsPerMl && Number.isInteger(vials) && vials >= 0
        ? freezeMix({
            suspensionCellsPerMl: i.suspensionCellsPerMl,
            targetCellsPerVial: target,
            volumePerVialMl: volume,
            vials,
            freezingMediumX: strengthX,
            freezingMediumDmsoPct: numberOrNull(i.draft.dmsoPct),
          })
        : null;
    return { allocation, mix, vials, strengthX, targetCellsPerVial: target, error: '' };
  } catch (e) {
    return { ...empty, error: (e as Error).message };
  }
}

/** Stock fields of a freeze request (freeze, or the leftover freeze of a passage); throws a Korean message when unsavable. */
export function freezeRequest(
  plan: FreezePlanView,
  draft: FreezeStockDraft,
  cells: { recoveredLiveCells: number; retainedCells: number; suspensionCellsPerMl: number | null },
) {
  const { allocation, targetCellsPerVial: target } = plan;
  if (plan.error) throw new Error(plan.error);
  if (!allocation || !target) throw new Error('회수한 생세포 수와 바이알당 세포 수·부피를 채우세요');
  if (!Number.isInteger(plan.vials) || plan.vials < 1 || plan.vials > allocation.possibleVials)
    throw new Error(allocation.possibleVials < 1 ? '바이알 1개를 채울 세포가 부족합니다' : `동결 바이알 수는 1–${allocation.possibleVials} 사이여야 합니다`);
  if (!draft.medium.trim()) throw new Error('동결 배지를 고르거나 입력하세요');
  if (!draft.location.trim()) throw new Error('동결 stock의 보관 위치를 입력하세요');
  return {
    vials: plan.vials,
    cellsPerVial: target,
    location: draft.location,
    // The stock keeps the strength in its medium text unless the product name already states it.
    freezingMedium: draft.medium.includes(`${plan.strengthX}X`) ? draft.medium.trim() : `${draft.medium.trim()} · ${plan.strengthX}X`,
    plan: {
      ...cells,
      targetCellsPerVial: target,
      volumePerVialMl: Number(draft.volumeMl),
      desiredVials: null,
      freezingMediumX: plan.strengthX,
      freezingMediumDmsoPct: numberOrNull(draft.dmsoPct),
    },
  };
}

/**
 * Stock settings (cells per vial from the line's stock concentration, vial volume, freezing medium product and its
 * strength), the vial count chosen within what the cells allow, and the recipe for those vials.
 */
export function FreezeStockFields({
  line,
  draft,
  onChange,
  plan,
  retainedCells = 0,
}: {
  line: CellLineDto;
  draft: FreezeStockDraft;
  onChange(next: FreezeStockDraft): void;
  plan: FreezePlanView;
  retainedCells?: number;
}) {
  const set = (patch: Partial<FreezeStockDraft>) => onChange({ ...draft, ...patch });
  const { sourceCellsPerVial } = draft;
  const concentration = targetConcentration(draft, line);
  const fromDefault = draft.targetCellsPerMl === null;
  const max = plan.allocation?.possibleVials ?? 0;
  const targetHint = !fromDefault
    ? '이번 동결에만 적용'
    : line.stockCellsPerMl
      ? '세포주 정보의 stock 농도'
      : sourceCellsPerVial
        ? '입고 stock의 바이알당 세포 수를 현재 바이알 부피로 환산'
        : '세포주 정보에 stock 농도를 저장하면 기본값으로 사용합니다.';
  return (
    <>
      <FieldRow>
        <Field label="목표 stock 농도 (cells/mL)" hint={targetHint}>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <ScientificInput
                label="목표 stock 농도"
                value={draft.targetCellsPerMl ?? (concentration === null ? '' : String(concentration))}
                onChange={(text) => set({ targetCellsPerMl: text })}
              />
            </div>
            {!fromDefault && (line.stockCellsPerMl || sourceCellsPerVial) && (
              <button type="button" className={`${smallBtnCls} h-auto shrink-0`} onClick={() => set({ targetCellsPerMl: null })}>
                기본값
              </button>
            )}
          </div>
        </Field>
        <Field label="바이알당 부피 (mL)">
          <input required type="number" min="0.000001" step="any" className={inputCls} value={draft.volumeMl} onChange={(e) => set({ volumeMl: e.target.value })} />
        </Field>
      </FieldRow>
      {plan.targetCellsPerVial !== null && <p className="mb-3 text-xs text-fg-muted">바이알당 {formatCount(plan.targetCellsPerVial)} cells</p>}
      <Field label="동결 배지" hint="실험 용품에 '동결 배지'로 등록한 제품을 고르면 농도(X)와 DMSO %를 채웁니다.">
        <MediumProductPicker
          kind="freezing_medium"
          ariaLabel="동결 배지"
          placeholder="동결 배지 이름 (예: Cell Freezing Medium-DMSO)"
          value={draft.productId}
          label={draft.medium}
          onChange={(v) => {
            const dmso = v.product ? productDmso(v.product) : null;
            set({
              productId: v.productId,
              medium: v.label,
              ...(v.product?.strengthX ? { strengthX: String(v.product.strengthX) } : {}),
              ...(dmso !== null ? { dmsoPct: String(dmso) } : {}),
            });
          }}
        />
      </Field>
      <FieldRow>
        <Field label="동결 배지 농도 (X)" hint="1X = 바로 쓰는 완제품, 2X = 세포액과 1:1로 섞는 배지">
          <input required type="number" min="1" max={MAX_FREEZING_MEDIUM_X} step="any" className={inputCls} value={draft.strengthX} onChange={(e) => set({ strengthX: e.target.value })} />
        </Field>
        <Field label="동결 배지 DMSO (%, 선택)">
          <input type="number" min="0" max="100" step="any" className={inputCls} value={draft.dmsoPct} onChange={(e) => set({ dmsoPct: e.target.value })} />
        </Field>
      </FieldRow>
      <FreezeRecipe plan={plan} draft={draft} retainedCells={retainedCells} max={max} onVials={(vials) => set({ vials })} />
      <Field label="보관 위치">
        <input required className={inputCls} value={draft.location} onChange={(e) => set({ location: e.target.value })} />
      </Field>
    </>
  );
}

/** Maximum vials, the chosen count, and what to pipette for it. */
function FreezeRecipe({
  plan,
  draft,
  retainedCells,
  max,
  onVials,
}: {
  plan: FreezePlanView;
  draft: FreezeStockDraft;
  retainedCells: number;
  max: number;
  onVials(text: string): void;
}) {
  const { allocation, mix, error, vials, strengthX } = plan;
  if (!allocation)
    return (
      <div className="freeze-recipe is-empty" aria-live="polite">
        {error ? <p className="text-danger">{error}</p> : <p>회수 생세포 수, 목표 stock 농도, 바이알 부피를 넣으면 만들 수 있는 바이알 수를 계산합니다.</p>}
      </div>
    );
  const volume = Number(draft.volumeMl);
  const used = vials * (plan.targetCellsPerVial ?? 0);
  const leftover = Math.max(0, allocation.availableCells - used);
  const x = strengthX ?? 1;
  const liquidPerVial = x > 1 ? volume - volume / x : 0;
  return (
    <div className="freeze-recipe" aria-live="polite">
      <div className="freeze-recipe-head">
        <div>
          <span>만들 수 있는 최대</span>
          <strong>{max.toLocaleString()} vial</strong>
        </div>
        <label className="freeze-vial-picker">
          <span>동결할 바이알 수</span>
          <span className="flex items-center gap-2">
            <input
              type="range"
              min={max ? 1 : 0}
              max={max}
              step={1}
              disabled={max < 1}
              aria-label="동결할 바이알 수 슬라이더"
              value={Math.min(vials, max)}
              onChange={(e) => onVials(e.target.value)}
            />
            <input
              type="number"
              min={1}
              max={max}
              step={1}
              className={`${inputCls} w-20`}
              aria-label="동결할 바이알 수"
              placeholder={String(max)}
              value={draft.vials}
              onChange={(e) => onVials(e.target.value)}
            />
          </span>
        </label>
      </div>
      {max < 1 && (
        <p className="text-danger">
          바이알 1개에 필요한 세포가 부족합니다 ({formatCount(allocation.shortfallCells)} cells 부족).
        </p>
      )}
      {vials > max && <p className="text-danger">최대 {max}개까지 만들 수 있습니다.</p>}
      {error && <p className="text-danger">{error}</p>}
      <p className="freeze-recipe-cells">
        사용 {formatCount(used)} cells · 남는 세포 {formatCount(leftover)} cells
        {retainedCells > 0 && ` · 계속 배양 ${formatCount(retainedCells)} cells`}
        {vials >= 1 && ` · 최종 ${ml(volume * vials)}`}
      </p>
      {mix?.countedSuspensionMl != null && vials >= 1 && vials <= max && !error && (
        <p className="freeze-recipe-cells">
          원 현탁액 {ml(mix.countedSuspensionMl)} / 최종 stock {ml(volume * vials)} · 동결에 쓸 수 있는 세포 중{' '}
          {Number(((used / allocation.availableCells) * 100).toFixed(1))}% 사용
        </p>
      )}
      {vials >= 1 && vials <= max && !error && (
        <ol className="freeze-steps">
          {mix ? (
            <MixSteps mix={mix} />
          ) : x > 1 ? (
            <>
              <li>원심 후 펠릿을 배지 <strong>{ml(liquidPerVial * vials)}</strong>에 현탁</li>
              <li>
                동결 배지({x}X) <strong>{ml((volume / x) * vials)}</strong>를 넣고 섞기
              </li>
              <li>바이알 {vials}개에 {ml(volume)}씩 분주</li>
            </>
          ) : (
            <>
              <li>원심 후 펠릿을 동결 배지 <strong>{ml(volume * vials)}</strong>에 현탁</li>
              <li>바이알 {vials}개에 {ml(volume)}씩 분주</li>
            </>
          )}
        </ol>
      )}
      {!mix && vials >= 1 && <p className="text-fg-muted">Live cell concentration을 넣으면 덜어 낼 현탁액 양까지 계산합니다.</p>}
    </div>
  );
}

function MixSteps({ mix }: { mix: FreezeMix }) {
  const x = mix.freezingMediumX ?? 1;
  const counted = mix.countedSuspensionMl ?? 0;
  const dmso = mix.finalDmsoPct === null ? '' : ` · 최종 DMSO ${Number(mix.finalDmsoPct.toFixed(2))}%`;
  if (mix.method === 'pellet')
    return (
      <>
        <li>
          계수한 현탁액 <strong>{ml(counted)}</strong>를 원심
        </li>
        <li>
          펠릿을 동결 배지 <strong>{ml(mix.totalFreezingMediumMl)}</strong>에 현탁
        </li>
        <li>
          바이알 {mix.vials}개에 {ml(mix.volumePerVialMl)}씩 분주{dmso}
        </li>
      </>
    );
  return (
    <>
      {mix.method === 'dilute' ? (
        <li>
          계수한 현탁액 <strong>{ml(counted)}</strong>
          {(mix.growthMediumMl ?? 0) > 0 && (
            <>
              {' '}
              + 배지 <strong>{ml(mix.growthMediumMl ?? 0)}</strong>
            </>
          )}{' '}
          → 세포액 {ml(mix.totalSuspensionMl)}
        </li>
      ) : (
        <li>
          현탁액이 묽어 세포액 {ml(mix.totalSuspensionMl)}에 다 담기지 않습니다. 현탁액 <strong>{ml(counted)}</strong>를 원심해 펠릿을 배지{' '}
          <strong>{ml(mix.totalSuspensionMl)}</strong>에 현탁
        </li>
      )}
      <li>
        동결 배지({x}X) <strong>{ml(mix.totalFreezingMediumMl)}</strong>를 넣고 섞기
      </li>
      <li>
        바이알 {mix.vials}개에 {ml(mix.volumePerVialMl)}씩 분주 (세포액 {ml(mix.suspensionPerVialMl)} + 동결 배지 {ml(mix.freezingMediumPerVialMl)}){dmso}
      </li>
    </>
  );
}
