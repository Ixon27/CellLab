import * as Plot from '@observablehq/plot';
import { Info } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { formatCount } from '../../shared/cell-count';
import type { CultureDto, LogDto, LotDto } from '../../shared/cell-line';
import type { CultureVesselUse } from '../../shared/lab-products';
import { FEED_MODE_LABELS, LEFTOVER_LABELS, PLATE_STATUS_LABELS, RESERVED_EXTRA_KEYS, type PlateStatus } from '../../shared/culture-operations';
import { splitConditionSnapshot } from '../../shared/culture-plan';
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
import { formatRecordDate, recordKind, RecordBadge } from './record-display';
import { sourceCellsPerVial } from './lineage-source';

export const CULTURE_STATUS_LABELS: Record<CultureDto['status'], string> = {
  active: '활성',
  split: '계대 완료',
  frozen: '동결 완료',
  harvested: '수확',
  discarded: '폐기',
  contaminated: '오염',
};
/** The record that ended a culture in each status; editing or undoing that record changes the end. */
const END_RECORD: Record<Exclude<CultureDto['status'], 'active'>, string> = {
  split: '계대',
  frozen: '동결',
  harvested: '수확',
  discarded: '폐기',
  contaminated: '오염',
};

export function NodeDrawer({
  ws,
  lot,
  culture,
  selectedPlate,
  onSelect,
  onClose,
  onChanged,
}: {
  ws: LineageWorkspace;
  lot?: LotDto;
  culture?: CultureDto;
  selectedPlate?: number;
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
  }, [node, lot, culture]);
  const startedAt = lot?.eventAt ?? culture!.startedAt;
  const props = {
    line,
    lot,
    culture,
    profiles,
    initialPlate: selectedPlate,
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
      <header className="cell-sel-head">
        <div className="min-w-0">
          <p className="workbench-eyebrow">{lot ? '선택한 바이알' : '선택한 배양'}</p>
          <h3 className="cell-sel-title">{node.label}</h3>
        </div>
        <button className={smallBtnCls} onClick={onClose}>
          기본 선택
        </button>
      </header>
      <ul className="cell-sel-chips" aria-label="배양 요약">
        {culture && (
          <li className="cell-chip" data-tone={CULTURE_TONES[culture.status]}>
            {CULTURE_STATUS_LABELS[culture.status]}
          </li>
        )}
        <li className="cell-chip">P{node.passage ?? '미정'}</li>
        {culture && <li className="cell-chip">{culture.vessel}</li>}
        {selectedPlate !== undefined && <li className="cell-chip" data-tone="accent">plate {selectedPlate} 선택</li>}
      </ul>
      <dl className="cell-sel-meta">
        <div>
          <dt>{lot ? (lot.origin === 'received' ? '입고' : '동결') : '시작'}</dt>
          <dd title={new Date(startedAt).toLocaleString('ko-KR')}>{formatRecordDate(startedAt)}</dd>
        </div>
        {culture?.endNote && (
          <div>
            <dt>종료 메모</dt>
            <dd>{culture.endNote}</dd>
          </div>
        )}
      </dl>
      {lot ? (
        <div className="cell-sel-actions" role="group" aria-label="바이알 작업">
          <button className={smallBtnCls} disabled={lot.vialsRemaining === 0} onClick={() => setDialog('thaw')}>
            해동
          </button>
        </div>
      ) : culture!.status === 'active' ? (
        <div className="cell-sel-actions" role="group" aria-label="배양 작업">
          <button className={smallBtnCls} onClick={() => setDialog('log')}>
            관찰 기록
          </button>
          <button className={smallBtnCls} onClick={() => setDialog('feed')}>
            배지 교체
          </button>
          {(['passage', 'freeze', 'end'] as const).map((kind, i) => (
            <button key={kind} className={smallBtnCls} onClick={() => setDialog(kind)}>
              {i < 2 && selectedPlate !== undefined ? `plate ${selectedPlate} ${['계대', '동결'][i]}` : ['계대', '동결', '종료'][i]}
            </button>
          ))}
        </div>
      ) : (
        <div className="cell-sel-notice" role="note">
          <Info aria-hidden size={14} />
          <p>
            <strong>종료된 배양</strong>
            새 작업은 기록할 수 없습니다. 기존 기록과 배양 정보는 언제든 수정할 수 있습니다.
          </p>
        </div>
      )}
      {lot?.vialsRemaining === 0 && (
        <div className="cell-sel-notice" role="note">
          <Info aria-hidden size={14} />
          <p>
            <strong>남은 바이알 없음</strong>
            새로 해동할 수 없습니다. 해동한 배양과 해동 기록은 아래에서 수정·취소합니다.
          </p>
        </div>
      )}
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
            {culture && culture.status !== 'active' && (
              <p className="mb-3 text-xs text-fg-muted">
                {CULTURE_STATUS_LABELS[culture.status]} 상태는 아래 기록 목록의 {END_RECORD[culture.status]} 기록에서 일시·메모를 고치거나, 그 기록을
                취소하면 다시 활성이 됩니다.
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
      {culture && culture.plates.length > 1 && (
        <section className="cell-sel-plates" aria-label="plate 상태">
          <div className="cell-sel-plates-head">
            <span>plate {culture.plates.length}개</span>
            <button
              className={smallDangerBtnCls}
              disabled={culture.status !== 'active' || !culture.plates.some((p) => p.status === 'active')}
              onClick={() => setDialog('plates')}
            >
              plate 폐기
            </button>
          </div>
          <ul className="cell-sel-chips">
            {culture.plates.map((p) => (
              <li key={p.no} className="cell-chip" data-tone={PLATE_TONES[p.status]}>
                {p.no} {PLATE_STATUS_LABELS[p.status]}
              </li>
            ))}
          </ul>
        </section>
      )}
      {lot && (
        <section className="cell-sel-section">
          <div className="cell-sel-heading">
            <h4>이 stock에서 해동한 배양</h4>
            {thawedFrom.length > 0 && <span>{thawedFrom.length}개</span>}
          </div>
          {thawedFrom.length === 0 && <p className="cell-sel-empty">아직 해동한 배양이 없습니다.</p>}
          <ol className="cell-rec-list">
            {thawedFrom.map((c) => {
              const thawLog = ws.logs.find((l) => l.cultureId === c.id && l.operation === 'thaw');
              return (
                <li key={c.id}>
                  <article className="cell-rec" data-kind="thaw">
                    <header className="cell-rec-head">
                      <button className="cell-text-button cell-rec-title" onClick={() => onSelect(c.id)}>
                        {c.label} · P{c.passage}
                      </button>
                      <span className="cell-chip" data-tone={CULTURE_TONES[c.status]}>
                        {CULTURE_STATUS_LABELS[c.status]}
                      </span>
                    </header>
                    <p className="cell-rec-line is-muted" title={new Date(c.startedAt).toLocaleString('ko-KR')}>
                      {formatRecordDate(c.startedAt)} · {c.vessel}
                      {thawLog?.thaw?.vials != null && ` · 바이알 ${thawLog.thaw.vials}개`}
                    </p>
                    {thawLog && (
                      <div className="cell-rec-foot">
                        <RecordActions log={thawLog} ws={ws} onChanged={onChanged} />
                      </div>
                    )}
                  </article>
                </li>
              );
            })}
          </ol>
        </section>
      )}
      {culture && (
        <>
          <ConfluencyTrend logs={logs} />
          <section className="cell-sel-section">
            <div className="cell-sel-heading">
              <h4>기록 목록</h4>
              {logs.length > 0 && <span>{logs.length}건 · 최신순</span>}
            </div>
            {logs.length === 0 && <p className="cell-sel-empty">아직 기록이 없습니다.</p>}
            <ol className="cell-rec-list is-timeline">
              {logs.map((l) => (
                <li key={l.id}>
                  <RecordCard log={l} ws={ws} onChanged={onChanged} />
                </li>
              ))}
            </ol>
          </section>
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

/** Chip colors follow the lineage graph: green = growing, blue = handed on to a new culture or stock, red = lost. */
const CULTURE_TONES: Record<CultureDto['status'], 'success' | 'accent' | 'danger'> = {
  active: 'success',
  split: 'accent',
  frozen: 'accent',
  harvested: 'success',
  discarded: 'danger',
  contaminated: 'danger',
};
const PLATE_TONES: Record<PlateStatus, 'success' | 'accent' | 'danger'> = { active: 'success', passaged: 'accent', discarded: 'danger', frozen: 'accent' };
const DAY = 86_400_000;
const monthDay = (d: Date) => `${d.getMonth() + 1}.${d.getDate()}`;
const pad2 = (n: number) => String(n).padStart(2, '0');

/** Date ticks (M.D): one per day (thinned to ~5) over several days; the observation times themselves within one or two days. */
function trendOptions(points: { at: Date; value: number }[]): Plot.PlotOptions {
  const first = +points[0].at;
  const last = +points[points.length - 1].at;
  let x: Plot.ScaleOptions;
  if (last - first >= 2 * DAY) {
    const start = new Date(first);
    start.setHours(0, 0, 0, 0);
    const end = new Date(last);
    end.setHours(0, 0, 0, 0);
    end.setDate(end.getDate() + 1);
    const days: Date[] = [];
    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) days.push(new Date(d));
    const step = Math.ceil(days.length / 5);
    x = { type: 'utc', domain: [start, end], ticks: days.filter((_, i) => i % step === 0), tickFormat: monthDay };
  } else {
    const pad = Math.max((last - first) * 0.25, 3 * 3_600_000);
    const times = [...new Set(points.map((p) => +p.at))];
    const ticks = times.length > 3 ? [times[0], times[Math.floor(times.length / 2)], times[times.length - 1]] : times;
    x = {
      type: 'utc',
      domain: [new Date(first - pad), new Date(last + pad)],
      ticks: ticks.map((t) => new Date(t)),
      tickFormat: (d: Date) => `${monthDay(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
    };
  }
  return {
    height: 132,
    marginTop: 12,
    marginRight: 18,
    x: { ...x, label: null },
    y: { domain: [0, 100], ticks: [0, 50, 100], tickFormat: (v: number) => `${v}%`, label: null, grid: true },
    marks: [
      Plot.line(points, { x: 'at', y: 'value', stroke: 'var(--pr-accent)', strokeWidth: 1.75 }),
      Plot.dot(points, {
        x: 'at',
        y: 'value',
        r: 3.5,
        fill: 'var(--pr-accent)',
        title: (p) => `${formatRecordDate(p.at.toISOString())}\nConfluency ${p.value}%`,
        tip: true,
      }),
    ],
  };
}

/** Confluency over time; with fewer than two observations a line has nothing to show, so the single value is a stat. */
function ConfluencyTrend({ logs }: { logs: LogDto[] }) {
  const points = useMemo(
    () =>
      logs
        .filter((l) => l.confluencyPct !== null)
        .map((l) => ({ at: new Date(l.at), value: l.confluencyPct as number }))
        .sort((a, b) => +a.at - +b.at),
    [logs],
  );
  const options = useMemo(() => (points.length > 1 ? trendOptions(points) : null), [points]);
  const latest = points.at(-1);
  return (
    <section className="cell-sel-section">
      <div className="cell-sel-heading">
        <h4>Confluency 변화</h4>
        {latest && options && <span>최근 {latest.value}%</span>}
      </div>
      {!latest && <p className="cell-sel-empty">Confluency 관찰값이 없습니다.</p>}
      {latest && options && (
        <>
          <PlotFrame options={options} />
          <p className="cell-sel-hint">관찰 당시 값 · {points.length}회 관찰</p>
        </>
      )}
      {latest && !options && (
        <div className="cell-stat">
          <div className="cell-stat-main">
            <strong>{latest.value}%</strong>
            <span>{formatRecordDate(latest.at.toISOString())} 관찰</span>
          </div>
          <div className="cell-stat-bar" role="img" aria-label={`Confluency ${latest.value}%`}>
            <i style={{ width: `${Math.min(100, Math.max(0, latest.value))}%` }} />
          </div>
          <p className="cell-sel-hint">최근 confluency · 관찰 당시 값 · 2회 이상 관찰하면 추이 그래프가 표시됩니다.</p>
        </div>
      )}
    </section>
  );
}

/** One label/value pair of a record; a missing value reads as muted 미기록. */
function Metric({ label, value, unit }: { label: string; value: string | null; unit?: string }) {
  return (
    <div>
      <dt>{label}</dt>
      {value === null ? (
        <dd className="is-empty">미기록</dd>
      ) : (
        <dd>
          {value}
          {unit && <small>{unit}</small>}
        </dd>
      )}
    </div>
  );
}

/** A record as one card: type badge · date · actions, then its measurements as a label/value grid; long text stays folded. */
function RecordCard({ log: l, ws, onChanged }: { log: LogDto; ws: LineageWorkspace; onChanged(): void }) {
  const { text: note, snapshot } = splitConditionSnapshot(l.note);
  const p = l.passage;
  const title = recordTitle(l);
  const extras = Object.entries(l.extra).filter(([key]) => !RESERVED_EXTRA_KEYS.includes(key));
  return (
    <article className="cell-rec" data-kind={recordKind(l)}>
      <header className="cell-rec-head">
        <RecordBadge log={l} />
        <time dateTime={l.at} title={new Date(l.at).toLocaleString('ko-KR')}>
          {formatRecordDate(l.at)}
        </time>
        <RecordActions log={l} ws={ws} onChanged={onChanged} />
      </header>
      <dl className="cell-rec-metrics">
        {l.confluencyPct !== null && <Metric label="Confluency" value={`${l.confluencyPct}%`} />}
        {l.cellsPerMl !== null && <Metric label="생세포 농도" value={formatCount(l.cellsPerMl)} unit="cells/mL" />}
        {l.viabilityPct !== null && <Metric label="생존율" value={`${l.viabilityPct}%`} />}
        {l.totalCells !== null && <Metric label="총 세포" value={formatCount(l.totalCells)} unit="개" />}
        {l.mycoplasma && <Metric label="마이코플라스마" value={{ negative: '음성', positive: '양성', pending: '검사 중' }[l.mycoplasma]} />}
        {p && (
          <>
            <Metric label="분주" value={p.splitRatio || null} />
            <Metric label="회수 생세포" value={p.recoveredLiveCells === null ? null : formatCount(p.recoveredLiveCells)} />
            <Metric label="접종" value={p.seededCells === null ? null : formatCount(p.seededCells)} unit={p.seededCells === null ? undefined : 'cells'} />
            {p.leftoverHandling && (
              <Metric
                label="남은 세포"
                value={`${p.leftoverCells === null ? '' : `${formatCount(p.leftoverCells)} `}${LEFTOVER_LABELS[p.leftoverHandling]}`}
              />
            )}
            <Metric label="해리 시약" value={p.dissociationReagent ?? null} />
          </>
        )}
      </dl>
      {l.feed && (
        <p className="cell-rec-line">
          {title !== FEED_MODE_LABELS[l.feed.mode] && <>{FEED_MODE_LABELS[l.feed.mode]} · </>}
          {l.feed.mediumLabel ?? '배지 미기록'}
          <span className="is-muted">
            {' '}
            · 제거 {l.feed.removedMl ?? '미기록'} mL / 추가 {l.feed.addedMl ?? '미기록'} mL{l.feed.mediumDetail && ` · ${l.feed.mediumDetail}`}
          </span>
        </p>
      )}
      {l.morphology && (
        <p className="cell-rec-line">
          <span className="is-muted">형태</span> {l.morphology}
        </p>
      )}
      <PhotoStrip photos={l.photos ?? []} />
      {extras.length > 0 && (
        <dl className="cell-rec-extras">
          {extras.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {note && <p className="cell-rec-note">{note}</p>}
      {l.count && (
        <details className="cell-rec-fold">
          <summary>계수기 상세</summary>
          <ul>
            {countText(l.count)
              .split(' · ')
              .map((item) => (
                <li key={item}>{item}</li>
              ))}
          </ul>
        </details>
      )}
      {snapshot && (
        <details className="cell-rec-fold">
          <summary>사용 조건 스냅샷</summary>
          <p>{snapshot}</p>
        </details>
      )}
      {l.protocolRun && <ProtocolRunView run={l.protocolRun} />}
    </article>
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
