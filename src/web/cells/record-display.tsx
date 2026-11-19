import type { LogDto } from '../../shared/cell-line';
import { recordTitle } from './RecordActions';

export type RecordKind = 'observation' | 'feed' | 'passage' | 'freeze' | 'thaw' | 'discard' | 'harvest' | 'other';

/** The visual family of a record: operations first, then what the record type says. */
export function recordKind(log: LogDto): RecordKind {
  if (log.operation) return log.operation;
  if (log.feed || log.type === 'medium_change') return 'feed';
  if (log.type === 'observation') return 'observation';
  if (log.type === 'passage' || log.type === 'freeze' || log.type === 'harvest') return log.type;
  return 'other';
}

/** Colored type badge: 계대 · 동결 · 해동 · 배지 교체 · 관찰 … */
export function RecordBadge({ log }: { log: LogDto }) {
  return (
    <span className="cell-rec-badge" data-kind={recordKind(log)}>
      {recordTitle(log)}
    </span>
  );
}

/**
 * `11.18 (수)` and `15:00`; the year is added when the record is not from the current year. Stock dates carry no
 * meaningful hour, so callers there use the date part alone.
 */
export function recordDateParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = d.getFullYear() === new Date().getFullYear() ? '' : `${d.getFullYear()}.`;
  const weekday = d.toLocaleDateString('ko-KR', { weekday: 'short' });
  return { date: `${year}${pad(d.getMonth() + 1)}.${pad(d.getDate())} (${weekday})`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/** `11.18 (수) 15:00` */
export function formatRecordDate(iso: string): string {
  const { date, time } = recordDateParts(iso);
  return `${date} ${time}`;
}
