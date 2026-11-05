import { useMemo, useState } from 'react';
import { hemocytometer, seedingVolume, targetCellsFor } from '../../shared/cell-count';
import { VESSEL_AREA_CM2 } from '../../shared/catalog';
import { Field, inputCls, smallBtnCls } from './Dialog';

export interface CellCountValues {
  cellsPerMl: number;
  viabilityPct: number | null;
  totalCells: number;
}
export function CellCountCalculator({ vessel, onApply }: { vessel: string; onApply(values: CellCountValues): void }) {
  const [live, setLive] = useState(['', '', '', '']);
  const [dead, setDead] = useState(['', '', '', '']);
  const [dilution, setDilution] = useState('2');
  const [volume, setVolume] = useState('1');
  const [density, setDensity] = useState('20000');
  const [target, setTarget] = useState('');
  const result = useMemo(() => {
    try {
      if (!live.some((v) => v.trim()) || !volume.trim() || Number(volume) < 0) return null;
      const counts = hemocytometer({
        liveCounts: live.filter((v) => v.trim()).map(Number),
        deadCounts: dead.filter((v) => v.trim()).map(Number),
        dilutionFactor: Number(dilution),
      });
      return { ...counts, totalCells: counts.cellsPerMl * Number(volume) };
    } catch {
      return null;
    }
  }, [live, dead, dilution, volume]);
  let required: number | null = null;
  try {
    const cells = target.trim() ? Number(target) : targetCellsFor(vessel, Number(density));
    if (result && cells !== null) required = seedingVolume({ cellsPerMl: result.cellsPerMl, targetCells: cells });
  } catch {
    /* Invalid input is kept editable. */
  }
  return (
    <details className="rounded-lg border border-line bg-sunken p-3">
      <summary className="cursor-pointer font-medium">세포 수 계산기</summary>
      <div className="mt-3 grid grid-cols-5 gap-1 text-xs">
        <span>사각형</span>
        {[1, 2, 3, 4].map((n) => (
          <span key={n}>{n}</span>
        ))}
        <span>생세포</span>
        {live.map((v, i) => (
          <input
            key={i}
            className={inputCls}
            aria-label={`생세포 ${i + 1}`}
            type="number"
            min="0"
            value={v}
            onChange={(e) => setLive((a) => a.map((s, j) => (i === j ? e.target.value : s)))}
          />
        ))}
        <span>사세포</span>
        {dead.map((v, i) => (
          <input
            key={i}
            className={inputCls}
            aria-label={`사세포 ${i + 1}`}
            type="number"
            min="0"
            value={v}
            onChange={(e) => setDead((a) => a.map((s, j) => (i === j ? e.target.value : s)))}
          />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="희석배수 (기본 2, trypan blue 1:1)">
          <input className={inputCls} type="number" min="0" value={dilution} onChange={(e) => setDilution(e.target.value)} />
        </Field>
        <Field label="현탁 부피 (mL)">
          <input className={inputCls} type="number" min="0" value={volume} onChange={(e) => setVolume(e.target.value)} />
        </Field>
      </div>
      {result ? (
        <div className="text-sm">
          {result.cellsPerMl.toExponential(2)} cells/mL · 생존율 {result.viabilityPct?.toFixed(1) ?? '미정'}% · 총{' '}
          {result.totalCells.toExponential(2)}개{' '}
          <button type="button" className={smallBtnCls} onClick={() => onApply(result)}>
            기록에 적용
          </button>
        </div>
      ) : (
        <p className="text-xs text-fg-muted">카운트와 유효한 희석배수를 입력하세요.</p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="목표 밀도 (cells/cm²)">
          <input className={inputCls} type="number" min="0" value={density} onChange={(e) => setDensity(e.target.value)} />
        </Field>
        <Field label="또는 목표 세포 수">
          <input className={inputCls} type="number" min="0" value={target} onChange={(e) => setTarget(e.target.value)} />
        </Field>
      </div>
      <p className="text-xs text-fg-muted">
        {vessel}: {VESSEL_AREA_CM2[vessel] ?? '면적 미정'} cm² (제조사별 상이) · 필요 부피{' '}
        {required === null ? '미정' : `${required.toFixed(3)} mL`}
      </p>
    </details>
  );
}
