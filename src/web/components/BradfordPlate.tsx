import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Ban, Eraser, FileSpreadsheet, PencilLine, Plus, Upload } from 'lucide-react';
import { applyPlate, emptyPlate, type BradfordData, type PlateMapping } from '../../shared/bradford';
import { api } from '../api';
import { btnCls, inputCls, primaryBtnCls, smallIconBtnCls } from './Dialog';

interface Grid {
  id: string;
  sheet: string;
  origin: string;
  values: (number | null)[];
  wavelengthNm: number | null;
  warnings: string[];
}
interface Props {
  data: BradfordData;
  onChange(data: BradfordData): void;
}
type Kind = 'standard' | 'sample';
type Tool = { kind: Kind; index: number } | { kind: 'erase' } | { kind: 'exclude' };

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const SAMPLE_HUES = ['#0f9d8a', '#c77d0a', '#7c5cf0', '#d6457f', '#3f9b3f', '#e0662b', '#2aa4d8', '#8a6d3b'];
/** One hue per sample, shared by its wells, its table row and its marker on the curve. */
export const sampleHue = (index: number) => SAMPLE_HUES[index % SAMPLE_HUES.length];
const position = (i: number) => `${'ABCDEFGH'[Math.floor(i / 12)]}${(i % 12) + 1}`;
const numericCount = (values: (number | null)[]) => values.filter((v) => v !== null).length;

/** Each well measured for one standard or sample, in plate order. */
export function plateWells(data: BradfordData, kind: Kind, index: number) {
  const plate = data.plate;
  if (!plate) return [];
  return plate.mappings.flatMap((m, i) =>
    m?.kind === kind && m.index === index ? [{ position: position(i), value: plate.values[i], excluded: plate.excluded[i] }] : [],
  );
}

/** Standards deepen with concentration; samples take one hue each. */
function wellColors(data: BradfordData, mapping: NonNullable<PlateMapping>): CSSProperties {
  if (mapping.kind === 'sample') {
    const hue = sampleHue(mapping.index);
    return {
      '--well-fill': `color-mix(in srgb, ${hue} 22%, transparent)`,
      '--well-edge': `color-mix(in srgb, ${hue} 62%, transparent)`,
    } as CSSProperties;
  }
  const conc = data.standards[mapping.index]?.conc ?? 0;
  const rank = data.standards.filter((s) => s.conc < conc).length;
  const strength = 10 + (data.standards.length > 1 ? rank / (data.standards.length - 1) : 1) * 42;
  return {
    '--well-fill': `color-mix(in srgb, var(--pr-accent) ${strength.toFixed(0)}%, transparent)`,
    '--well-edge': `color-mix(in srgb, var(--pr-accent) ${Math.min(strength + 34, 92).toFixed(0)}%, transparent)`,
  } as CSSProperties;
}

