import * as Plot from '@observablehq/plot';
import { useEffect, useMemo, useState } from 'react';
import { formatCount } from '../../shared/cell-count';
import type { CultureDto, LotDto } from '../../shared/cell-line';
import type { CultureVesselUse } from '../../shared/lab-products';
import { FEED_MODE_LABELS, LEFTOVER_LABELS, PLATE_STATUS_LABELS, RESERVED_EXTRA_KEYS } from '../../shared/culture-operations';
import { countText } from '../components/CellCounterFields';
import { VesselUsePicker } from '../components/VesselUsePicker';
import { PhotoStrip } from './operations/ObservationForm';
import { LotRecoveryPanel } from './operations/LotRecoveryPanel';
import { isoFromInput, localInput, optionalNumber } from './operations/common';
import { ProtocolRunView } from './ProtocolRun';
import { api } from '../api';
import { Dialog, Field, inputCls, primaryBtnCls, smallBtnCls, smallDangerBtnCls, solidDangerBtnCls } from '../components/Dialog';
import { OptionCombobox } from '../components/OptionCombobox';
import { PlotFrame } from '../components/PlotFrame';
import { useToast } from '../components/Toast';
import { EndCultureDialog, FreezeDialog, LogDialog, PassageDialog, ThawDialog } from './dialogs/CultureDialogs';
import { DeleteCultureDialog, RecordActions, recordTitle, type LineageWorkspace } from './RecordActions';
import { sourceCellsPerVial } from './lineage-source';

export const CULTURE_STATUS_LABELS: Record<CultureDto['status'], string> = {
  active: '활성',
  split: '계대 완료',
  frozen: '동결 완료',
  harvested: '수확',
  discarded: '폐기',
  contaminated: '오염',
};
/** Ends set by 배양 종료; these may be changed or undone in place. Split/frozen are undone through their record. */
const MANUAL_END = ['harvested', 'discarded', 'contaminated'] as const;

