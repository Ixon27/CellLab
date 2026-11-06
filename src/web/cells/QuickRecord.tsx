import { useState } from 'react';
import type { CultureDto, LotDto, CellLineDto, ProfileDto } from '../../shared/cell-line';
import { api } from '../api';
import { Field, inputCls, primaryBtnCls } from '../components/Dialog';
import { FreezeDialog, PassageDialog, ThawDialog } from './dialogs/CultureDialogs';

function localNow() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function QuickRecord({
  line,
  cultures,
  lots,
  profiles,
  selected,
  onSelect,
  onSaved,
  onReceive,
}: {
  line: CellLineDto;
  cultures: CultureDto[];
  lots: LotDto[];
  profiles: ProfileDto[];
  selected: string | null;
  onSelect(id: string): void;
  onSaved(): void;
  onReceive(): void;
}) {
  const [type, setType] = useState('observation');
  const [at, setAt] = useState(localNow);
  const [confluency, setConfluency] = useState('');
  const [performer, setPerformer] = useState('');
  const [note, setNote] = useState('');
  const [mycoplasma, setMycoplasma] = useState('pending');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const culture = cultures.find((c) => c.id === selected);
  const lot = lots.find((l) => l.id === selected);
  const isAction = ['passage', 'freeze', 'thaw'].includes(type);
  const compatible = type === 'thaw' ? !!lot && lot.vialsRemaining > 0 : !!culture && culture.status === 'active';
  async function save() {
    if (!compatible || busy) return;
    if (isAction) {
      setAction(type);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/api/cultures/${culture!.id}/logs`, {
        method: 'POST',
        json: {
          type,
          at: new Date(at).toISOString(),
          confluencyPct: confluency === '' ? null : Number(confluency),
          extra: performer.trim() ? { 수행자: performer.trim() } : {},
          note,
          mycoplasma: type === 'mycoplasma' ? mycoplasma : null,
        },
      });
      setConfluency('');
      setPerformer('');
      setNote('');
      setAt(localNow());
      setMycoplasma('pending');
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const props = { line, culture, lot, profiles, initialAt: at, onSaved, onClose: () => setAction(null) };
  return (
    <section className="workbench-panel cell-quick">
      <h3>오늘의 기록</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="배양 / 바이알">
          <select className={inputCls} value={selected ?? ''} onChange={(e) => onSelect(e.target.value)}>
            <option value="">대상을 선택하세요</option>
            <optgroup label="배양">
              {cultures.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} · P{c.passage}
                  {c.status !== 'active' ? ' (종료)' : ''}
                </option>
              ))}
            </optgroup>
            <optgroup label="바이알 (해동)">
              {lots.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label} · {l.vialsRemaining} vial
                </option>
              ))}
            </optgroup>
          </select>
        </Field>
        <Field label="수행 일시">
          <input required type="datetime-local" className={inputCls} value={at} onChange={(e) => setAt(e.target.value)} />
        </Field>
        <Field label="기록 / 작업">
          <select
            className={inputCls}
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setError(null);
            }}
          >
            {Object.entries({
              observation: '관찰',
              medium_change: '배지 교체',
              treatment: '처리',
              mycoplasma: '마이코플라스마',
              note: '메모',
              passage: '계대',
              freeze: '동결',
              thaw: '해동',
            }).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {!isAction && (
          <>
            <div className="cell-form-pair">
              <Field label="Confluency (%)">
                <input
                  className={inputCls}
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  value={confluency}
                  onChange={(e) => setConfluency(e.target.value)}
                />
              </Field>
              <Field label="수행자 (선택)">
                <input className={inputCls} value={performer} onChange={(e) => setPerformer(e.target.value)} />
              </Field>
            </div>
            {type === 'mycoplasma' && (
              <Field label="검사 결과">
                <select className={inputCls} value={mycoplasma} onChange={(e) => setMycoplasma(e.target.value)}>
                  <option value="pending">검사 중</option>
                  <option value="negative">음성</option>
                  <option value="positive">양성</option>
                </select>
              </Field>
            )}
            <Field label="메모">
              <textarea className={inputCls} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </>
        )}
        {isAction && <p className="cell-help">실제 계보·재고를 변경하는 작업 창에서 세부 정보를 확인합니다.</p>}
        {!compatible && (
          <p className="cell-help">
            {type === 'thaw'
              ? '남은 바이알이 있는 stock을 선택하세요.'
              : culture
                ? '종료된 배양에는 새 작업을 기록할 수 없습니다. 기록표에서 기존 기록을 수정하세요.'
                : '활성 배양을 선택하거나 배양을 입고하세요.'}
          </p>
        )}
        {!cultures.length && (
          <button type="button" className={primaryBtnCls} onClick={onReceive}>
            배양 상태로 입고
          </button>
        )}
        {error && (
          <p role="alert" className="text-danger text-xs">
            {error}
          </p>
        )}
        <button className={`${primaryBtnCls} cell-save`} disabled={busy || !compatible}>
          {busy ? '저장 중…' : isAction ? '작업 창 열기' : '기록 저장'}
        </button>
      </form>
      {action === 'passage' && <PassageDialog {...props} />}
      {action === 'freeze' && <FreezeDialog {...props} />}
      {action === 'thaw' && <ThawDialog {...props} />}
    </section>
  );
}
