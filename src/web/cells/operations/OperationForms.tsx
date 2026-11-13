import { useState } from 'react';
import type { CellLineDto, CultureDto, LogDto, ProfileDto } from '../../../shared/cell-line';
import {
  FEED_MODES,
  FEED_MODE_LABELS,
  FEED_MODE_HELP,
  freezeAllocation,
  passageConservation,
  validateFeedInput,
} from '../../../shared/culture-operations';
import type { FeedMode, FreezeAllocation } from '../../../shared/culture-operations';
import { vesselArea } from '../../../shared/lab-products';
import type { CultureVesselUse, VesselProduct } from '../../../shared/lab-products';
import { api } from '../../api';
import { Field, inputCls, primaryBtnCls, smallBtnCls } from '../../components/Dialog';
import { VesselUsePicker } from '../../components/VesselUsePicker';
import { CellCountCalculator } from '../../components/CellCountCalculator';
import { MediumProductPicker } from '../../components/MediumProductPicker';
import { VesselChangeCalculator } from '../../components/VesselChangeCalculator';
import { executionProfile } from '../culture-plan-state';
import { composeOperationNote, FieldRow, FormError, isoFromInput, localInput, PlanRecordSection } from './common';

export interface OperationProps {
  line: CellLineDto;
  culture: CultureDto;
  profiles: ProfileDto[];
  initialAt?: string;
  initialLog?: LogDto;
  onSaved(): void;
}

