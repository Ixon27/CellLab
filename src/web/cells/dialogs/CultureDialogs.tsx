import { useState } from 'react';
import type { CellLineDto, CultureDto, LogDto, LotDto, ProfileDto } from '../../../shared/cell-line';
import type { CultureVesselUse } from '../../../shared/lab-products';
import { api } from '../../api';
import { Dialog, Field, inputCls, primaryBtnCls, smallBtnCls } from '../../components/Dialog';
import { OptionCombobox } from '../../components/OptionCombobox';
import { VesselUsePicker } from '../../components/VesselUsePicker';
import { useToast } from '../../components/Toast';
import { executionProfile } from '../culture-plan-state';
import { ObservationForm } from '../operations/ObservationForm';
import { FeedForm, FreezeForm, PassageForm } from '../operations/OperationForms';
import { composeOperationNote, isoFromInput, localInput, PlanRecordSection } from '../operations/common';

interface Props {
  line: CellLineDto;
  culture?: CultureDto;
  lot?: LotDto;
  profiles: ProfileDto[];
  initialLog?: LogDto;
  initialAt?: string;
  logType?: 'observation' | 'medium_change';
  onClose(): void;
  onSaved(): void;
}
type BasicAction = 'lot' | 'culture' | 'thaw' | 'end' | 'log';
const titles: Record<BasicAction, string> = {
  lot: 'stock 입고(바이알)',
  culture: '배양 상태로 입고',
  thaw: '해동',
  end: '배양 종료',
  log: '기타 기록',
};
const otherLogs = { harvest: '수확', treatment: '처리', mycoplasma: '마이코플라스마', note: '메모' };

