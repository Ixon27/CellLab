import type { ReactNode } from 'react';
import type { CultureDto, ProfileDto } from '../../../shared/cell-line';
import type { PlanStage } from '../../../shared/culture-plan';
import { Field, inputCls } from '../../components/Dialog';
import { CulturePlanGuide } from '../CulturePlanGuide';
import { executionProfile, executionSnapshot } from '../culture-plan-state';

/** `YYYY-MM-DDTHH:mm` in local time, the value format of datetime-local inputs. */
export function localInput(value: Date | string | number = Date.now()): string {
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
/** ISO time for a datetime-local value; throws a Korean message when it is empty or invalid. */
export function isoFromInput(value: string): string {
  const time = Date.parse(value);
  if (!value || !Number.isFinite(time)) throw new Error('일시를 확인하세요');
  return new Date(time).toISOString();
}
/** Blank → null, otherwise the number (NaN is rejected so a typo never becomes a silent null). */
export function optionalNumber(value: string, label: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${label}을(를) 숫자로 입력하세요`);
  return n;
}
/** Short readable number for derived inputs. */
export function plainNumber(n: number): string {
  return Number.isFinite(n) ? String(Number(n.toPrecision(6))) : '';
}

/** The user-entered actual values of the plan's record labels, with the condition snapshot, merged into the log note. */
export function composeOperationNote(
  note: string,
  profile: ProfileDto | null,
  stage: PlanStage,
  records: Record<string, string>,
): string {
  const labels = profile?.executionPlan?.steps[stage].recordLabels ?? [];
  const recorded = Object.entries(records)
    .filter(([key, value]) => labels.includes(key) && value.trim())
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
  const composed = [note, recorded].filter(Boolean).join('\n') + executionSnapshot(profile, stage);
  if (composed.length > 10000) throw new Error('기록과 조건 스냅샷이 메모 한도(10,000자)를 넘습니다. 조건 설명을 간결하게 정리하세요.');
  return composed;
}

/** Plan guidance and the plan's own "record these actual values" inputs for one stage. */
export function PlanRecordSection({
  profiles,
  culture,
  profile: explicit,
  stage,
  lineId,
  records,
  onRecords,
  showFields = true,
}: {
  profiles: ProfileDto[];
  culture?: CultureDto;
  /** When given, replaces the profile resolved from the culture. */
  profile?: ProfileDto | null;
  stage: PlanStage;
  lineId: string;
  records: Record<string, string>;
  onRecords(next: Record<string, string>): void;
  showFields?: boolean;
}) {
  const context = executionProfile(profiles, culture);
  const profile = explicit === undefined ? context.profile : explicit;
  const labels = profile?.executionPlan?.steps[stage].recordLabels ?? [];
  return (
    <>
      <CulturePlanGuide profile={profile} fallback={!!culture && context.fallback} stage={stage} lineId={lineId} />
      {showFields &&
        labels.map((label) => (
          <Field key={label} label={`${label} (실제 수행값)`}>
            <input className={inputCls} value={records[label] ?? ''} onChange={(e) => onRecords({ ...records, [label]: e.target.value })} />
          </Field>
        ))}
    </>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="mb-3 text-sm text-danger">
      {children}
    </p>
  );
}

/** Two-column grid used by the numeric inputs of the operation forms. */
export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="mb-1 grid grid-cols-2 gap-3">{children}</div>;
}
