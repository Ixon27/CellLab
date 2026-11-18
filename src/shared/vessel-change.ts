import { vesselArea, type SurfaceTreatment, type VesselProduct } from './lab-products';

export interface VesselEnd {
  product: VesselProduct;
  usedWells: number;
}
export type VesselSeed =
  | { kind: 'density'; densityPerCm2: number }
  | { kind: 'cells'; cells: number }
  /** Seed the target at the source's measured density (needs source cells and area). */
  | { kind: 'same_density' };
export interface VesselChangeInput {
  source: (VesselEnd & { cells: number | null }) | null;
  target: VesselEnd;
  seed: VesselSeed;
}
/** not_compared: no source vessel given. match_stated: both surfaces known and the same (not a compatibility guarantee). */
export type SurfaceCheck = 'match_stated' | 'mismatch' | 'unverified' | 'not_compared';
export interface VesselChangeResult {
  sourceAreaCm2: number | null;
  sourceDensityPerCm2: number | null;
  targetAreaCm2: number;
  targetCells: number;
  resultingDensityPerCm2: number;
  /** target area / source area; null without a source area. */
  areaRatio: number | null;
  /** Recommended medium for the wells in use, only from values the user entered on the product. null = none on record. */
  mediumMl: { min: number | null; max: number | null } | null;
  surface: { check: SurfaceCheck; source: SurfaceTreatment | null; target: SurfaceTreatment };
  warnings: string[];
}

function positive(n: unknown, message: string): number {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) throw new Error(message);
  return n;
}
function checkEnd(end: VesselEnd, side: string): void {
  if (!Number.isInteger(end.usedWells) || end.usedWells < 1) throw new Error(`${side} 용기의 사용 well 수는 1 이상의 정수여야 합니다`);
}

/**
 * Cell count and density when moving cells between two arbitrary vessel products.
 * Only uses entered specs: no vessel is assumed equivalent to another, no spec is guessed.
 */
export function calculateVesselChange(input: VesselChangeInput): VesselChangeResult {
  const { source, target } = input;
  const warnings: string[] = [];
  checkEnd(target, '목표');
  if (source) checkEnd(source, '현재');

  const targetAreaCm2 = vesselArea(target.product, target.usedWells);
  if (targetAreaCm2 === null) throw new Error('목표 용기의 면적이 등록되지 않아 계산할 수 없습니다');
  const sourceAreaCm2 = source ? vesselArea(source.product, source.usedWells) : null;
  if (source && sourceAreaCm2 === null) warnings.push('현재 용기의 면적이 등록되지 않아 현재 밀도와 면적 비율을 계산하지 못했습니다');

  let sourceDensity: number | null = null;
  if (source && source.cells !== null) {
    const cells = positive(source.cells, '현재 세포 수는 0보다 큰 숫자여야 합니다');
    if (sourceAreaCm2 !== null) sourceDensity = cells / sourceAreaCm2;
  }

  let targetCells: number;
  switch (input.seed.kind) {
    case 'density':
      targetCells = positive(input.seed.densityPerCm2, '목표 밀도는 0보다 큰 숫자여야 합니다') * targetAreaCm2;
      break;
    case 'cells':
      targetCells = positive(input.seed.cells, '실제 접종 세포 수는 0보다 큰 숫자여야 합니다');
      break;
    case 'same_density':
      if (sourceDensity === null) throw new Error('현재 밀도를 쓰려면 현재 용기의 면적과 세포 수가 필요합니다');
      targetCells = sourceDensity * targetAreaCm2;
      break;
  }
  if (source && source.cells !== null && targetCells > source.cells)
    warnings.push('접종할 세포 수가 현재 용기의 세포 수보다 많습니다');

  const min = target.product.mediumMinMlPerWell === null ? null : target.product.mediumMinMlPerWell * target.usedWells;
  const max = target.product.mediumMaxMlPerWell === null ? null : target.product.mediumMaxMlPerWell * target.usedWells;
  const mediumMl = min === null && max === null ? null : { min, max };
  if (!mediumMl) warnings.push('목표 용기의 권장 배지 부피가 등록되지 않았습니다 (제품 사양에서 확인해 입력하세요)');

  let check: SurfaceCheck = source ? 'unverified' : 'not_compared';
  if (source) {
    const a = source.product.surfaceTreatment;
    const b = target.product.surfaceTreatment;
    if (a !== 'unknown' && b !== 'unknown') check = a === b ? 'match_stated' : 'mismatch';
  }
  if (check === 'mismatch') warnings.push('두 용기의 표면 처리 표기가 다릅니다. 세포 부착·성장이 달라질 수 있어 사양을 확인하세요');
  else if (check === 'not_compared' && target.product.surfaceTreatment === 'unknown') warnings.push('목표 용기의 표면 처리가 확인되지 않았습니다');
  else if (source && check === 'unverified') warnings.push('표면 처리가 확인되지 않은 용기가 있습니다. 같은 용도로 쓸 수 있다고 가정하지 마세요');
  if (source?.product.specStatus === 'reference' || target.product.specStatus === 'reference')
    warnings.push('참고 사양(미확인) 면적을 사용했습니다. 실제 제품 사양과 다를 수 있습니다');

  return {
    sourceAreaCm2,
    sourceDensityPerCm2: sourceDensity,
    targetAreaCm2,
    targetCells,
    resultingDensityPerCm2: targetCells / targetAreaCm2,
    areaRatio: sourceAreaCm2 === null ? null : targetAreaCm2 / sourceAreaCm2,
    mediumMl,
    surface: { check, source: source ? source.product.surfaceTreatment : null, target: target.product.surfaceTreatment },
    warnings,
  };
}