function CultureDialog({ action, ...p }: Props & { action: BasicAction }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [at, setAt] = useState(() => localInput(p.initialLog?.at ?? p.initialAt ?? Date.now()));
  const [passage, setPassage] = useState(String(p.lot?.passage ?? p.culture?.passage ?? 0));
  const [vials, setVials] = useState('1');
  const [vessel, setVessel] = useState('');
  const [use, setUse] = useState<CultureVesselUse | null>(null);
  const [profile, setProfile] = useState(executionProfile(p.profiles, p.culture).profile?.id ?? '');
  const [location, setLocation] = useState('');
  const [supplierLot, setSupplierLot] = useState('');
  const [cellsPerVial, setCellsPerVial] = useState('');
  const [status, setStatus] = useState('harvested');
  const [type, setType] = useState(p.initialLog?.type ?? 'note');
  const [note, setNote] = useState(p.initialLog?.note ?? '');
  const [mycoplasma, setMycoplasma] = useState(p.initialLog?.mycoplasma ?? 'pending');
  const [extra, setExtra] = useState<[string, string][]>(Object.entries(p.initialLog?.extra ?? {}));
  const [metrics, setMetrics] = useState({
    confluencyPct: String(p.initialLog?.confluencyPct ?? ''),
    cellsPerMl: String(p.initialLog?.cellsPerMl ?? ''),
    viabilityPct: String(p.initialLog?.viabilityPct ?? ''),
    totalCells: String(p.initialLog?.totalCells ?? ''),
  });
  const [records, setRecords] = useState<Record<string, string>>({});
  const stage = action === 'lot' || action === 'culture' ? 'stock' : action === 'thaw' ? 'thaw' : 'feed';
  const usedProfile =
    action === 'culture' || action === 'thaw'
      ? (p.profiles.find((v) => v.id === profile) ?? null)
      : executionProfile(p.profiles, p.culture).profile;
  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (p.culture && p.culture.status !== 'active' && !p.initialLog) throw new Error('종료된 배양에는 새 작업을 기록할 수 없습니다');
      const time = isoFromInput(at);
      const savedNote = p.initialLog ? note : composeOperationNote(note, usedProfile, stage, records);
      let path: string;
      let body: Record<string, unknown>;
      if (action === 'lot') {
        path = `/api/cell-lines/${p.line.id}/lots`;
        body = {
          label,
          passage: passage === '' ? null : Number(passage),
          vials: Number(vials),
          cellsPerVial: cellsPerVial === '' ? null : Number(cellsPerVial),
          location,
          supplierLot,
          receivedAt: time,
          notes: savedNote,
        };
      } else if (action === 'culture' || action === 'thaw') {
        path = action === 'culture' ? `/api/cell-lines/${p.line.id}/cultures` : `/api/lots/${p.lot!.id}/thaw`;
        body = {
          label,
          passage: Number(passage),
          vessel,
          vesselUse: use,
          profileId: profile || null,
          at: time,
          startedAt: time,
          vials: Number(vials),
          note: savedNote,
          notes: savedNote,
        };
      } else if (action === 'end') {
        path = `/api/cultures/${p.culture!.id}/end`;
        body = { status, at: time, note: savedNote };
      } else {
        path = p.initialLog ? `/api/logs/${p.initialLog.id}` : `/api/cultures/${p.culture!.id}/logs`;
        if (extra.some(([k]) => !k.trim()) || new Set(extra.map(([k]) => k.trim())).size !== extra.length)
          throw new Error('자유 항목 이름은 비어 있거나 중복될 수 없습니다');
        body = {
          at: time,
          type,
          ...Object.fromEntries(Object.entries(metrics).map(([k, v]) => [k, v === '' ? null : Number(v)])),
          note: savedNote,
          mycoplasma: type === 'mycoplasma' ? mycoplasma : null,
          extra: Object.fromEntries(extra.map(([k, v]) => [k.trim(), v])),
        };
      }
      const response = await api<{ warnings?: string[] }>(path, { method: p.initialLog ? 'PUT' : 'POST', json: body });
      for (const warning of response.warnings ?? []) toast(warning);
      p.onSaved();
      p.onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={p.initialLog ? '기록 수정' : titles[action]}
      onClose={p.onClose}
      width={680}
      footer={
        <button className={primaryBtnCls} disabled={busy} onClick={() => void save()}>
          {busy ? '저장 중…' : '저장'}
        </button>
      }
    >
      {error && (
        <p role="alert" className="mb-3 text-sm text-danger">
          {error}
        </p>
      )}
      {!p.initialLog && (
        <PlanRecordSection
          profiles={p.profiles}
          culture={p.culture}
          profile={usedProfile}
          stage={stage}
          lineId={p.line.id}
          records={records}
          onRecords={setRecords}
        />
      )}
      <Field label="일시">
        <input className={inputCls} type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
      </Field>
      {(action === 'lot' || action === 'culture') && (
        <Field label="라벨 (비우면 자동 생성)">
          <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
      )}
      {['lot', 'culture', 'thaw'].includes(action) && (
        <Field label="Passage (해동 시 기본 유지)">
          <input className={inputCls} type="number" min="0" value={passage} onChange={(e) => setPassage(e.target.value)} />
        </Field>
      )}
      {['lot', 'thaw'].includes(action) && (
        <Field label={`바이알 수${p.lot ? ` (남은 ${p.lot.vialsRemaining})` : ''}`}>
          <input
            type="number"
            min="1"
            max={p.lot?.vialsRemaining}
            className={inputCls}
            value={vials}
            onChange={(e) => setVials(e.target.value)}
          />
        </Field>
      )}
      {(action === 'culture' || action === 'thaw') && (
        <>
          <VesselUsePicker value={use} onChange={(v) => setUse(v)} />
          {!use && (
            <Field label="배양 용기 (직접 입력)">
              <OptionCombobox category="vessel" value={vessel} onChange={setVessel} />
            </Field>
          )}
          <Field label="배양 조건">
            <select className={inputCls} value={profile} onChange={(e) => setProfile(e.target.value)}>
              <option value="">연결하지 않음</option>
              {p.profiles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.isActive ? ' (활성)' : ''}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
      {action === 'lot' && (
        <>
          <Field label="바이알당 세포 수">
            <input type="number" min="0" className={inputCls} value={cellsPerVial} onChange={(e) => setCellsPerVial(e.target.value)} />
          </Field>
          <Field label="보관 위치">
            <input className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
          <Field label="공급자 로트">
            <input className={inputCls} value={supplierLot} onChange={(e) => setSupplierLot(e.target.value)} />
          </Field>
        </>
      )}
      {action === 'end' && (
        <Field label="종료 상태">
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="harvested">수확</option>
            <option value="discarded">폐기</option>
            <option value="contaminated">오염</option>
          </select>
        </Field>
      )}
      {action === 'log' && (
        <>
          <Field label="기록 종류">
            <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as LogDto['type'])}>
              {Object.entries(otherLogs).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries({
              confluencyPct: 'Confluency (%)',
              cellsPerMl: '세포 농도 (cells/mL)',
              viabilityPct: '생존율 (%)',
              totalCells: '총 세포 수',
            }).map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  type="number"
                  min="0"
                  className={inputCls}
                  value={metrics[key as keyof typeof metrics]}
                  onChange={(e) => setMetrics((v) => ({ ...v, [key]: e.target.value }))}
                />
              </Field>
            ))}
          </div>
          {type === 'mycoplasma' && (
            <Field label="검사 결과">
              <select className={inputCls} value={mycoplasma} onChange={(e) => setMycoplasma(e.target.value as typeof mycoplasma)}>
                <option value="negative">음성</option>
                <option value="positive">양성</option>
                <option value="pending">검사 중</option>
              </select>
            </Field>
          )}
          {extra.map(([k, v], i) => (
            <div key={i} className="mb-2 flex gap-2">
              <input
                aria-label="항목 이름"
                className={inputCls}
                value={k}
                onChange={(e) => setExtra((a) => a.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))}
              />
              <input
                aria-label="항목 값"
                className={inputCls}
                value={v}
                onChange={(e) => setExtra((a) => a.map((r, j) => (j === i ? [r[0], e.target.value] : r)))}
              />
              <button className={smallBtnCls} onClick={() => setExtra((a) => a.filter((_, j) => i !== j))}>
                삭제
              </button>
            </div>
          ))}
          <button className={smallBtnCls} onClick={() => setExtra((a) => [...a, ['', '']])}>
            자유 항목 추가
          </button>
        </>
      )}
      <Field label="메모">
        <textarea className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Dialog>
  );
}

