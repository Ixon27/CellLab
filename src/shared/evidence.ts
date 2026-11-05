export interface Paragraph {
  heading: string;
  text: string;
}
export interface EvidenceSentence {
  id: string;
  heading: string;
  text: string;
}
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (all, key: string) => {
    if (key[0] === '#') {
      const n = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
      return n <= 0x10ffff ? String.fromCodePoint(n) : all;
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[key.toLowerCase()] ?? all;
  });
}
function plain(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}
export function jatsParagraphs(xml: string): Paragraph[] {
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(xml)?.[1] ?? xml;
  const cleaned = body.replace(/<(table-wrap|fig|xref|supplementary-material)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  let heading = '';
  const result: Paragraph[] = [];
  for (const m of cleaned.matchAll(/<title>([\s\S]*?)<\/title>|<p[\s>][\s\S]*?<\/p>/g)) {
    if (m[1] !== undefined) heading = plain(m[1]);
    else {
      const text = plain(m[0]);
      if (text) result.push({ heading, text });
    }
  }
  return result;
}
export function htmlParagraphs(html: string): Paragraph[] {
  return html
    .replace(/<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/p>|<br\s*\/?\s*>|<\/li>|<\/div>|<\/tr>|<\/h\d>/gi, '\n')
    .split(/\r?\n/)
    .map(plain)
    .filter((text) => text.length >= 20)
    .map((text) => ({ heading: '', text }));
}
export function splitSentences(text: string): string[] {
  const result: string[] = [];
  for (const piece of text.split(/(?<=[.;])\s+(?=[A-Z(\d])/)) {
    if (piece.length < 15 && result.length) result[result.length - 1] += ` ${piece}`;
    else if (piece.trim()) result.push(piece.trim());
  }
  return result;
}
export const CULTURE_KEYWORDS =
  /medium|media\b|serum|FBS|FCS|DMEM|RPMI|MEM\b|glutamine|penicillin|streptomycin|antibiotic|passag|subcultur|split|trypsin|accutase|TrypLE|confluen|CO2|CO₂|°C|humidif|incubat|seeded|seeding|density|cryopreserv|DMSO|froze|frozen|coat|obtained from|purchased from/i;
export const METHODS_HEADING = /method|material|experimental|procedure|cell (culture|line)|culture/i;
export function selectEvidence(paragraphs: Paragraph[], names: string[], prefix: string, maxChars: number): EvidenceSentence[] {
  const escaped = names.filter(Boolean).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const name = escaped.length ? new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'i') : null;
  const candidates = paragraphs.flatMap((p) =>
    splitSentences(p.text).map((text) => ({
      heading: p.heading,
      text,
      priority:
        name?.test(p.text) && (CULTURE_KEYWORDS.test(text) || name.test(text))
          ? 1
          : (!name || METHODS_HEADING.test(p.heading)) && CULTURE_KEYWORDS.test(text)
            ? 2
            : 0,
    })),
  );
  const selected = new Set<string>();
  let size = 0;
  selection: for (const priority of [1, 2])
    for (const candidate of candidates) {
      if (candidate.priority !== priority || selected.has(candidate.text)) continue;
      if (size + candidate.text.length > maxChars) break selection;
      selected.add(candidate.text);
      size += candidate.text.length;
    }
  const result: EvidenceSentence[] = [];
  for (const candidate of candidates) {
    if (!selected.delete(candidate.text)) continue;
    result.push({ id: `${prefix}-${result.length + 1}`, heading: candidate.heading, text: candidate.text });
  }
  return result;
}
