import { formatCount } from '../../../shared/cell-count';
import { freezeAllocation, freezeMix, type FreezeAllocation, type FreezeMix } from '../../../shared/culture-operations';

const ml = (v: number) => (v < 1 ? `${Number((v * 1000).toFixed(1))} µL` : `${Number(v.toFixed(3))} mL`);

export interface FreezePlanView {
  allocation: FreezeAllocation | null;
  /** How each vial is filled from the counted suspension; null without a suspension concentration. */
  mix: FreezeMix | null;
  error: string;
}
/**
 * Vials the cells allow and, from a counted suspension, the suspension and freezing medium per vial.
 * `vials` is the count actually frozen (defaults to all possible vials).
 */
export function planFreeze(i: {
  availableCells: number | null;
  retainedCells?: number;
  suspensionCellsPerMl: number | null;
  targetCellsPerVial: number | null;
  volumePerVialMl: number | null;
  desiredVials?: number | null;
  vials: number | null;
  dmsoPct: number | null;
}): FreezePlanView {
  if (i.availableCells === null || !i.targetCellsPerVial || !i.volumePerVialMl) return { allocation: null, mix: null, error: '' };
  try {
    const allocation = freezeAllocation({
      recoveredLiveCells: i.availableCells,
      retainedCells: i.retainedCells ?? 0,
      targetCellsPerVial: i.targetCellsPerVial,
      volumePerVialMl: i.volumePerVialMl,
      desiredVials: i.desiredVials ?? null,
    });
    const mix = i.suspensionCellsPerMl
      ? freezeMix({
          suspensionCellsPerMl: i.suspensionCellsPerMl,
          targetCellsPerVial: i.targetCellsPerVial,
          volumePerVialMl: i.volumePerVialMl,
          vials: i.vials ?? allocation.vials,
          freezingMediumDmsoPct: i.dmsoPct,
        })
      : null;
    return { allocation, mix, error: '' };
  } catch (e) {
    return { allocation: null, mix: null, error: (e as Error).message };
  }
}

export function FreezeMixSummary({ plan, retainedCells = 0 }: { plan: FreezePlanView; retainedCells?: number }) {
  const { allocation, mix, error } = plan;
  if (error) return <p className="mb-3 text-sm text-danger">{error}</p>;
  if (!allocation) return null;
  return (
    <div className="mb-4 grid gap-0.5 rounded-lg border border-line bg-sunken p-3 text-sm" aria-live="polite">
      <p>
        동결 가능 <strong>{allocation.possibleVials.toLocaleString()} vial</strong> · 배분 {allocation.vials.toLocaleString()} vial
        {retainedCells > 0 && ` · 계속 배양 ${formatCount(retainedCells)} cells`}
      </p>
      <p className="text-fg-muted">
        동결에 사용 {formatCount(allocation.usedCells)} · 남는 세포 {formatCount(allocation.leftoverCells)}
        {allocation.shortfallCells > 0 && ` · 부족 ${formatCount(allocation.shortfallCells)}`} cells
      </p>
      {mix ? (
        <>
          <p>
            바이알당 <strong>현탁액 {ml(mix.suspensionPerVialMl)}</strong> + <strong>동결 배지 {ml(mix.freezingMediumPerVialMl)}</strong> ={' '}
            {ml(mix.volumePerVialMl)}
            {mix.finalDmsoPct !== null && ` · 최종 DMSO ${Number(mix.finalDmsoPct.toFixed(2))}%`}
          </p>
          <p className="text-fg-muted">
            {mix.vials} vial 합계: 현탁액 {ml(mix.totalSuspensionMl)} · 동결 배지 {ml(mix.totalFreezingMediumMl)}
          </p>
        </>
      ) : (
        <p className="text-fg-muted">
          펠릿을 동결 배지에 바로 풀면 동결 배지 {ml(allocation.resuspendVolumeMl)} ({Number(allocation.concentrationCellsPerMl.toPrecision(3)).toLocaleString()}{' '}
          cells/mL). 현탁액 농도를 넣으면 바이알마다 덜어 낼 현탁액·동결 배지 양을 계산합니다.
        </p>
      )}
    </div>
  );
}
