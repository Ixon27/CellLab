import { nanoid } from 'nanoid';
import { CULTURE_FIELDS } from '../../shared/culture';
import { htmlParagraphs, jatsParagraphs, selectEvidence } from '../../shared/evidence';
import type { LiteratureReport, ReportSource } from '../../shared/literature';
import type { MadeBy } from '../../shared/models';
import { validateCultureExtraction } from '../../shared/literature';
import { getLineRow } from '../cell-lines';
import { db, now, parseJsonColumn } from '../db';
import { HttpError } from '../http-error';
import { startJob } from '../jobs';
import { parseJsonLoose } from '../json';
import { resolveModel, runLlm } from '../llm/index';
import { fill, loadPrompt } from '../prompts';
import type { EpmcHit } from '../services/europepmc';
import { fetchFullTextXml } from '../services/europepmc';
import { getText } from '../services/http';
export interface LiteratureInput { papers: EpmcHit[]; providerUrl: string | null; providerText: string | null; query: string | null; bankFilter: string | null }
export function startLiterature(lineId: string, input: LiteratureInput): string {
  const line = getLineRow(lineId);
  if (!input || !Array.isArray(input.papers) || input.papers.length > 8) throw new HttpError(400, '논문은 최대 8개까지 선택할 수 있습니다');
  if (!input.papers.length && !input.providerUrl && !input.providerText) throw new HttpError(400, '분석할 논문이나 분양처 정보를 선택하세요');
  for (const p of input.papers) if (!p || !/^PMC\d+$/.test(p.pmcid) || typeof p.title !== 'string' || !p.title.trim() || p.title.length > 500 || typeof p.authors !== 'string' || (p.year !== null && !Number.isFinite(p.year)) || (p.journal !== null && typeof p.journal !== 'string')) throw new HttpError(400, '논문 정보가 올바르지 않습니다');
  if (input.providerUrl != null && (typeof input.providerUrl !== 'string' || !/^https?:\/\//i.test(input.providerUrl))) throw new HttpError(400, '분양처 주소는 http 또는 https 주소여야 합니다');
  if (input.providerText != null && (typeof input.providerText !== 'string' || input.providerText.length > 50000)) throw new HttpError(400, '분양처 내용은 50,000자 이하여야 합니다');
  if ((input.query != null && typeof input.query !== 'string') || (input.bankFilter != null && typeof input.bankFilter !== 'string')) throw new HttpError(400, '검색 조건이 올바르지 않습니다');
  return startJob(lineId, 'literature', async (ctx) => {
    const model = resolveModel('quick'); const templates = loadPrompt('culture-extract');
    const names = [line.name, ...parseJsonColumn<string[]>(line.synonyms, []).slice(0, 4)];
    const sources: ReportSource[] = [];
    if (input.providerUrl || input.providerText) sources.push({ key: 'S0', kind: 'provider', label: `${line.source_bank ?? '분양처'} ${line.catalog_no ?? ''}`.trim(), pmcid: null, url: input.providerUrl ?? '', year: null, status: 'ok', error: null, fields: null, evidence: {} });
    for (const [i, p] of input.papers.entries()) sources.push({ key: `S${i + 1}`, kind: 'paper', label: `${p.authors.split(',')[0] || '저자 미상'} et al. ${p.year ?? ''} · ${p.journal ?? ''}`, pmcid: p.pmcid, url: `https://europepmc.org/article/PMC/${p.pmcid}`, year: p.year, status: 'ok', error: null, fields: null, evidence: {} });
    let done = 0; let by: MadeBy | null = null;
    await Promise.all(sources.map(async (source) => {
      try {
        ctx.signal.throwIfAborted();
        let content: string | null;
        try { content = source.kind === 'provider' ? input.providerText || await getText(source.url) : await fetchFullTextXml(source.pmcid!); }
        catch { if (source.kind === 'paper') throw new Error('논문 전문을 불러오지 못했습니다'); content = null; }
        if (!content && source.kind === 'paper') { source.status = 'no_fulltext'; return; }
        const evidence = selectEvidence(source.kind === 'provider' ? htmlParagraphs(content ?? '') : jatsParagraphs(content ?? ''), source.kind === 'provider' ? [] : names, source.key, source.kind === 'provider' ? 8000 : 12000);
        if (source.kind === 'provider' && evidence.reduce((n, e) => n + e.text.length, 0) < 200) { source.status = 'fetch_failed'; source.error = '분양처 페이지를 읽지 못했습니다. 페이지 내용을 복사해 붙여넣어 주세요'; return; }
        if (!evidence.length) { source.status = 'no_evidence'; return; }
        const vars = { cell_line: line.name, synonyms: names.slice(1).join(', '), source_label: source.label, fields_spec: CULTURE_FIELDS.map((f) => `- ${f.key} (${f.label}, ${f.type}${f.unit ? `, ${f.unit}` : ''})`).join('\n'), evidence: evidence.map((e) => `[${e.id}] (${e.heading}) ${e.text}`).join('\n') };
        const system = fill(templates.SYSTEM, vars); const prompt = fill(templates.PROMPT, vars); const ids = new Set(evidence.map((e) => e.id));
        for (let attempt = 0; attempt < 2; attempt++) {
          const result = await runLlm({ system, prompt: prompt + (attempt ? '\n\n(설명 없이 JSON 객체 하나만 출력하라.)' : ''), profile: 'quick', model, signal: ctx.signal });
          try { source.fields = validateCultureExtraction(parseJsonLoose(result.text), ids); by ??= result.by; break; }
          catch { if (attempt) throw new Error('추출 결과 형식이 올바르지 않습니다'); }
        }
        const used = new Set(Object.values(source.fields!).flatMap((f) => f.evidenceIds));
        source.evidence = Object.fromEntries(evidence.filter((e) => used.has(e.id)).map((e) => [e.id, { heading: e.heading, text: e.text }]));
      } catch (error) { source.status = 'error'; source.error = error instanceof Error ? error.message : '자료 분석에 실패했습니다'; }
      finally { done++; if (!ctx.signal.aborted) ctx.progress(done / sources.length, `${done}/${sources.length} 자료 분석 완료`); }
    }));
    ctx.signal.throwIfAborted();
    const report: LiteratureReport = { version: 1, id: nanoid(12), cellLineId: lineId, createdAt: now(), by, query: input.query ?? null, bankFilter: input.bankFilter ?? null, sources };
    db.prepare('INSERT INTO literature_reports(id,cell_line_id,content,created_at) VALUES(?,?,?,?)').run(report.id, lineId, JSON.stringify(report), report.createdAt);
  }, null);
}