/** Step 1: where the absorbances come from. A workbook upload fills the plate at once. */
export function BradfordMeasure({ data, onChange }: Props) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [imported, setImported] = useState<{ filename: string; grids: Grid[]; gridId: string } | null>(null);
  const plate = data.plate;
  const filled = plate ? numericCount(plate.values) : 0;
  const manualValues = !plate && [...data.standards, ...data.samples].some((row) => row.reps.some((r) => r.abs !== null));
  const grid = imported?.grids.find((g) => g.id === imported.gridId);

  function applyGrid(filename: string, next: Grid) {
    onChange(
      applyPlate({
        ...data,
        wavelengthNm: next.wavelengthNm ?? data.wavelengthNm,
        plate: {
          ...(plate ?? emptyPlate()),
          values: [...next.values],
          filename,
          sheet: `${next.sheet} · ${next.origin}`,
          wavelengthNm: next.wavelengthNm,
        },
      }),
    );
  }
  async function upload(file: File) {
    setBusy(true);
    setError('');
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error('엑셀 파일은 10 MB 이하여야 합니다');
      const body = new FormData();
      body.append('file', file);
      const response = await api<{ filename: string; grids: Grid[] }>('/api/bradford/import-workbook', { method: 'POST', body });
      if (!response.grids.length) throw new Error('8행 × 12열 측정값 표를 찾지 못했습니다');
      // The fullest table is the reading; the others stay one select away.
      const best = response.grids.reduce((a, b) => (numericCount(b.values) > numericCount(a.values) ? b : a));
      if (manualValues && !window.confirm('직접 입력한 반복값 대신 파일의 well 측정값을 사용합니다. 계속할까요?')) return;
      if (filled && !window.confirm('기존 측정값을 새 파일 값으로 바꿀까요? well 배정은 그대로 둡니다.')) return;
      applyGrid(response.filename, best);
      setImported({ ...response, gridId: best.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : '파일을 읽지 못했습니다');
    } finally {
      setBusy(false);
    }
  }
  function setMode(next: 'plate' | 'manual') {
    if (next === 'plate' && !plate) {
      if (manualValues && !window.confirm('플레이트 모드에서는 직접 입력한 반복값 대신 well 측정값을 사용합니다. 시작할까요?')) return;
      onChange(applyPlate({ ...data, plate: emptyPlate() }));
    }
    if (next === 'manual' && plate) {
      if (!window.confirm('플레이트 연결을 해제하고 현재 값을 반복값으로 옮겨 직접 편집할까요?')) return;
      const manual = applyPlate(data);
      delete manual.plate;
      setImported(null);
      onChange(manual);
    }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="pr-seg" role="group" aria-label="측정값 입력 방식">
          <button aria-pressed={!!plate} onClick={() => setMode('plate')}>
            96-well 플레이트
          </button>
          <button aria-pressed={!plate} onClick={() => setMode('manual')}>
            직접 입력
          </button>
        </div>
        <label className={`${filled ? btnCls : primaryBtnCls} cursor-pointer`}>
          <Upload size={14} aria-hidden />
          {busy ? '파일 읽는 중…' : filled ? '다른 파일로 교체' : '엑셀 파일 올리기'}
          <input
            className="sr-only"
            type="file"
            accept=".xlsx,.xlsm"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void upload(file);
            }}
          />
        </label>
        {imported && imported.grids.length > 1 && (
          <label className="flex items-center gap-2 text-[12.5px] text-fg-muted">
            표
            <select
              className={`${inputCls} w-56`}
              value={imported.gridId}
              onChange={(e) => {
                const next = imported.grids.find((g) => g.id === e.target.value);
                if (!next) return;
                applyGrid(imported.filename, next);
                setImported({ ...imported, gridId: next.id });
              }}
            >
              {imported.grids.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.sheet} · {g.origin} ({numericCount(g.values)}칸)
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="ml-auto flex items-center gap-2 text-[12.5px] text-fg-muted">
          파장
          <input
            type="number"
            min="1"
            className={`${inputCls} w-[72px]`}
            value={data.wavelengthNm}
            onChange={(e) => onChange({ ...data, wavelengthNm: Number(e.target.value) })}
          />
          nm
        </label>
      </div>
      {error && (
        <p role="alert" className="text-[12.5px] text-danger">
          {error}
        </p>
      )}
      {plate?.filename ? (
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-fg-muted">
          <FileSpreadsheet size={14} className="shrink-0" aria-hidden />
          <span className="font-medium text-fg">{plate.filename}</span>
          <span>{plate.sheet}</span>
          <span className="tabular-nums">
            {filled}/96칸 · {plate.wavelengthNm ?? '파장 미확인'}
            {plate.wavelengthNm ? ' nm' : ''}
          </span>
        </p>
      ) : (
        <p className="text-[12.5px] leading-relaxed text-fg-muted">
          {plate
            ? '플레이트 리더에서 내보낸 .xlsx · .xlsm 파일을 올리면 96개 값이 바로 들어갑니다. 파일의 매크로는 실행하지 않습니다.'
            : '아래 표준·시료 표에 반복 흡광도를 직접 입력합니다. 엑셀 파일을 올리면 플레이트 방식으로 바뀝니다.'}
        </p>
      )}
      {grid && grid.warnings.length > 0 && (
        <details className="text-[12.5px]">
          <summary className="cursor-pointer text-warning">값이 없거나 숫자가 아닌 칸 {grid.warnings.length}개 (0으로 바꾸지 않음)</summary>
          <ul className="mt-1 space-y-0.5 text-fg-muted">
            {grid.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Step 2: pick a standard or sample, then click or drag across the wells that hold it. */
export function BradfordPlateMap({ data, onChange }: Props) {
  const plate = data.plate ?? emptyPlate();
  const [picked, setPicked] = useState<Tool>({ kind: 'standard', index: 0 });
  const [editing, setEditing] = useState(false),
    [error, setError] = useState('');
  const stroke = useRef<{ exclude?: boolean } | null>(null);
  // A deleted row must not leave the brush pointing at its successor.
  const tool: Tool =
    (picked.kind === 'standard' && picked.index >= data.standards.length) || (picked.kind === 'sample' && picked.index >= data.samples.length)
      ? { kind: 'erase' }
      : picked;
  useEffect(() => {
    const end = () => {
      stroke.current = null;
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, []);

  function commit(next: BradfordData) {
    try {
      onChange(applyPlate(next));
      setError('');
    } catch (e) {
      stroke.current = null;
      setError(e instanceof Error ? e.message : '배정을 적용하지 못했습니다');
    }
  }
  function paint(i: number, brush: Tool = tool) {
    const next = structuredClone(plate);
    if (brush.kind === 'exclude') {
      const target = stroke.current?.exclude ?? !next.excluded[i];
      if (stroke.current) stroke.current.exclude = target;
      if (next.excluded[i] === target) return;
      next.excluded[i] = target;
    } else {
      const mapping: PlateMapping = brush.kind === 'erase' ? null : { kind: brush.kind, index: brush.index };
      const current = next.mappings[i];
      if (current?.kind === mapping?.kind && current?.index === mapping?.index) return;
      next.mappings[i] = mapping;
    }
    commit({ ...data, plate: next });
  }
  const toolKey = 'index' in tool ? `${tool.kind}:${tool.index}` : tool.kind;
  const wellCounts = new Map<string, number>();
  for (const m of plate.mappings) if (m) wellCounts.set(`${m.kind}:${m.index}`, (wellCounts.get(`${m.kind}:${m.index}`) ?? 0) + 1);
  const numbers = plate.values.filter((v): v is number => v !== null);
  const low = Math.min(...numbers),
    span = Math.max(...numbers) - low;

  return (
    <div className="space-y-3">
      <div className="bf-map">
        <div className="bf-palette" role="group" aria-label="배정할 항목">
          <div className="bf-palette-scroll">
            <p className="bf-palette-label">표준 (µg/mL)</p>
            {data.standards.map((s, i) => (
              <button key={i} className="bf-tool" aria-pressed={toolKey === `standard:${i}`} onClick={() => setPicked({ kind: 'standard', index: i })}>
                <span className="bf-swatch" style={wellColors(data, { kind: 'standard', index: i })} />
                <span>{s.conc}</span>
                <span className="bf-tool-count">{wellCounts.get(`standard:${i}`)}</span>
              </button>
            ))}
            <p className="bf-palette-label">
              시료
              <button
                className={smallIconBtnCls}
                style={{ width: 20, height: 20 }}
                aria-label="시료 추가"
                title="시료 추가"
                disabled={data.samples.length >= 96}
                onClick={() => {
                  commit({ ...data, samples: [...data.samples, { name: `시료 ${data.samples.length + 1}`, dilution: 1, cultureId: null, reps: [] }] });
                  setPicked({ kind: 'sample', index: data.samples.length });
                }}
              >
                <Plus size={13} />
              </button>
            </p>
            {data.samples.map((s, i) => (
              <button key={i} className="bf-tool" aria-pressed={toolKey === `sample:${i}`} onClick={() => setPicked({ kind: 'sample', index: i })}>
                <span className="bf-swatch" style={wellColors(data, { kind: 'sample', index: i })} />
                <span>{s.name || `시료 ${i + 1}`}</span>
                <span className="bf-tool-count">{wellCounts.get(`sample:${i}`)}</span>
              </button>
            ))}
            {!data.samples.length && <p className="px-2 pb-2 text-[12px] leading-relaxed text-fg-dim">+ 를 눌러 시료를 만들고 well을 칠하세요.</p>}
          </div>
          <div className="bf-palette-foot">
            <button className="bf-tool" aria-pressed={tool.kind === 'erase'} onClick={() => setPicked({ kind: 'erase' })}>
              <Eraser size={13} aria-hidden /> 지우개
            </button>
            <button
              className="bf-tool"
              aria-pressed={tool.kind === 'exclude'}
              title="계산에서 빼거나 다시 넣기"
              onClick={() => setPicked({ kind: 'exclude' })}
            >
              <Ban size={13} aria-hidden /> 제외
            </button>
          </div>
        </div>
        <div className="min-w-0 overflow-x-auto pb-1">
          <div className="bf-plate" role="grid" aria-label="96-well 플레이트">
            <span />
            {Array.from({ length: 12 }, (_, c) => (
              <span key={c} className="bf-plate-axis" style={{ height: 16 }}>
                {c + 1}
              </span>
            ))}
            {plate.mappings.map((m, i) => {
              const value = plate.values[i];
              const label = m ? (m.kind === 'standard' ? String(data.standards[m.index]?.conc ?? '') : data.samples[m.index]?.name || `시료 ${m.index + 1}`) : '';
              const heat = value !== null && span > 0 ? (value - low) / span : 0;
              const style = m ? wellColors(data, m) : ({ '--well-fill': `color-mix(in srgb, var(--pr-fg) ${(2 + heat * 10).toFixed(1)}%, transparent)` } as CSSProperties);
              return [
                i % 12 === 0 && (
                  <span key={`row${i}`} className="bf-plate-axis">
                    {'ABCDEFGH'[i / 12]}
                  </span>
                ),
                editing ? (
                  <input
                    key={i}
                    aria-label={`${position(i)} 흡광도`}
                    className="bf-well-input"
                    type="number"
                    step="any"
                    value={value ?? ''}
                    onChange={(e) => {
                      const values = [...plate.values];
                      values[i] = e.target.value === '' ? null : Number(e.target.value);
                      commit({ ...data, plate: { ...plate, values } });
                    }}
                  />
                ) : (
                  <button
                    key={i}
                    className="bf-well"
                    style={style}
                    data-active={(m && toolKey === `${m.kind}:${m.index}`) || undefined}
                    data-excluded={plate.excluded[i] || undefined}
                    aria-label={`${position(i)} ${m ? `${m.kind === 'standard' ? '표준' : '시료'} ${label}` : '미배정'}${plate.excluded[i] ? ' 제외됨' : ''}, 흡광도 ${value ?? '없음'}`}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      stroke.current = {};
                      paint(i);
                    }}
                    onPointerEnter={() => {
                      if (stroke.current) paint(i);
                    }}
                    // Keyboard activation arrives as a click without a pointer press.
                    onClick={(e) => {
                      if (e.detail === 0) paint(i);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      paint(i, { kind: 'erase' });
                    }}
                  >
                    {label && <span className="bf-well-tag">{label}</span>}
                    <span className="bf-well-value" data-empty={value === null || undefined}>
                      {value ?? '—'}
                    </span>
                  </button>
                ),
              ];
            })}
          </div>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-[12.5px] text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-fg-muted">
          왼쪽에서 항목을 고르고 well을 클릭하거나 드래그해 칠합니다. 오른쪽 클릭은 배정을 지웁니다. 한 항목에 최대 6칸.
        </p>
        <button className={btnCls} aria-pressed={editing} onClick={() => setEditing((on) => !on)}>
          <PencilLine size={13} aria-hidden />
          {editing ? '값 수정 끝내기' : '측정값 직접 수정'}
        </button>
      </div>
    </div>
  );
}
