import { useState } from 'react';
import type { CultureDto, LotDto, CellLineDto, ProfileDto } from '../../shared/cell-line';
import { api } from '../api';
import { Field, inputCls, primaryBtnCls, smallBtnCls } from '../components/Dialog';
import { FreezeDialog, PassageDialog, ThawDialog } from './dialogs/CultureDialogs';
import { ObservationForm } from './operations/ObservationForm';
import { FeedForm } from './operations/OperationForms';
import { composeOperationNote, isoFromInput, localInput, PlanRecordSection } from './operations/common';
import { executionProfile } from './culture-plan-state';
import { sourceCellsPerVial } from './lineage-source';

export function QuickRecord({
  line,
  cultures,
  lots,
  profiles,
  selected,
  selectedPlate,
  onSelect,
  onSaved,
  onReceive,
}: {
  line: CellLineDto;
  cultures: CultureDto[];
  lots: LotDto[];
  profiles: ProfileDto[];
  selected: string | null;
  selectedPlate?: number;
  onSelect(id: string): void;
  onSaved(): void;
  onReceive(): void;
}) {
  const [type, setType] = useState('observation');
  const [at, setAt] = useState(localInput);
  const [note, setNote] = useState('');
  const [performer, setPerformer] = useState('');
  const [mycoplasma, setMycoplasma] = useState('pending');
  const [records, setRecords] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const culture = cultures.find((c) => c.id === selected);
  const lot = lots.find((l) => l.id === selected);
  const compatible = type === 'thaw' ? !!lot && lot.vialsRemaining > 0 : !!culture && culture.status === 'active';
  const isAction = ['passage', 'freeze', 'thaw'].includes(type);
  const context = executionProfile(profiles, culture);
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
          at: isoFromInput(at),
          note: composeOperationNote(note, context.profile, 'feed', records),
          extra: performer.trim() ? { 수행자: performer.trim() } : {},
          mycoplasma: type === 'mycoplasma' ? mycoplasma : null,
        },
      });
      setNote('');
      setPerformer('');
      setRecords({});
      setAt(localInput());
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const props = {
    line,
    culture,
    lot,
    profiles,
    initialAt: at,
    initialPlate: selectedPlate,
    defaultCellsPerVial: culture ? sourceCellsPerVial(culture.id, cultures, lots) : null,
    onSaved,
    onClose: () => setAction(null),
  };
  return (
    <section className="workbench-panel cell-quick">
      <h3>오늘의 기록</h3>
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
      {selectedPlate !== undefined && <p className="cell-help">plate {selectedPlate} 선택 · 계대·동결 창에 적용</p>}
      <Field label="기록 / 작업">
        <select
          className={inputCls}
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setError(null);
            setRecords({});
          }}
        >
          {Object.entries({
            observation: '관찰 · 형태·사진',
            medium_change: '배지 교체 · 추가',
            passage: '계대',
            freeze: '동결 · 스탁 배분',
            thaw: '해동',
            treatment: '처리',
            mycoplasma: '마이코플라스마',
            note: '메모',
          }).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      {compatible && culture && type === 'observation' && (
        <ObservationForm key={`${culture.id}-observation`} line={line} culture={culture} profiles={profiles} onSaved={onSaved} />
      )}
      {compatible && culture && type === 'medium_change' && (
        <FeedForm
          key={`${culture.id}-feed`}
          line={line}
          culture={culture}
          profiles={profiles}
          onSaved={() => {
            onSaved();
            setType('observation');
          }}
        />
      )}
      {type !== 'observation' && type !== 'medium_change' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label="수행 일시">
            <input required type="datetime-local" className={inputCls} value={at} onChange={(e) => setAt(e.target.value)} />
          </Field>
          {!isAction && (
            <>
              <PlanRecordSection
                profiles={profiles}
                culture={culture}
                stage="feed"
                lineId={line.id}
                records={records}
                onRecords={setRecords}
              />
              <Field label="수행자 (선택)">
                <input className={inputCls} value={performer} onChange={(e) => setPerformer(e.target.value)} />
              </Field>
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
                <textarea className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
            </>
          )}
          {isAction && <p className="cell-help">실제 계보·재고를 변경하는 작업 창에서 세부 정보를 확인합니다.</p>}
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
          <button className={`${primaryBtnCls} cell-save`} disabled={busy || !compatible}>
            {busy ? '저장 중…' : isAction ? '작업 창 열기' : '기록 저장'}
          </button>
        </form>
      )}
      {!compatible && type !== 'thaw' && culture && cultures.some((c) => c.status === 'active') ? (
        <div className="cell-quick-picks">
          <span>기록할 활성 배양</span>
          {cultures
            .filter((c) => c.status === 'active')
            .map((c) => (
              <button key={c.id} type="button" className={smallBtnCls} onClick={() => onSelect(c.id)}>
                {c.label}
              </button>
            ))}
        </div>
      ) : (
        !compatible && (
          <p className="cell-help">
            {type === 'thaw'
              ? lot && lot.vialsRemaining === 0
                ? '남은 바이알이 없습니다. 이 stock에서 해동한 배양과 해동 기록은 오른쪽 선택 패널에서 언제든 수정·취소할 수 있습니다.'
                : '남은 바이알이 있는 stock을 선택하세요.'
              : culture
                ? '종료된 배양입니다. 활성 배양이 없어 새 작업을 기록할 수 없습니다.'
                : '활성 배양을 선택하거나 배양을 입고하세요.'}
          </p>
        )
      )}
      {!cultures.length && (
        <button type="button" className={primaryBtnCls} onClick={onReceive}>
          배양 상태로 입고
        </button>
      )}
      {action === 'passage' && <PassageDialog {...props} />}
      {action === 'freeze' && <FreezeDialog {...props} />}
      {action === 'thaw' && <ThawDialog {...props} />}
    </section>
  );
}
