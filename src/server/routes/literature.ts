import { Hono } from 'hono';
import { parseLiteratureReport } from '../../shared/literature';
import { getLineRow } from '../cell-lines';
import { db, parseJsonColumn } from '../db';
import { HttpError } from '../http-error';
import { BANK_ALIASES, buildMethodsQuery, searchMethods } from '../services/europepmc';
import { startLiterature } from '../tasks/literature';
import type { LiteratureInput } from '../tasks/literature';
export const literature = new Hono();
function getReport(id: string) {
  const row = db.prepare('SELECT content FROM literature_reports WHERE id=?').get(id) as { content: string } | undefined;
  if (!row) throw new HttpError(404, '문헌 보고서를 찾을 수 없습니다');
  return parseLiteratureReport(row.content);
}
literature.get('/cell-lines/:id/literature/search', async (c) => {
  const line = getLineRow(c.req.param('id'));
  const bank = c.req.query('bank') === '1' && line.source_bank && BANK_ALIASES[line.source_bank] ? line.source_bank : null;
  const query = buildMethodsQuery(
    [line.name, ...parseJsonColumn<string[]>(line.synonyms, []).slice(0, 4)],
    bank ? BANK_ALIASES[bank] : null,
  );
  try {
    return c.json({ query, bankFilter: bank, ...(await searchMethods(query)) });
  } catch {
    throw new HttpError(502, 'Europe PMC 검색에 실패했습니다');
  }
});
literature.post('/cell-lines/:id/literature', async (c) =>
  c.json({ jobId: startLiterature(c.req.param('id'), await c.req.json<LiteratureInput>()) }),
);
literature.get('/cell-lines/:id/literature', (c) => {
  const id = c.req.param('id');
  getLineRow(id);
  const rows = db.prepare('SELECT content FROM literature_reports WHERE cell_line_id=? ORDER BY created_at DESC').all(id) as unknown as {
    content: string;
  }[];
  return c.json(
    rows.map((r) => {
      const report = parseLiteratureReport(r.content);
      return {
        id: report.id,
        createdAt: report.createdAt,
        sourceCount: report.sources.length,
        okCount: report.sources.filter((s) => s.status === 'ok').length,
      };
    }),
  );
});
literature.get('/literature/:reportId', (c) => c.json(getReport(c.req.param('reportId'))));
literature.delete('/literature/:reportId', (c) => {
  const report = getReport(c.req.param('reportId'));
  db.prepare('DELETE FROM literature_reports WHERE id=?').run(report.id);
  return c.json({ ok: true });
});
