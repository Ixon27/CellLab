import { useState } from 'react';
import type { CellLineDto, CultureDto, LogDto, LotDto, ProfileDto } from '../../../shared/cell-line';
import { api } from '../../api';
import { CellCountCalculator } from '../../components/CellCountCalculator';
import { Dialog, Field, inputCls, primaryBtnCls, smallBtnCls } from '../../components/Dialog';
import { OptionCombobox } from '../../components/OptionCombobox';
import { useToast } from '../../components/Toast';

type Action = 'lot' | 'culture' | 'thaw' | 'passage' | 'freeze' | 'end' | 'log';
interface Props { line: CellLineDto; culture?: CultureDto; lot?: LotDto; profiles: ProfileDto[]; initialLog?: LogDto; logType?: 'observation' | 'medium_change'; onClose(): void; onSaved(): void }
const titles: Record<Action, string> = { lot: 'stock 입고(바이알)', culture: '배양 상태로 입고', thaw: '해동', passage: '계대', freeze: '동결', end: '배양 종료', log: '관찰 기록' };
const logLabels: Record<string, string> = { observation: '관찰', medium_change: '배지 교체', harvest: '수확', treatment: '처리', mycoplasma: '마이코플라스마', note: '메모' };

function CultureDialog({ action, ...p }: Props & { action: Action }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [at, setAt] = useState(() => { const d = new Date(p.initialLog?.at ?? Date.now()); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); });
  const [passage, setPassage] = useState(String(p.lot?.passage ?? p.culture?.passage ?? 0));
  const [vials, setVials] = useState('1');
  const [vessel, setVessel] = useState(p.culture?.vessel ?? 'T75');
  const [profile, setProfile] = useState(p.profiles.find(v => v.isActive)?.id ?? '');
  const [location, setLocation] = useState('');
  const [supplierLot, setSupplierLot] = useState('');
  const [cellsPerVial, setCellsPerVial] = useState('');
  const [freezingMedium, setFreezingMedium] = useState('');
  const [end, setEnd] = useState(true);
  const [status, setStatus] = useState('harvested');
  const [splitRatio, setSplitRatio] = useState('');
  const [children, setChildren] = useState([{ vessel: 'T75', label: '' }, { vessel: 'T75', label: '' }]);
  const [logType, setLogType] = useState(p.initialLog?.type ?? p.logType ?? 'observation');
  const [note, setNote] = useState(p.initialLog?.note ?? '');
  const [confluency, setConfluency] = useState(String(p.initialLog?.confluencyPct ?? ''));
  const [cells, setCells] = useState(String(p.initialLog?.cellsPerMl ?? ''));
  const [viability, setViability] = useState(String(p.initialLog?.viabilityPct ?? ''));
  const [total, setTotal] = useState(String(p.initialLog?.totalCells ?? ''));
  const [mycoplasma, setMycoplasma] = useState(p.initialLog?.mycoplasma ?? 'pending');
  const [extra, setExtra] = useState<[string, string][]>(Object.entries(p.initialLog?.extra ?? {}));
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const metrics = { confluencyPct: confluency === '' ? null : Number(confluency), cellsPerMl: cells === '' ? null : Number(cells), viabilityPct: viability === '' ? null : Number(viability), totalCells: total === '' ? null : Number(total) };
      const time = new Date(at).toISOString();
      let path: string;
      let body: Record<string, unknown>;
      if (action === 'lot') { path = `/api/cell-lines/${p.line.id}/lots`; body = { label, passage: passage === '' ? null : Number(passage), vials: Number(vials), cellsPerVial: cellsPerVial === '' ? null : Number(cellsPerVial), location, supplierLot, receivedAt: time }; }
      else if (action === 'culture') { path = `/api/cell-lines/${p.line.id}/cultures`; body = { label, passage: Number(passage), vessel, profileId: profile || null, startedAt: time }; }
      else if (action === 'thaw') { path = `/api/lots/${p.lot!.id}/thaw`; body = { vials: Number(vials), passage: Number(passage), vessel, profileId: profile || null, at: time }; }
      else if (action === 'passage') { path = `/api/cultures/${p.culture!.id}/passage`; body = { at: time, splitRatio, ...metrics, children, keepParent: false }; }
      else if (action === 'freeze') { path = `/api/cultures/${p.culture!.id}/freeze`; body = { at: time, vials: Number(vials), cellsPerVial: cellsPerVial === '' ? null : Number(cellsPerVial), freezingMedium, location, endCulture: end }; }
      else if (action === 'end') { path = `/api/cultures/${p.culture!.id}/end`; body = { status, at: time, note }; }
      else {
        path = p.initialLog ? `/api/logs/${p.initialLog.id}` : `/api/cultures/${p.culture!.id}/logs`;
        if (extra.some(([k]) => !k.trim()) || new Set(extra.map(([k]) => k.trim())).size !== extra.length) throw new Error('자유 항목 이름은 비어 있거나 중복될 수 없습니다');
        body = { at: time, type: logType, ...metrics, note, mycoplasma: logType === 'mycoplasma' ? mycoplasma : null, extra: Object.fromEntries(extra.map(([k, v]) => [k.trim(), v])) };
      }
      const response = await api<{ warnings?: string[] }>(path, { method: p.initialLog ? 'PUT' : 'POST', json: body });
      for (const warning of response.warnings ?? []) toast(warning);
      p.onSaved(); p.onClose();
    } catch (e) { setError(e instanceof Error ? e.message : '저장하지 못했습니다'); }
    finally { setBusy(false); }
  };
  return <Dialog title={p.initialLog ? '기록 수정' : titles[action]} onClose={p.onClose} width={680} footer={<button className={primaryBtnCls} disabled={busy} onClick={() => void submit()}>{busy ? '저장 중…' : '저장'}</button>}>
    {error && <p role="alert" className="mb-3 text-sm text-danger">{error}</p>}
    <Field label="일시"><input className={inputCls} type="datetime-local" value={at} onChange={e => setAt(e.target.value)} /></Field>
    {(action === 'lot' || action === 'culture') && <Field label="라벨 (비우면 자동 생성)"><input className={inputCls} value={label} onChange={e => setLabel(e.target.value)} /></Field>}
    {['lot', 'culture', 'thaw'].includes(action) && <Field label="Passage (해동 시 기본 유지)"><input className={inputCls} type="number" min="0" value={passage} onChange={e => setPassage(e.target.value)} /></Field>}
    {['lot', 'thaw', 'freeze'].includes(action) && <Field label={`바이알 수${p.lot ? ` (남은 ${p.lot.vialsRemaining})` : ''}`}><input className={inputCls} type="number" min="1" value={vials} onChange={e => setVials(e.target.value)} /></Field>}
    {['culture', 'thaw'].includes(action) && <><Field label="배양 용기"><OptionCombobox category="vessel" value={vessel} onChange={setVessel} /></Field><Field label="배양 조건"><select className={inputCls} value={profile} onChange={e => setProfile(e.target.value)}><option value="">연결하지 않음</option>{p.profiles.map(v => <option key={v.id} value={v.id}>{v.name}{v.isActive ? ' (활성)' : ''}</option>)}</select></Field></>}
    {['lot', 'freeze'].includes(action) && <><Field label="바이알당 세포 수"><input type="number" min="0" className={inputCls} value={cellsPerVial} onChange={e => setCellsPerVial(e.target.value)} /></Field><Field label="보관 위치"><input className={inputCls} value={location} onChange={e => setLocation(e.target.value)} /></Field></>}
    {action === 'lot' && <Field label="공급자 로트"><input className={inputCls} value={supplierLot} onChange={e => setSupplierLot(e.target.value)} /></Field>}
    {action === 'freeze' && <><Field label="동결 배지"><OptionCombobox category="freezing_medium" value={freezingMedium} onChange={setFreezingMedium} /></Field><label className="flex gap-2"><input type="checkbox" checked={end} onChange={e => setEnd(e.target.checked)} />동결 후 배양 종료</label></>}
    {action === 'end' && <Field label="종료 상태"><select className={inputCls} value={status} onChange={e => setStatus(e.target.value)}><option value="harvested">수확</option><option value="discarded">폐기</option><option value="contaminated">오염</option></select></Field>}
    {action === 'passage' && <><Field label="분주 비율"><input className={inputCls} value={splitRatio} onChange={e => setSplitRatio(e.target.value)} /></Field><Field label="자식 배양 수 (1–24)"><input className={inputCls} type="number" min="1" max="24" value={children.length} onChange={e => { const n = Math.max(1, Math.min(24, Number(e.target.value) || 1)); setChildren(a => Array.from({ length: n }, (_, i) => a[i] ?? { vessel: 'T75', label: '' })); }} /></Field>{children.map((child, i) => <div key={i} className="mb-3 grid grid-cols-2 gap-3"><Field label={`자식 ${String.fromCharCode(65 + i)} 용기`}><OptionCombobox category="vessel" value={child.vessel} onChange={v => setChildren(a => a.map((c, j) => i === j ? { ...c, vessel: v } : c))} /></Field><Field label="라벨 (자동 생성)"><input className={inputCls} value={child.label} onChange={e => setChildren(a => a.map((c, j) => i === j ? { ...c, label: e.target.value } : c))} /></Field></div>)}<CellCountCalculator vessel={children[0].vessel} onApply={v => { setCells(String(v.cellsPerMl)); setViability(String(v.viabilityPct ?? '')); setTotal(String(v.totalCells)); }} /></>}
    {action === 'log' && <Field label="기록 종류"><select className={inputCls} value={logType} onChange={e => setLogType(e.target.value as LogDto['type'])}>{Object.entries(logLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>}
    {(action === 'log' || action === 'passage') && <div className="mt-3 grid grid-cols-2 gap-3">{[{ label: 'Confluency (%)', value: confluency, set: setConfluency }, { label: '세포 농도 (cells/mL)', value: cells, set: setCells }, { label: '생존율 (%)', value: viability, set: setViability }, { label: '총 세포 수', value: total, set: setTotal }].map(f => <Field key={f.label} label={f.label}><input className={inputCls} type="number" min="0" value={f.value} onChange={e => f.set(e.target.value)} /></Field>)}</div>}
    {action === 'log' && <>{logType === 'mycoplasma' && <Field label="검사 결과"><select className={inputCls} value={mycoplasma} onChange={e => setMycoplasma(e.target.value as NonNullable<LogDto['mycoplasma']>)}><option value="negative">음성</option><option value="positive">양성</option><option value="pending">검사 중</option></select></Field>}<h3 className="mb-2 text-sm font-medium">자유 항목</h3>{extra.map(([k, v], i) => <div key={i} className="mb-2 flex gap-2"><input aria-label="항목 이름" className={inputCls} value={k} onChange={e => setExtra(a => a.map((r, j) => i === j ? [e.target.value, r[1]] : r))} /><input aria-label="항목 값" className={inputCls} value={v} onChange={e => setExtra(a => a.map((r, j) => i === j ? [r[0], e.target.value] : r))} /><button className={smallBtnCls} onClick={() => setExtra(a => a.filter((_, j) => j !== i))}>삭제</button></div>)}<button className={smallBtnCls} onClick={() => setExtra(a => [...a, ['', '']])}>항목 추가</button></>}
    {(action === 'log' || action === 'end') && <Field label="메모"><textarea className={inputCls} value={note} onChange={e => setNote(e.target.value)} /></Field>}
  </Dialog>;
}

export function ReceiveLotDialog(props: Props) { return <CultureDialog {...props} action="lot" />; }
export function ReceiveCultureDialog(props: Props) { return <CultureDialog {...props} action="culture" />; }
export function ThawDialog(props: Props) { return <CultureDialog {...props} action="thaw" />; }
export function PassageDialog(props: Props) { return <CultureDialog {...props} action="passage" />; }
export function FreezeDialog(props: Props) { return <CultureDialog {...props} action="freeze" />; }
export function EndCultureDialog(props: Props) { return <CultureDialog {...props} action="end" />; }
export function LogDialog(props: Props) { return <CultureDialog {...props} action="log" />; }
