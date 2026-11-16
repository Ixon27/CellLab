import { extname, basename } from 'node:path';
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { previewSop } from '../../shared/sop';
import type { FilledSop } from '../../shared/sop';
import { protocolProvenance } from '../../shared/protocol';
import type { ProtocolProvenance } from '../../shared/protocol';
import type { CultureProfileFields } from '../../shared/culture';
import { isProtocolFolder } from '../../shared/protocol-run';
import type { CellProtocolDto, ProtocolFolder } from '../../shared/protocol-run';
import { activeProfileRow, getLineRow, toProfileDto } from '../cell-lines';
import type { CellLineRow } from '../cell-lines';
import { db, now, parseJsonColumn, tx } from '../db';
import { HttpError } from '../http-error';
import { docxToMarkdown } from '../protocol-import';

const CATEGORIES = ['culture_sop', 'western', 'bradford', 'protein', 'other'] as const;
type Category = (typeof CATEGORIES)[number];
interface ProtocolRow {
  id: string;
  title: string;
  category: Category;
  version: string;
  status: 'draft' | 'confirmed';
  body_md: string;
  source_file: string | null;
  builtin: number;
  created_at: string;
  updated_at: string;
}
interface RevisionRow {
  id: string;
  protocol_id: string;
  version: string;
  body_md: string;
  saved_at: string;
}

export const protocols = new Hono();

function category(raw: unknown): Category {
  if (typeof raw !== 'string' || !CATEGORIES.includes(raw as Category)) throw new HttpError(400, '프로토콜 분류가 올바르지 않습니다');
  return raw as Category;
}

function text(raw: unknown, label: string, max: number, required = false): string {
  if (typeof raw !== 'string' || raw.length > max || (required && !raw.trim()))
    throw new HttpError(400, `${label} 형식이 올바르지 않습니다`);
  return raw;
}

function status(raw: unknown): ProtocolRow['status'] {
  if (raw !== 'draft' && raw !== 'confirmed') throw new HttpError(400, '프로토콜 상태가 올바르지 않습니다');
  return raw;
}

interface CopyRow {
  source_protocol_id: string;
  source_title: string;
  source_version: string;
  source_provenance: string;
  cell_line_id: string | null;
}

function provenance(row: Pick<ProtocolRow, 'id' | 'source_file'>): ProtocolProvenance {
  const copy = db.prepare('SELECT * FROM protocol_copies WHERE protocol_id=?').get(row.id) as CopyRow | undefined;
  if (!copy) {
    const owner = db.prepare('SELECT cell_line_id FROM cell_protocols WHERE protocol_id=?').get(row.id) as { cell_line_id: string } | undefined;
    if (!owner) return protocolProvenance(row);
    return {
      kind: 'manual',
      label: '세포주 전용 문서',
      detail: '이 세포주의 프로토콜 폴더에서 직접 작성한 문서입니다. 별도의 외부 검증 출처가 등록되어 있지 않습니다.',
      cellLineId: owner.cell_line_id,
    };
  }
  const origin = parseJsonColumn<ProtocolProvenance>(copy.source_provenance, protocolProvenance(row));
  return {
    kind: 'cell_copy',
    label: '세포주용으로 분리한 사본',
    detail: `원본 출처: ${origin.label}. ${origin.detail} 사본 생성은 실험 조건의 검증을 뜻하지 않습니다.`,
    copiedFrom: { id: copy.source_protocol_id, title: copy.source_title, version: copy.source_version },
    cellLineId: copy.cell_line_id,
  };
}

type StoredProtocol = ProtocolRow & { provenance: ProtocolProvenance };
function getProtocol(id: string): StoredProtocol {
  const row = db.prepare('SELECT * FROM protocols WHERE id=?').get(id) as ProtocolRow | undefined;
  if (!row) throw new HttpError(404, '프로토콜을 찾을 수 없습니다');
  return { ...row, provenance: provenance(row) };
}

