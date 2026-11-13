import { useEffect, useMemo, useRef, useState } from 'react';
import type { CellLineDto, CultureDto, LogDto, ProfileDto } from '../../../shared/cell-line';
import { PHOTO_MAX_BYTES, PHOTO_MAX_PER_LOG, RESERVED_EXTRA_KEYS } from '../../../shared/culture-operations';
import type { PhotoDto } from '../../../shared/culture-operations';
import { api } from '../../api';
import { Field, inputCls, primaryBtnCls } from '../../components/Dialog';
import { useToast } from '../../components/Toast';
import { composeOperationNote, FieldRow, FormError, isoFromInput, localInput, PlanRecordSection } from './common';
import { executionProfile } from '../culture-plan-state';

const ACCEPT = 'image/png,image/jpeg';
const MB = 1024 * 1024;

interface Pending {
  key: string;
  file: File;
  preview: string;
}

/** Client-side pre-check; the server re-validates size, declared type and file signature. */
export function photoProblem(file: File, taken: number): string | null {
  if (file.type !== 'image/png' && file.type !== 'image/jpeg') return `${file.name}: PNG 또는 JPEG 사진만 첨부할 수 있습니다`;
  if (file.size === 0) return `${file.name}: 빈 파일입니다`;
  if (file.size > PHOTO_MAX_BYTES) return `${file.name}: ${PHOTO_MAX_BYTES / MB} MB 이하여야 합니다`;
  if (taken >= PHOTO_MAX_PER_LOG) return `기록당 사진은 최대 ${PHOTO_MAX_PER_LOG}장입니다`;
  return null;
}

