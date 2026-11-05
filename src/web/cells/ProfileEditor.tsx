import { useEffect, useState } from 'react';
import type { ProfileDto } from '../../shared/cell-line';
import { CULTURE_FIELDS, completeMediumText } from '../../shared/culture';
import type { CultureProfileFields } from '../../shared/culture';
import { api } from '../api';
import { OptionCombobox, OptionMultiSelect } from '../components/OptionCombobox';
import { btnCls, primaryBtnCls, dangerBtnCls, inputCls } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { invalidateCatalog } from '../state/catalog';
export function ProfileEditor({
  lineId,
  profiles,
  selectedId,
  onSelect,
  onChanged,
}: {
  lineId: string;
  profiles: ProfileDto[];
  selectedId: string | null;
  onSelect(id: string): void;
  onChanged(): void;
}) {
  const selected = profiles.find((p) => p.id === selectedId) ?? profiles[0];
  const [name, setName] = useState('');
  const [fields, setFields] = useState<CultureProfileFields>({});
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setName(selected?.name ?? '새 배양 조건');
    setFields(selected?.fields ?? {});
  }, [selected]);
  async function save(copy = false) {
    setBusy(true);
    try {
      const p = await api<ProfileDto>(selected && !copy ? `/api/profiles/${selected.id}` : `/api/cell-lines/${lineId}/profiles`, {
        method: selected && !copy ? 'PUT' : 'POST',
        json: { name: copy ? `${name} 복제` : name, fields, ...(selected && !copy ? {} : { origin: 'manual' }) },
      });
      for (const f of CULTURE_FIELDS) if (f.catalog) invalidateCatalog(f.catalog);
      onChanged();
      onSelect(p.id);
      toast('배양 조건을 저장했습니다');
    } catch (e) {
      toast(String(e), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }
  async function action(kind: 'activate' | 'delete') {
    if (!selected) return;
    setBusy(true);
    try {
      await api(`/api/profiles/${selected.id}${kind === 'activate' ? '/activate' : ''}`, {
        method: kind === 'activate' ? 'POST' : 'DELETE',
      });
      onChanged();
    } catch (e) {
      toast(String(e), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-5 md:grid-cols-[220px_1fr]">
      <aside className="grid content-start gap-2">
        {profiles.map((p) => (
          <button
            key={p.id}
            className={`rounded-lg border p-3 text-left ${selected?.id === p.id ? 'border-accent bg-accent-soft' : 'border-line'}`}
            onClick={() => onSelect(p.id)}
          >
            {p.name}
            <div className="text-xs text-fg-muted">
              {p.isActive ? '활성 · ' : ''}
              {{ manual: '수동', literature: '문헌', provider: '분양처' }[p.origin]}
            </div>
          </button>
        ))}
      </aside>
      <div className="grid gap-4">
        <label className="grid gap-1 text-sm">
          조건 세트 이름
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          {CULTURE_FIELDS.filter((f) => f.inProfile).map((def) => {
            const v = fields[def.key];
            const refs = selected?.sourceRefs.filter((r) => r.field === def.key) ?? [];
            return (
              <label className="grid gap-1 text-sm" key={def.key}>
                <span>
                  {def.label} {def.unit && `(${def.unit})`}{' '}
                  {refs.length > 0 && (
                    <span tabIndex={0} aria-label="출처 근거" title={refs.map((r) => `${r.sourceLabel}\n${r.quote}`).join('\n\n')}>
                      ⓘ
                    </span>
                  )}
                </span>
                {def.type === 'list' && def.catalog ? (
                  <OptionMultiSelect
                    category={def.catalog}
                    value={Array.isArray(v) ? v : []}
                    onChange={(value) => setFields({ ...fields, [def.key]: value })}
                  />
                ) : def.catalog ? (
                  <OptionCombobox
                    category={def.catalog}
                    value={typeof v === 'string' ? v : ''}
                    onChange={(value) => setFields({ ...fields, [def.key]: value })}
                  />
                ) : (
                  <input
                    className={inputCls}
                    type={def.type === 'number' ? 'number' : 'text'}
                    step="any"
                    value={typeof v === 'number' || typeof v === 'string' ? v : ''}
                    onChange={(e) =>
                      setFields({
                        ...fields,
                        [def.key]: def.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value,
                      })
                    }
                  />
                )}
              </label>
            );
          })}
          <label className="grid gap-1 text-sm">
            배지 교체 경고 주기 (일)
            <input
              type="number"
              min="1"
              max="30"
              className={inputCls}
              value={fields.medium_change_days ?? ''}
              onChange={(e) => setFields({ ...fields, medium_change_days: e.target.value === '' ? null : Number(e.target.value) })}
            />
          </label>
        </div>
        <div className="rounded-lg bg-sunken p-3 text-sm">완전 배지: {completeMediumText(fields) || '미정'}</div>
        <div className="flex flex-wrap gap-2">
          <button className={primaryBtnCls} disabled={busy} onClick={() => save()}>
            저장
          </button>
          <button className={btnCls} disabled={busy || !selected || selected.isActive} onClick={() => action('activate')}>
            활성화
          </button>
          <button className={btnCls} disabled={busy || !selected} onClick={() => save(true)}>
            복제해서 새 세트
          </button>
          <button className={dangerBtnCls} disabled={busy || !selected || selected.isActive} onClick={() => action('delete')}>
            삭제
          </button>
        </div>
      </div>
    </div>
  );
}
