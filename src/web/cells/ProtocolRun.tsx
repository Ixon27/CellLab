import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { CellLineDto, ProfileDto } from '../../shared/cell-line';
import {
  PROTOCOL_FOLDERS,
  PROTOCOL_FOLDER_LABELS,
  changedSteps,
  protocolSteps,
  type ProtocolFolder,
  type ProtocolRun,
  type ProtocolRunInput,
} from '../../shared/protocol-run';
import { inputCls, smallBtnCls, smallGhostBtnCls, smallPrimaryBtnCls } from '../components/Dialog';
import { Markdown } from '../components/Markdown';
import { fillProtocol, useCellProtocols } from './cell-protocols';
import './cell-protocols.css';

interface StepRow {
  index: number;
  section: string | null;
  original: string;
  modified: string | null;
}

/** Steps grouped under their section headings, numbered within each section. Actions sit at the row's right; the editor below the text. */
function StepList({
  steps,
  renderActions,
  renderEditor,
}: {
  steps: StepRow[];
  renderActions?(step: StepRow): ReactNode;
  renderEditor?(step: StepRow): ReactNode;
}) {
  const groups: { section: string | null; steps: StepRow[] }[] = [];
  for (const step of steps) {
    const last = groups.at(-1);
    if (last && last.section === step.section) last.steps.push(step);
    else groups.push({ section: step.section, steps: [step] });
  }
  return (
    <div className="space-y-3">
      {groups.map((group, g) => (
        <section key={g}>
          {group.section && <h5 className="mb-1 text-[11.5px] font-semibold text-fg-muted">{group.section}</h5>}
          <ol className="space-y-1">
            {group.steps.map((step, n) => (
              <li key={step.index} className="protocol-run-step" data-changed={step.modified !== null || undefined}>
                <span className="protocol-run-number">{n + 1}</span>
                <div className="min-w-0 flex-1">
                  {step.modified === null ? (
                    <Markdown text={step.original} className="protocol-run-text" />
                  ) : (
                    <>
                      <Markdown text={step.original} className="protocol-run-text protocol-run-struck" />
                      <p className="protocol-run-change">
                        {step.modified === '' ? '이번에는 생략' : step.modified}
                      </p>
                    </>
                  )}
                  {renderEditor?.(step)}
                </div>
                {renderActions?.(step)}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

/**
 * Pick the protocol an operation follows and change single steps for this run only.
 * Changes are sent with the record; the protocol document is never modified here.
 */
export function ProtocolRunSection({
  line,
  profile,
  folder,
  value,
  onChange,
}: {
  line: CellLineDto;
  /** Condition set whose values fill the protocol variables (the culture's linked set, else the active one). */
  profile: ProfileDto | null;
  folder: ProtocolFolder;
  value: ProtocolRunInput | null;
  onChange(next: ProtocolRunInput | null): void;
}) {
  const { items, error } = useCellProtocols(line.id);
  const [chosen, setChosen] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  // Default to the first protocol of the operation's folder once the list arrives, unless the user already chose.
  useEffect(() => {
    if (chosen || value || !items) return;
    const first = items.find((p) => p.folder === folder);
    if (first) onChange({ protocolId: first.id, protocolUpdatedAt: first.updatedAt, deviations: [] });
  }, [items, folder, chosen, value, onChange]);
  const protocol = items?.find((p) => p.id === value?.protocolId) ?? null;
  const steps = useMemo(() => (protocol ? protocolSteps(fillProtocol(protocol.bodyMd, line, profile).markdown) : []), [protocol, line, profile]);
  const changes = new Map((value?.deviations ?? []).map((d) => [d.index, d.text]));
  const rows: StepRow[] = steps.map((s) => ({ index: s.index, section: s.section, original: s.text, modified: changes.get(s.index) ?? null }));
  function setChange(index: number, text: string | null) {
    if (!value) return;
    const rest = value.deviations.filter((d) => d.index !== index);
    onChange({ ...value, deviations: text === null ? rest : [...rest, { index, text }].sort((a, b) => a.index - b.index) });
  }
  if (error) return <p className="mb-3 text-sm text-danger">{error}</p>;
  if (!items) return <p className="mb-3 text-sm text-fg-muted">프로토콜을 불러오는 중…</p>;
  return (
    <section className="protocol-run mb-4" aria-label="이번 작업의 프로토콜">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-[13px] font-semibold">프로토콜</h4>
        <select
          aria-label="따를 프로토콜"
          className={`${inputCls} w-auto min-w-56 flex-1`}
          value={value?.protocolId ?? ''}
          onChange={(e) => {
            setChosen(true);
            setEditing(null);
            const next = items.find((p) => p.id === e.target.value);
            onChange(next ? { protocolId: next.id, protocolUpdatedAt: next.updatedAt, deviations: [] } : null);
          }}
        >
          <option value="">프로토콜 없이 기록</option>
          {PROTOCOL_FOLDERS.map((f) => {
            const inFolder = items.filter((p) => p.folder === f);
            return inFolder.length ? (
              <optgroup key={f} label={PROTOCOL_FOLDER_LABELS[f]}>
                {inFolder.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                    {p.version ? ` · ${p.version}` : ''}
                  </option>
                ))}
              </optgroup>
            ) : null;
          })}
        </select>
        {changes.size > 0 && <span className="protocol-run-badge">이번만 변경 {changes.size}단계</span>}
      </div>
      {!items.length && (
        <p className="mt-2 text-xs text-fg-muted">이 세포주에 저장된 프로토콜이 없습니다. 세포주의 프로토콜 탭에서 폴더별로 추가하세요.</p>
      )}
      {protocol && (
        <>
          <p className="mt-1.5 text-xs text-fg-muted">
            단계의 <strong>이번만 수정</strong>은 이 기록에만 남습니다. 원본 프로토콜은 바뀌지 않으며 기록에는 원래 단계가 취소선으로 함께 남습니다.
          </p>
          <div className="mt-3 max-h-[420px] overflow-y-auto pr-1">
            {rows.length === 0 && <p className="text-sm text-fg-muted">본문에 단계가 없습니다.</p>}
            <StepList
              steps={rows}
              renderEditor={(step) =>
                editing === step.index && (
                  <div className="mt-1.5 space-y-1.5">
                    <textarea
                      aria-label="이번에 실제로 한 방법"
                      className={inputCls}
                      rows={3}
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        className={smallPrimaryBtnCls}
                        disabled={!draft.trim() || draft.trim() === step.original}
                        onClick={() => {
                          setChange(step.index, draft.trim());
                          setEditing(null);
                        }}
                      >
                        적용
                      </button>
                      <button type="button" className={smallGhostBtnCls} onClick={() => setEditing(null)}>
                        취소
                      </button>
                    </div>
                  </div>
                )
              }
              renderActions={(step) =>
                editing !== step.index && (
                  <div className="protocol-run-actions">
                    <button
                      type="button"
                      className={smallBtnCls}
                      onClick={() => {
                        setDraft(step.modified || step.original);
                        setEditing(step.index);
                      }}
                    >
                      {step.modified === null ? '이번만 수정' : '다시 수정'}
                    </button>
                    {step.modified === null ? (
                      <button type="button" className={smallGhostBtnCls} onClick={() => setChange(step.index, '')}>
                        생략
                      </button>
                    ) : (
                      <button type="button" className={smallGhostBtnCls} onClick={() => setChange(step.index, null)}>
                        원래대로
                      </button>
                    )}
                  </div>
                )
              }
            />
          </div>
        </>
      )}
    </section>
  );
}

/** A saved record's protocol: every step as written, with this run's changes over struck-through originals. */
export function ProtocolRunView({ run }: { run: ProtocolRun }) {
  const changed = changedSteps(run).length;
  return (
    <details className="protocol-run protocol-run-saved">
      <summary>
        프로토콜 · {run.title}
        {run.version ? ` (${run.version})` : ''}
        <span className={changed ? 'protocol-run-badge' : 'text-fg-muted'}>{changed ? `변경 ${changed}단계` : '그대로 수행'}</span>
      </summary>
      <div className="mt-2">
        <StepList steps={run.steps} />
      </div>
    </details>
  );
}
