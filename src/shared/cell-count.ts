import { VESSEL_AREA_CM2 } from './catalog';

export function hemocytometer({
  liveCounts,
  deadCounts,
  dilutionFactor,
}: {
  liveCounts: number[];
  deadCounts: number[];
  dilutionFactor: number;
}): { cellsPerMl: number; viabilityPct: number | null } {
  if (
    !liveCounts.length ||
    liveCounts.length > 4 ||
    deadCounts.length > 4 ||
    ![...liveCounts, ...deadCounts].every((n) => Number.isFinite(n) && n >= 0) ||
    !Number.isFinite(dilutionFactor) ||
    dilutionFactor <= 0
  )
    throw new Error('세포 수와 희석배수를 확인하세요');
  const live = liveCounts.reduce((a, b) => a + b, 0);
  const dead = deadCounts.reduce((a, b) => a + b, 0);
  return {
    cellsPerMl: (live / liveCounts.length) * dilutionFactor * 1e4,
    viabilityPct: live + dead === 0 ? null : (live / (live + dead)) * 100,
  };
}

export function seedingVolume({ cellsPerMl, targetCells }: { cellsPerMl: number; targetCells: number }): number {
  if (!Number.isFinite(cellsPerMl) || cellsPerMl <= 0 || !Number.isFinite(targetCells) || targetCells < 0)
    throw new Error('농도는 0보다 커야 하고 목표 세포 수는 0 이상이어야 합니다');
  return targetCells / cellsPerMl;
}

export function targetCellsFor(vessel: string, densityPerCm2: number): number | null {
  const area = VESSEL_AREA_CM2[vessel];
  if (area === undefined) return null;
  if (!Number.isFinite(densityPerCm2) || densityPerCm2 < 0) throw new Error('접종 밀도를 확인하세요');
  return area * densityPerCm2;
}
