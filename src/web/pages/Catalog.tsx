import { Eye, EyeOff, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { CATALOG_CATEGORIES, CATALOG_LABELS, VESSEL_AREA_CM2, type CatalogCategory, type CatalogOption } from '../../shared/catalog';
import { api } from '../api';
import { chipCls, inputCls, primaryBtnCls, smallIconBtnCls } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { invalidateCatalog } from '../state/catalog';

export function Catalog() {
  const [category, setCategory] = useState<CatalogCategory>('base_medium');
  const [items, setItems] = useState<CatalogOption[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setItems(await api<CatalogOption[]>(`/api/catalog?category=${category}&all=1`));
    } catch (e) {
      toast((e as Error).message, { tone: 'error' });
    }
  }, [category, toast]);

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      invalidateCatalog(category);
      await load();
    } catch (e) {
      toast((e as Error).message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const add = () =>
    run(async () => {
      await api('/api/catalog', { method: 'POST', json: { category, label: draft } });
      setDraft('');
    });

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-[20px] font-semibold text-fg">선택 목록</h1>
      <p className="mt-1 text-[13px] text-fg-muted">
        배양 조건·기록 입력창에 제안되는 항목입니다. 기본 항목은 숨길 수만 있고, 직접 입력한 값은 저장할 때 자동으로 추가됩니다.
      </p>
      <div role="tablist" aria-label="분류" className="mt-4 flex flex-wrap gap-1.5">
        {CATALOG_CATEGORIES.map((c) => (
          <button key={c} role="tab" aria-selected={c === category} className={chipCls(c === category)} onClick={() => setCategory(c)}>
            {CATALOG_LABELS[c]}
          </button>
        ))}
      </div>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) void add();
        }}
      >
        <input
          className={inputCls}
          aria-label="새 항목"
          placeholder={`${CATALOG_LABELS[category]} 항목 추가`}
          value={draft}
          maxLength={120}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className={`${primaryBtnCls} shrink-0`} disabled={busy || !draft.trim()}>
          항목 추가
        </button>
      </form>
      {category === 'vessel' && (
        <p className="mt-2 text-[12px] text-fg-dim">세포 수 계산의 배양 면적은 Corning 기준값이며 제조사별로 다릅니다.</p>
      )}
      <ul className="mt-4 divide-y divide-line rounded-xl border border-line bg-surface">
        {items === null && <li className="px-4 py-3 text-[13px] text-fg-muted">불러오는 중…</li>}
        {items?.length === 0 && <li className="px-4 py-3 text-[13px] text-fg-muted">항목이 없습니다.</li>}
        {items?.map((item) => (
          <li key={item.id} className={`flex items-center gap-3 px-4 py-2 ${item.hidden ? 'opacity-55' : ''}`}>
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-fg">
              {item.label}
              {category === 'vessel' && VESSEL_AREA_CM2[item.label] !== undefined && (
                <span className="ml-2 text-[12px] text-fg-dim">{VESSEL_AREA_CM2[item.label]} cm²</span>
              )}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] ${item.builtin ? 'bg-sunken text-fg-muted' : 'bg-accent-soft text-accent'}`}
            >
              {item.builtin ? '기본' : '사용자'}
            </span>
            <button
              className={smallIconBtnCls}
              disabled={busy}
              aria-label={item.hidden ? `${item.label} 다시 보이기` : `${item.label} 숨기기`}
              title={item.hidden ? '다시 보이기' : '숨기기'}
              onClick={() => void run(() => api(`/api/catalog/${item.id}`, { method: 'PUT', json: { hidden: !item.hidden } }))}
            >
              {item.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            {!item.builtin && (
              <button
                className={smallIconBtnCls}
                disabled={busy}
                aria-label={`${item.label} 삭제`}
                title="삭제"
                onClick={() => void run(() => api(`/api/catalog/${item.id}`, { method: 'DELETE' }))}
              >
                <Trash2 size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