/** Thumbnails of stored photos (click opens the original in a new view) with a remove button. */
export function PhotoStrip({ photos, onRemove }: { photos: PhotoDto[]; onRemove?(photo: PhotoDto): void }) {
  if (!photos.length) return null;
  return (
    <ul className="my-2 flex flex-wrap gap-2" aria-label="첨부 사진">
      {photos.map((p) => (
        <li key={p.id} className="relative">
          <a href={p.url} target="_blank" rel="noreferrer" title={`${p.originalName} · ${(p.bytes / 1024).toFixed(0)} KB`}>
            <img src={p.url} alt={p.originalName} loading="lazy" className="h-20 w-20 rounded-md border border-line object-cover" />
          </a>
          {onRemove && (
            <button
              type="button"
              className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full border border-line-strong bg-surface text-[11px] leading-none text-fg hover:bg-hover"
              aria-label={`${p.originalName} 사진 삭제`}
              onClick={() => onRemove(p)}
            >
              ✕
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Observation record: confluency, morphology, optional real photo files and a note.
 * Creating one never changes the passage or the medium history.
 */
export function ObservationForm({
  line,
  culture,
  profiles,
  initialAt,
  initialLog,
  onSaved,
  onComplete,
}: {
  line: CellLineDto;
  culture: CultureDto;
  profiles: ProfileDto[];
  initialAt?: string;
  initialLog?: LogDto;
  onSaved(): void;
  onComplete?(): void;
}) {
  const toast = useToast();
  const [at, setAt] = useState(() => localInput(initialLog?.at ?? initialAt ?? Date.now()));
  const [confluency, setConfluency] = useState(initialLog?.confluencyPct == null ? '' : String(initialLog.confluencyPct));
  const [morphology, setMorphology] = useState(initialLog?.morphology ?? '');
  const [performer, setPerformer] = useState(initialLog?.extra['수행자'] ?? '');
  const [note, setNote] = useState(initialLog?.note ?? '');
  const [records, setRecords] = useState<Record<string, string>>({});
  const [stored, setStored] = useState<PhotoDto[]>(initialLog?.photos ?? []);
  const [pending, setPending] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // After the log exists, a failed photo upload is retried against it instead of creating a second record.
  const savedLogId = useRef<string | null>(null);
  const previews = useRef<string[]>([]);
  useEffect(
    () => () => {
      for (const url of previews.current) URL.revokeObjectURL(url);
    },
    [],
  );
  const profile = executionProfile(profiles, culture).profile;
  const totalPhotos = stored.length + pending.length;
  const confluencyError = useMemo(() => {
    if (!confluency.trim()) return null;
    const n = Number(confluency);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? null : 'Confluency는 0–100% 범위입니다';
  }, [confluency]);

  function addFiles(files: FileList | null) {
    if (!files) return;
    const next: Pending[] = [];
    const problems: string[] = [];
    for (const file of Array.from(files)) {
      const problem = photoProblem(file, totalPhotos + next.length);
      if (problem) {
        problems.push(problem);
        continue;
      }
      const preview = URL.createObjectURL(file);
      previews.current.push(preview);
      next.push({ key: `${file.name}:${file.size}:${file.lastModified}:${preview}`, file, preview });
    }
    setError(problems.length ? problems.join('\n') : null);
    setPending((list) => [...list, ...next]);
  }
  async function removeStored(photo: PhotoDto) {
    if (!confirm('이 사진을 삭제할까요? 원본 파일도 앱 저장소에서 삭제됩니다.')) return;
    try {
      await api(`/api/photos/${photo.id}`, { method: 'DELETE' });
      setStored((list) => list.filter((p) => p.id !== photo.id));
      onSaved();
    } catch (e) {
      toast((e as Error).message, { tone: 'error' });
    }
  }
  async function upload(logId: string): Promise<string[]> {
    const failed: string[] = [];
    const remaining: Pending[] = [];
    for (const item of pending) {
      const body = new FormData();
      body.set('file', item.file);
      try {
        const photo = await api<PhotoDto>(`/api/logs/${logId}/photos`, { method: 'POST', body });
        setStored((list) => [...list, photo]);
      } catch (e) {
        failed.push(`${item.file.name}: ${(e as Error).message}`);
        remaining.push(item);
      }
    }
    setPending(remaining);
    return failed;
  }
  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (confluencyError) throw new Error(confluencyError);
      let logId = savedLogId.current ?? initialLog?.id ?? null;
      if (!savedLogId.current) {
        const extra = Object.fromEntries(Object.entries(initialLog?.extra ?? {}).filter(([k]) => !RESERVED_EXTRA_KEYS.includes(k) && k !== '수행자'));
        if (performer.trim()) extra['수행자'] = performer.trim();
        const body = {
          type: 'observation',
          at: isoFromInput(at),
          confluencyPct: confluency.trim() ? Number(confluency) : null,
          morphology: morphology.trim(),
          extra,
          note: initialLog ? note : composeOperationNote(note, profile, 'feed', records),
        };
        const log = await api<LogDto>(initialLog ? `/api/logs/${initialLog.id}` : `/api/cultures/${culture.id}/logs`, {
          method: initialLog ? 'PUT' : 'POST',
          json: body,
        });
        logId = log.id;
        savedLogId.current = log.id;
      }
      const failed = pending.length ? await upload(logId!) : [];
      onSaved();
      if (failed.length) {
        setError(`기록은 저장했지만 사진을 올리지 못했습니다. 다시 저장하면 사진만 다시 시도합니다.\n${failed.join('\n')}`);
        return;
      }
      if (!initialLog) {
        setConfluency('');
        setMorphology('');
        setPerformer('');
        setNote('');
        setRecords({});
        setStored([]);
        setAt(localInput());
        savedLogId.current = null;
        toast('관찰을 기록했습니다');
      }
      onComplete?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {!initialLog && (
        <PlanRecordSection profiles={profiles} culture={culture} stage="feed" lineId={line.id} records={records} onRecords={setRecords} />
      )}
      <Field label="관찰 일시">
        <input required type="datetime-local" className={inputCls} value={at} onChange={(e) => setAt(e.target.value)} />
      </Field>
      <FieldRow>
        <Field label="Confluency (%)" hint={confluencyError ?? undefined}>
          <input
            className={inputCls}
            type="number"
            min="0"
            max="100"
            step="any"
            value={confluency}
            aria-invalid={!!confluencyError}
            onChange={(e) => setConfluency(e.target.value)}
          />
        </Field>
        <Field label="수행자 (선택)">
          <input className={inputCls} value={performer} onChange={(e) => setPerformer(e.target.value)} />
        </Field>
      </FieldRow>
      <Field label="세포 형태 (선택)" hint="예: 방추형, 둥글게 떠 있는 세포, 군집 형성 등 관찰한 그대로 적습니다.">
        <textarea className={inputCls} rows={2} maxLength={1000} value={morphology} onChange={(e) => setMorphology(e.target.value)} />
      </Field>
      <Field label={`사진 (선택 · PNG/JPEG · 파일당 ${PHOTO_MAX_BYTES / MB} MB 이하 · 최대 ${PHOTO_MAX_PER_LOG}장)`}>
        <input
          type="file"
          accept={ACCEPT}
          multiple
          className="block w-full text-[12.5px]"
          disabled={totalPhotos >= PHOTO_MAX_PER_LOG}
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </Field>
      <PhotoStrip photos={stored} onRemove={(photo) => void removeStored(photo)} />
      {pending.length > 0 && (
        <ul className="mb-3 flex flex-wrap gap-2" aria-label="업로드 대기 사진">
          {pending.map((item) => (
            <li key={item.key} className="relative">
              <img src={item.preview} alt={item.file.name} className="h-20 w-20 rounded-md border border-dashed border-line-strong object-cover" />
              <button
                type="button"
                className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full border border-line-strong bg-surface text-[11px] leading-none hover:bg-hover"
                aria-label={`${item.file.name} 제외`}
                onClick={() => setPending((list) => list.filter((p) => p.key !== item.key))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <Field label="메모">
        <textarea className={inputCls} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <p className="mb-3 text-xs text-fg-muted">관찰 기록은 passage 번호와 배지 교체일을 바꾸지 않습니다.</p>
      <FormError>{error && <span className="whitespace-pre-line">{error}</span>}</FormError>
      <button className={primaryBtnCls} disabled={busy || !!confluencyError}>
        {busy ? '저장 중…' : initialLog ? '수정 저장' : '관찰 저장'}
      </button>
    </form>
  );
}
