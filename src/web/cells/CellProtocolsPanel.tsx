import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { FileText, Folder, ListChecks, Plus } from 'lucide-react';
import type { CellLineDto, ProfileDto } from '../../shared/cell-line';
import { CULTURE_FIELDS } from '../../shared/culture';
import { PLAN_STAGE_LABELS, type PlanStage } from '../../shared/culture-plan';
import { PROTOCOL_FOLDERS, PROTOCOL_FOLDER_LABELS, type CellProtocolDto, type ProtocolFolder } from '../../shared/protocol-run';
import type { FilledSop } from '../../shared/sop';
import { api } from '../api';
import { btnCls, Dialog, Field, inputCls, primaryBtnCls, smallIconBtnCls, solidDangerBtnCls } from '../components/Dialog';
import { Markdown } from '../components/Markdown';
import { ProtocolDocumentEditor } from '../components/ProtocolDocumentEditor';
import { ProtocolOrigin } from '../components/ProtocolPreview';
import { useCopy, useToast } from '../components/Toast';
import type { ProtocolDocument, ProtocolSummary } from '../pages/Protocols';
import { fillProtocol, useCellProtocols } from './cell-protocols';
import { CulturePlanGuide, MediumCalculator } from './CulturePlanGuide';
import { SourceRefDetails } from './SourceRefDetails';
import './cell-protocols.css';

const PLAN = 'plan';
const NEW_PREFIX = 'new:';

/**
 * A cell line's protocols in folders (해동, 배지 교체, 계대 …), viewed and edited in place.
 * `selected` is a protocol id, `plan`, or `new:<folder>`; it lives in the URL so reloads keep it.
 */
export function CellProtocolsPanel({
  line,
  profiles,
  selected,
  onSelect,
  onChanged,
}: {
  line: CellLineDto;
  profiles: ProfileDto[];
  selected: string | null;
  onSelect(next: string): void;
  onChanged(): void;
}) {
  const { items, error, reload } = useCellProtocols(line.id);
  const [editingId, setEditingId] = useState<string | null>(null);
  const dirty = useRef(false);
  const active = profiles.find((p) => p.isActive) ?? null;
  const current = selected ?? (items?.[0]?.id ?? PLAN);
  const protocol = items?.find((p) => p.id === current) ?? null;
  const select = useCallback(
    (next: string, edit = false) => {
      if (dirty.current && !window.confirm('저장하지 않은 편집 내용이 있습니다. 버리고 이동할까요?')) return;
      dirty.current = false;
      setEditingId(edit ? next : null);
      onSelect(next);
    },
    [onSelect],
  );
  async function created(doc: ProtocolDocument) {
    await reload();
    onChanged();
    select(doc.id, true);
  }
  return (
    <div className="cell-protocols">
      <nav className="cell-protocols-nav" aria-label="프로토콜 폴더">
        <button className="cell-protocols-item is-plan" aria-current={current === PLAN} onClick={() => select(PLAN)}>
          <ListChecks size={14} aria-hidden /> 실행 계획 · 조건
        </button>
        {PROTOCOL_FOLDERS.map((folder) => {
          const inFolder = items?.filter((p) => p.folder === folder) ?? [];
          return (
            <div key={folder} className="cell-protocols-folder">
              <div className="cell-protocols-folder-head">
                <Folder size={13} aria-hidden />
                <span>{PROTOCOL_FOLDER_LABELS[folder]}</span>
                <button
                  className={smallIconBtnCls}
                  title={`${PROTOCOL_FOLDER_LABELS[folder]}에 새 프로토콜`}
                  aria-label={`${PROTOCOL_FOLDER_LABELS[folder]}에 새 프로토콜`}
                  onClick={() => select(`${NEW_PREFIX}${folder}`)}
                >
                  <Plus size={13} />
                </button>
              </div>
              {inFolder.map((p) => (
                <button key={p.id} className="cell-protocols-item" aria-current={current === p.id} onClick={() => select(p.id)}>
                  <FileText size={13} aria-hidden className="shrink-0 opacity-60" />
                  <span className="min-w-0 truncate">{p.title}</span>
                  <small>{p.status === 'confirmed' ? '확정' : '초안'}</small>
                </button>
              ))}
              {items && !inFolder.length && <p className="cell-protocols-empty">비어 있음</p>}
            </div>
          );
        })}
      </nav>
      <div className="cell-protocols-main">
        {error && (
          <p role="alert" className="mb-3 text-sm text-danger">
            {error}{' '}
            <button className={btnCls} onClick={() => void reload()}>
              다시 불러오기
            </button>
          </p>
        )}
        {current === PLAN && <PlanOverview line={line} profiles={profiles} onOpenProtocol={(id, edit) => void reload().then(() => select(id, edit))} onChanged={onChanged} />}
        {current.startsWith(NEW_PREFIX) && (
          <NewProtocolForm
            line={line}
            folder={current.slice(NEW_PREFIX.length) as ProtocolFolder}
            onCreated={(doc) => void created(doc)}
            onCancel={() => select(items?.[0]?.id ?? PLAN)}
          />
        )}
        {protocol && (
          <ProtocolPane
            key={protocol.id}
            line={line}
            profile={active}
            protocol={protocol}
            startEditing={editingId === protocol.id}
            onDirty={(value) => {
              dirty.current = value;
            }}
            onSaved={async () => {
              dirty.current = false;
              setEditingId(null);
              await reload();
              onChanged();
            }}
            onDeleted={async () => {
              dirty.current = false;
              await reload();
              onChanged();
              onSelect(PLAN);
            }}
          />
        )}
        {items && current !== PLAN && !current.startsWith(NEW_PREFIX) && !protocol && (
          <p className="text-sm text-fg-muted">선택한 프로토콜이 이 세포주에 없습니다. 왼쪽 폴더에서 다시 고르세요.</p>
        )}
      </div>
    </div>
  );
}

