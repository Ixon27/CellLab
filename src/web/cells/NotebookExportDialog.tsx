import { useState } from 'react';
import type { CellLineDto, CultureDto } from '../../shared/cell-line';
import { Dialog, Field, btnCls, inputCls, primaryBtnCls } from '../components/Dialog';
import { Markdown } from '../components/Markdown';

type Format = 'html' | 'md';

const FORMATS: { value: Format; label: string; hint: string }[] = [
  { value: 'html', label: '인쇄용 HTML', hint: '브라우저나 앱에서 PDF로 저장 가능' },
  { value: 'md', label: 'Markdown (.md)', hint: '' },
];

async function fetchNotebook(path: string): Promise<{ blob: Blob; fileName: string | null }> {
  const res = await fetch(path);
  if (!res.ok) {
    let message = `요청 실패 (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // keep the status message
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(res.headers.get('Content-Disposition') ?? '')?.[1];
  return { blob, fileName: encoded ? decodeURIComponent(encoded) : null };
}

/** Export a cell line's records as a lab notebook (Markdown or print-ready HTML), with an in-dialog Markdown preview. */
export function NotebookExportDialog({ line, cultures, onClose }: { line: CellLineDto; cultures: CultureDto[]; onClose(): void }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cultureId, setCultureId] = useState('');
  const [format, setFormat] = useState<Format>('html');
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<'preview' | 'export' | null>(null);
  const [error, setError] = useState('');

  const url = (as: Format) => {
    const params = new URLSearchParams({ format: as });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (cultureId) params.set('cultureId', cultureId);
    return `/api/cell-lines/${encodeURIComponent(line.id)}/notebook?${params}`;
  };

  async function run(kind: 'preview' | 'export') {
    setBusy(kind);
    setError('');
    try {
      const { blob, fileName } = await fetchNotebook(url(kind === 'preview' ? 'md' : format));
      if (kind === 'preview') {
        setPreview(await blob.text());
        return;
      }
      const link = document.createElement('a');
      const href = URL.createObjectURL(blob);
      link.href = href;
      link.download = fileName ?? `${line.name}_실험노트.${format}`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog
      title={`실험노트 내보내기 — ${line.name}`}
      onClose={onClose}
      width={760}
      footer={(close) => (
        <>
          <button className={btnCls} onClick={close}>
            닫기
          </button>
          <button className={btnCls} onClick={() => void run('preview')} disabled={busy !== null}>
            {busy === 'preview' ? '불러오는 중…' : '미리보기'}
          </button>
          <button className={primaryBtnCls} onClick={() => void run('export')} disabled={busy !== null}>
            {busy === 'export' ? '내보내는 중…' : '내보내기'}
          </button>
        </>
      )}
    >
      <p className="mb-3 text-[12.5px] leading-relaxed text-fg-muted">
        날짜별로 정리한 기록을 실험노트 파일로 저장합니다. 프로토콜을 이번에만 바꾼 단계는 원문에 취소선을 긋고 실제로 한 방법을 함께 보여 줍니다.
      </p>
      <div className="grid gap-x-3 sm:grid-cols-3">
        <Field label="기간 시작" hint="비우면 처음부터">
          <input className={inputCls} type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="기간 끝" hint="비우면 현재까지">
          <input className={inputCls} type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="배양">
          <select className={inputCls} value={cultureId} onChange={(e) => setCultureId(e.target.value)}>
            <option value="">전체 배양</option>
            {cultures.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} · P{c.passage}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <fieldset className="mb-3">
        <legend className="mb-1 text-[12.5px] font-medium text-fg">형식</legend>
        <div className="flex flex-col gap-1">
          {FORMATS.map((f) => (
            <label key={f.value} className="flex items-center gap-2 text-[12.5px] text-fg">
              <input type="radio" name="notebook-format" checked={format === f.value} onChange={() => setFormat(f.value)} />
              <span>{f.label}</span>
              {f.hint && <span className="text-fg-muted">— {f.hint}</span>}
            </label>
          ))}
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
          {error}
        </p>
      )}
      {preview !== null && (
        <div className="max-h-[360px] overflow-y-auto rounded-lg border border-line bg-surface p-4" aria-label="실험노트 미리보기">
          <Markdown text={preview} />
        </div>
      )}
    </Dialog>
  );
}