export function FeedForm({ line, culture, profiles, initialAt, initialLog, onSaved }: OperationProps) {
  const old = initialLog?.feed;
  const [at, setAt] = useState(() => localInput(initialLog?.at ?? initialAt ?? Date.now()));
  const [mode, setMode] = useState<FeedMode | ''>(old && old.mode !== 'unspecified' ? old.mode : '');
  const [removed, setRemoved] = useState(String(old?.removedMl ?? ''));
  const [added, setAdded] = useState(String(old?.addedMl ?? ''));
  const [medium, setMedium] = useState(old?.mediumLabel ?? '');
  const [productId, setProductId] = useState<string | null>(old?.mediumProductId ?? null);
  const [productLabel, setProductLabel] = useState('');
  const [note, setNote] = useState(initialLog?.note ?? '');
  const [records, setRecords] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const profile = executionProfile(profiles, culture).profile;
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const feed = validateFeedInput(
        { mode, removedMl: mode === 'addition' ? 0 : removed, addedMl: added, mediumLabel: medium, mediumProductId: productId },
        initialLog ? null : (culture.vesselUse?.mediumMl ?? null),
      );
      await api(initialLog ? `/api/logs/${initialLog.id}` : `/api/cultures/${culture.id}/logs`, {
        method: initialLog ? 'PUT' : 'POST',
        json: {
          type: 'medium_change',
          at: isoFromInput(at),
          feed,
          note: initialLog ? note : composeOperationNote(note, profile, 'feed', records),
        },
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="mb-3 rounded-lg bg-sunken p-3 text-sm">
        세포는 같은 용기에 그대로 두고 배지만 바꿉니다. 계대수(P{culture.passage})는 올라가지 않습니다.
      </p>
      {!initialLog && (
        <PlanRecordSection profiles={profiles} culture={culture} stage="feed" lineId={line.id} records={records} onRecords={setRecords} />
      )}
      {old?.mode === 'unspecified' && (
        <p className="mb-3 text-xs text-warning">이전 기록에는 교체 방식·부피가 없습니다. 실제 수행 내용을 아는 경우에만 보완하세요.</p>
      )}
      <Field label="배지 작업 일시">
        <input required type="datetime-local" className={inputCls} value={at} onChange={(e) => setAt(e.target.value)} />
      </Field>
      <Field label="배지 작업 방식">
        <select required className={inputCls} value={mode} onChange={(e) => setMode(e.target.value as FeedMode)}>
          <option value="">선택하세요</option>
          {FEED_MODES.map((m) => (
            <option key={m} value={m}>
              {FEED_MODE_LABELS[m]}
            </option>
          ))}
        </select>
      </Field>
      {mode && <p className="mb-3 text-xs text-fg-muted">{FEED_MODE_HELP[mode]}</p>}
      <Field label="기본 배지 제품 연결 (선택)">
        <MediumProductPicker
          label={productLabel}
          ariaLabel="배지 제품"
          value={productId}
          kind="base_medium"
          onChange={(v) => {
            setProductId(v.productId);
            setProductLabel(v.label);
            if (v.product && !medium) setMedium(v.label);
          }}
        />
      </Field>
      <Field label="사용한 완전배지 이름·조성">
        <input required className={inputCls} maxLength={200} value={medium} onChange={(e) => setMedium(e.target.value)} />
      </Field>
      <FieldRow>
        <Field label="제거한 배지 (mL)">
          <input
            required
            type="number"
            step="any"
            min={mode === 'addition' ? 0 : 0.000001}
            disabled={mode === 'addition'}
            className={inputCls}
            value={mode === 'addition' ? '0' : removed}
            onChange={(e) => setRemoved(e.target.value)}
          />
        </Field>
        <Field label="추가한 새 배지 (mL)">
          <input
            required
            type="number"
            min="0.000001"
            step="any"
            className={inputCls}
            value={added}
            onChange={(e) => setAdded(e.target.value)}
          />
        </Field>
      </FieldRow>
      <Field label="메모">
        <textarea className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <FormError>{error}</FormError>
      <button className={primaryBtnCls} disabled={busy}>
        {busy ? '저장 중…' : '배지 작업 저장'}
      </button>
    </form>
  );
}

interface Child {
  vessel: string;
  label: string;
  use: CultureVesselUse | null;
  product: VesselProduct | null;
  cells: string;
}
const newChild = (): Child => ({ vessel: '', label: '', use: null, product: null, cells: '' });
export function PassageForm({ line, culture, profiles, initialAt, onSaved }: OperationProps) {
  const [at, setAt] = useState(() => localInput(initialAt ?? Date.now()));
  const [reagent, setReagent] = useState('');
  const [recovered, setRecovered] = useState('');
  const [concentration, setConcentration] = useState('');
  const [children, setChildren] = useState<Child[]>([newChild()]);
  const [note, setNote] = useState('');
  const [records, setRecords] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const profile = executionProfile(profiles, culture).profile;
  const patch = (i: number, values: Partial<Child>) => setChildren((old) => old.map((v, j) => (i === j ? { ...v, ...values } : v)));
  const recoveredN = recovered.trim() ? Number(recovered) : null;
  const seeded = children.reduce((s, c) => s + (Number(c.cells) || 0), 0);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (recoveredN === null) throw new Error('회수한 생세포 수를 입력하세요');
      if (children.some((c) => !c.cells.trim() || Number(c.cells) <= 0)) throw new Error('모든 새 배양의 접종 세포 수를 입력하세요');
      passageConservation(
        recoveredN,
        children.map((c) => Number(c.cells)),
      );
      const result = await api<{ warnings: string[] }>(`/api/cultures/${culture.id}/passage`, {
        method: 'POST',
        json: {
          at: isoFromInput(at),
          dissociationReagent: reagent,
          recoveredLiveCells: recoveredN,
          cellsPerMl: concentration.trim() ? Number(concentration) : null,
          children: children.map((c) => ({
            vessel: c.vessel,
            vesselUse: c.use,
            label: c.label,
            seededCells: Number(c.cells),
            seededVolumeMl: Number(concentration) > 0 ? Number(c.cells) / Number(concentration) : null,
          })),
          note: composeOperationNote(note, profile, 'passage', records),
          keepParent: false,
        },
      });
      if (result.warnings.length) alert(result.warnings.join('\n'));
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="mb-3 rounded-lg bg-sunken p-3 text-sm">
        세포를 회수해 새 용기에 접종합니다. 새 배양은 P{culture.passage + 1}이며 기존 배양은 계대 완료로 종료됩니다. 배지만 바꾸려면 배지
        교체를 사용하세요.
      </p>
      <PlanRecordSection profiles={profiles} culture={culture} stage="passage" lineId={line.id} records={records} onRecords={setRecords} />
      <Field label="계대 일시">
        <input required type="datetime-local" className={inputCls} value={at} onChange={(e) => setAt(e.target.value)} />
      </Field>
      <Field label="사용한 해리 시약·농도">
        <input
          required
          maxLength={200}
          className={inputCls}
          value={reagent}
          onChange={(e) => setReagent(e.target.value)}
          placeholder="제품·농도·실제 처리 조건은 확인한 SOP를 따르세요"
        />
      </Field>
      <FieldRow>
        <Field label="회수한 살아 있는 세포 수">
          <input
            required
            type="number"
            min="1"
            step="any"
            className={inputCls}
            value={recovered}
            onChange={(e) => setRecovered(e.target.value)}
          />
        </Field>
        <Field label="생세포 농도 (cells/mL, 선택)">
          <input
            type="number"
            min="0.000001"
            step="any"
            className={inputCls}
            value={concentration}
            onChange={(e) => setConcentration(e.target.value)}
          />
        </Field>
      </FieldRow>
      <p className="mb-3 text-xs text-fg-muted">이미 살아 있는 세포를 센 값입니다. 생존율을 다시 곱하지 않습니다.</p>
      <CellCountCalculator
        vessel={children[0].vessel}
        onApply={(v) => {
          setRecovered(String(v.totalCells));
          setConcentration(String(v.cellsPerMl));
        }}
      />
      {children.map((c, i) => {
        const area = c.product && c.use ? vesselArea(c.product, c.use.usedWells) : null;
        return (
          <fieldset key={i} className="mb-4 rounded-lg border border-line p-3">
            <legend className="px-1 text-sm font-medium">새 배양 {i + 1}</legend>
            <VesselUsePicker value={c.use} onChange={(use, product) => patch(i, { use, product })} />
            {!c.use && (
              <Field label={`새 배양 ${i + 1} 용기 (직접 입력)`}>
                <input required className={inputCls} value={c.vessel} onChange={(e) => patch(i, { vessel: e.target.value })} />
              </Field>
            )}
            <Field label={`새 배양 ${i + 1} 접종 세포 수`}>
              <input
                required
                type="number"
                min="1"
                step="any"
                className={inputCls}
                value={c.cells}
                onChange={(e) => patch(i, { cells: e.target.value })}
              />
            </Field>
            {c.cells && (
              <p className="mb-2 text-xs text-fg-muted">
                밀도: {area ? `${(Number(c.cells) / area).toLocaleString()} cells/cm²` : '면적 미확인으로 계산 불가'}
                {Number(concentration) > 0 && ` · 세포 현탁액 ${(Number(c.cells) / Number(concentration)).toLocaleString()} mL`}
              </p>
            )}
            <Field label={`새 배양 ${i + 1} 라벨 (선택)`}>
              <input className={inputCls} value={c.label} onChange={(e) => patch(i, { label: e.target.value })} />
            </Field>
            {children.length > 1 && (
              <button type="button" className={smallBtnCls} onClick={() => setChildren((old) => old.filter((_, j) => i !== j))}>
                새 배양 {i + 1} 제외
              </button>
            )}
          </fieldset>
        );
      })}
      <button type="button" className={smallBtnCls} disabled={children.length >= 24} onClick={() => setChildren((v) => [...v, newChild()])}>
        새 배양 추가
      </button>
      <p className={`my-3 text-sm ${recoveredN !== null && seeded > recoveredN ? 'text-danger' : 'text-fg-muted'}`}>
        접종 합계 {seeded.toLocaleString()} cells
        {recoveredN !== null && ` · 미접종 ${Math.max(0, recoveredN - seeded).toLocaleString()} cells`}
      </p>
      <details className="mb-3">
        <summary className="cursor-pointer text-sm">용기 변경 계산 열기 (기록에 자동 적용하지 않음)</summary>
        <VesselChangeCalculator source={{ use: culture.vesselUse }} />
      </details>
      <Field label="메모">
        <textarea className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <FormError>{error}</FormError>
      <button className={primaryBtnCls} disabled={busy}>
        {busy ? '저장 중…' : '계대 저장'}
      </button>
    </form>
  );
}

