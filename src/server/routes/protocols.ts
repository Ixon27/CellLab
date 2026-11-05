import { extname, basename } from 'node:path';
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { fillSop } from '../../shared/sop';
import type { CultureProfileFields } from '../../shared/culture';
import { activeProfileRow, getLineRow } from '../cell-lines';
import { db, now, parseJsonColumn, tx } from '../db';
import { HttpError } from '../http-error';
import { docxToMarkdown } from '../protocol-import';

const CATEGORIES = ['culture_sop', 'western', 'bradford', 'protein', 'other'] as const;
type Category = typeof CATEGORIES[number];
interface ProtocolRow {
  id: string; title: string; category: Category; version: string; status: 'draft' | 'confirmed';
  body_md: string; source_file: string | null; builtin: number; created_at: string; updated_at: string;
}
interface RevisionRow { id: string; protocol_id: string; version: string; body_md: string; saved_at: string }

export const protocols = new Hono();

function category(raw: unknown): Category {
  if (typeof raw !== 'string' || !CATEGORIES.includes(raw as Category)) throw new HttpError(400, '프로토콜 분류가 올바르지 않습니다');
  return raw as Category;
}

function text(raw: unknown, label: string, max: number, required = false): string {
  if (typeof raw !== 'string' || raw.length > max || (required && !raw.trim())) throw new HttpError(400, `${label} 형식이 올바르지 않습니다`);
  return raw;
}

function status(raw: unknown): ProtocolRow['status'] {
  if (raw !== 'draft' && raw !== 'confirmed') throw new HttpError(400, '프로토콜 상태가 올바르지 않습니다');
  return raw;
}

function getProtocol(id: string): ProtocolRow {
  const row = db.prepare('SELECT * FROM protocols WHERE id=?').get(id) as ProtocolRow | undefined;
  if (!row) throw new HttpError(404, '프로토콜을 찾을 수 없습니다');
  return row;
}

function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, '프로토콜 입력 형식이 올바르지 않습니다');
  return raw as Record<string, unknown>;
}

function insertProtocol(input: { title: string; category: Category; version: string; status: ProtocolRow['status']; bodyMd: string; sourceFile?: string }): ProtocolRow {
  const id = nanoid(12);
  const at = now();
  db.prepare('INSERT INTO protocols(id,title,category,version,status,body_md,source_file,builtin,created_at,updated_at) VALUES(?,?,?,?,?,?,?,0,?,?)')
    .run(id, input.title, input.category, input.version, input.status, input.bodyMd, input.sourceFile ?? null, at, at);
  return getProtocol(id);
}

protocols.get('/protocols', (c) => {
  const filter = c.req.query('category');
  const rows = db.prepare(`SELECT id,title,category,version,status,builtin,updated_at FROM protocols ${filter === undefined ? '' : 'WHERE category=?'} ORDER BY updated_at DESC, title`)
    .all(...(filter === undefined ? [] : [category(filter)]));
  return c.json(rows);
});

// Register the static import route before parameter routes.
protocols.post('/protocols/import', async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) throw new HttpError(400, '가져올 파일을 선택하세요');
  const kind = category(body.category);
  const ext = extname(file.name).toLowerCase();
  if (!['.docx', '.md', '.txt'].includes(ext)) throw new HttpError(400, 'docx, md, txt 파일만 가져올 수 있습니다');
  if (file.size > 10 * 1024 * 1024) throw new HttpError(400, '파일은 10 MB 이하여야 합니다');
  let bodyMd: string;
  try {
    bodyMd = ext === '.docx' ? await docxToMarkdown(Buffer.from(await file.arrayBuffer())) : await file.text();
  } catch {
    throw new HttpError(400, '파일을 읽지 못했습니다. 올바른 문서인지 확인하세요');
  }
  return c.json(insertProtocol({ title: basename(file.name, extname(file.name)), category: kind, version: '', status: 'draft', bodyMd, sourceFile: file.name }), 201);
});

protocols.post('/protocols', async (c) => {
  const body = object(await c.req.json());
  return c.json(insertProtocol({
    title: text(body.title, '제목', 200, true).trim(), category: category(body.category),
    version: body.version === undefined ? '' : text(body.version, '버전', 120),
    status: body.status === undefined ? 'draft' : status(body.status),
    bodyMd: text(body.bodyMd, '본문', 10 * 1024 * 1024),
  }), 201);
});

protocols.get('/protocols/:id', (c) => c.json(getProtocol(c.req.param('id'))));

protocols.put('/protocols/:id', async (c) => {
  const row = getProtocol(c.req.param('id'));
  const body = object(await c.req.json());
  const title = body.title === undefined ? row.title : text(body.title, '제목', 200, true).trim();
  const version = body.version === undefined ? row.version : text(body.version, '버전', 120);
  const nextStatus = body.status === undefined ? row.status : status(body.status);
  const bodyMd = body.bodyMd === undefined ? row.body_md : text(body.bodyMd, '본문', 10 * 1024 * 1024);
  tx(() => {
    if (bodyMd !== row.body_md) db.prepare('INSERT INTO protocol_revisions(id,protocol_id,version,body_md,saved_at) VALUES(?,?,?,?,?)').run(nanoid(12), row.id, row.version, row.body_md, now());
    db.prepare('UPDATE protocols SET title=?,version=?,status=?,body_md=?,updated_at=? WHERE id=?').run(title, version, nextStatus, bodyMd, now(), row.id);
  });
  return c.json(getProtocol(row.id));
});

protocols.delete('/protocols/:id', (c) => {
  const row = getProtocol(c.req.param('id'));
  if (row.builtin) throw new HttpError(400, '기본 프로토콜은 삭제할 수 없습니다');
  db.prepare('DELETE FROM protocols WHERE id=?').run(row.id);
  return c.json({ ok: true });
});

protocols.get('/protocols/:id/revisions', (c) => {
  const row = getProtocol(c.req.param('id'));
  return c.json(db.prepare('SELECT * FROM protocol_revisions WHERE protocol_id=? ORDER BY saved_at DESC, rowid DESC').all(row.id));
});

protocols.post('/protocols/:id/revisions/:revId/restore', (c) => {
  const row = getProtocol(c.req.param('id'));
  const revision = db.prepare('SELECT * FROM protocol_revisions WHERE id=? AND protocol_id=?').get(c.req.param('revId'), row.id) as RevisionRow | undefined;
  if (!revision) throw new HttpError(404, '이전 버전을 찾을 수 없습니다');
  tx(() => {
    db.prepare('INSERT INTO protocol_revisions(id,protocol_id,version,body_md,saved_at) VALUES(?,?,?,?,?)').run(nanoid(12), row.id, row.version, row.body_md, now());
    db.prepare('UPDATE protocols SET body_md=?,version=?,updated_at=? WHERE id=?').run(revision.body_md, revision.version, now(), row.id);
  });
  return c.json(getProtocol(row.id));
});

protocols.get('/cell-lines/:id/sop', (c) => {
  const line = getLineRow(c.req.param('id'));
  const profile = activeProfileRow(line.id);
  const protocol = getProtocol(line.sop_protocol_id ?? (line.growth_mode === 'suspension' ? 'sop-suspension' : 'sop-adherent'));
  const fields = parseJsonColumn<CultureProfileFields>(profile?.fields, {});
  return c.json({ protocolId: protocol.id, title: protocol.title, markdown: fillSop(protocol.body_md, line, fields) });
});
