import { useEffect, useRef, useState } from 'react';
import { formatCount, parseScientific, powerOfTen } from '../../shared/cell-count';
import type { LogDto } from '../../shared/cell-line';
import { COUNT_FIELDS, type CellCountExtras, type CountKey } from '../../shared/culture-operations';
import { inputCls } from './Dialog';

/** Text of every input: the live-cell columns plus the counter extras, as typed. */
export type CounterDraft = Record<'livePerMl' | 'viabilityPct' | CountKey, string>;
export function emptyCounter(): CounterDraft {
  const draft = { livePerMl: '', viabilityPct: '' } as CounterDraft;
  for (const field of COUNT_FIELDS) draft[field.key] = '';
  draft.countSuspensionMl = '1';
  return draft;
}
/** The counter values a saved record holds, for editing it. */
export function counterDraftFrom(log: LogDto): CounterDraft {
  const draft = emptyCounter();
  draft.livePerMl = log.cellsPerMl === null ? '' : String(log.cellsPerMl);
  draft.viabilityPct = log.viabilityPct === null ? '' : String(log.viabilityPct);
  for (const field of COUNT_FIELDS) draft[field.key] = log.count?.[field.key] === undefined ? '' : String(log.count[field.key]);
  return draft;
}
/** One line of the stored counter values, in the order of the device screen. */
export function countText(count: CellCountExtras): string {
  return COUNT_FIELDS.filter((f) => count[f.key] !== undefined)
    .map((f) => {
      const v = count[f.key]!;
      const shown = f.unit === 'cells/mL' ? formatCount(v) : String(v);
      return `${f.label} ${shown}${f.unit ? ` ${f.unit}` : ''}`;
    })
    .join(' · ');
}

