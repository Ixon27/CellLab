import { useState } from 'react';
import { CULTURE_FIELDS, normalizeFieldValue } from '../../shared/culture';
import type { CultureFieldKey, CultureFieldValue, CultureProfileFields } from '../../shared/culture';
import type { ProfileDto, SourceRef } from '../../shared/cell-line';
import { consensus } from '../../shared/literature';
import type { LiteratureReport, ReportSource, SourceStatus } from '../../shared/literature';
import { api } from '../api';
import { inputCls, primaryBtnCls } from '../components/Dialog';
import { OptionCombobox, OptionMultiSelect } from '../components/OptionCombobox';
import { useToast } from '../components/Toast';
import { invalidateCatalog } from '../state/catalog';
export const SOURCE_STATUS_LABELS: Record<SourceStatus, string> = { ok: '분석 완료', no_fulltext: '전문 없음', no_evidence: '배양 근거 없음', fetch_failed: '페이지 읽기 실패', error: '분석 실패' };
export function ComparisonTable({ report, onProfileCreated }: { report: LiteratureReport; onProfileCreated(id: string): void }) {
  const [selected, setSelected] = useState<Partial<Record<CultureFieldKey, string>>>({});
  const [manual, setManual] = useState<CultureProfileFields>({}); const [saving, setSaving] = useState(false); const toast = useToast();
  const [popover, setPopover] = useState<{ source: ReportSource; key: CultureFieldKey } | null>(null);
  async function createProfile() {
    setSaving(true);
    try {
      const fields: CultureProfileFields = {}; const sourceRefs: SourceRef[] = []; const usedSources: ReportSource[] = [];
      for (const def of CULTURE_FIELDS.filter((f) => f.inProfile)) {
        const agreed = consensus(report.sources, def.key); const choice = selected[def.key] ?? (agreed ? 'consensus' : 'manual');
        const source = choice === 'consensus' ? report.sources.find((s) => s.status === 'ok' && normalizeFieldValue(s.fields?.[def.key]?.value ?? null) === normalizeFieldValue(agreed?.value ?? null)) : report.sources.find((s) => s.key === choice);
        fields[def.key] = choice === 'manual' ? manual[def.key] ?? null : source?.fields?.[def.key]?.value ?? null;
        if (source && fields[def.key] !== null) {
          usedSources.push(source);
          sourceRefs.push({ field: def.key, sourceLabel: source.label, url: source.url, quote: (source.fields?.[def.key]?.evidenceIds ?? []).map((id) => source.evidence[id]?.text).filter(Boolean).join(' … ') });
        }
      }
      const providerOnly = usedSources.length > 0 && usedSources.every((s) => s.kind === 'provider');
      const profile = await api<ProfileDto>(`/api/cell-lines/${report.cellLineId}/profiles`, { method: 'POST', json: { name: `${providerOnly ? '분양처' : '문헌'} 기반 ${new Date().toISOString().slice(0, 10)}`, origin: usedSources.filter((s) => s.kind === 'provider').length > usedSources.length / 2 ? 'provider' : 'literature', fields, sourceRefs, activate: false } });
      for (const def of CULTURE_FIELDS) if (def.catalog && fields[def.key] != null) invalidateCatalog(def.catalog);
      onProfileCreated(profile.id);
    } catch (e) { toast(e instanceof Error ? e.message : '배양 조건 생성에 실패했습니다', { tone: 'error' }); }
    finally { setSaving(false); }
  }
  const display = (value: CultureFieldValue | undefined) => value == null ? '—' : Array.isArray(value) ? value.join(', ') : String(value);
  return <div className="space-y-4">
    <div className="overflow-x-auto rounded-xl border border-line"><table className="w-full text-sm"><thead><tr className="bg-sunken"><th className="p-3 text-left">항목</th><th className="p-3 min-w-44">합의값</th>{report.sources.map((s) => <th key={s.key} className={`p-3 min-w-56 ${s.status !== 'ok' ? 'text-fg-dim bg-sunken' : ''}`}><div>{s.label}</div><div className="text-xs font-normal">{SOURCE_STATUS_LABELS[s.status]}</div>{s.status !== 'ok' && <p className="text-xs font-normal">{s.error ?? SOURCE_STATUS_LABELS[s.status]}</p>}</th>)}<th className="p-3 min-w-56">직접 입력</th></tr></thead>
      <tbody>{CULTURE_FIELDS.map((def) => {
        const agreed = consensus(report.sources, def.key); const choice = selected[def.key] ?? (agreed ? 'consensus' : 'manual');
        const radio = (value: string, disabled = false) => def.inProfile && <input aria-label={`${def.label}: ${value === 'consensus' ? '합의값' : value === 'manual' ? '직접 입력' : report.sources.find((s) => s.key === value)?.label}`} type="radio" name={`${report.id}-${def.key}`} checked={choice === value} disabled={disabled} onChange={() => setSelected({ ...selected, [def.key]: value })} className="mr-2" />;
        return <tr key={def.key} className="border-t border-line align-top"><th className="p-3 text-left whitespace-nowrap">{def.label}{def.unit && <span className="text-fg-muted"> ({def.unit})</span>}</th><td className="p-3">{radio('consensus', !agreed)}{display(agreed?.value)}{agreed && <span className="ml-2 text-xs text-fg-muted">{agreed.count}/{agreed.total}</span>}</td>
          {report.sources.map((source) => { const field = source.fields?.[def.key]; return <td key={source.key} className={`p-3 ${source.status !== 'ok' || field?.rejected ? 'bg-sunken text-fg-dim' : ''}`}>{radio(source.key, source.status !== 'ok' || !field || field.value === null)}{field?.rejected ? '근거 불충분으로 제외' : display(field?.value)}{!!field?.evidenceIds.length && <button className="ml-2 rounded bg-accent-soft px-1 text-xs text-accent" onClick={() => setPopover({ source, key: def.key })}>근거 {field.evidenceIds.length}</button>}</td>; })}
          <td className="p-3">{def.inProfile ? <>{radio('manual')}{def.type === 'list' && def.catalog ? <OptionMultiSelect category={def.catalog} value={Array.isArray(manual[def.key]) ? manual[def.key] as string[] : []} onChange={(v) => setManual({ ...manual, [def.key]: v })} /> : def.catalog ? <OptionCombobox category={def.catalog} value={typeof manual[def.key] === 'string' ? manual[def.key] as string : ''} onChange={(v) => setManual({ ...manual, [def.key]: v })} /> : <input aria-label={`${def.label} 직접 입력`} className={inputCls} type={def.type === 'number' ? 'number' : 'text'} value={manual[def.key] as string | number ?? ''} onChange={(e) => setManual({ ...manual, [def.key]: def.type === 'number' ? e.target.value === '' ? null : Number(e.target.value) : e.target.value })} />}</> : '표시 전용'}</td></tr>;
      })}</tbody></table></div>
    <button className={primaryBtnCls} disabled={saving} onClick={() => void createProfile()}>{saving ? '생성 중…' : '이 선택으로 배양 조건 세트 만들기'}</button>
    {popover && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6" onClick={() => setPopover(null)}><section role="dialog" aria-modal="true" aria-label="원문 근거" className="max-h-[75vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-line bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}><div className="flex justify-between"><h3 className="font-semibold">{popover.source.label}</h3><button onClick={() => setPopover(null)}>닫기</button></div>{popover.source.fields?.[popover.key]?.evidenceIds.map((id) => <blockquote key={id} className="my-4 border-l-2 border-accent pl-3"><p className="mb-1 text-xs text-fg-muted">{popover.source.evidence[id]?.heading}</p><p>{popover.source.evidence[id]?.text}</p></blockquote>)}{popover.source.url && <a className="text-accent" href={popover.source.url} target="_blank" rel="noreferrer">원문 열기</a>}</section></div>}
  </div>;
}