function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, '프로토콜 입력 형식이 올바르지 않습니다');
  return raw as Record<string, unknown>;
}

function insertProtocol(input: {
  title: string;
  category: Category;
  version: string;
  status: ProtocolRow['status'];
  bodyMd: string;
  sourceFile?: string;
}): ProtocolRow {
  const id = nanoid(12);
  const at = now();
  db.prepare(
    'INSERT INTO protocols(id,title,category,version,status,body_md,source_file,builtin,created_at,updated_at) VALUES(?,?,?,?,?,?,?,0,?,?)',
  ).run(id, input.title, input.category, input.version, input.status, input.bodyMd, input.sourceFile ?? null, at, at);
  return getProtocol(id);
}

/** Shared library. A cell line's folder protocols are listed only with `includeCell=1`, tagged with the line name. */
protocols.get('/protocols', (c) => {
  const filter = c.req.query('category');
  const includeCell = c.req.query('includeCell') === '1';
  const where = [filter === undefined ? '' : 'p.category=?', includeCell ? '' : 'cp.protocol_id IS NULL'].filter(Boolean);
  const rows = db
    .prepare(
      `SELECT p.id,p.title,p.category,p.version,p.status,p.builtin,p.source_file,p.updated_at,cl.name AS cell_line_name
       FROM protocols p LEFT JOIN cell_protocols cp ON cp.protocol_id=p.id LEFT JOIN cell_lines cl ON cl.id=cp.cell_line_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.updated_at DESC, p.title`,
    )
    .all(...(filter === undefined ? [] : [category(filter)])) as unknown as (Omit<ProtocolRow, 'body_md' | 'created_at'> & {
    cell_line_name: string | null;
  })[];
  return c.json(rows.map((row) => ({ ...row, provenance: provenance(row) })));
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
  return c.json(
    insertProtocol({
      title: basename(file.name, extname(file.name)),
      category: kind,
      version: '',
      status: 'draft',
      bodyMd,
      sourceFile: file.name,
    }),
    201,
  );
});

protocols.post('/protocols', async (c) => {
  const body = object(await c.req.json());
  return c.json(
    insertProtocol({
      title: text(body.title, '제목', 200, true).trim(),
      category: category(body.category),
      version: body.version === undefined ? '' : text(body.version, '버전', 120),
      status: body.status === undefined ? 'draft' : status(body.status),
      bodyMd: text(body.bodyMd, '본문', 10 * 1024 * 1024),
    }),
    201,
  );
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
    if (bodyMd !== row.body_md)
      db.prepare('INSERT INTO protocol_revisions(id,protocol_id,version,body_md,saved_at) VALUES(?,?,?,?,?)').run(
        nanoid(12),
        row.id,
        row.version,
        row.body_md,
        now(),
      );
    db.prepare('UPDATE protocols SET title=?,version=?,status=?,body_md=?,updated_at=? WHERE id=?').run(
      title,
      version,
      nextStatus,
      bodyMd,
      now(),
      row.id,
    );
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
  const revision = db.prepare('SELECT * FROM protocol_revisions WHERE id=? AND protocol_id=?').get(c.req.param('revId'), row.id) as
    RevisionRow | undefined;
  if (!revision) throw new HttpError(404, '이전 버전을 찾을 수 없습니다');
  tx(() => {
    db.prepare('INSERT INTO protocol_revisions(id,protocol_id,version,body_md,saved_at) VALUES(?,?,?,?,?)').run(
      nanoid(12),
      row.id,
      row.version,
      row.body_md,
      now(),
    );
    db.prepare('UPDATE protocols SET body_md=?,version=?,updated_at=? WHERE id=?').run(revision.body_md, revision.version, now(), row.id);
  });
  return c.json(getProtocol(row.id));
});

function selectedSop(line: CellLineRow) {
  const id = line.sop_protocol_id ?? (line.growth_mode === 'mixed' ? null : line.growth_mode === 'suspension' ? 'sop-suspension' : 'sop-adherent');
  if (!id) return null;
  const protocol = getProtocol(id);
  if (protocol.category !== 'culture_sop') throw new HttpError(400, '배양 SOP 분류의 템플릿을 선택하세요');
  return protocol;
}

