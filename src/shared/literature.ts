import type { MadeBy } from './models';
import { CULTURE_FIELDS, normalizeFieldValue } from './culture';
import type { CultureFieldKey, CultureFieldValue } from './culture';
export interface ExtractedField { value: CultureFieldValue; evidenceIds: string[]; rejected: boolean }
export type SourceStatus = 'ok' | 'no_fulltext' | 'no_evidence' | 'fetch_failed' | 'error';
export interface ReportSource { key: string; kind: 'paper' | 'provider'; label: string; pmcid: string | null; url: string; year: number | null; status: SourceStatus; error: string | null; fields: Record<CultureFieldKey, ExtractedField> | null; evidence: Record<string, { heading: string; text: string }> }
export interface LiteratureReport { version: 1; id: string; cellLineId: string; createdAt: string; by: MadeBy | null; query: string | null; bankFilter: string | null; sources: ReportSource[] }
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export function validateCultureExtraction(raw: unknown, evidenceIds: ReadonlySet<string>): Record<CultureFieldKey, ExtractedField> {
  if (!isObject(raw) || !isObject(raw.fields)) throw new Error('추출 결과 형식이 올바르지 않습니다');
  const out = {} as Record<CultureFieldKey, ExtractedField>;
  for (const def of CULTURE_FIELDS) {
    const item = raw.fields[def.key]; let value: CultureFieldValue = null; let rejected = false; let ids: string[] = [];
    if (item !== undefined && item !== null) {
      if (!isObject(item)) rejected = true;
      else {
        const v = item.value;
        if (v !== null && v !== undefined) {
          if (def.type === 'text' && typeof v === 'string' && v.length <= 200) value = v.trim() || null;
          else if (def.type === 'number' && (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(Number(v))) value = Number(v);
          else if (def.type === 'list' && Array.isArray(v) && v.length <= 20 && v.every((x) => typeof x === 'string' && x.length <= 120)) value = v;
          else rejected = true;
        }
        ids = Array.isArray(item.evidence) ? [...new Set(item.evidence.filter((id): id is string => typeof id === 'string' && evidenceIds.has(id)))] : [];
        if (value !== null && !ids.length) { value = null; rejected = true; }
      }
    }
    out[def.key] = { value, evidenceIds: ids, rejected };
  }
  return out;
}
export function parseLiteratureReport(raw: unknown): LiteratureReport {
  const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!isObject(value) || value.version !== 1 || typeof value.id !== 'string' || typeof value.cellLineId !== 'string' || typeof value.createdAt !== 'string' || !Array.isArray(value.sources)) throw new Error('문헌 보고서 형식이 올바르지 않습니다');
  for (const s of value.sources) {
    if (!isObject(s) || typeof s.key !== 'string' || !['paper', 'provider'].includes(String(s.kind)) || typeof s.label !== 'string' || typeof s.url !== 'string' || !['ok', 'no_fulltext', 'no_evidence', 'fetch_failed', 'error'].includes(String(s.status)) || !isObject(s.evidence) || (s.fields !== null && !isObject(s.fields))) throw new Error('문헌 보고서 자료 형식이 올바르지 않습니다');
  }
  return value as unknown as LiteratureReport;
}
export function consensus(sources: ReportSource[], key: CultureFieldKey): { value: CultureFieldValue; count: number; total: number } | null {
  const counts = new Map<string, { value: CultureFieldValue; count: number }>(); let total = 0;
  for (const source of sources) {
    const value = source.fields?.[key]?.value ?? null;
    if (source.status !== 'ok' || value === null) continue;
    const normalized = normalizeFieldValue(value); if (normalized === null) continue;
    total++; const entry = counts.get(normalized); if (entry) entry.count++; else counts.set(normalized, { value, count: 1 });
  }
  let best: { value: CultureFieldValue; count: number } | null = null;
  for (const entry of counts.values()) if (!best || entry.count > best.count) best = entry;
  return best ? { ...best, total } : null;
}
