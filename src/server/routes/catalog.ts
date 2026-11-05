import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { isCatalogCategory } from '../../shared/catalog';
import { findOption, toOption, type CatalogRow } from '../catalog';
import { db, now } from '../db';
import { HttpError } from '../http-error';

export const catalog = new Hono();

function cleanLabel(raw: unknown): string {
  const label = typeof raw === 'string' ? raw.trim() : '';
  if (!label || label.length > 120) throw new HttpError(400, '항목 이름은 1–120자여야 합니다');
  return label;
}

function getRow(id: string): CatalogRow {
  const row = db.prepare('SELECT * FROM catalog_options WHERE id=?').get(id) as CatalogRow | undefined;
  if (!row) throw new HttpError(404, '항목을 찾을 수 없습니다');
  return row;
}

catalog.get('/catalog', (c) => {
  const category = c.req.query('category');
  const all = c.req.query('all') === '1';
  if (category !== undefined && !isCatalogCategory(category)) throw new HttpError(400, '알 수 없는 분류입니다');
  const where = [category ? 'category=?' : null, all ? null : 'hidden=0'].filter(Boolean).join(' AND ');
  const rows = db
    .prepare(`SELECT * FROM catalog_options ${where ? `WHERE ${where}` : ''} ORDER BY category, builtin DESC, sort, label`)
    .all(...(category ? [category] : [])) as unknown as CatalogRow[];
  return c.json(rows.map(toOption));
});

catalog.post('/catalog', async (c) => {
  const body = (await c.req.json()) as { category?: unknown; label?: unknown };
  if (!isCatalogCategory(body.category)) throw new HttpError(400, '알 수 없는 분류입니다');
  const label = cleanLabel(body.label);
  const existing = findOption(body.category, label);
  if (existing) return c.json(toOption(existing));
  const id = nanoid(12);
  db.prepare('INSERT INTO catalog_options(id,category,label,builtin,hidden,sort,created_at) VALUES(?,?,?,0,0,0,?)').run(id, body.category, label, now());
  return c.json(toOption(getRow(id)), 201);
});

catalog.put('/catalog/:id', async (c) => {
  const row = getRow(c.req.param('id'));
  const body = (await c.req.json()) as { hidden?: unknown; label?: unknown };
  if (body.label !== undefined) {
    if (row.builtin) throw new HttpError(400, '기본 항목은 이름을 바꿀 수 없습니다');
    const label = cleanLabel(body.label);
    const clash = findOption(row.category, label);
    if (clash && clash.id !== row.id) throw new HttpError(400, '같은 이름의 항목이 이미 있습니다');
    db.prepare('UPDATE catalog_options SET label=? WHERE id=?').run(label, row.id);
  }
  if (body.hidden !== undefined) {
    if (typeof body.hidden !== 'boolean') throw new HttpError(400, '숨김 값이 올바르지 않습니다');
    db.prepare('UPDATE catalog_options SET hidden=? WHERE id=?').run(body.hidden ? 1 : 0, row.id);
  }
  return c.json(toOption(getRow(row.id)));
});

catalog.delete('/catalog/:id', (c) => {
  const row = getRow(c.req.param('id'));
  if (row.builtin) throw new HttpError(400, '기본 항목은 숨기기만 할 수 있습니다');
  db.prepare('DELETE FROM catalog_options WHERE id=?').run(row.id);
  return c.json({ ok: true });
});
