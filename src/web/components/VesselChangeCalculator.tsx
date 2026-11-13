import { useMemo, useState } from 'react';
import type { CultureVesselUse } from '../../shared/lab-products';
import { calculateVesselChange, type VesselSeed } from '../../shared/vessel-change';
import { useVesselProducts } from '../state/lab-products';
import { inputCls } from './Dialog';
import { mediumRangeText, VesselUsePicker } from './VesselUsePicker';

const fmt = (n: number) => n.toLocaleString('ko-KR', { maximumSignificantDigits: 4 });
type SeedMode = VesselSeed['kind'];
const SEED_LABELS: Record<SeedMode, string> = {
  density: '목표 밀도 입력 (cells/cm²)',
  cells: '실제 접종 세포 수 입력',
  same_density: '현재 밀도 유지',
};

/**
 * Cells and density when moving a culture to another vessel product.
 * Uses only the specs entered on the products: it never treats two formats as equivalent.
 */
export function VesselChangeCalculator({ source }: { source?: { use: CultureVesselUse | null } }) {
  const { items } = useVesselProducts();
  const [from, setFrom] = useState<CultureVesselUse | null>(source?.use ?? null);
  const [to, setTo] = useState<CultureVesselUse | null>(null);
  const [mode, setMode] = useState<SeedMode>('density');
  const [density, setDensity] = useState('');
  const [cells, setCells] = useState('');
  const [sourceCells, setSourceCells] = useState('');

  const outcome = useMemo(() => {
    const fromProduct = from && items?.find((p) => p.id === from.vesselProductId);
    const toProduct = to && items?.find((p) => p.id === to.vesselProductId);
    if (!toProduct || !to) return { error: '목표 용기와 사용한 well 수를 선택하세요.' } as const;
    if (mode === 'density' && density.trim() === '') return { error: '목표 밀도를 입력하세요.' } as const;
    if (mode === 'cells' && cells.trim() === '') return { error: '접종 세포 수를 입력하세요.' } as const;
    const seed: VesselSeed =
      mode === 'density' ? { kind: 'density', densityPerCm2: Number(density) } : mode === 'cells' ? { kind: 'cells', cells: Number(cells) } : { kind: 'same_density' };
    try {
      return {
        result: calculateVesselChange({
          source: fromProduct && from ? { product: fromProduct, usedWells: from.usedWells, cells: sourceCells.trim() === '' ? null : Number(sourceCells) } : null,
          target: { product: toProduct, usedWells: to.usedWells },
          seed,
        }),
        toProduct,
        to,
      } as const;
    } catch (e) {
      return { error: (e as Error).message } as const;
    }
  }, [items, from, to, mode, density, cells, sourceCells]);

  return (
    <section className="grid gap-4" aria-label="용기 변경 계산">
      <div className="grid gap-4 lg:grid-cols-2">
        <fieldset className="grid gap-2 rounded-xl border border-line p-3">
          <legend className="px-1 text-[13px] font-medium text-fg">현재 용기 (선택)</legend>
          <VesselUsePicker value={from} onChange={(use) => setFrom(use)} withMedium={false} />
          <label className="block text-[12.5px] font-medium text-fg">
            현재 용기의 세포 수 (선택)
            <input
              className={`${inputCls} mt-1`}
              aria-label="현재 세포 수"
              type="number"
              min={0}
              step="any"
              value={sourceCells}
              onChange={(e) => setSourceCells(e.target.value)}
            />
          </label>
        </fieldset>
        <fieldset className="grid gap-2 rounded-xl border border-line p-3">
          <legend className="px-1 text-[13px] font-medium text-fg">목표 용기</legend>
          <VesselUsePicker value={to} onChange={(use) => setTo(use)} withMedium={false} />
        </fieldset>
      </div>
      <fieldset className="grid gap-2 rounded-xl border border-line p-3">
        <legend className="px-1 text-[13px] font-medium text-fg">접종 기준</legend>
        <div className="flex flex-wrap gap-4 text-[13px]">
          {(Object.keys(SEED_LABELS) as SeedMode[]).map((m) => (
            <label key={m} className="flex items-center gap-1.5">
              <input type="radio" name="seed-mode" checked={mode === m} onChange={() => setMode(m)} />
              {SEED_LABELS[m]}
            </label>
          ))}
        </div>
        {mode === 'density' && (
          <input className={`${inputCls} max-w-56`} aria-label="목표 밀도 cells/cm²" type="number" min={0} step="any" placeholder="cells/cm²" value={density} onChange={(e) => setDensity(e.target.value)} />
        )}
        {mode === 'cells' && (
          <input className={`${inputCls} max-w-56`} aria-label="접종 세포 수" type="number" min={0} step="any" placeholder="cells" value={cells} onChange={(e) => setCells(e.target.value)} />
        )}
        {mode === 'same_density' && <p className="text-[12px] text-fg-muted">현재 용기의 사용 면적과 세포 수로 계산한 밀도를 목표 면적에 적용합니다.</p>}
      </fieldset>
      {'error' in outcome ? (
        <p className="text-[13px] text-fg-muted" role="status">
          {outcome.error}
        </p>
      ) : (
        <div className="grid gap-2 rounded-xl border border-line bg-sunken p-4 text-[13px]" role="status" data-testid="vessel-change-result">
          <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {outcome.result.sourceAreaCm2 !== null && (
              <div>
                <dt className="text-fg-muted">현재 총 면적</dt>
                <dd className="font-medium text-fg">{fmt(outcome.result.sourceAreaCm2)} cm²</dd>
              </div>
            )}
            {outcome.result.sourceDensityPerCm2 !== null && (
              <div>
                <dt className="text-fg-muted">현재 밀도</dt>
                <dd className="font-medium text-fg">{fmt(outcome.result.sourceDensityPerCm2)} cells/cm²</dd>
              </div>
            )}
            <div>
              <dt className="text-fg-muted">목표 총 면적 ({outcome.to.usedWells} well)</dt>
              <dd className="font-medium text-fg">{fmt(outcome.result.targetAreaCm2)} cm²</dd>
            </div>
            {outcome.result.areaRatio !== null && (
              <div>
                <dt className="text-fg-muted">면적 비율 (목표/현재)</dt>
                <dd className="font-medium text-fg">× {fmt(outcome.result.areaRatio)}</dd>
              </div>
            )}
            <div>
              <dt className="text-fg-muted">접종 세포 수</dt>
              <dd className="font-medium text-fg">{fmt(outcome.result.targetCells)} cells</dd>
            </div>
            <div>
              <dt className="text-fg-muted">결과 밀도</dt>
              <dd className="font-medium text-fg">{fmt(outcome.result.resultingDensityPerCm2)} cells/cm²</dd>
            </div>
            <div>
              <dt className="text-fg-muted">권장 배지 부피</dt>
              <dd className="font-medium text-fg">{mediumRangeText(outcome.toProduct, outcome.to.usedWells) ?? '미등록'}</dd>
            </div>
          </dl>
          {outcome.result.warnings.map((w) => (
            <p key={w} className="text-[12px] text-warning">
              {w}
            </p>
          ))}
          {outcome.result.surface.check === 'match_stated' && (
            <p className="text-[12px] text-fg-muted">두 용기의 표면 처리 표기가 같습니다. 실제 적합성은 제품 사양으로 확인하세요.</p>
          )}
        </div>
      )}
    </section>
  );
}
