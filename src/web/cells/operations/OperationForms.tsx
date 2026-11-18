import { useState } from 'react';
import type { CellLineDto, CultureDto, LogDto, ProfileDto } from '../../../shared/cell-line';
import { FEED_MODES, FEED_MODE_LABELS, FEED_MODE_HELP, validateFeedInput } from '../../../shared/culture-operations';
import type { FeedMode } from '../../../shared/culture-operations';
import { api } from '../../api';
import { Field, inputCls, primaryBtnCls } from '../../components/Dialog';
import { MediumProductPicker } from '../../components/MediumProductPicker';
import { executionProfile } from '../culture-plan-state';
import { composeOperationNote, FieldRow, FormError, isoFromInput, localInput, PlanRecordSection } from './common';
import type { ProtocolRunEdit } from '../../../shared/protocol-run';
import { initialRunEdit, ProtocolRunSection } from '../ProtocolRun';

export interface OperationProps {
  line: CellLineDto;
  culture: CultureDto;
  profiles: ProfileDto[];
  initialAt?: string;
  initialLog?: LogDto;
  /** Cells per vial recorded on the stock this culture descends from; prefills freezing. */
  defaultCellsPerVial?: number | null;
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
  const [protocolRun, setProtocolRun] = useState<ProtocolRunEdit>(() => initialRunEdit(initialLog?.protocolRun));
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
          protocolRun,
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
      <ProtocolRunSection
        line={line}
        profile={profile}
        folder="feed"
        value={protocolRun}
        onChange={setProtocolRun}
        saved={initialLog ? initialLog.protocolRun : undefined}
      />
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