export interface CounterResult {
  liveCellsPerMl: number;
  viabilityPct: number | null;
  /** Live cells in the whole suspension (concentration × suspension volume); null without a volume. */
  liveCells: number | null;
  extras: CellCountExtras;
  /** Viability recomputed from live ÷ total concentration, when both are entered. */
  checkedViabilityPct: number | null;
}
/** Parsed counter values; null until a live concentration is entered. Throws a Korean message on a bad number. */
export function counterResult(draft: CounterDraft): CounterResult | null {
  const num = (text: string, label: string) => {
    if (!text.trim()) return null;
    const n = Number(text);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${label}을(를) 0 이상의 숫자로 입력하세요`);
    return n;
  };
  const live = num(draft.livePerMl, 'Live cell concentration');
  if (live === null) return null;
  const viability = num(draft.viabilityPct, 'Viability');
  if (viability !== null && viability > 100) throw new Error('Viability는 0–100%입니다');
  const extras: CellCountExtras = {};
  for (const field of COUNT_FIELDS) {
    const n = num(draft[field.key], field.label);
    if (n === null) continue;
    if (field.integer && !Number.isInteger(n)) throw new Error(`${field.label}은(는) 정수입니다`);
    extras[field.key] = n;
  }
  const total = extras.countTotalPerMl;
  return {
    liveCellsPerMl: live,
    viabilityPct: viability,
    liveCells: extras.countSuspensionMl === undefined ? null : live * extras.countSuspensionMl,
    extras,
    checkedViabilityPct: total ? (live / total) * 100 : null,
  };
}

/** The counter's result screen, top to bottom; the suspension volume (not on the screen) last. */
const SCREEN: { key: keyof CounterDraft; label: string; unit: string; scientific?: boolean; integer?: boolean }[] = [
  { key: 'countTotalPerMl', label: 'Total cell concentration', unit: 'cells/mL', scientific: true },
  { key: 'livePerMl', label: 'Live cell concentration', unit: 'cells/mL', scientific: true },
  { key: 'countDeadPerMl', label: 'Dead cell concentration', unit: 'cells/mL', scientific: true },
  { key: 'viabilityPct', label: 'Viability', unit: '%' },
  { key: 'countAverageSizeUm', label: 'Average size', unit: 'µm' },
  { key: 'countTotalCounted', label: 'Total cell number', unit: 'cells', integer: true },
  { key: 'countLiveCounted', label: 'Live cell number', unit: 'cells', integer: true },
  { key: 'countDeadCounted', label: 'Dead cell number', unit: 'cells', integer: true },
  { key: 'countDilution', label: 'Dilution factor', unit: '' },
  { key: 'countSuspensionMl', label: 'Suspension volume', unit: 'mL' },
];
const EXPONENTS = Array.from({ length: 13 }, (_, n) => n);

/**
 * A cell number as on the counter screen: mantissa plus a chosen power of ten (default 10⁶). Pasting
 * "1.46x10e7" or "1.46e7" into the number fills both parts. Emits the plain number as text ('' when empty);
 * a value set from outside (e.g. a calculation) is split again.
 */
export function ScientificInput({ label, value, onChange }: { label: string; value: string; onChange(text: string): void }) {
  const split = (text: string) => {
    const parsed = parseScientific(text);
    return parsed ? { mantissa: String(parsed.mantissa), exponent: parsed.exponent } : { mantissa: text, exponent: 6 };
  };
  const [parts, setParts] = useState(() => split(value));
  const emitted = useRef(value);
  useEffect(() => {
    if (value !== emitted.current) {
      emitted.current = value;
      setParts(split(value));
    }
  }, [value]);
  const emit = (mantissa: string, exponent: number) => {
    setParts({ mantissa, exponent });
    const m = mantissa.trim();
    emitted.current = m === '' ? '' : Number.isFinite(Number(m)) ? String(Number(`${m}e${exponent}`)) : m;
    onChange(emitted.current);
  };
  return (
    <div className="cell-sci-input">
      <input
        className={inputCls}
        aria-label={`${label} 앞자리`}
        inputMode="decimal"
        placeholder="예: 3.73"
        value={parts.mantissa}
        onChange={(e) => {
          const pasted = /[x×e]/i.test(e.target.value) ? parseScientific(e.target.value) : null;
          if (pasted) emit(String(pasted.mantissa), pasted.exponent);
          else emit(e.target.value, parts.exponent);
        }}
      />
      <select className={inputCls} aria-label={`${label} 10의 거듭제곱`} value={parts.exponent} onChange={(e) => emit(parts.mantissa, Number(e.target.value))}>
        {EXPONENTS.map((n) => (
          <option key={n} value={n}>
            × {powerOfTen(n)}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * The items of an automated cell counter's result screen (LUNA-type), in its order and wording. Concentrations are
 * entered as the device shows them (dilution already applied); the dilution factor is kept for the record and never
 * multiplied again. Live cells in the suspension = live concentration × suspension volume. Forms that always ask for
 * the pellet suspension volume (counted or not) show it themselves and pass `withSuspension={false}`.
 */
export function CellCounterFields({
  value,
  onChange,
  withSuspension = true,
}: {
  value: CounterDraft;
  onChange(next: CounterDraft): void;
  withSuspension?: boolean;
}) {
  let result: CounterResult | null = null;
  let problem = '';
  try {
    result = counterResult(value);
  } catch (e) {
    problem = (e as Error).message;
  }
  const set = (key: keyof CounterDraft, text: string) => onChange({ ...value, [key]: text });
  const mismatch =
    result?.checkedViabilityPct != null && result.viabilityPct !== null && Math.abs(result.checkedViabilityPct - result.viabilityPct) > 1;
  return (
    <fieldset className="cell-counter mb-3">
      <legend>세포 계수 결과 (자동 계수기 화면 그대로)</legend>
      <div className="cell-counter-grid">
        {SCREEN.filter((f) => withSuspension || f.key !== 'countSuspensionMl').map((f) => (
          <label key={f.key} className={f.scientific ? 'cell-counter-wide' : undefined}>
            <span>
              {f.label}
              {f.unit && ` (${f.unit})`}
            </span>
            {f.scientific ? (
              <ScientificInput label={f.label} value={value[f.key]} onChange={(text) => set(f.key, text)} />
            ) : (
              <input
                className={inputCls}
                type="number"
                min="0"
                step={f.integer ? 1 : 'any'}
                value={value[f.key]}
                onChange={(e) => set(f.key, e.target.value)}
              />
            )}
          </label>
        ))}
      </div>
      <p className="cell-counter-note">
        계수기 화면의 값을 그대로 넣습니다. 농도는 앞자리 숫자와 10의 거듭제곱을 고르며, 화면 값(1.46x10e7)을 붙여 넣어도 됩니다. Dilution
        factor는 기록용이며 다시 곱하지 않습니다.{withSuspension && ' Suspension volume은 펠릿을 다시 푼 배지 부피입니다.'}
      </p>
      {problem && <p className="text-xs text-danger">{problem}</p>}
      {result && (
        <p className="cell-counter-result">
          현탁액 속 생세포 {result.liveCells === null ? '— (현탁 부피 입력 필요)' : `${formatCount(result.liveCells)} cells`}
          {result.checkedViabilityPct != null && ` · 생/총 농도로 본 생존율 ${result.checkedViabilityPct.toFixed(1)}%`}
        </p>
      )}
      {mismatch && <p className="text-xs text-warning">입력한 생존율과 생/총 농도 비율이 1%p 넘게 다릅니다. 화면 값을 다시 확인하세요.</p>}
    </fieldset>
  );
}
