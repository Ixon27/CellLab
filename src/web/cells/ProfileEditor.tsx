import { useEffect, useState } from 'react';
import type { ProfileDto, SourceRef } from '../../shared/cell-line';
import type { CultureExecutionPlan } from '../../shared/culture-plan';
import { validateExecutionPlan } from '../../shared/culture-plan';
import { ExecutionPlanEditor } from './ExecutionPlanEditor';
import { CULTURE_FIELDS, completeMediumText, normalizeFieldValue } from '../../shared/culture';
import { isAdoptedRef } from '../../shared/literature-adoption';
import { SourceRefDetails } from './SourceRefDetails';
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
  const [executionPlan, setExecutionPlan] = useState<CultureExecutionPlan | null>(null);
  const [sourceRefs, setSourceRefs] = useState<SourceRef[]>([]);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setName(selected?.name ?? '새 배양 조건');
    setFields(selected?.fields ?? {});
    setExecutionPlan(selected?.executionPlan ?? null);
    setSourceRefs(selected?.sourceRefs ?? []);
  }, [selected]);
  // 저장된 값에서 바뀐 항목에 붙은 문헌 근거는 더 이상 그 값의 근거가 아니므로 저장할 때 제거한다.
  const isStale = (ref: SourceRef) =>
    isAdoptedRef(ref) && normalizeFieldValue(fields[ref.field] ?? null) !== normalizeFieldValue(selected?.fields[ref.field] ?? null);
  async function save(copy = false) {
    setBusy(true);
    try {
      const plan = executionPlan ? validateExecutionPlan({
        ...executionPlan,
        steps: Object.fromEntries(Object.entries(executionPlan.steps).map(([stage, step]) => [stage, {
          ...step, recordLabels: step.recordLabels.map((label) => label.trim()).filter(Boolean),
        }])),
      }) : null;
      const p = await api<ProfileDto>(selected && !copy ? `/api/profiles/${selected.id}` : `/api/cell-lines/${lineId}/profiles`, {
        method: selected && !copy ? 'PUT' : 'POST',
        json: { name: copy ? `${name} 복제` : name, fields, sourceRefs: sourceRefs.filter((r) => !isStale(r)), executionPlan: plan, ...(selected && !copy ? {} : { origin: selected?.origin ?? 'manual' }) },
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
            const refs = sourceRefs.filter((r) => r.field === def.key);
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
                {refs.filter((r) => r.reason).map((r, i) => (
                  <p key={i} className="text-xs text-fg-muted">
                    {isStale(r) ? '⚠ 값을 바꿨습니다. 아래 문헌 근거는 저장 시 제거됩니다 · ' : ''}채택 사유: {r.reason}
                  </p>
                ))}
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
        <details className="rounded-lg border border-line p-3">
          <summary className="cursor-pointer text-sm font-medium">기본 비교 항목의 출처 편집 ({sourceRefs.length})</summary>
          <div className="mt-3 grid gap-3">
            {sourceRefs.map((ref, index) => isAdoptedRef(ref) ? <fieldset key={index} className="grid gap-2 rounded-lg bg-sunken p-3">
              <legend className="text-xs">문헌에서 채택한 근거 · {CULTURE_FIELDS.find((f) => f.key === ref.field)?.label}</legend>
              <SourceRefDetails sourceRef={ref} />
              {isStale(ref) && <p role="alert" className="text-xs text-warning">값을 바꿨으므로 이 문헌 근거는 저장할 때 제거됩니다.</p>}
              <label className="grid gap-1 text-sm">채택 사유 (필수)<textarea className={inputCls} rows={2} maxLength={2000} value={ref.reason ?? ''} onChange={(e) => setSourceRefs(sourceRefs.map((r, i) => i === index ? { ...r, reason: e.target.value } : r))} /></label>
              <button className={dangerBtnCls} onClick={() => setSourceRefs(sourceRefs.filter((_, i) => i !== index))}>근거 제거</button>
            </fieldset> : <fieldset key={index} className="grid gap-2 rounded-lg bg-sunken p-3">
              <legend className="text-xs">항목 근거 {index + 1}</legend>
              <label className="grid gap-1 text-sm">비교 항목<select className={inputCls} value={ref.field} onChange={(e) => setSourceRefs(sourceRefs.map((r, i) => i === index ? { ...r, field: e.target.value as SourceRef['field'] } : r))}>{CULTURE_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select></label>
              {(['sourceLabel', 'url', 'quote'] as const).map((key) => <label key={key} className="grid gap-1 text-sm">{{ sourceLabel: '출처 이름', url: '원문 URL (없으면 빈칸)', quote: '근거 문장·사용자 제공 보고' }[key]}<textarea className={inputCls} rows={key === 'quote' ? 3 : 1} value={ref[key]} onChange={(e) => setSourceRefs(sourceRefs.map((r, i) => i === index ? { ...r, [key]: e.target.value } : r))} /></label>)}
              <label className="grid gap-1 text-sm">메모 (선택)<textarea className={inputCls} rows={2} maxLength={2000} value={ref.reason ?? ''} onChange={(e) => setSourceRefs(sourceRefs.map((r, i) => i === index ? { ...r, reason: e.target.value } : r))} /></label>
              <button className={dangerBtnCls} onClick={() => setSourceRefs(sourceRefs.filter((_, i) => i !== index))}>근거 제거</button>
            </fieldset>)}
            <button className={btnCls} disabled={sourceRefs.length >= 500} onClick={() => setSourceRefs([...sourceRefs, { field: 'base_medium', sourceLabel: '', url: '', quote: '' }])}>항목 근거 추가</button>
          </div>
        </details>
        <ExecutionPlanEditor value={executionPlan} onChange={setExecutionPlan} />
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