export function ReceiveLotDialog(p: Props) {
  return <CultureDialog {...p} action="lot" />;
}
export function ReceiveCultureDialog(p: Props) {
  return <CultureDialog {...p} action="culture" />;
}
export function ThawDialog(p: Props) {
  return <CultureDialog {...p} action="thaw" />;
}
export function EndCultureDialog(p: Props) {
  return <CultureDialog {...p} action="end" />;
}
export function PassageDialog(p: Props) {
  return p.culture ? (
    <Dialog title="계대 · 새 용기에 접종" width={760} onClose={p.onClose}>
      <PassageForm
        {...p}
        culture={p.culture}
        onSaved={() => {
          p.onSaved();
          p.onClose();
        }}
      />
    </Dialog>
  ) : null;
}
export function FreezeDialog(p: Props) {
  return p.culture ? (
    <Dialog title="초기 스탁 · 동결 배분" width={760} onClose={p.onClose}>
      <FreezeForm
        {...p}
        culture={p.culture}
        onSaved={() => {
          p.onSaved();
          p.onClose();
        }}
      />
    </Dialog>
  ) : null;
}
export function LogDialog(p: Props) {
  const type = p.initialLog?.type ?? p.logType ?? 'observation';
  if (!p.culture) return null;
  if (type !== 'observation' && type !== 'medium_change') return <CultureDialog {...p} action="log" />;
  return (
    <Dialog title={type === 'observation' ? '관찰 · 형태·사진' : '배지 교체 · 추가'} width={680} onClose={p.onClose}>
      {type === 'observation' ? (
        <ObservationForm {...p} culture={p.culture} onComplete={p.onClose} />
      ) : (
        <FeedForm
          {...p}
          culture={p.culture}
          onSaved={() => {
            p.onSaved();
            p.onClose();
          }}
        />
      )}
    </Dialog>
  );
}
