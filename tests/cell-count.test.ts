import { describe, expect, it } from 'vitest';
import { formatCount, hemocytometer, seedingVolume, targetCellsFor } from '../src/shared/cell-count';

describe('세포 수 계산', () => {
  it('혈구계산판 농도와 생존율을 계산한다', () => {
    const result = hemocytometer({ liveCounts: [50, 48, 52, 50], deadCounts: [5, 5, 5, 5], dilutionFactor: 2 });
    expect(result.cellsPerMl).toBe(1e6);
    expect(result.viabilityPct).toBeCloseTo(90.909, 2);
  });
  it('필요한 접종 부피를 계산한다', () => {
    expect(seedingVolume({ cellsPerMl: 1e6, targetCells: 2e6 })).toBe(2);
    expect(() => seedingVolume({ cellsPerMl: 0, targetCells: 2e6 })).toThrow();
  });
  it('용기 면적으로 목표 세포 수를 계산한다', () => {
    expect(targetCellsFor('T75', 2e4)).toBe(1.5e6);
    expect(targetCellsFor('알수없음', 2e4)).toBeNull();
  });
  it('카운트가 0이면 생존율은 미정이다', () => {
    expect(hemocytometer({ liveCounts: [0], deadCounts: [0], dilutionFactor: 2 })).toEqual({ cellsPerMl: 0, viabilityPct: null });
  });
  it('세포 수를 지수 표기로 보여 준다', () => {
    expect(formatCount(1e6)).toBe('1.00 × 10⁶');
    expect(formatCount(1.5e5)).toBe('1.50 × 10⁵');
    expect(formatCount(0)).toBe('0');
  });
});
