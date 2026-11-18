import { useState } from 'react';
import type { LotDto } from '../../../shared/cell-line';
import { RECOVERY_LABELS } from '../../../shared/culture-operations';
import type { RecoveryStatus } from '../../../shared/culture-operations';
import { api } from '../../api';
import { Field, inputCls, primaryBtnCls } from '../../components/Dialog';
import { FormError, isoFromInput, localInput } from './common';

export function LotRecoveryPanel({ lot, onSaved }: { lot: LotDto; onSaved(): void }) {
  const [status, setStatus] = useState<RecoveryStatus | ''>(lot.recovery?.status ?? '');
  const [observedAt, setObservedAt] = useState(lot.recovery?.observedAt ? localInput(lot.recovery.observedAt) : '');
  const [note, setNote] = useState(lot.recovery?.note ?? '');
  const [count, setCount] = useState(String(lot.representativeThaw?.vials ?? ''));
  const [plannedAt, setPlannedAt] = useState(lot.representativeThaw?.plannedAt ? localInput(lot.representativeThaw.plannedAt) : '');
  const [planNote, setPlanNote] = useState(lot.representativeThaw?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/lots/${lot.id}`, {
        method: 'PUT',
        json: {
          representativeThaw: count.trim()
            ? { vials: Number(count), plannedAt: plannedAt ? isoFromInput(plannedAt) : null, note: planNote }
            : null,
          recovery: status ? { status, observedAt: status === 'unverified' ? null : isoFromInput(observedAt), note } : null,
        },
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const plan = lot.freezePlan;
  return (
    <section className="mt-4 rounded-lg border border-line p-3 text-xs">
      <h4 className="mb-2 text-sm font-medium">동결 배분 · 회복 확인</h4>
      {plan ? (
        <div className="mb-3 space-y-1">
          <p>
            회수 생세포 {plan.recoveredLiveCells.toLocaleString()} · 계속 배양 {plan.retainedCells.toLocaleString()} cells
          </p>
          <p>
            실제 {plan.vials} vial × {plan.targetCellsPerVial.toLocaleString()} cells · 동결액 {plan.volumePerVialMl} mL/vial
          </p>
          {plan.mix ? (
            <p>
              바이알당 현탁액 {Number(plan.mix.suspensionPerVialMl.toFixed(4))} mL + 동결 배지 {Number(plan.mix.freezingMediumPerVialMl.toFixed(4))} mL
              {plan.mix.finalDmsoPct !== null && ` · 최종 DMSO ${Number(plan.mix.finalDmsoPct.toFixed(2))}%`} · 미배분{' '}
              {plan.leftoverCells.toLocaleString()} cells
            </p>
          ) : (
            <p>
              미배분 {plan.leftoverCells.toLocaleString()} cells · 총 동결액 {plan.resuspendVolumeMl} mL
            </p>
          )}
        </div>
      ) : (
        <p className="mb-3 text-fg-muted">배분 수치 미기록 (입고·이전 lot)</p>
      )}
      <p className="mb-2 font-medium">
        {lot.recovery ? RECOVERY_LABELS[lot.recovery.status] : '회복 상태 미기록'}
        {lot.recovery?.observedAt && ` · ${new Date(lot.recovery.observedAt).toLocaleString('ko-KR')}`}
      </p>
      {lot.recovery?.note && <p className="mb-2 whitespace-pre-wrap">{lot.recovery.note}</p>}
      {lot.representativeThaw && (
        <p className="mb-2">
          대표 해동 계획 {lot.representativeThaw.vials} vial
          {lot.representativeThaw.plannedAt && ` · ${new Date(lot.representativeThaw.plannedAt).toLocaleString('ko-KR')}`} ·{' '}
          {lot.representativeThaw.note || '방법·판단 기준 미등록'}
        </p>
      )}
      <details>
        <summary className="mb-3 cursor-pointer">해동 확인 계획·실제 회복 결과 편집</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label="대표 해동 바이알 수 (비우면 계획 제거)">
            <input
              type="number"
              min="1"
              max={lot.vialsInitial}
              className={inputCls}
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
          </Field>
          <Field label="대표 해동 예정 일시">
            <input type="datetime-local" className={inputCls} value={plannedAt} onChange={(e) => setPlannedAt(e.target.value)} />
          </Field>
          <Field label="해동 확인 방법·판단 기준">
            <textarea className={inputCls} maxLength={1000} value={planNote} onChange={(e) => setPlanNote(e.target.value)} />
          </Field>
          <Field label="실제 회복 상태">
            <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as RecoveryStatus | '')}>
              <option value="">미기록 (상태 제거)</option>
              {Object.entries(RECOVERY_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          {status && status !== 'unverified' && (
            <Field label="회복을 실제 관찰한 일시">
              <input
                required
                type="datetime-local"
                className={inputCls}
                value={observedAt}
                onChange={(e) => setObservedAt(e.target.value)}
              />
            </Field>
          )}
          <Field label="회복 관찰 내용">
            <textarea
              required={!!status && status !== 'unverified'}
              className={inputCls}
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <p className="mb-3 text-fg-muted">
            계획·결과 입력만으로 바이알 재고를 차감하지 않습니다. 실제 사용은 해동 작업으로 기록하세요. 확인 상태는 입력자의 관찰이며 앱의
            검증이 아닙니다.
          </p>
          <FormError>{error}</FormError>
          <button disabled={busy} className={primaryBtnCls}>
            {busy ? '저장 중…' : '해동 계획·회복 결과 저장'}
          </button>
        </form>
      </details>
    </section>
  );
}
