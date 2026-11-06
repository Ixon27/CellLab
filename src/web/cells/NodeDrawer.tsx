import * as Plot from '@observablehq/plot';
import { useEffect, useMemo, useState } from 'react';
import { formatCount } from '../../shared/cell-count';
import type { CellLineDto, CultureDto, LogDto, LotDto, ProfileDto } from '../../shared/cell-line';
import { api } from '../api';
import { Field, inputCls, primaryBtnCls, smallBtnCls } from '../components/Dialog';
import { OptionCombobox } from '../components/OptionCombobox';
import { PlotFrame } from '../components/PlotFrame';
import { useToast } from '../components/Toast';
import { EndCultureDialog, FreezeDialog, LogDialog, PassageDialog, ThawDialog } from './dialogs/CultureDialogs';

export const CULTURE_STATUS_LABELS: Record<CultureDto['status'], string> = {
  active: '활성',
  split: '계대 완료',
  frozen: '동결 완료',
  harvested: '수확',
  discarded: '폐기',
  contaminated: '오염',
};
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
export function NodeDrawer({
  line,
  lot,
  culture,
  profiles,
  logs,
  onClose,
  onChanged,
}: {
  line: CellLineDto;
  lot?: LotDto;
  culture?: CultureDto;
  profiles: ProfileDto[];
  logs: LogDto[];
  onClose(): void;
  onChanged(): void;
}) {
  const toast = useToast();
  const node = lot ?? culture!;
  const [label, setLabel] = useState(node.label);
  const [location, setLocation] = useState(lot?.location ?? '');
  const [vials, setVials] = useState(String(lot?.vialsRemaining ?? 0));
  const [vessel, setVessel] = useState(culture?.vessel ?? '');
  const [profile, setProfile] = useState(culture?.profileId ?? '');
  const [notes, setNotes] = useState(node.notes);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<'thaw' | 'log' | 'feed' | 'passage' | 'freeze' | 'end' | null>(null);
  const [editing, setEditing] = useState<LogDto | undefined>();
  useEffect(() => {
    setLabel(node.label);
    setNotes(node.notes);
    setVials(String(lot?.vialsRemaining ?? 0));
    setLocation(lot?.location ?? '');
    setVessel(culture?.vessel ?? '');
    setProfile(culture?.profileId ?? '');
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
  const changed = () => {
    onChanged();
  };
  const props = {
    line,
    lot,
    culture,
    profiles,
    onClose: () => {
      setDialog(null);
      setEditing(undefined);
    },
    onSaved: changed,
  };
  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/${lot ? 'lots' : 'cultures'}/${node.id}`, {
        method: 'PUT',
        json: lot ? { label, location, notes, vialsRemaining: Number(vials) } : { label, vessel, notes, profileId: profile || null },
      });
      changed();
      toast('저장했습니다');
    } catch (e) {
      toast((e as Error).message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
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
          {lastConfluency ? `${lastConfluency.confluencyPct}% · ${new Date(lastConfluency.at).toLocaleDateString('ko-KR')}` : '미정'}
        </p>
      )}
      {culture?.endNote && <p className="mb-3 text-xs text-fg-muted">종료 메모: {culture.endNote}</p>}
      <details className="cell-info-details">
        <summary>정보 수정 · 배양 조건 연결</summary>
        <Field label="라벨">
          <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        {lot ? (
          <>
            <p className="mb-3 text-sm">
              {lot.origin === 'received' ? '입고' : '동결'} · 남은 {lot.vialsRemaining}/{lot.vialsInitial} 바이알 ·{' '}
              {lot.cellsPerVial?.toLocaleString() ?? '미정'} cells/vial
            </p>
            <p className="mb-3 text-xs text-fg-muted">
              동결 배지: {lot.freezingMedium ?? '미정'} · 공급자 로트: {lot.supplierLot ?? '미정'}
            </p>
            <Field label="보관 위치">
              <input className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} />
            </Field>
            <Field label="남은 바이알 수동 보정">
              <input
                className={inputCls}
                type="number"
                min="0"
                max={lot.vialsInitial}
                value={vials}
                onChange={(e) => setVials(e.target.value)}
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="배양 용기">
              <OptionCombobox category="vessel" value={vessel} onChange={setVessel} />
            </Field>
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
          </>
        )}
        <Field label="메모">
          <textarea className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <button className={primaryBtnCls} disabled={busy} onClick={() => void save()}>
          정보 저장
        </button>
      </details>
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
      {culture && culture.status !== 'active' && (
        <p className="text-xs text-fg-muted">종료된 배양에는 새 작업을 기록할 수 없습니다. 기존 기록은 수정할 수 있습니다.</p>
      )}
      {lot?.vialsRemaining === 0 && <p className="text-xs text-fg-muted">남은 바이알이 없어 해동할 수 없습니다.</p>}
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
          {logs.map((l) => (
            <article key={l.id} className="mt-3 rounded-lg border border-line p-3 text-xs">
              <div className="font-medium">
                {logLabels[l.type]} · {new Date(l.at).toLocaleString('ko-KR')}
              </div>
              <p className="mt-1">
                {l.confluencyPct !== null && `Confluency ${l.confluencyPct}% · `}
                {l.cellsPerMl !== null && `${formatCount(l.cellsPerMl)} cells/mL · `}
                {l.viabilityPct !== null && `생존율 ${l.viabilityPct}% · `}
                {l.totalCells !== null && `총 ${formatCount(l.totalCells)}개`}
              </p>
              {l.mycoplasma && <p>마이코플라스마: {{ negative: '음성', positive: '양성', pending: '검사 중' }[l.mycoplasma]}</p>}
              {Object.entries(l.extra).map(([k, v]) => (
                <p key={k}>
                  {k}: {v}
                </p>
              ))}
              <p className="mt-1 whitespace-pre-wrap">{l.note}</p>
              {l.type !== 'passage' && l.type !== 'freeze' && (
                <div className="mt-2 flex gap-2">
                  <button
                    className={smallBtnCls}
                    onClick={() => {
                      setEditing(l);
                      setDialog('log');
                    }}
                  >
                    수정
                  </button>
                  <button
                    className={smallBtnCls}
                    onClick={async () => {
                      if (!confirm('이 기록을 삭제할까요?')) return;
                      try {
                        await api(`/api/logs/${l.id}`, { method: 'DELETE' });
                        changed();
                      } catch (e) {
                        toast((e as Error).message, { tone: 'error' });
                      }
                    }}
                  >
                    삭제
                  </button>
                </div>
              )}
              {(l.type === 'passage' || l.type === 'freeze') && <p className="mt-2 text-fg-muted">계보 작업 기록 · 수정·삭제 보호</p>}
            </article>
          ))}
        </>
      )}
      {dialog === 'thaw' && <ThawDialog {...props} />}
      {(dialog === 'log' || dialog === 'feed') && (
        <LogDialog {...props} initialLog={editing} logType={dialog === 'feed' ? 'medium_change' : 'observation'} />
      )}
      {dialog === 'passage' && <PassageDialog {...props} />}
      {dialog === 'freeze' && <FreezeDialog {...props} />}
      {dialog === 'end' && <EndCultureDialog {...props} />}
    </aside>
  );
}
