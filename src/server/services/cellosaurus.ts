import type { CellosaurusHit, CellosaurusInfo } from '../../shared/cell-line';
import { HttpError } from '../http-error';
import { getJson } from './http';
type Entry = Record<string, unknown>;
function object(v: unknown): Entry { return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Entry : {}; }
function rows(v: unknown): Entry[] { return Array.isArray(v) ? v.map(object) : []; }
function text(v: unknown): string | null { return typeof v === 'string' ? v : null; }
function entries(raw: unknown): Entry[] {
  if (raw === null) return [];
  const list = object(object(raw).Cellosaurus)['cell-line-list'];
  if (!Array.isArray(list)) throw new Error('Cellosaurus 응답 형식이 올바르지 않습니다');
  return list.map(object);
}
export function normalizeCellosaurus(r: Record<string, unknown>): CellosaurusInfo {
  const names = rows(r['name-list']);
  return { ac: text(rows(r['accession-list']).find(x => x.type === 'primary')?.value) ?? '', name: text(names.find(x => x.type === 'identifier')?.value) ?? '', synonyms: names.filter(x => x.type === 'synonym').slice(0,10).flatMap(x => typeof x.value === 'string' ? [x.value] : []), species: text(rows(r['species-list'])[0]?.label), disease: text(rows(r['disease-list'])[0]?.label), tissue: text(object(rows(r['derived-from-site-list'])[0]?.site).value), category: text(r.category), sex: text(r.sex), doublingTime: rows(r['doubling-time-list']).map(x => text(x['doubling-time-value'])).filter(Boolean).join(' / ') || null, caution: rows(r['comment-list']).filter(x => x.category === 'Problematic cell line' || x.category === 'Caution').map(x => text(x.value)).filter(Boolean).join('\n') || null, providers: rows(r['xref-list']).filter(x => x.category === 'Cell line collections (Providers)' && typeof x.database === 'string' && typeof x.accession === 'string').map(x => ({database:String(x.database),accession:String(x.accession),url:text(x.url)})) };
}
export async function searchCellosaurus(q: string): Promise<CellosaurusHit[]> {
  q = q.trim();
  if (q.length < 2 || q.length > 80) throw new HttpError(400, '검색어는 2–80자여야 합니다');
  const url = `https://api.cellosaurus.org/search/cell-line?q=${encodeURIComponent(q)}&format=json&rows=10`;
  let result = entries(await getJson(`${url}&fields=ac,id,ox,ca`));
  if (result.some(r => !r['species-list'] || !r.category)) result = entries(await getJson(url));
  return result.map(normalizeCellosaurus).map(({ac,name,species,category}) => ({ac,name,species,category}));
}
export async function getCellosaurus(ac: string): Promise<CellosaurusInfo | null> {
  if (!/^CVCL_[A-Z0-9]{4}$/.test(ac)) throw new HttpError(400, 'Cellosaurus 등록번호가 올바르지 않습니다');
  const row = entries(await getJson(`https://api.cellosaurus.org/cell-line/${ac}?format=json`))[0];
  return row ? normalizeCellosaurus(row) : null;
}