export function FreezeForm({ line, culture, profiles, initialAt, onSaved }: OperationProps) {
  const [at, setAt] = useState(() => localInput(initialAt ?? Date.now()));
  const [recovered, setRecovered] = useState('');
  const [retained, setRetained] = useState('');
  const [perVial, setPerVial] = useState('');
  const [volume, setVolume] = useState('');
  const [desired, setDesired] = useState('');
  const [vials, setVials] = useState('');
  const [location, setLocation] = useState('');
  const [medium, setMedium] = useState('');
  const [end, setEnd] = useState(false);
  const [testVials, setTestVials] = useState('');
  const [testAt, setTestAt] = useState('');
  const [testNote, setTestNote] = useState('');
  const [note, setNote] = useState('');
  const [records, setRecords] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const profile = executionProfile(profiles, culture).profile;
  const plan = {
    recoveredLiveCells: Number(recovered),
    retainedCells: Number(retained),
    targetCellsPerVial: Number(perVial),
    volumePerVialMl: Number(volume),
    desiredVials: desired.trim() ? Number(desired) : null,
  };
  let allocation: FreezeAllocation | null = null;
  let problem = '';
  if ([recovered, retained, perVial, volume].every((s) => s.trim())) {
    try {
      allocation = freezeAllocation(plan);
    } catch (e) {
      problem = (e as Error).message;
    }
  }
  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (!allocation) throw new Error(problem || '동결 배분 입력값을 모두 채우세요 (남길 세포가 없으면 0)');
      if (!Number.isInteger(Number(vials)) || Number(vials) < 1 || Number(vials) > allocation.possibleVials)
        throw new Error('실제 동결 바이알 수가 만들 수 있는 범위인지 확인하세요');
      await api(`/api/cultures/${culture.id}/freeze`, {
        method: 'POST',
        json: {
          at: isoFromInput(at),
          vials: Number(vials),
          cellsPerVial: plan.targetCellsPerVial,
          freezingMedium: medium,
          location,
          endCulture: plan.retainedCells > 0 ? false : end,
          plan: {
            ...plan,
            representativeThaw: testVials.trim()
              ? { vials: Number(testVials), plannedAt: testAt ? isoFromInput(testAt) : null, note: testNote }
              : null,
          },
          note: composeOperationNote(note, profile, 'freeze', records),
          notes: composeOperationNote(note, profile, 'freeze', records),
        },
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <PlanRecordSection profiles={profiles} culture={culture} stage="freeze" lineId={line.id} records={records} onRecords={setRecords} />
      <p className="mb-3 text-sm text-fg-muted">
        회수한 생세포에서 계속 배양할 세포를 먼저 뺍니다. 목표량을 채울 수 있는 바이알만 계산하며 실제 동결할 때 저장하세요.
      </p>
      <Field label="동결 일시">
        <input required type="datetime-local" className={inputCls} value={at} onChange={(e) => setAt(e.target.value)} />
      </Field>
      <FieldRow>
        <Field label="회수한 살아 있는 세포 수">
          <input
            required
            type="number"
            min="0"
            step="any"
            className={inputCls}
            value={recovered}
            onChange={(e) => setRecovered(e.target.value)}
          />
        </Field>
        <Field label="계속 배양할 세포 수">
          <input
            required
            type="number"
            min="0"
            step="any"
            className={inputCls}
            value={retained}
            onChange={(e) => setRetained(e.target.value)}
          />
        </Field>
      </FieldRow>
      <FieldRow>
        <Field label="바이알당 목표 세포 수">
          <input
            required
            type="number"
            min="1"
            step="any"
            className={inputCls}
            value={perVial}
            onChange={(e) => setPerVial(e.target.value)}
          />
        </Field>
        <Field label="바이알당 동결액 (mL)">
          <input
            required
            type="number"
            min="0.000001"
            step="any"
            className={inputCls}
            value={volume}
            onChange={(e) => setVolume(e.target.value)}
          />
        </Field>
      </FieldRow>
      <Field label="희망 바이알 수 (선택)">
        <input type="number" min="1" className={inputCls} value={desired} onChange={(e) => setDesired(e.target.value)} />
      </Field>
      {problem && <FormError>{problem}</FormError>}
      {allocation && (
        <div className="mb-4 rounded-lg border border-line bg-sunken p-3 text-sm" aria-live="polite">
          <p>
            동결 가능 {allocation.possibleVials.toLocaleString()} vial · 배분 {allocation.vials.toLocaleString()} vial
          </p>
          <p>
            계속 배양 {plan.retainedCells.toLocaleString()} cells · 동결에 사용 {allocation.usedCells.toLocaleString()} cells
          </p>
          <p>
            남는 세포 {allocation.leftoverCells.toLocaleString()} cells · 부족 {allocation.shortfallCells.toLocaleString()} cells
          </p>
          <p>
            동결액 합계 {allocation.resuspendVolumeMl.toLocaleString()} mL · {allocation.concentrationCellsPerMl.toLocaleString()} cells/mL
          </p>
          <button
            type="button"
            className={`${smallBtnCls} mt-2`}
            disabled={allocation.vials < 1}
            onClick={() => setVials(String(allocation!.vials))}
          >
            계산한 바이알 수 적용
          </button>
        </div>
      )}
      <FieldRow>
        <Field label="실제 동결 바이알 수">
          <input
            required
            type="number"
            min="1"
            max={allocation?.possibleVials}
            className={inputCls}
            value={vials}
            onChange={(e) => setVials(e.target.value)}
          />
        </Field>
        <Field label="보관 위치">
          <input required className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} />
        </Field>
      </FieldRow>
      <Field label="사용한 동결 배지·제품">
        <input required className={inputCls} value={medium} onChange={(e) => setMedium(e.target.value)} />
      </Field>
      <fieldset className="mb-3 rounded-lg border border-line p-3">
        <legend className="text-sm">대표 바이알 해동 확인 계획 (선택)</legend>
        <Field label="확인할 바이알 수">
          <input
            type="number"
            min="1"
            max={vials || undefined}
            className={inputCls}
            value={testVials}
            onChange={(e) => setTestVials(e.target.value)}
          />
        </Field>
        <Field label="해동 예정 일시">
          <input type="datetime-local" className={inputCls} value={testAt} onChange={(e) => setTestAt(e.target.value)} />
        </Field>
        <Field label="회복 확인 방법·판단 기준">
          <textarea className={inputCls} value={testNote} onChange={(e) => setTestNote(e.target.value)} />
        </Field>
      </fieldset>
      <label className="mb-3 flex gap-2 text-sm">
        <input
          type="checkbox"
          checked={plan.retainedCells > 0 ? false : end}
          disabled={plan.retainedCells > 0}
          onChange={(e) => setEnd(e.target.checked)}
        />
        동결 후 기존 배양 종료
      </label>
      {plan.retainedCells > 0 && (
        <p className="mb-3 text-xs text-fg-muted">
          남겨 둔 세포가 있으므로 기존 배양은 활성으로 유지합니다. 새 용기로 계대한 작업은 별도로 기록하세요.
        </p>
      )}
      <p className="mb-3 text-xs text-fg-muted">
        계획만으로 회복 확인·바이알 소모를 기록하지 않습니다. 해동 후 실제 관찰 결과는 재고 상세에서 입력합니다.
      </p>
      <Field label="메모">
        <textarea className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <FormError>{error}</FormError>
      <button className={primaryBtnCls} disabled={busy || !allocation || allocation.possibleVials < 1}>
        {busy ? '저장 중…' : '동결·배분 저장'}
      </button>
    </form>
  );
}
