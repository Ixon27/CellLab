import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import { api } from '../api';
import { btnCls, solidDangerBtnCls, Dialog, Field, inputCls, primaryBtnCls } from '../components/Dialog';
import { ProtocolDocumentEditor } from '../components/ProtocolDocumentEditor';
import { ProtocolOrigin, ProtocolPreview } from '../components/ProtocolPreview';
import { useToast } from '../components/Toast';
import type { ProtocolDocument } from './Protocols';

interface Revision {
  id: string;
  protocol_id: string;
  version: string;
  body_md: string;
  saved_at: string;
}

export function ProtocolDetail({ id }: { id: string }) {
  const [doc, setDoc] = useState<ProtocolDocument | null>(null);
  const [draft, setDraft] = useState<ProtocolDocument | null>(null);
  const [editing, setEditing] = useState(() => new URLSearchParams(window.location.search).get('edit') === '1');
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [revision, setRevision] = useState<Revision | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const [, navigate] = useLocation();
  const load = useCallback(async () => {
    setError('');
    try {
      const [next, history] = await Promise.all([
        api<ProtocolDocument>(`/api/protocols/${id}`),
        api<Revision[]>(`/api/protocols/${id}/revisions`),
      ]);
      setDoc(next);
      setDraft(next);
      setRevisions(history);
    } catch (e) {
      setError(e instanceof Error ? e.message : '프로토콜을 불러오지 못했습니다');
    }
  }, [id]);
  useEffect(() => {
    setDoc(null);
    setDraft(null);
    setRevision(null);
    setRevisions([]);
    setEditing(new URLSearchParams(window.location.search).get('edit') === '1');
    void load();
  }, [load]);

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      const next = await api<ProtocolDocument>(`/api/protocols/${id}`, {
        method: 'PUT',
        json: { title: draft.title, version: draft.version, status: draft.status, bodyMd: draft.body_md },
      });
      setDoc(next);
      setDraft(next);
      setEditing(false);
      setRevision(null);
      setRevisions(await api<Revision[]>(`/api/protocols/${id}/revisions`));
      toast('프로토콜을 저장했습니다');
    } catch (e) {
      toast(e instanceof Error ? e.message : '저장하지 못했습니다', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus() {
    if (!doc) return;
    setBusy(true);
    try {
      const next = await api<ProtocolDocument>(`/api/protocols/${id}`, {
        method: 'PUT',
        json: { status: doc.status === 'draft' ? 'confirmed' : 'draft' },
      });
      setDoc(next);
      setDraft(next);
    } catch (e) {
      toast(e instanceof Error ? e.message : '상태를 바꾸지 못했습니다', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (!revision) return;
    setBusy(true);
    try {
      await api(`/api/protocols/${id}/revisions/${revision.id}/restore`, { method: 'POST' });
      await load();
      setRevision(null);
      setEditing(false);
      toast('이전 버전을 복원했습니다');
    } catch (e) {
      toast(e instanceof Error ? e.message : '복원하지 못했습니다', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api(`/api/protocols/${id}`, { method: 'DELETE' });
      navigate('/protocols');
    } catch (e) {
      toast(e instanceof Error ? e.message : '삭제하지 못했습니다', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  if (error)
    return (
      <div role="alert" className="p-6 text-danger">
        {error}{' '}
        <button className={btnCls} onClick={() => void load()}>
          다시 시도
        </button>
      </div>
    );
  if (!doc || !draft) return <p className="p-6 text-fg-muted">불러오는 중…</p>;
  return (
    <div className="workbench-page space-y-5">
      <header className="workbench-head !mb-0 !items-start">
        <div className="min-w-0">
          <Link href="/protocols" className="mb-1.5 inline-flex items-center gap-1 text-[12px] text-fg-muted hover:text-fg">
            <ArrowLeft size={13} aria-hidden /> 프로토콜 목록
          </Link>
          <h1>{doc.title}</h1>
          <p className="workbench-head-note">
            {doc.version || '버전 없음'} · {doc.status === 'draft' ? '초안 — 실험실 지침으로 확인하세요' : '사용자가 확정한 문서 — 외부 검증을 뜻하지 않습니다'}
            {doc.source_file ? ` · 원본: ${doc.source_file}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            aria-label="이전 버전 보기"
            className={`${inputCls} w-auto`}
            value={revision?.id ?? ''}
            disabled={busy}
            onChange={(e) => setRevision(revisions.find((r) => r.id === e.target.value) ?? null)}
          >
            <option value="">이전 버전 ({revisions.length})</option>
            {revisions.map((r) => (
              <option key={r.id} value={r.id}>
                {new Date(r.saved_at).toLocaleString('ko-KR')} · {r.version || '버전 없음'}
              </option>
            ))}
          </select>
          {editing ? (
            <>
              <button
                className={btnCls}
                disabled={busy}
                onClick={() => {
                  setDraft(doc);
                  setEditing(false);
                }}
              >
                취소
              </button>
              <button className={primaryBtnCls} disabled={busy || !draft.title.trim()} onClick={() => void save()}>
                저장
              </button>
            </>
          ) : (
            <>
              <button className={btnCls} disabled={busy} onClick={() => void toggleStatus()}>
                {doc.status === 'draft' ? '확정으로 변경' : '초안으로 변경'}
              </button>
              <button className={primaryBtnCls} disabled={busy} onClick={() => {
                setDraft(doc);
                setEditing(true);
              }}>
                {doc.provenance.cellLineId ? '세포주용 사본 편집' : '공유 원본 편집'}
              </button>
              {!doc.builtin && (
                <button className={btnCls} onClick={() => setDeleting(true)}>
                  삭제
                </button>
              )}
            </>
          )}
        </div>
      </header>
      {editing && (
        <section aria-label="문서 출처와 편집 범위" className="space-y-3">
          <ProtocolOrigin protocol={doc} />
          <div role="note" className="rounded-xl border border-line bg-raised p-4 text-sm leading-relaxed text-fg-muted">
            {doc.provenance.cellLineId ? (
              <p>이 세포주용 사본의 실험 절차를 편집합니다. 배지·온도 등 연결된 조건 값은{' '}
                <Link className="text-accent" href={`/cells/${doc.provenance.cellLineId}?tab=profiles`}>
                  세포주 배양 조건에서 편집
                </Link>하세요. 본문의 조건 항목은 값을 직접 입력하지 않고 연결을 유지합니다.
              </p>
            ) : (
              <>
                <p className="text-warning">공유 원본의 절차를 편집합니다. 이 문서를 연결한 모든 세포주·실험에 영향을 줍니다.</p>
                <p className="mt-1">배지·온도 등 세포주별 조건은 해당 세포주의 배양 조건에서 수정하세요.
                  한 세포주의 절차만 바꾸려면 배양 SOP에서 전용 사본을 만드세요. 연결된 조건 항목은 세포주 맥락이 있어야 값을 확인할 수 있습니다.</p>
              </>
            )}
          </div>
        </section>
      )}
      {editing ? (
        <>
          <div className="grid gap-3 md:grid-cols-[1fr_180px_140px]">
            <Field label="제목">
              <input
                className={inputCls}
                value={draft.title}
                maxLength={200}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </Field>
            <Field label="버전">
              <input
                className={inputCls}
                value={draft.version}
                maxLength={120}
                onChange={(e) => setDraft({ ...draft, version: e.target.value })}
              />
            </Field>
            <Field label="상태">
              <select
                className={inputCls}
                value={draft.status}
                onChange={(e) => setDraft({ ...draft, status: e.target.value as 'draft' | 'confirmed' })}
              >
                <option value="draft">초안</option>
                <option value="confirmed">확정</option>
              </select>
            </Field>
          </div>
          <section aria-label="프로토콜 절차 편집" className="min-w-0">
            <h2 className="mb-2 text-sm font-medium">실험 절차</h2>
            <ProtocolDocumentEditor
              key={doc.id}
              value={draft.body_md}
              onChange={(body_md) => setDraft((current) => current ? { ...current, body_md } : current)}
              cellLineId={doc.provenance.cellLineId}
            />
          </section>
        </>
      ) : (
        <article className="min-w-0 rounded-xl border border-line bg-raised p-6">
          <ProtocolPreview protocol={doc} />
        </article>
      )}
      {revision && (
        <Dialog
          title={`이전 버전 · ${revision.version || '버전 없음'}`}
          width={1000}
          dismissible={!busy}
          onClose={() => setRevision(null)}
          footer={
            <button className={primaryBtnCls} disabled={busy} onClick={() => void restore()}>
              이 버전으로 복원
            </button>
          }
        >
          <p className="mb-4 text-sm text-fg-muted">
            {new Date(revision.saved_at).toLocaleString('ko-KR')} · 복원하면 현재 본문도 이력에 보관됩니다. 편집 중인 미저장 내용은
            사라집니다.
          </p>
          <ProtocolPreview protocol={{ ...doc, body_md: revision.body_md }} />
        </Dialog>
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
          <p className="text-sm text-fg-muted">‘{doc.title}’과 모든 수정 이력을 삭제합니다. 연결된 실험의 프로토콜 연결도 해제됩니다.</p>
        </Dialog>
      )}
    </div>
  );
}