function ProtocolPane({
  line,
  profile,
  protocol,
  startEditing,
  onDirty,
  onSaved,
  onDeleted,
}: {
  line: CellLineDto;
  profile: ProfileDto | null;
  protocol: CellProtocolDto;
  startEditing: boolean;
  onDirty(dirty: boolean): void;
  onSaved(): Promise<void>;
  onDeleted(): Promise<void>;
}) {
  const [editing, setEditing] = useState(startEditing);
  const [draft, setDraft] = useState({ title: protocol.title, version: protocol.version, status: protocol.status, body: protocol.bodyMd });
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const toast = useToast();
  const filled = fillProtocol(protocol.bodyMd, line, profile);
  const changed =
    draft.title !== protocol.title || draft.version !== protocol.version || draft.status !== protocol.status || draft.body !== protocol.bodyMd;
  useEffect(() => onDirty(editing && changed), [editing, changed, onDirty]);
  function edit() {
    setDraft({ title: protocol.title, version: protocol.version, status: protocol.status, body: protocol.bodyMd });
    setEditing(true);
  }
  async function save() {
    setBusy(true);
    try {
      await api(`/api/protocols/${protocol.id}`, {
        method: 'PUT',
        json: { title: draft.title, version: draft.version, status: draft.status, bodyMd: draft.body },
      });
      setEditing(false);
      await onSaved();
      toast('프로토콜을 저장했습니다');
    } catch (e) {
      toast(e instanceof Error ? e.message : '저장하지 못했습니다', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }
  async function move(folder: ProtocolFolder) {
    setBusy(true);
    try {
      await api(`/api/cell-lines/${line.id}/protocols/${protocol.id}`, { method: 'PATCH', json: { folder } });
      await onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : '폴더를 옮기지 못했습니다', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await api(`/api/protocols/${protocol.id}`, { method: 'DELETE' });
      await onDeleted();
      toast('프로토콜을 삭제했습니다');
    } catch (e) {
      toast(e instanceof Error ? e.message : '삭제하지 못했습니다', { tone: 'error' });
      setBusy(false);
    }
  }
  return (
    <article className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        {editing ? (
          <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[1fr_140px_110px]">
            <input
              aria-label="제목"
              className={inputCls}
              value={draft.title}
              maxLength={200}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
            <input
              aria-label="버전"
              placeholder="버전"
              className={inputCls}
              value={draft.version}
              maxLength={120}
              onChange={(e) => setDraft({ ...draft, version: e.target.value })}
            />
            <select
              aria-label="상태"
              className={inputCls}
              value={draft.status}
              onChange={(e) => setDraft({ ...draft, status: e.target.value as CellProtocolDto['status'] })}
            >
              <option value="draft">초안</option>
              <option value="confirmed">확정</option>
            </select>
          </div>
        ) : (
          <div className="min-w-0">
            <h2 className="cell-protocols-title">{protocol.title}</h2>
            <p className="cell-protocols-meta">
              {[
                PROTOCOL_FOLDER_LABELS[protocol.folder],
                protocol.version || '버전 없음',
                protocol.status === 'confirmed' ? '확정' : '초안',
                `수정 ${new Date(protocol.updatedAt).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}`,
                protocol.copiedFrom && `복사 원본: ${protocol.copiedFrom.title}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <button
                className={btnCls}
                disabled={busy}
                onClick={() => {
                  if (changed && !window.confirm('편집한 내용을 버릴까요?')) return;
                  setEditing(false);
                }}
              >
                취소
              </button>
              <button className={primaryBtnCls} disabled={busy || !draft.title.trim() || !changed} onClick={() => void save()}>
                저장
              </button>
            </>
          ) : (
            <>
              <select
                aria-label="폴더 이동"
                className={`${inputCls} w-auto`}
                value={protocol.folder}
                disabled={busy}
                onChange={(e) => void move(e.target.value as ProtocolFolder)}
              >
                {PROTOCOL_FOLDERS.map((f) => (
                  <option key={f} value={f}>
                    {PROTOCOL_FOLDER_LABELS[f]} 폴더
                  </option>
                ))}
              </select>
              <Link className={btnCls} href={`/protocols/${protocol.id}`}>
                이전 버전
              </Link>
              <button className={btnCls} disabled={busy} onClick={() => setDeleting(true)}>
                삭제
              </button>
              <button className={primaryBtnCls} disabled={busy} onClick={edit}>
                편집
              </button>
            </>
          )}
        </div>
      </header>
      {editing ? (
        <ProtocolDocumentEditor value={draft.body} onChange={(body) => setDraft((d) => ({ ...d, body }))} cellLineId={line.id} />
      ) : (
        <>
          {filled.missingFields.length > 0 && (
            <p className="text-xs text-warning">
              조건 미설정: {filled.missingFields.map((f) => f.label).join(', ')} · 배양 조건에서 값을 넣으면 여기와 작업 기록에 채워집니다.
            </p>
          )}
          <div
            className="min-w-0 rounded-xl border border-line bg-raised p-5"
            title="더블클릭하면 편집합니다"
            onDoubleClick={edit}
          >
            {protocol.bodyMd.trim() ? (
              <Markdown text={filled.markdown} />
            ) : (
              <p className="text-sm text-fg-muted">본문이 비어 있습니다. 편집을 눌러 단계를 적으세요.</p>
            )}
          </div>
          <p className="text-xs text-fg-muted">
            해동·배지 교체·계대 등 작업을 기록할 때 이 프로토콜을 불러오고, 그날만 다르게 한 단계는 기록 창에서 따로 수정합니다. 그 수정은 원본을 바꾸지 않습니다.
          </p>
        </>
      )}
      {deleting && (
        <Dialog
          title="프로토콜 삭제"
          onClose={() => setDeleting(false)}
          dismissible={!busy}
          footer={
            <button className={solidDangerBtnCls} disabled={busy} onClick={() => void remove()}>
              삭제
            </button>
          }
        >
          <p className="text-sm text-fg-muted">
            ‘{protocol.title}’과 수정 이력을 삭제합니다. 이미 저장한 작업 기록에는 당시 단계가 그대로 남습니다.
          </p>
        </Dialog>
      )}
    </article>
  );
}

function NewProtocolForm({
  line,
  folder: initialFolder,
  onCreated,
  onCancel,
}: {
  line: CellLineDto;
  folder: ProtocolFolder;
  onCreated(doc: ProtocolDocument): void;
  onCancel(): void;
}) {
  const [folder, setFolder] = useState(initialFolder);
  const [title, setTitle] = useState('');
  const [source, setSource] = useState('');
  const [library, setLibrary] = useState<(ProtocolSummary & { cell_line_name: string | null })[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => setFolder(initialFolder), [initialFolder]);
  useEffect(() => {
    api<(ProtocolSummary & { cell_line_name: string | null })[]>('/api/protocols?includeCell=1')
      .then(setLibrary)
      .catch(() => setLibrary([]));
  }, []);
  async function create() {
    setBusy(true);
    try {
      const doc = await api<ProtocolDocument>(`/api/cell-lines/${line.id}/protocols`, {
        method: 'POST',
        json: { folder, title: title.trim(), sourceProtocolId: source || null },
      });
      onCreated(doc);
    } catch (e) {
      toast(e instanceof Error ? e.message : '프로토콜을 만들지 못했습니다', { tone: 'error' });
      setBusy(false);
    }
  }
  const shared = library.filter((p) => !p.cell_line_name);
  const others = library.filter((p) => p.cell_line_name);
  return (
    <form
      className="max-w-xl space-y-1"
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <h2 className="cell-protocols-title mb-3">새 프로토콜</h2>
      <Field label="폴더">
        <select className={inputCls} value={folder} onChange={(e) => setFolder(e.target.value as ProtocolFolder)}>
          {PROTOCOL_FOLDERS.map((f) => (
            <option key={f} value={f}>
              {PROTOCOL_FOLDER_LABELS[f]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="시작 내용">
        <select className={inputCls} value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">빈 문서</option>
          {shared.length > 0 && (
            <optgroup label="프로토콜 라이브러리에서 복사">
              {shared.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </optgroup>
          )}
          {others.length > 0 && (
            <optgroup label="다른 세포주의 프로토콜 복사">
              {others.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.cell_line_name} · {p.title}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </Field>
      <Field label={source ? '제목 (비우면 원본 제목)' : '제목'}>
        <input
          className={inputCls}
          value={title}
          maxLength={200}
          placeholder={`예: ${line.name} ${PROTOCOL_FOLDER_LABELS[folder]}`}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>
      <p className="pb-2 text-xs text-fg-muted">복사본은 이 세포주에만 속합니다. 원본은 바뀌지 않습니다.</p>
      <div className="flex gap-2">
        <button type="submit" className={primaryBtnCls} disabled={busy || (!source && !title.trim())}>
          만들고 편집
        </button>
        <button type="button" className={btnCls} onClick={onCancel}>
          취소
        </button>
      </div>
    </form>
  );
}

const ORIGIN_LABELS = { manual: '수동 입력', literature: '문헌에서 추출', provider: '분양처에서 추출' };
const SCOPE_LABELS = { general: '일반 골격', cell_specific: '이 세포주용 사본', shared: '공유 템플릿', unselected: '템플릿 미선택' };

/** Execution plan by stage, the medium calculator, and the general SOP template filled with the active conditions. */
function PlanOverview({
  line,
  profiles,
  onOpenProtocol,
  onChanged,
}: {
  line: CellLineDto;
  profiles: ProfileDto[];
  onOpenProtocol(id: string, edit: boolean): void;
  onChanged(): void;
}) {
  const [stage, setStage] = useState<PlanStage>('thaw');
  const active = profiles.find((p) => p.isActive) ?? null;
  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="cell-protocols-title">실행 계획 · 조건</h2>
          <p className="cell-protocols-meta">
            활성 조건: {active?.name ?? '없음'} · 단계별 조건과 근거는 배양 조건에서 편집합니다.
          </p>
        </div>
        <Link className={btnCls} href={`/cells/${line.id}?tab=profiles${active ? `&profile=${active.id}` : ''}`}>
          조건·근거 편집
        </Link>
      </header>
      {active?.executionPlan?.summary && <p className="whitespace-pre-wrap text-sm leading-relaxed">{active.executionPlan.summary}</p>}
      <nav aria-label="실행 단계" className="flex flex-wrap gap-2">
        {(Object.keys(PLAN_STAGE_LABELS) as PlanStage[]).map((s) => (
          <button key={s} className={s === stage ? primaryBtnCls : btnCls} aria-pressed={s === stage} onClick={() => setStage(s)}>
            {PLAN_STAGE_LABELS[s]}
          </button>
        ))}
      </nav>
      <CulturePlanGuide profile={active} stage={stage} lineId={line.id} />
      {active?.executionPlan && <MediumCalculator plan={active.executionPlan} />}
      <SopTemplateReference line={line} onOpenProtocol={onOpenProtocol} onChanged={onChanged} />
    </section>
  );
}

function SopTemplateReference({
  line,
  onOpenProtocol,
  onChanged,
}: {
  line: CellLineDto;
  onOpenProtocol(id: string, edit: boolean): void;
  onChanged(): void;
}) {
  const [sop, setSop] = useState<FilledSop | null>(null);
  const [templates, setTemplates] = useState<ProtocolSummary[]>([]);
  const [changing, setChanging] = useState(false);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const copy = useCopy();
  const toast = useToast();
  const load = useCallback(async () => {
    setError('');
    try {
      const [next, options] = await Promise.all([
        api<FilledSop>(`/api/cell-lines/${line.id}/sop`),
        api<ProtocolSummary[]>('/api/protocols?category=culture_sop'),
      ]);
      setSop(next);
      setTemplates(options);
      setSelected(next.protocolId ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : '배양 SOP를 불러오지 못했습니다');
    }
  }, [line.id, line.sopProtocolId, line.updatedAt]);
  useEffect(() => {
    void load();
  }, [load]);

  async function changeTemplate() {
    setBusy(true);
    try {
      await api(`/api/cell-lines/${line.id}`, { method: 'PUT', json: { sopProtocolId: selected || null } });
      setChanging(false);
      onChanged();
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : '템플릿을 바꾸지 못했습니다', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function createCopy() {
    if (!sop?.protocolId) return;
    setBusy(true);
    try {
      const doc = await api<ProtocolDocument>(`/api/cell-lines/${line.id}/sop/copy`, { method: 'POST', json: { protocolId: sop.protocolId } });
      onChanged();
      onOpenProtocol(doc.id, true);
    } catch (e) {
      toast(e instanceof Error ? e.message : '세포주용 사본을 만들지 못했습니다', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  if (error)
    return (
      <p role="alert" className="text-sm text-danger">
        {error}{' '}
        <button className={btnCls} onClick={() => void load()}>
          참고 템플릿 다시 불러오기
        </button>
      </p>
    );
  if (!sop) return null;
  const profile = sop.profile;
  const filledFields = CULTURE_FIELDS.filter((field) => {
    const value = profile?.fields[field.key];
    return field.inProfile && value !== null && value !== undefined && (Array.isArray(value) ? value.length > 0 : String(value).trim() !== '');
  });
  return (
    <details className="rounded-xl border border-line p-4">
      <summary className="cursor-pointer text-sm font-medium">일반 SOP 템플릿 참고 · {sop.title}</summary>
      <div className="mt-4 space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-fg-muted">
            {SCOPE_LABELS[sop.scope]} · {sop.templateStatus === 'confirmed' ? '사용자가 확정한 템플릿' : '검토 전 초안'}
          </p>
          <div className="flex flex-wrap gap-2">
            <button className={btnCls} disabled={busy} onClick={() => setChanging(true)}>
              템플릿 선택
            </button>
            {sop.scope === 'cell_specific' && sop.protocolId ? (
              <button className={btnCls} onClick={() => onOpenProtocol(sop.protocolId!, false)}>
                전체 SOP 폴더에서 열기
              </button>
            ) : (
              <button className={btnCls} disabled={busy || !sop.protocolId} onClick={() => void createCopy()}>
                이 세포주용 사본 만들기
              </button>
            )}
            <button className={btnCls} disabled={!sop.markdown} onClick={() => copy(sop.markdown)}>
              마크다운 복사
            </button>
          </div>
        </header>
        <p className="text-sm leading-relaxed text-fg-muted">
          선택한 템플릿에 활성 조건값을 넣어 보여 줍니다. Cellosaurus는 배양 조건이나 세포주별 SOP를 제공하지 않으므로 분양처·문헌 근거와 실험실 지침으로
          확인하세요.
        </p>
        {sop.provenance && <ProtocolOrigin protocol={{ id: sop.protocolId ?? undefined, provenance: sop.provenance }} />}
        {sop.warnings.length > 0 && (
          <ul className="list-disc space-y-1 rounded-xl bg-warning-soft p-4 pl-8 text-sm text-warning">
            {sop.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
        <section className="rounded-xl border border-line bg-raised p-4">
          <h3 className="text-sm font-medium text-fg">조건값과 근거</h3>
          {profile ? (
            <>
              <p className="mt-1 text-sm text-fg-muted">
                활성 조건: {profile.name} · {ORIGIN_LABELS[profile.origin]}
              </p>
              <div className="mt-3 space-y-3">
                {filledFields.length === 0 && <p className="text-sm text-warning">활성 조건에 입력된 배양값이 없습니다.</p>}
                {filledFields.map((field) => {
                  const value = profile.fields[field.key];
                  const refs = profile.sourceRefs.filter((ref) => ref.field === field.key);
                  return (
                    <div key={field.key} className="border-t border-line pt-3 text-sm">
                      <p className="font-medium text-fg">
                        {field.label}: {Array.isArray(value) ? value.join(', ') : String(value)}
                        {field.unit ? ` ${field.unit}` : ''}
                      </p>
                      {refs.length === 0 ? (
                        <p className="mt-1 text-xs text-fg-muted">외부 근거 미등록</p>
                      ) : (
                        refs.map((ref, index) => <SourceRefDetails key={`${ref.sourceLabel}-${index}`} sourceRef={ref} />)
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-warning">활성 배양 조건 없음 · 배양 조건 탭에서 조건 세트를 활성화하세요.</p>
          )}
        </section>
        {sop.markdown && (
          <article className="min-w-0 rounded-xl border border-line bg-raised p-6">
            <Markdown text={sop.markdown} />
          </article>
        )}
      </div>
      {changing && (
        <Dialog
          title="배양 SOP 템플릿 선택"
          onClose={() => setChanging(false)}
          dismissible={!busy}
          footer={
            <button className={primaryBtnCls} disabled={busy} onClick={() => void changeTemplate()}>
              선택 저장
            </button>
          }
        >
          <p className="mb-4 text-sm leading-relaxed text-fg-muted">
            선택은 원본을 연결할 뿐 검증을 뜻하지 않습니다. 이 세포주의 절차만 바꾸려면 사본을 만드세요.
          </p>
          <Field label="템플릿">
            <select className={inputCls} value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">{line.growthMode === 'mixed' ? '자동 선택 안 함 (혼합 배양)' : '배양 방식의 일반 골격 (미검증)'}</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} · {t.status === 'draft' ? '초안' : '사용자 확정'}
                </option>
              ))}
            </select>
          </Field>
        </Dialog>
      )}
    </details>
  );
}
