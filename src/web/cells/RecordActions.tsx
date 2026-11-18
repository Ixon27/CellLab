import { useState } from 'react';
import type { CellLineDto, CultureDto, LogDto, LotDto, ProfileDto } from '../../shared/cell-line';
import { childCultureIds, FEED_MODE_LABELS } from '../../shared/culture-operations';
import type { ProtocolFolder, ProtocolRunEdit } from '../../shared/protocol-run';
import { api } from '../api';
import { Dialog, Field, inputCls, primaryBtnCls, smallBtnCls, smallDangerBtnCls, solidDangerBtnCls } from '../components/Dialog';
import { CellCounterFields, counterDraftFrom, counterResult, type CounterDraft } from '../components/CellCounterFields';
import { useToast } from '../components/Toast';
import { executionProfile } from './culture-plan-state';
import { LogDialog } from './dialogs/CultureDialogs';
import { FieldRow, FormError, isoFromInput, localInput, optionalNumber } from './operations/common';
import { initialRunEdit, ProtocolRunSection } from './ProtocolRun';

/** Everything on the lineage workspace a record action needs to explain and carry out its consequences. */
export interface LineageWorkspace {
  line: CellLineDto;
  profiles: ProfileDto[];
  cultures: CultureDto[];
  lots: LotDto[];
  /** All records of the line. */
  logs: LogDto[];
}

export const logLabels: Record<LogDto['type'], string> = {
  observation: '관찰',
  medium_change: '배지 교체',
  passage: '계대',
  freeze: '동결',
  harvest: '수확',
  treatment: '처리',
  mycoplasma: '마이코플라스마',
  note: '메모',
};
const OPERATION_LABELS = { thaw: '해동', passage: '계대', freeze: '동결', discard: 'plate 폐기' } as const;
const OPERATION_FOLDERS: Record<keyof typeof OPERATION_LABELS, ProtocolFolder> = {
  thaw: 'thaw',
  passage: 'passage',
  freeze: 'freeze',
  discard: 'general',
};

/** How a record is named in lists: the operation it stands for, the feed mode, else its type. */
export function recordTitle(log: LogDto): string {
  if (log.operation) return OPERATION_LABELS[log.operation];
  return log.feed ? FEED_MODE_LABELS[log.feed.mode] : logLabels[log.type];
}

