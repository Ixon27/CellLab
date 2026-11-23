import { useMemo, useState } from 'react';
import { formatCount, hemocytometer } from '../../shared/cell-count';
import { Field, inputCls, smallBtnCls } from './Dialog';

export interface CellCountValues {
  cellsPerMl: number;
  viabilityPct: number | null;
  totalCells: number;
}
export function CellCountCalculator({
  volume,
  onApply,
}: {
  volume: string;
  onApply(values: CellCountValues): void;
}) {
  const [live, setLive] = useState(['', '', '', '']);
  const [dead, setDead] = useState(['', '', '', '']);
  const [dilution, setDilution] = useState('2');
  const result = useMemo(() => {
    try {
      if (!live.some((v) => v.trim()) || !Number.isFinite(Number(volume)) || Number(volume) <= 0) return null;
      const counts = hemocytometer({
        liveCounts: live.filter((v) => v.trim()).map(Number),
        deadCounts: dead.filter((v) => v.trim()).map(Number),
        dilutionFactor: Number(dilution),
      });
      // Viability is recorded to 0.1 %, the precision a hemocytometer count supports.
      const paired = live.every((v, i) => Boolean(v.trim()) === Boolean(dead[i].trim()));
      const viabilityPct = !paired || counts.viabilityPct === null ? null : Math.round(counts.viabilityPct * 10) / 10;
      return { cellsPerMl: counts.cellsPerMl, viabilityPct, totalCells: counts.cellsPerMl * Number(volume) };
    } catch {
      return null;
    }
  }, [live, dead, dilution, volume]);
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
      </div>
      {result ? (
        <div className="text-sm">
          {formatCount(result.cellsPerMl)} cells/mL · 생존율 {result.viabilityPct === null ? '미측정' : `${result.viabilityPct.toFixed(1)}%`} · 회수 생세포{' '}
          {formatCount(result.totalCells)}개{' '}
          <button type="button" className={smallBtnCls} onClick={() => onApply(result)}>
            기록에 적용
          </button>
        </div>
      ) : (
        <p className="text-xs text-fg-muted">카운트와 유효한 희석배수를 입력하세요.</p>
      )}
      <p className="text-xs text-fg-muted">위의 펠릿 현탁 부피를 사용합니다. 생존율은 생세포와 사세포를 같은 칸에서 모두 기록할 때만 계산합니다.</p>
    </details>
  );
}
