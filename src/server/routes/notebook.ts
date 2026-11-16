import { Hono } from 'hono';
import { getLineRow } from '../cell-lines';
import { buildNotebookMarkdown, notebookFileName, notebookHtml, parseNotebookQuery } from '../notebook';

export const notebook = new Hono();

/** `GET /api/cell-lines/:id/notebook?format=md|html&from=YYYY-MM-DD&to=YYYY-MM-DD&cultureId=` — the records as a lab notebook file. */
notebook.get('/cell-lines/:id/notebook', (c) => {
  const id = c.req.param('id');
  const name = getLineRow(id).name;
  const query = parseNotebookQuery((key) => c.req.query(key));
  const exportedAt = new Date();
  const text = buildNotebookMarkdown(id, query, query.format === 'html', exportedAt);
  const fileName = notebookFileName(name, query, exportedAt);
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  return c.body(query.format === 'html' ? notebookHtml(text) : text, 200, {
    'Content-Type': query.format === 'html' ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8',
    'Content-Disposition': `attachment; filename="notebook.${query.format}"; filename*=UTF-8''${encoded}`,
    'Cache-Control': 'no-store',
  });
});
