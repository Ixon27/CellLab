import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { BradfordData, BradfordResult } from '../../shared/bradford';
import { loadingPlan, validateWesternLoading } from '../../shared/western';
import type { WesternData } from '../../shared/western';
import { DEFAULT_LOADING } from '../../shared/western-defaults';
import { inputCls, primaryBtnCls } from './Dialog';

interface Props {
  data: BradfordData;
  result: BradfordResult;
  onChange(data: BradfordData): void;
  onCreateWestern(loading: WesternData['loading']): void | Promise<void>;
  selected: number[];
  onSelectedChange(indexes: number[]): void;
}

/** Step 5: per-sample loading volumes from the stock concentrations, then hand the chosen samples to a Western run. */
export function BradfordLoading({ data, result, onChange, onCreateWestern, selected, onSelectedChange }: Props) {
  const loading = data.loading ?? DEFAULT_LOADING;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  let valid = true;
  try {
    validateWesternLoading(loading);
  } catch {
    valid = false;
  }
  const chosen = selected.filter((i) => Number.isInteger(i) && i >= 0 && i < data.samples.length);
  const all = data.samples.length > 0 && chosen.length === data.samples.length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        {(
          [
            ['proteinUg', '목표 단백질량', 'µg'],
            ['finalUl', '최종 부피', 'µL'],
            ['sampleBufferX', 'Sample buffer', 'X'],
          ] as const
        ).map(([key, label, unit]) => (
          <label key={key} className="block">
            <span className="mb-1 block text-[12px] font-medium text-fg-muted">{label}</span>
            <span className="flex items-center gap-1.5 text-[12.5px] text-fg-muted">
              <input
                type="number"
                step="any"
                min={key === 'sampleBufferX' ? 1 : 0}
                className={`${inputCls} w-24`}
                value={Number.isFinite(loading[key]) ? loading[key] : ''}
                onChange={(e) => onChange({ ...data, loading: { ...loading, [key]: e.target.value === '' ? 0 : Number(e.target.value) } })}
              />
              {unit}
            </span>
          </label>
        ))}
        <p className="min-w-0 flex-1 basis-64 text-[12px] leading-relaxed text-fg-muted">
          희석배수가 이미 반영된 원액 농도로 계산합니다. 희석액은 연결할 프로토콜에 맞게 고르세요.
        </p>
      </div>
      {!valid && (
        <p role="alert" className="text-[12.5px] text-danger">
          목표 단백질량과 최종 부피는 양수, buffer 배수는 1보다 커야 합니다.
        </p>
      )}
      {data.samples.length ? (
        <div className="overflow-x-auto">
          <table className="pr-table">
            <thead>
              <tr>
                <th>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      aria-label="모든 시료 선택"
                      checked={all}
                      onChange={(e) => onSelectedChange(e.target.checked ? data.samples.map((_, i) => i) : [])}
                    />
                    시료
                  </label>
                </th>
                <th className="num">원액 µg/µL</th>
                <th className="num">단백질 원액 µL</th>
                <th className="num">희석액 µL</th>
                <th className="num">Buffer µL</th>
                <th>조제</th>
              </tr>
            </thead>
            <tbody>
              {data.samples.map((sample, index) => {
                const concentration = result.samples[index]?.stockUgPerUl ?? null;
                const plan = valid ? loadingPlan(concentration, loading) : null;
                const checked = chosen.includes(index);
                return (
                  <tr key={index}>
                    <td>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => onSelectedChange(e.target.checked ? [...chosen, index] : chosen.filter((i) => i !== index))}
                        />
                        {sample.name || `시료 ${index + 1}`}
                      </label>
                    </td>
                    <td className="num">{concentration === null ? '—' : concentration.toLocaleString('ko-KR', { maximumFractionDigits: 3 })}</td>
                    <td className="num font-semibold">{plan?.ok ? plan.sampleUl.toFixed(1) : '—'}</td>
                    <td className="num">{plan?.ok ? plan.diluentUl.toFixed(1) : '—'}</td>
                    <td className="num">{plan?.ok ? plan.bufferUl.toFixed(1) : '—'}</td>
                    <td className={plan && !plan.ok ? 'text-danger' : 'text-fg-muted'}>
                      {!valid
                        ? '로딩 조건 확인'
                        : !plan
                          ? '농도 계산 필요'
                          : plan.ok
                            ? `총 ${loading.finalUl} µL · 최종 buffer 1X`
                            : `조제 불가: 농축하거나 조건을 조정하세요 (최소 ${Number(plan.minConc.toPrecision(4))} µg/µL)`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="workbench-empty">시료 농도가 계산되면 여기서 보낼 시료를 고릅니다.</p>
      )}
      {error && (
        <p role="alert" className="text-[12.5px] text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <button
          className={primaryBtnCls}
          disabled={!valid || !chosen.length || pending}
          onClick={async () => {
            setPending(true);
            setError('');
            try {
              await onCreateWestern(validateWesternLoading(loading));
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Western 실험을 만들지 못했습니다');
            } finally {
              setPending(false);
            }
          }}
        >
          {pending ? 'Western 실험 만드는 중…' : chosen.length ? `시료 ${chosen.length}개로 Western 실험 만들기` : '보낼 시료를 선택하세요'}
          {!pending && chosen.length > 0 && <ArrowRight size={14} aria-hidden />}
        </button>
      </div>
    </div>
  );
}