/** What undoing a passage or freeze record will change, for the confirmation. */
function undoMessage(log: LogDto, ws: LineageWorkspace): string {
  const culture = ws.cultures.find((c) => c.id === log.cultureId);
  if (log.operation === 'passage') {
    const children = childCultureIds(log.extra)
      .map((id) => ws.cultures.find((c) => c.id === id))
      .filter((c): c is CultureDto => !!c);
    const records = ws.logs.filter((l) => children.some((c) => c.id === l.cultureId)).length;
    return [
      '계대를 취소합니다.',
      children.length ? `새 배양 ${children.map((c) => c.label).join(', ')}와(과) 그 기록 ${records}건이 삭제됩니다.` : '',
      culture?.status === 'split' ? `${culture.label}은(는) 다시 활성 배양이 됩니다.` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }
  if (log.operation === 'discard')
    return [
      `plate ${log.extra.discardedPlates} 폐기를 취소합니다. 그 plate는 다시 활성이 됩니다.`,
      culture?.status === 'discarded' ? `${culture.label}은(는) 다시 활성 배양이 됩니다.` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  const lot = ws.lots.find((l) => l.id === log.extra.frozenLotId);
  return [
    '동결을 취소합니다.',
    lot ? `stock ${lot.label}(${lot.vialsRemaining}/${lot.vialsInitial} vial)이 삭제됩니다.` : '',
    culture?.status === 'frozen' ? `${culture.label}은(는) 다시 활성 배양이 됩니다.` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** 수정 and 삭제/취소 of one record. Deleting a thaw, passage or freeze record undoes that operation in the lineage. */
export function RecordActions({ log, ws, onChanged }: { log: LogDto; ws: LineageWorkspace; onChanged(): void }) {
  const toast = useToast();
  const [dialog, setDialog] = useState<'edit' | 'delete' | null>(null);
  const culture = ws.cultures.find((c) => c.id === log.cultureId);
  async function remove() {
    if (log.operation === 'thaw') return setDialog('delete');
    if (!confirm(log.operation ? undoMessage(log, ws) : '이 기록을 삭제할까요?')) return;
    try {
      await api(`/api/logs/${log.id}`, { method: 'DELETE' });
      onChanged();
    } catch (e) {
      toast((e as Error).message, { tone: 'error' });
    }
  }
  const close = () => setDialog(null);
  return (
    <div className="cell-row-actions" onClick={(e) => e.stopPropagation()}>
      <button className={smallBtnCls} onClick={() => setDialog('edit')}>
        수정
      </button>
      <button
        className={log.operation ? smallDangerBtnCls : smallBtnCls}
        title={log.operation ? `${OPERATION_LABELS[log.operation]}을(를) 되돌리고 만들어진 배양·stock을 정리합니다` : undefined}
        onClick={() => void remove()}
      >
        {log.operation ? `${OPERATION_LABELS[log.operation]} 취소` : '삭제'}
      </button>
      {dialog === 'edit' && culture && log.operation && <OperationLogDialog log={log} culture={culture} ws={ws} onClose={close} onSaved={onChanged} />}
      {dialog === 'edit' && culture && !log.operation && (
        <LogDialog line={ws.line} profiles={ws.profiles} culture={culture} initialLog={log} onClose={close} onSaved={onChanged} />
      )}
      {dialog === 'delete' && culture && <DeleteCultureDialog culture={culture} ws={ws} onClose={close} onDeleted={onChanged} />}
    </div>
  );
}

/**
 * Edit a thaw/passage/freeze record: time, measured values, note and the protocol steps changed in that run.
 * Moving the time moves what the operation made; vessels, labels and vial counts are edited on the culture/stock itself.
 */
export function OperationLogDialog({
  log,
  culture,
  ws,
  onClose,
  onSaved,
}: {
  log: LogDto;
  culture: CultureDto;
  ws: LineageWorkspace;
  onClose(): void;
  onSaved(): void;
}) {
  const op = log.operation!;
  const [at, setAt] = useState(() => localInput(log.at));
  const [note, setNote] = useState(log.note);
  const [reagent, setReagent] = useState(log.passage?.dissociationReagent ?? '');
  const [ratio, setRatio] = useState(log.passage?.splitRatio ?? '');
  const [confluency, setConfluency] = useState(String(log.confluencyPct ?? ''));
  const [totalCells, setTotalCells] = useState(String(log.totalCells ?? ''));
  const [counter, setCounter] = useState<CounterDraft>(() => counterDraftFrom(log));
  const [protocolRun, setProtocolRun] = useState<ProtocolRunEdit>(() => initialRunEdit(log.protocolRun));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const profile = executionProfile(ws.profiles, culture).profile ?? ws.profiles.find((p) => p.isActive) ?? null;
  const lot = ws.lots.find((l) => l.id === (op === 'thaw' ? log.thaw?.lotId : log.extra.frozenLotId));
  const children = childCultureIds(log.extra)
    .map((id) => ws.cultures.find((c) => c.id === id)?.label)
    .filter(Boolean);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { at: isoFromInput(at), note, protocolRun };
      if (op === 'passage' || op === 'freeze') {
        const counted = counterResult(counter);
        Object.assign(body, {
          confluencyPct: optionalNumber(confluency, 'Confluency'),
          cellsPerMl: counted?.liveCellsPerMl ?? null,
          viabilityPct: counted?.viabilityPct ?? null,
          totalCells: counted?.liveCells ?? optionalNumber(totalCells, '회수한 생세포 수'),
          count: counted?.extras ?? {},
        });
      }
      if (op === 'passage') Object.assign(body, { dissociationReagent: reagent, splitRatio: ratio });
      await api(`/api/logs/${log.id}`, { method: 'PUT', json: body });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={`${OPERATION_LABELS[op]} 기록 수정`}
      onClose={onClose}
      width={720}
      footer={
        <button className={primaryBtnCls} disabled={busy} onClick={() => void save()}>
          {busy ? '저장 중…' : '저장'}
        </button>
      }
    >
      <FormError>{error}</FormError>
      <p className="mb-3 rounded-lg bg-sunken p-3 text-sm">
        {op === 'thaw' &&
          `${lot?.label ?? '삭제된 stock'}에서 바이알 ${log.thaw?.vials ?? '(기록 없음)'}개 해동 → ${culture.label}. 용기·라벨·passage는 배양 정보 수정에서, 바이알 수는 stock 정보에서 고칩니다.`}
        {op === 'passage' && `${culture.label} → 새 배양 ${children.join(', ') || '(없음)'}. 일시를 고치면 새 배양의 시작 일시도 같이 바뀝니다.`}
        {op === 'freeze' &&
          `${culture.label} → stock ${lot?.label ?? '(삭제됨)'}. 일시를 고치면 stock의 동결일도 같이 바뀌고, 바이알 수·위치는 stock 정보에서 고칩니다.`}
        {op === 'discard' && `${culture.label}의 plate ${log.extra.discardedPlates} 폐기. 폐기를 되돌리려면 이 기록을 취소하세요.`}
      </p>
      <ProtocolRunSection line={ws.line} profile={profile} folder={OPERATION_FOLDERS[op]} value={protocolRun} onChange={setProtocolRun} saved={log.protocolRun} />
      <Field label={`${OPERATION_LABELS[op]} 일시`}>
        <input required type="datetime-local" className={inputCls} value={at} onChange={(e) => setAt(e.target.value)} />
      </Field>
      {op === 'passage' && (
        <FieldRow>
          <Field label="사용한 해리 시약·농도">
            <input className={inputCls} maxLength={200} value={reagent} onChange={(e) => setReagent(e.target.value)} />
          </Field>
          <Field label="분주 비율">
            <input className={inputCls} maxLength={120} value={ratio} onChange={(e) => setRatio(e.target.value)} />
          </Field>
        </FieldRow>
      )}
      {(op === 'passage' || op === 'freeze') && (
        <>
          <FieldRow>
            <Field label={`${OPERATION_LABELS[op]} 직전 confluency (%)`}>
              <input type="number" min="0" max="100" step="any" className={inputCls} value={confluency} onChange={(e) => setConfluency(e.target.value)} />
            </Field>
            <Field label="회수한 살아 있는 세포 수 (계수기 생세포 농도·현탁 부피가 있으면 그 값)">
              <input type="number" min="0" step="any" className={inputCls} value={totalCells} onChange={(e) => setTotalCells(e.target.value)} />
            </Field>
          </FieldRow>
          <CellCounterFields value={counter} onChange={setCounter} />
        </>
      )}
      <Field label="메모">
        <textarea className={inputCls} rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Dialog>
  );
}

/**
 * Delete a culture (also how a thaw is undone). Shows what goes with it and, for a thawed culture, how many vials
 * return to the stock: all vials of the thaw once its last culture goes, editable when the record lacks the count.
 */
export function DeleteCultureDialog({
  culture,
  ws,
  onClose,
  onDeleted,
}: {
  culture: CultureDto;
  ws: LineageWorkspace;
  onClose(): void;
  onDeleted(): void;
}) {
  const toast = useToast();
  const records = ws.logs.filter((l) => l.cultureId === culture.id);
  const blockers = [
    ...ws.cultures.filter((c) => c.parentCultureId === culture.id).map((c) => `계대한 배양 ${c.label}`),
    ...ws.lots.filter((l) => l.sourceCultureId === culture.id).map((l) => `동결한 stock ${l.label}`),
  ];
  const lot = ws.lots.find((l) => l.id === culture.parentLotId);
  const used = lot ? lot.vialsInitial - lot.vialsRemaining : 0;
  const siblings = ws.cultures.filter((c) => c.id !== culture.id && c.parentLotId === culture.parentLotId && c.createdAt === culture.createdAt);
  const recorded = records.find((l) => l.thaw)?.thaw?.vials ?? null;
  const [vials, setVials] = useState(() => String(siblings.length ? 0 : Math.min(used, recorded ?? 1)));
  const parent = ws.cultures.find((c) => c.id === culture.parentCultureId);
  const passage = ws.logs.find((l) => l.cultureId === parent?.id && l.type === 'passage' && childCultureIds(l.extra).includes(culture.id));
  const lastChild = !!passage && childCultureIds(passage.extra).length === 1;
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try {
      await api(`/api/cultures/${culture.id}${lot ? `?restoreVials=${Number(vials) || 0}` : ''}`, { method: 'DELETE' });
      onDeleted();
      onClose();
    } catch (e) {
      toast((e as Error).message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={`${culture.label} 삭제`}
      onClose={onClose}
      footer={
        <button className={solidDangerBtnCls} disabled={busy || blockers.length > 0} onClick={() => void remove()}>
          {busy ? '삭제 중…' : lot ? '해동 취소 · 배양 삭제' : '배양 삭제'}
        </button>
      }
    >
      {blockers.length > 0 ? (
        <p className="mb-3 text-sm text-danger">
          이 배양에서 이어진 {blockers.join(', ')}이(가) 있어 지금은 삭제할 수 없습니다. 그 계대·동결 기록을 먼저 취소하세요.
        </p>
      ) : (
        <p className="mb-3 text-sm">배양과 기록 {records.length}건(사진 포함)이 삭제됩니다. 되돌릴 수 없습니다.</p>
      )}
      {lot && (
        <Field
          label={`${lot.label}에 되돌릴 바이알 수 (현재 남은 ${lot.vialsRemaining}/${lot.vialsInitial})`}
          hint={
            siblings.length
              ? `같은 해동에서 나눈 배양(${siblings.map((c) => c.label).join(', ')})이 남아 있어 기본값은 0개입니다.`
              : recorded === null
                ? '해동 기록에 바이알 수가 없어 1개로 채웠습니다. 실제로 쓴 바이알 수를 확인하세요.'
                : `이 해동에서 쓴 바이알 ${recorded}개를 기본으로 되돌립니다.`
          }
        >
          <input type="number" min="0" max={used} className={inputCls} value={vials} onChange={(e) => setVials(e.target.value)} />
        </Field>
      )}
      {lastChild && parent && (
        <p className="mb-3 text-sm text-fg-muted">
          {parent.label}의 마지막 새 배양이므로 그 계대 기록도 취소되고 {parent.label}은(는) 다시 활성 배양이 됩니다.
        </p>
      )}
    </Dialog>
  );
}