export function NodeDrawer({
  ws,
  lot,
  culture,
  onSelect,
  onClose,
  onChanged,
}: {
  ws: LineageWorkspace;
  lot?: LotDto;
  culture?: CultureDto;
  onSelect(id: string): void;
  onClose(): void;
  onChanged(): void;
}) {
  const { line, profiles } = ws;
  const toast = useToast();
  const node = lot ?? culture!;
  const logs = useMemo(() => (culture ? ws.logs.filter((l) => l.cultureId === culture.id) : []), [ws.logs, culture]);
  const thawedFrom = lot ? ws.cultures.filter((c) => c.parentLotId === lot.id) : [];
  const [label, setLabel] = useState(node.label);
  const [at, setAt] = useState(localInput(lot?.eventAt ?? culture!.startedAt));
  const [passage, setPassage] = useState(String(node.passage ?? ''));
  const [location, setLocation] = useState(lot?.location ?? '');
  const [vials, setVials] = useState(String(lot?.vialsRemaining ?? 0));
  const [vialsInitial, setVialsInitial] = useState(String(lot?.vialsInitial ?? 1));
  const [cellsPerVial, setCellsPerVial] = useState(String(lot?.cellsPerVial ?? ''));
  const [freezingMedium, setFreezingMedium] = useState(lot?.freezingMedium ?? '');
  const [supplierLot, setSupplierLot] = useState(lot?.supplierLot ?? '');
  const [vessel, setVessel] = useState(culture?.vessel ?? '');
  const [vesselUse, setVesselUse] = useState<CultureVesselUse | null>(culture?.vesselUse ?? null);
  const [profile, setProfile] = useState(culture?.profileId ?? '');
  const [status, setStatus] = useState<CultureDto['status']>(culture?.status ?? 'active');
  const [endedAt, setEndedAt] = useState(culture?.endedAt ? localInput(culture.endedAt) : '');
  const [endNote, setEndNote] = useState(culture?.endNote ?? '');
  const [notes, setNotes] = useState(node.notes);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<'thaw' | 'log' | 'feed' | 'passage' | 'freeze' | 'end' | 'delete' | 'plates' | null>(null);
  useEffect(() => {
    setLabel(node.label);
    setAt(localInput(lot?.eventAt ?? culture!.startedAt));
    setPassage(String(node.passage ?? ''));
    setNotes(node.notes);
    setVials(String(lot?.vialsRemaining ?? 0));
    setVialsInitial(String(lot?.vialsInitial ?? 1));
    setCellsPerVial(String(lot?.cellsPerVial ?? ''));
    setFreezingMedium(lot?.freezingMedium ?? '');
    setSupplierLot(lot?.supplierLot ?? '');
    setLocation(lot?.location ?? '');
    setVessel(culture?.vessel ?? '');
    setVesselUse(culture?.vesselUse ?? null);
    setProfile(culture?.profileId ?? '');
    setStatus(culture?.status ?? 'active');
    setEndedAt(culture?.endedAt ? localInput(culture.endedAt) : '');
    setEndNote(culture?.endNote ?? '');
  }, [node, lot, culture]);
  const chart = useMemo<Plot.PlotOptions>(() => {
    const points = logs
      .filter((l) => l.confluencyPct !== null)
      .map((l) => ({ at: new Date(l.at), value: l.confluencyPct }))
      .sort((a, b) => +a.at - +b.at);
    return {
      height: 140,
      x: { label: '관찰일' },
      y: { domain: [0, 100], label: 'Confluency (%)' },
      marks: [Plot.line(points, { x: 'at', y: 'value' }), Plot.dot(points, { x: 'at', y: 'value', tip: true })],
    };
  }, [logs]);
  const lastConfluency = logs.find((l) => l.confluencyPct !== null);
  const manualEnd = culture && (status === 'active' || (MANUAL_END as readonly string[]).includes(status));
  const props = {
    line,
    lot,
    culture,
    profiles,
    defaultCellsPerVial: culture ? sourceCellsPerVial(culture.id, ws.cultures, ws.lots) : null,
    onClose: () => setDialog(null),
    onSaved: onChanged,
  };
  const save = async () => {
    setBusy(true);
    try {
      const time = isoFromInput(at);
      const json = lot
        ? {
            label,
            location,
            notes,
            eventAt: time,
            passage: optionalNumber(passage, 'Passage'),
            vialsInitial: Number(vialsInitial),
            vialsRemaining: Number(vials),
            cellsPerVial: optionalNumber(cellsPerVial, '바이알당 세포 수'),
            freezingMedium,
            supplierLot,
          }
        : {
            label,
            vessel,
            vesselUse,
            notes,
            profileId: profile || null,
            startedAt: time,
            passage: optionalNumber(passage, 'Passage') ?? undefined,
            ...(manualEnd ? { status, ...(status === 'active' ? {} : { endedAt: endedAt ? isoFromInput(endedAt) : undefined, endNote }) } : {}),
          };
      await api(`/api/${lot ? 'lots' : 'cultures'}/${node.id}`, { method: 'PUT', json });
      onChanged();
      toast('저장했습니다');
    } catch (e) {
      toast((e as Error).message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  async function removeLot() {
    if (!lot) return;
    const message =
      lot.origin === 'frozen'
        ? `동결을 취소합니다.\n\nstock ${lot.label}이 삭제되고, 동결로 종료된 배양은 다시 활성 배양이 됩니다.`
        : `stock ${lot.label}을(를) 삭제할까요?`;
    if (!confirm(message)) return;
    try {
      await api(`/api/lots/${lot.id}`, { method: 'DELETE' });
      onClose();
      onChanged();
    } catch (e) {
      toast((e as Error).message, { tone: 'error' });
    }
  }
  return (
    <aside aria-label="계보 노드 상세" className="workbench-panel cell-selection">
      <p className="workbench-eyebrow">{lot ? '선택한 바이알' : '선택한 배양'}</p>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="break-all font-semibold">{node.label}</h3>
        <button className={smallBtnCls} onClick={onClose}>
          기본 선택
        </button>
      </div>
      <p className="mb-3 text-xs text-fg-muted">
        P{node.passage ?? '미정'} · {new Date(lot?.eventAt ?? culture!.startedAt).toLocaleString('ko-KR')}{' '}
        {culture && `· ${CULTURE_STATUS_LABELS[culture.status]}`}
      </p>
      {culture && (
        <p className="mb-3 text-xs text-fg-muted">
          {culture.vessel} · 최근 confluency{' '}
          {lastConfluency ? `${lastConfluency.confluencyPct}% · ${new Date(lastConfluency.at).toLocaleString('ko-KR')} (관찰 당시 값)` : '미정'}
        </p>
      )}
      {culture?.endNote && <p className="mb-3 text-xs text-fg-muted">종료 메모: {culture.endNote}</p>}
      <details className="cell-info-details" open={lot?.vialsRemaining === 0 || undefined}>
        <summary>정보 수정 · 배양 조건 연결</summary>
        <Field label="라벨">
          <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={lot ? (lot.origin === 'received' ? '입고 일시' : '동결 일시') : '시작 일시 (해동·계대·입고)'}>
            <input type="datetime-local" className={inputCls} value={at} onChange={(e) => setAt(e.target.value)} />
          </Field>
          <Field label="Passage">
            <input type="number" min="0" className={inputCls} value={passage} onChange={(e) => setPassage(e.target.value)} />
          </Field>
        </div>
        {lot ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="최초 바이알 수">
                <input className={inputCls} type="number" min="1" value={vialsInitial} onChange={(e) => setVialsInitial(e.target.value)} />
              </Field>
              <Field label="남은 바이알 수">
                <input className={inputCls} type="number" min="0" max={vialsInitial} value={vials} onChange={(e) => setVials(e.target.value)} />
              </Field>
            </div>
            <Field label="바이알당 세포 수">
              <input className={inputCls} type="number" min="0" step="any" value={cellsPerVial} onChange={(e) => setCellsPerVial(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="동결 배지">
                <input className={inputCls} value={freezingMedium} onChange={(e) => setFreezingMedium(e.target.value)} />
              </Field>
              <Field label="공급자 로트">
                <input className={inputCls} value={supplierLot} onChange={(e) => setSupplierLot(e.target.value)} />
              </Field>
            </div>
            <Field label="보관 위치">
              <input className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} />
            </Field>
          </>
        ) : (
          <>
            <VesselUsePicker value={vesselUse} legacyVessel={culture?.vessel} onChange={(use) => setVesselUse(use)} />
            {!vesselUse && (
              <Field label="배양 용기 (직접 입력)">
                <OptionCombobox category="vessel" value={vessel} onChange={setVessel} />
              </Field>
            )}
            <Field label="연결 배양 조건">
              <select className={inputCls} value={profile} onChange={(e) => setProfile(e.target.value)}>
                <option value="">연결하지 않음</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            {manualEnd && culture!.status !== 'active' && (
              <>
                <Field label="상태" hint="활성으로 바꾸면 종료 기록이 지워지고 다시 작업을 기록할 수 있습니다.">
                  <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as CultureDto['status'])}>
                    <option value="active">활성 (종료 취소)</option>
                    {MANUAL_END.map((s) => (
                      <option key={s} value={s}>
                        {CULTURE_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </Field>
                {status !== 'active' && (
                  <>
                    <Field label="종료 일시">
                      <input type="datetime-local" className={inputCls} value={endedAt} onChange={(e) => setEndedAt(e.target.value)} />
                    </Field>
                    <Field label="종료 메모">
                      <textarea className={inputCls} value={endNote} onChange={(e) => setEndNote(e.target.value)} />
                    </Field>
                  </>
                )}
              </>
            )}
            {culture && !manualEnd && (
              <p className="mb-3 text-xs text-fg-muted">
                {CULTURE_STATUS_LABELS[culture.status]} 상태는 아래 기록 목록의 {culture.status === 'split' ? '계대' : '동결'} 기록을 취소하면 다시 활성이
                됩니다.
              </p>
            )}
          </>
        )}
        <Field label="메모">
          <textarea className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="cell-info-actions">
          <button className={primaryBtnCls} disabled={busy} onClick={() => void save()}>
            정보 저장
          </button>
          <button className={smallDangerBtnCls} onClick={() => (lot ? void removeLot() : setDialog('delete'))}>
            {lot ? (lot.origin === 'frozen' ? '동결 취소 · stock 삭제' : 'stock 삭제') : culture?.parentLotId ? '해동 취소 · 배양 삭제' : '배양 삭제'}
          </button>
        </div>
      </details>
      {lot && <LotRecoveryPanel key={lot.id} lot={lot} onSaved={onChanged} />}
      <div className="my-4 flex flex-wrap gap-2">
        {lot ? (
          <button className={smallBtnCls} disabled={lot.vialsRemaining === 0} onClick={() => setDialog('thaw')}>
            해동
          </button>
        ) : (
          <>
            <button className={smallBtnCls} disabled={culture!.status !== 'active'} onClick={() => setDialog('log')}>
              관찰 기록
            </button>
            <button className={smallBtnCls} disabled={culture!.status !== 'active'} onClick={() => setDialog('feed')}>
              배지 교체
            </button>
            {(['passage', 'freeze', 'end'] as const).map((kind, i) => (
              <button key={kind} className={smallBtnCls} disabled={culture!.status !== 'active'} onClick={() => setDialog(kind)}>
                {['계대', '동결', '종료'][i]}
              </button>
            ))}
          </>
        )}
      </div>
      {culture && culture.plates.length > 1 && (
        <div className="mb-3 rounded-lg border border-line p-2 text-xs">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="font-medium">plate {culture.plates.length}개</span>
            <button
              className={smallDangerBtnCls}
              disabled={culture.status !== 'active' || !culture.plates.some((p) => p.status === 'active')}
              onClick={() => setDialog('plates')}
            >
              plate 폐기
            </button>
          </div>
          <p className="text-fg-muted">
            {culture.plates.map((p) => `${p.no} ${PLATE_STATUS_LABELS[p.status]}`).join(' · ')}
          </p>
        </div>
      )}
      {culture && culture.status !== 'active' && (
        <p className="text-xs text-fg-muted">종료된 배양에는 새 작업을 기록할 수 없습니다. 기존 기록과 배양 정보는 언제든 수정할 수 있습니다.</p>
      )}
      {lot && (
        <>
          {lot.vialsRemaining === 0 && (
            <p className="text-xs text-fg-muted">남은 바이알이 없어 새로 해동할 수 없습니다. 해동한 배양과 해동 기록은 아래에서 수정·취소합니다.</p>
          )}
          <h4 className="mt-4 text-sm font-medium">이 stock에서 해동한 배양</h4>
          {thawedFrom.length === 0 && <p className="my-3 text-sm text-fg-muted">아직 해동한 배양이 없습니다.</p>}
          {thawedFrom.map((c) => {
            const thawLog = ws.logs.find((l) => l.cultureId === c.id && l.operation === 'thaw');
            return (
              <article key={c.id} className="mt-3 rounded-lg border border-line p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <button className="cell-text-button font-medium" onClick={() => onSelect(c.id)}>
                    {c.label} · P{c.passage}
                  </button>
                  <span className="text-fg-muted">{CULTURE_STATUS_LABELS[c.status]}</span>
                </div>
                <p className="mt-1 text-fg-muted">
                  {new Date(c.startedAt).toLocaleString('ko-KR')} · {c.vessel}
                  {thawLog?.thaw?.vials != null && ` · 바이알 ${thawLog.thaw.vials}개`}
                </p>
                {thawLog && (
                  <div className="mt-2">
                    <RecordActions log={thawLog} ws={ws} onChanged={onChanged} />
                  </div>
                )}
              </article>
            );
          })}
        </>
      )}
      {culture && (
        <>
          <h4 className="text-sm font-medium">Confluency 변화</h4>
          {logs.some((l) => l.confluencyPct !== null) ? (
            <PlotFrame options={chart} />
          ) : (
            <p className="cell-empty">Confluency 관찰값이 없습니다.</p>
          )}
          <h4 className="mt-4 text-sm font-medium">기록 목록</h4>
          {logs.length === 0 && <p className="my-3 text-sm text-fg-muted">아직 기록이 없습니다.</p>}
          <div className="cell-record-list">
          {logs.map((l) => (
            <article key={l.id} className="mt-3 rounded-lg border border-line p-3 text-xs">
              <div className="font-medium">
                {recordTitle(l)} · {new Date(l.at).toLocaleString('ko-KR')}
              </div>
              <p className="mt-1">
                {l.confluencyPct !== null && `Confluency ${l.confluencyPct}% · `}
                {l.cellsPerMl !== null && `${formatCount(l.cellsPerMl)} cells/mL · `}
                {l.viabilityPct !== null && `생존율 ${l.viabilityPct}% · `}
                {l.totalCells !== null && `총 ${formatCount(l.totalCells)}개`}
              </p>
              {l.mycoplasma && <p>마이코플라스마: {{ negative: '음성', positive: '양성', pending: '검사 중' }[l.mycoplasma]}</p>}
              {l.feed && (
                <p className="mt-1">
                  {FEED_MODE_LABELS[l.feed.mode]} · {l.feed.mediumLabel ?? '배지 미기록'} · 제거 {l.feed.removedMl ?? '미기록'} mL / 추가{' '}
                  {l.feed.addedMl ?? '미기록'} mL{l.feed.mediumDetail && ` · ${l.feed.mediumDetail}`}
                </p>
              )}
              {l.morphology && <p className="mt-1">형태: {l.morphology}</p>}
              {l.count && <p className="mt-1">계수기: {countText(l.count)}</p>}
              {l.passage && (
                <p className="mt-1">
                  해리 시약: {l.passage.dissociationReagent ?? '미기록'} · 분주 {l.passage.splitRatio || '미기록'} · 회수 생세포{' '}
                  {l.passage.recoveredLiveCells === null ? '미기록' : formatCount(l.passage.recoveredLiveCells)} · 접종{' '}
                  {l.passage.seededCells === null ? '미기록' : formatCount(l.passage.seededCells)} cells
                  {l.passage.leftoverHandling &&
                    ` · 남은 세포${l.passage.leftoverCells === null ? '' : ` ${formatCount(l.passage.leftoverCells)}`} ${LEFTOVER_LABELS[l.passage.leftoverHandling]}`}
                </p>
              )}
              <PhotoStrip photos={l.photos ?? []} />
              {Object.entries(l.extra)
                .filter(([key]) => !RESERVED_EXTRA_KEYS.includes(key))
                .map(([k, v]) => (
                  <p key={k}>
                    {k}: {v}
                  </p>
                ))}
              <p className="mt-1 whitespace-pre-wrap">{l.note}</p>
              {l.protocolRun && (
                <div className="mt-2">
                  <ProtocolRunView run={l.protocolRun} />
                </div>
              )}
              <div className="mt-2">
                <RecordActions log={l} ws={ws} onChanged={onChanged} />
              </div>
            </article>
          ))}
          </div>
        </>
      )}
      {dialog === 'thaw' && <ThawDialog {...props} />}
      {(dialog === 'log' || dialog === 'feed') && <LogDialog {...props} logType={dialog === 'feed' ? 'medium_change' : 'observation'} />}
      {dialog === 'passage' && <PassageDialog {...props} />}
      {dialog === 'freeze' && <FreezeDialog {...props} />}
      {dialog === 'end' && <EndCultureDialog {...props} />}
      {dialog === 'plates' && culture && <DiscardPlatesDialog culture={culture} onClose={() => setDialog(null)} onSaved={onChanged} />}
      {dialog === 'delete' && culture && (
        <DeleteCultureDialog
          culture={culture}
          ws={ws}
          onClose={() => setDialog(null)}
          onDeleted={() => {
            onClose();
            onChanged();
          }}
        />
      )}
    </aside>
  );
}

/** Discard some vessels of a culture (the rest keep growing); discarding the last one ends the culture. */
function DiscardPlatesDialog({ culture, onClose, onSaved }: { culture: CultureDto; onClose(): void; onSaved(): void }) {
  const active = culture.plates.filter((p) => p.status === 'active').map((p) => p.no);
  const [chosen, setChosen] = useState<number[]>([]);
  const [at, setAt] = useState(() => localInput());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/cultures/${culture.id}/discard-plates`, { method: 'POST', json: { plates: chosen, at: isoFromInput(at), note } });
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
      title={`${culture.label} · plate 폐기`}
      onClose={onClose}
      footer={
        <button className={solidDangerBtnCls} disabled={busy || !chosen.length} onClick={() => void save()}>
          {busy ? '저장 중…' : `plate ${chosen.join(', ') || '—'} 폐기`}
        </button>
      }
    >
      {error && <p className="mb-3 text-sm text-danger">{error}</p>}
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {active.map((no) => (
          <label key={no} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={chosen.includes(no)}
              onChange={(e) => setChosen((old) => (e.target.checked ? [...old, no].sort((a, b) => a - b) : old.filter((n) => n !== no)))}
            />
            plate {no}
          </label>
        ))}
      </div>
      <p className="mb-3 text-xs text-fg-muted">
        {chosen.length && chosen.length === active.length
          ? `남은 plate를 모두 폐기하면 ${culture.label}은(는) 폐기로 종료됩니다.`
          : '고르지 않은 plate는 계속 배양합니다. 날짜별 기록의 plate 폐기 취소로 되돌릴 수 있습니다.'}
      </p>
      <Field label="폐기 일시">
        <input type="datetime-local" className={inputCls} value={at} onChange={(e) => setAt(e.target.value)} />
      </Field>
      <Field label="사유·메모">
        <textarea className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Dialog>
  );
}
