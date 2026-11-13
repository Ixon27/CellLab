import { useState } from 'react';
import { CULTURE_FIELDS } from '../../shared/culture';
import type { CultureFieldKey, CultureFieldValue, CultureProfileFields } from '../../shared/culture';
import type { ProfileDto } from '../../shared/cell-line';
import { buildAdoption, purposeMismatch } from '../../shared/literature-adoption';
import type { AdoptionError, FieldChoice } from '../../shared/literature-adoption';
import {
  FIELD_USAGE_LABELS,
  MEDIUM_PURPOSE_LABELS,
  fieldPurpose,
  fieldUsage,
  reportedValues,
  sourceContextOf,
} from '../../shared/literature';
import type { LiteratureReport, MediumPurpose, ReportSource, SourceStatus } from '../../shared/literature';
import { api } from '../api';
import { inputCls, primaryBtnCls } from '../components/Dialog';
import { OptionCombobox, OptionMultiSelect } from '../components/OptionCombobox';
import { useToast } from '../components/Toast';
import { invalidateCatalog } from '../state/catalog';
export const SOURCE_STATUS_LABELS: Record<SourceStatus, string> = {
  ok: '분석 완료',
  no_fulltext: '전문 없음',
  no_evidence: '배양 근거 없음',
  fetch_failed: '페이지 읽기 실패',
  error: '분석 실패',
};
const TARGET_CELL_LABELS = { target: '대상 세포 근거 확인', other: '다른 세포 기준', unknown: '대상 세포 미확인' } as const;
const SUPPLY_LABELS = { stated: '공급처 원문 명시', unknown: '공급처 미확인' } as const;
const display = (value: CultureFieldValue | undefined) => (value == null ? '—' : Array.isArray(value) ? value.join(', ') : String(value));
function PurposeBadge({ purpose, expected }: { purpose: MediumPurpose; expected: boolean }) {
  if (purpose !== 'unknown' && expected) return null;
  const tone = purpose === 'unknown' ? 'bg-sunken text-fg-muted' : 'bg-warning-soft text-warning';
  return <span className={`ml-1 rounded px-1 text-xs ${tone}`}>{MEDIUM_PURPOSE_LABELS[purpose]}</span>;
}
export function ComparisonTable({ report, onProfileCreated }: { report: LiteratureReport; onProfileCreated(id: string): void }) {
  // 어떤 항목도 자동으로 선택되지 않는다. 사용자가 라디오를 눌러야만 채택 대상이 된다.
  const [choices, setChoices] = useState<Partial<Record<CultureFieldKey, FieldChoice>>>({});
  const [manual, setManual] = useState<CultureProfileFields>({});
  const [errors, setErrors] = useState<Partial<Record<CultureFieldKey, string>>>({});
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const [popover, setPopover] = useState<{ title: string; source: ReportSource; ids: string[] } | null>(null);
  const choose = (key: CultureFieldKey, choice: FieldChoice | null) => {
    const next = { ...choices };
    if (choice) next[key] = choice;
    else delete next[key];
    setChoices(next);
    setErrors({ ...errors, [key]: undefined });
  };
  const chosenCount = Object.keys(choices).length;
  async function createProfile() {
    const adoption = buildAdoption(report, choices, manual);
    if (adoption.errors.length) {
      setErrors(Object.fromEntries(adoption.errors.map((e: AdoptionError) => [e.field, e.message])));
      toast('채택하려면 선택한 항목의 사유와 확인을 먼저 채워주세요', { tone: 'error' });
      return;
    }
    setSaving(true);
    try {
      const profile = await api<ProfileDto>(`/api/cell-lines/${report.cellLineId}/profiles`, {
        method: 'POST',
        json: {
          name: `${adoption.providerOnly ? '분양처' : '문헌'} 기반 ${new Date().toISOString().slice(0, 10)}`,
          origin: adoption.origin,
          fields: adoption.fields,
          sourceRefs: adoption.sourceRefs,
          activate: false,
        },
      });
      for (const def of CULTURE_FIELDS) if (def.catalog && adoption.fields[def.key] != null) invalidateCatalog(def.catalog);
      onProfileCreated(profile.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : '배양 조건 생성에 실패했습니다', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  }
  const evidenceButton = (title: string, source: ReportSource, ids: string[]) =>
    ids.length > 0 && (
      <button className="ml-2 rounded bg-accent-soft px-1 text-xs text-accent" onClick={() => setPopover({ title, source, ids })}>
        근거 {ids.length}
      </button>
    );
  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-sunken p-3 text-xs text-fg-muted">
        표의 값은 각 자료가 보고한 내용이며 정답이나 합의가 아닙니다. 단위가 다르면 같은 값으로 합치지 않습니다. 채택할 값은 직접 선택하고 사유를 적어야 하며,
        선택하지 않은 항목은 배양 조건에 들어가지 않습니다.
      </p>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-sunken">
              <th className="p-3 text-left">항목</th>
              <th className="p-3 min-w-44">문헌에서 보고된 값</th>
              {report.sources.map((s) => {
                const ctx = sourceContextOf(s);
                return (
                  <th key={s.key} className={`p-3 min-w-56 ${s.status !== 'ok' ? 'text-fg-dim bg-sunken' : ''}`}>
                    <div>{s.label}</div>
                    <div className="text-xs font-normal">{SOURCE_STATUS_LABELS[s.status]}</div>
                    {s.status !== 'ok' && <p className="text-xs font-normal">{s.error ?? SOURCE_STATUS_LABELS[s.status]}</p>}
                    {s.status === 'ok' && (
                      <div className="mt-1 space-y-0.5 text-xs font-normal text-fg-muted">
                        <div>
                          {TARGET_CELL_LABELS[ctx.targetCell.status]}
                          {evidenceButton('대상 세포 근거', s, ctx.targetCell.evidenceIds)}
                        </div>
                        <div>
                          {SUPPLY_LABELS[ctx.supplyOrigin.status]}
                          {evidenceButton('공급처 근거', s, ctx.supplyOrigin.evidenceIds)}
                        </div>
                      </div>
                    )}
                  </th>
                );
              })}
              <th className="p-3 min-w-56">직접 입력</th>
              <th className="p-3 min-w-64">채택 사유</th>
            </tr>
          </thead>
          <tbody>
            {CULTURE_FIELDS.map((def) => {
              const summary = reportedValues(report.sources, def.key);
              const choice = choices[def.key];
              const chosenSource = choice?.kind === 'source' ? report.sources.find((s) => s.key === choice.sourceKey) : undefined;
              const chosenPurpose = chosenSource ? fieldPurpose(chosenSource.fields?.[def.key]) : 'unknown';
              const radio = (value: string, disabled = false) =>
                def.inProfile && (
                  <input
                    aria-label={`${def.label}: ${value === 'manual' ? '직접 입력' : report.sources.find((s) => s.key === value)?.label}`}
                    type="radio"
                    name={`${report.id}-${def.key}`}
                    checked={value === 'manual' ? choice?.kind === 'manual' : choice?.kind === 'source' && choice.sourceKey === value}
                    disabled={disabled}
                    onChange={() =>
                      choose(
                        def.key,
                        value === 'manual'
                          ? { kind: 'manual' }
                          : { kind: 'source', sourceKey: value, reason: '', purposeConfirmed: false },
                      )
                    }
                    className="mr-2"
                  />
                );
              return (
                <tr key={def.key} className="border-t border-line align-top">
                  <th className="p-3 text-left whitespace-nowrap">
                    {def.label}
                    {def.unit && <span className="text-fg-muted"> ({def.unit})</span>}
                  </th>
                  <td className="p-3" data-testid={`reported-${def.key}`}>
                    {summary.groups.length === 0 ? (
                      <span className="text-fg-dim">보고된 값 없음</span>
                    ) : (
                      <ul className="space-y-1">
                        {summary.groups.map((g, i) => (
                          <li key={i}>
                            {display(g.value)}
                            <span className="ml-2 text-xs text-fg-muted">{g.count}편 보고</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {summary.explicitNotUsed.length > 0 && (
                      <div className="text-xs text-fg-muted">사용 안 함(원문 명시) {summary.explicitNotUsed.length}편</div>
                    )}
                    <div className="mt-1 text-xs text-fg-muted">
                      분석된 {summary.analyzed}편 중 {summary.reported}편 보고
                      {summary.reported === 1 && ' (단일 보고, 일치 여부 아님)'}
                      {summary.groups.length > 1 && ` · 서로 다른 값 ${summary.groups.length}가지`}
                    </div>
                  </td>
                  {report.sources.map((source) => {
                    const field = source.fields?.[def.key];
                    const usage = fieldUsage(field);
                    const purpose = fieldPurpose(field);
                    const selectable = source.status === 'ok' && !!field && !field.rejected && usage !== 'not_reported';
                    return (
                      <td key={source.key} className={`p-3 ${source.status !== 'ok' || field?.rejected ? 'bg-sunken text-fg-dim' : ''}`}>
                        {radio(source.key, !selectable)}
                        {field?.rejected ? (
                          '근거 불충분으로 제외'
                        ) : usage === 'explicit_not_used' ? (
                          <span>{FIELD_USAGE_LABELS.explicit_not_used}</span>
                        ) : usage === 'used' ? (
                          display(field?.value)
                        ) : source.status === 'ok' ? (
                          <span className="text-fg-dim">{FIELD_USAGE_LABELS.not_reported}</span>
                        ) : (
                          '—'
                        )}
                        {usage !== 'not_reported' && <PurposeBadge purpose={purpose} expected={!purposeMismatch(def.key, purpose)} />}
                        {!!field?.evidenceIds.length && evidenceButton(`${def.label} 근거`, source, field.evidenceIds)}
                      </td>
                    );
                  })}
                  <td className="p-3">
                    {def.inProfile ? (
                      <>
                        {radio('manual')}
                        {def.type === 'list' && def.catalog ? (
                          <OptionMultiSelect
                            category={def.catalog}
                            value={Array.isArray(manual[def.key]) ? (manual[def.key] as string[]) : []}
                            onChange={(v) => {
                              setManual({ ...manual, [def.key]: v });
                              if (v.length && choice?.kind !== 'manual') choose(def.key, { kind: 'manual' });
                            }}
                          />
                        ) : def.catalog ? (
                          <OptionCombobox
                            category={def.catalog}
                            value={typeof manual[def.key] === 'string' ? (manual[def.key] as string) : ''}
                            onChange={(v) => {
                              setManual({ ...manual, [def.key]: v });
                              if (v && choice?.kind !== 'manual') choose(def.key, { kind: 'manual' });
                            }}
                          />
                        ) : (
                          <input
                            aria-label={`${def.label} 직접 입력`}
                            className={inputCls}
                            type={def.type === 'number' ? 'number' : 'text'}
                            value={(manual[def.key] as string | number) ?? ''}
                            onChange={(e) => {
                              const v = def.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value;
                              setManual({ ...manual, [def.key]: v });
                              if (v !== null && v !== '' && choice?.kind !== 'manual') choose(def.key, { kind: 'manual' });
                            }}
                          />
                        )}
                      </>
                    ) : (
                      '표시 전용'
                    )}
                  </td>
                  <td className="p-3">
                    {choice && (
                      <div className="space-y-2">
                        {choice.kind === 'source' ? (
                          <>
                            <textarea
                              aria-label={`${def.label} 채택 사유`}
                              className={inputCls}
                              rows={2}
                              maxLength={2000}
                              placeholder="이 값을 채택하는 이유 (필수)"
                              value={choice.reason}
                              onChange={(e) => choose(def.key, { ...choice, reason: e.target.value })}
                            />
                            {chosenPurpose === 'unknown' && <p className="text-xs text-fg-muted">원문에서 쓰인 용도를 확인하지 못했습니다.</p>}
                            {purposeMismatch(def.key, chosenPurpose) && (
                              <label className="block text-xs text-warning">
                                <input
                                  type="checkbox"
                                  className="mr-1"
                                  checked={choice.purposeConfirmed}
                                  onChange={(e) => choose(def.key, { ...choice, purposeConfirmed: e.target.checked })}
                                />
                                원문 용도가 “{MEDIUM_PURPOSE_LABELS[chosenPurpose]}”입니다. 이 용도의 값을 일반 배양 조건에 쓰는 것이 맞음을 확인했습니다.
                              </label>
                            )}
                          </>
                        ) : (
                          <p className="text-xs text-fg-muted">직접 입력한 값입니다.</p>
                        )}
                        {errors[def.key] && (
                          <p role="alert" className="text-xs text-danger">
                            {errors[def.key]}
                          </p>
                        )}
                        <button className="text-xs text-fg-muted underline" onClick={() => choose(def.key, null)}>
                          선택 해제
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button className={primaryBtnCls} disabled={saving || chosenCount === 0} onClick={() => void createProfile()}>
        {saving ? '생성 중…' : `선택한 ${chosenCount}개 항목으로 배양 조건 세트 만들기`}
      </button>
      {chosenCount === 0 && <p className="text-xs text-fg-muted">채택할 값을 직접 선택하면 활성화됩니다. 자동으로 선택된 항목은 없습니다.</p>}
      {popover && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6" onClick={() => setPopover(null)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-label="원문 근거"
            className="max-h-[75vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-line bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between">
              <h3 className="font-semibold">
                {popover.source.label} · {popover.title}
              </h3>
              <button onClick={() => setPopover(null)}>닫기</button>
            </div>
            {popover.ids.map((id) => (
              <blockquote key={id} className="my-4 border-l-2 border-accent pl-3">
                <p className="mb-1 text-xs text-fg-muted">{popover.source.evidence[id]?.heading}</p>
                <p>{popover.source.evidence[id]?.text}</p>
              </blockquote>
            ))}
            {popover.source.url && (
              <a className="text-accent" href={popover.source.url} target="_blank" rel="noreferrer">
                원문 열기
              </a>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