/** Copy a library document into a cell line's folder; the source stays unchanged and is recorded as the origin. */
function copyIntoCell(line: CellLineRow, source: StoredProtocol, folder: ProtocolFolder, title: string) {
  const copy = insertProtocol({
    title,
    category: 'culture_sop',
    version: source.version,
    status: 'draft',
    bodyMd: source.body_md,
    sourceFile: source.source_file ?? undefined,
  });
  db.prepare('INSERT INTO protocol_copies(protocol_id,source_protocol_id,source_title,source_version,source_provenance,cell_line_id) VALUES(?,?,?,?,?,?)')
    .run(copy.id, source.id, source.title, source.version, JSON.stringify(source.provenance), line.id);
  fileInFolder(line.id, copy.id, folder);
  return copy;
}

function fileInFolder(lineId: string, protocolId: string, folder: ProtocolFolder) {
  const { next } = db.prepare('SELECT COALESCE(MAX(sort),-1)+1 AS next FROM cell_protocols WHERE cell_line_id=? AND folder=?').get(lineId, folder) as { next: number };
  db.prepare(
    'INSERT INTO cell_protocols(protocol_id,cell_line_id,folder,sort) VALUES(?,?,?,?) ON CONFLICT(protocol_id) DO UPDATE SET folder=excluded.folder,sort=excluded.sort',
  ).run(protocolId, lineId, folder, next);
}

function parseFolder(raw: unknown): ProtocolFolder {
  if (!isProtocolFolder(raw)) throw new HttpError(400, '프로토콜 폴더를 확인하세요');
  return raw;
}

protocols.post('/cell-lines/:id/sop/copy', async (c) => {
  const line = getLineRow(c.req.param('id'));
  const body = object(await c.req.json());
  const source = body.protocolId === undefined ? selectedSop(line) : getProtocol(text(body.protocolId, '템플릿', 120, true));
  if (!source) throw new HttpError(400, '혼합 배양은 템플릿을 직접 선택한 뒤 사본을 만드세요');
  if (source.category !== 'culture_sop') throw new HttpError(400, '배양 SOP 분류의 템플릿을 선택하세요');
  const copy = tx(() => {
    const copy = copyIntoCell(line, source, 'general', `${line.name} — ${source.title}`.slice(0, 200));
    db.prepare('UPDATE cell_lines SET sop_protocol_id=?,updated_at=? WHERE id=?').run(copy.id, now(), line.id);
    return getProtocol(copy.id);
  });
  return c.json(copy, 201);
});

protocols.get('/cell-lines/:id/protocols', (c) => {
  const line = getLineRow(c.req.param('id'));
  const rows = db
    .prepare(
      `SELECT p.id,p.title,p.version,p.status,p.body_md,p.updated_at,cp.folder,cp.sort,pc.source_protocol_id,pc.source_title,pc.source_version
       FROM cell_protocols cp JOIN protocols p ON p.id=cp.protocol_id LEFT JOIN protocol_copies pc ON pc.protocol_id=p.id
       WHERE cp.cell_line_id=? ORDER BY cp.folder, cp.sort, p.title`,
    )
    .all(line.id) as unknown as (Pick<ProtocolRow, 'id' | 'title' | 'version' | 'status' | 'body_md' | 'updated_at'> & {
    folder: ProtocolFolder;
    sort: number;
    source_protocol_id: string | null;
    source_title: string | null;
    source_version: string | null;
  })[];
  return c.json(
    rows.map(
      (r): CellProtocolDto => ({
        id: r.id,
        title: r.title,
        version: r.version,
        status: r.status,
        folder: r.folder,
        sort: r.sort,
        bodyMd: r.body_md,
        updatedAt: r.updated_at,
        copiedFrom: r.source_protocol_id ? { id: r.source_protocol_id, title: r.source_title ?? '', version: r.source_version ?? '' } : null,
      }),
    ),
  );
});

