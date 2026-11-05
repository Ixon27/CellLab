import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { BookOpen, FileUp, Plus } from 'lucide-react';
import { api } from '../api';
import { btnCls, Dialog, Field, inputCls, primaryBtnCls } from '../components/Dialog';
import { useToast } from '../components/Toast';

export const PROTOCOL_CATEGORIES = [
  { value: 'culture_sop', label: '배양 SOP' },
  { value: 'western', label: 'Western blot' },
  { value: 'bradford', label: 'Bradford' },
  { value: 'protein', label: '단백질' },
  { value: 'other', label: '기타' },
] as const;
export interface ProtocolSummary {
  id: string;
  title: string;
  category: string;
  version: string;
  status: 'draft' | 'confirmed';
  builtin: number;
  updated_at: string;
}
export interface ProtocolDocument extends ProtocolSummary {
  body_md: string;
  source_file: string | null;
  created_at: string;
}

export function Protocols() {
  const [filter, setFilter] = useState('');
  const [items, setItems] = useState<ProtocolSummary[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('other');
  const [importKind, setImportKind] = useState('other');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [, navigate] = useLocation();
  const toast = useToast();
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems(await api<ProtocolSummary[]>(`/api/protocols${filter ? `?category=${filter}` : ''}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : '프로토콜을 불러오지 못했습니다');
    } finally {
      setLoading(false);
    }
  }, [filter]);
  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    try {
      const doc = await api<ProtocolDocument>('/api/protocols', { method: 'POST', json: { title, category: kind, bodyMd: '' } });
      navigate(`/protocols/${doc.id}?edit=1`);
    } catch (e) {
      toast(e instanceof Error ? e.message : '프로토콜을 만들지 못했습니다', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File) {
    setBusy(true);
    const form = new FormData();
    form.set('file', file);
    form.set('category', importKind);
    try {
      const doc = await api<ProtocolDocument>('/api/protocols/import', { method: 'POST', body: form });
      navigate(`/protocols/${doc.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : '파일을 가져오지 못했습니다', { tone: 'error' });
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg">프로토콜 라이브러리</h1>
          <p className="mt-1 text-sm text-fg-muted">배양·정량·웨스턴 실험 절차와 수정 이력을 관리합니다.</p>
        </div>
        <button className={primaryBtnCls} onClick={() => setCreating(true)}>
          <Plus size={15} />새 프로토콜
        </button>
      </header>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-raised p-4">
        <label className="flex items-center gap-2 text-sm text-fg-muted">
          분류 필터
          <select aria-label="프로토콜 분류 필터" className={inputCls} value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">전체</option>
            {PROTOCOL_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex-1" />
        <label className="flex items-center gap-2 text-sm text-fg-muted">
          가져올 분류
          <select className={inputCls} value={importKind} onChange={(e) => setImportKind(e.target.value)}>
            {PROTOCOL_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <button className={btnCls} disabled={busy} onClick={() => fileInput.current?.click()}>
          <FileUp size={15} />
          파일 가져오기 (.docx/.md/.txt)
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".docx,.md,.txt"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importFile(file);
          }}
        />
      </div>
      {error ? (
        <div role="alert" className="text-danger">
          {error}{' '}
          <button className={btnCls} onClick={() => void load()}>
            다시 시도
          </button>
        </div>
      ) : loading ? (
        <p className="text-fg-muted">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-10 text-center text-fg-muted">
          프로토콜을 만들거나 문서 파일을 가져오세요.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((item) => (
            <Link
              key={item.id}
              href={`/protocols/${item.id}`}
              className="rounded-xl border border-line bg-raised p-4 hover:border-accent/50"
            >
              <div className="flex items-start gap-3">
                <BookOpen size={20} className="mt-1 shrink-0 text-accent" />
                <div className="min-w-0">
                  <h2 className="font-medium text-fg">{item.title}</h2>
                  <p className="mt-1 text-xs text-fg-muted">
                    {PROTOCOL_CATEGORIES.find((c) => c.value === item.category)?.label} · {item.version || '버전 없음'}
                  </p>
                </div>
                <span
                  className={`ml-auto shrink-0 rounded-full px-2 py-1 text-xs ${item.status === 'confirmed' ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'}`}
                >
                  {item.status === 'confirmed' ? '확정' : '초안'}
                </span>
              </div>
              <div className="mt-3 flex gap-2 text-xs text-fg-dim">
                {item.builtin ? <span>기본 프로토콜 ·</span> : null}
                <span>수정 {new Date(item.updated_at).toLocaleDateString('ko-KR')}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
      {creating && (
        <Dialog
          title="새 프로토콜"
          onClose={() => setCreating(false)}
          dismissible={!busy}
          footer={
            <button className={primaryBtnCls} disabled={busy || !title.trim()} onClick={() => void create()}>
              만들기
            </button>
          }
        >
          <Field label="제목">
            <input autoFocus className={inputCls} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="분류">
            <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value)}>
              {PROTOCOL_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
        </Dialog>
      )}
    </div>
  );
}
