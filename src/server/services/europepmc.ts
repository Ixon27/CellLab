import { getJson, getText } from './http';
export const BANK_ALIASES: Record<string, string[]> = {
  ATCC: ['ATCC', 'American Type Culture Collection'],
  KCLB: ['KCLB', 'Korean Cell Line Bank'],
  DSMZ: ['DSMZ'],
  ECACC: ['ECACC', 'European Collection of Authenticated Cell Cultures'],
  JCRB: ['JCRB'],
  'RIKEN BRC': ['RIKEN BRC', 'RIKEN BioResource'],
  CLS: ['CLS Cell Lines Service', 'Cytion'],
};
export function buildMethodsQuery(names: string[], bankAliases: string[] | null): string {
  const seen = new Set<string>();
  const unique = names
    .map((n) => n.replace(/"/g, '').trim())
    .filter((n) => {
      if (!n || seen.has(n.toLowerCase())) return false;
      seen.add(n.toLowerCase());
      return true;
    })
    .slice(0, 5);
  const group = (items: string[]) => `(${items.map((n) => `METHODS:"${n.replace(/"/g, '')}"`).join(' OR ')})`;
  return `${group(unique)}${bankAliases?.length ? ` AND ${group(bankAliases)}` : ''} AND OPEN_ACCESS:y AND HAS_FT:y`;
}
export interface EpmcHit {
  pmcid: string;
  pmid: string | null;
  title: string;
  authors: string;
  journal: string | null;
  year: number | null;
  cited: number;
}
export async function searchMethods(query: string, pageSize = 25): Promise<{ hitCount: number; hits: EpmcHit[] }> {
  const params = new URLSearchParams({ query, format: 'json', resultType: 'lite', pageSize: String(pageSize) });
  const data = await getJson<{
    hitCount: number;
    resultList?: {
      result?: {
        pmcid?: string;
        source: string;
        id: string;
        title: string;
        authorString?: string;
        journalTitle?: string;
        pubYear?: string;
        citedByCount?: number;
      }[];
    };
  }>(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?${params}`);
  if (!data) throw new Error('Europe PMC 검색 결과가 없습니다');
  return {
    hitCount: data.hitCount,
    hits: (data.resultList?.result ?? [])
      .filter((r) => r.pmcid)
      .map((r) => ({
        pmcid: r.pmcid!,
        pmid: r.source === 'MED' ? r.id : null,
        title: r.title,
        authors: r.authorString ?? '',
        journal: r.journalTitle ?? null,
        year: r.pubYear && Number.isFinite(Number(r.pubYear)) ? Number(r.pubYear) : null,
        cited: Number(r.citedByCount ?? 0),
      })),
  };
}
export async function fetchFullTextXml(pmcid: string): Promise<string | null> {
  return getText(`https://www.ebi.ac.uk/europepmc/webservices/rest/${pmcid}/fullTextXML`);
}