/** New folder document: blank, or a copy of any protocol (library or another line's). */
protocols.post('/cell-lines/:id/protocols', async (c) => {
  const line = getLineRow(c.req.param('id'));
  const body = object(await c.req.json());
  const target = parseFolder(body.folder);
  const title = body.title === undefined ? '' : text(body.title, '제목', 200).trim();
  const created = tx(() => {
    if (body.sourceProtocolId !== undefined && body.sourceProtocolId !== null) {
      const source = getProtocol(text(body.sourceProtocolId, '복사할 프로토콜', 120, true));
      return copyIntoCell(line, source, target, title || source.title);
    }
    if (!title) throw new HttpError(400, '제목을 입력하세요');
    const doc = insertProtocol({ title, category: 'culture_sop', version: '', status: 'draft', bodyMd: text(body.bodyMd ?? '', '본문', 10 * 1024 * 1024) });
    fileInFolder(line.id, doc.id, target);
    return doc;
  });
  return c.json(getProtocol(created.id), 201);
});

protocols.patch('/cell-lines/:id/protocols/:protocolId', async (c) => {
  const line = getLineRow(c.req.param('id'));
  const id = c.req.param('protocolId');
  if (!db.prepare('SELECT 1 FROM cell_protocols WHERE protocol_id=? AND cell_line_id=?').get(id, line.id))
    throw new HttpError(404, '이 세포주의 프로토콜이 아닙니다');
  fileInFolder(line.id, id, parseFolder(object(await c.req.json()).folder));
  return c.json(getProtocol(id));
});

protocols.get('/cell-lines/:id/sop', (c) => {
  const line = getLineRow(c.req.param('id'));
  const profile = activeProfileRow(line.id);
  const protocol = selectedSop(line);
  const fields = parseJsonColumn<CultureProfileFields>(profile?.fields, {});
  const preview = previewSop(protocol?.body_md ?? '', line, fields);
  const scope: FilledSop['scope'] = !protocol ? 'unselected'
    : protocol.provenance.cellLineId === line.id ? 'cell_specific'
    : protocol.provenance.kind === 'ai_draft' ? 'general' : 'shared';
  const warnings: string[] = [];
  if (!profile) warnings.push('활성 배양 조건이 없어 아직 SOP를 준비할 수 없습니다. 배양 조건 탭에서 조건 세트를 만들고 활성화하세요.');
  if (line.growth_mode === 'mixed') warnings.push('혼합 배양은 부착·부유 방식을 자동으로 결정하지 않습니다. 실제 배양 방식에 맞는 템플릿을 직접 선택하고 검토하세요.');
  if (scope === 'general') warnings.push('AI 작성 일반 골격이며 이 세포주에 대해 검증된 SOP가 아닙니다. 조건값을 채워도 일반 절차의 적합성 검토가 필요합니다.');
  if (scope === 'shared') warnings.push('여러 세포주가 함께 사용할 수 있는 템플릿입니다. 이 세포주 전용 사본을 만들어 검토·수정하세요.');
  if (preview.missingFields.length) warnings.push('미설정 항목이 있습니다. 실험 전에 누락된 조건을 확인하세요.');
  const readiness: FilledSop['readiness'] = !protocol ? 'template_required' : !profile ? 'no_profile'
    : scope === 'cell_specific' && protocol.status === 'confirmed' && preview.missingFields.length === 0 ? 'confirmed' : 'needs_review';
  const response: FilledSop = {
    protocolId: protocol?.id ?? null,
    title: protocol?.title ?? '배양 SOP 템플릿을 선택하세요',
    markdown: preview.markdown,
    templateStatus: protocol?.status ?? null,
    scope,
    readiness,
    provenance: protocol?.provenance ?? null,
    profile: profile ? toProfileDto(profile) : null,
    missingFields: preview.missingFields,
    warnings,
  };
  return c.json(response);
});
