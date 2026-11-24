import { Marked } from 'marked';
import type { CellLineDto, CultureDto, LogDto, LogType, LotDto } from '../shared/cell-line';
import { formatCount } from '../shared/cell-count';
import { FEED_MODE_LABELS, RESERVED_EXTRA_KEYS } from '../shared/culture-operations';
import { splitConditionSnapshot } from '../shared/culture-plan';
import { protocolRunMarkdown } from '../shared/protocol-run';
import type { LogRow } from './cell-lines';
import { getLineRow, toCultureDtos, toLineDto, toLogDtos, toLotDtos } from './cell-lines';
import type { CultureRow, LotRow } from './cell-lines';
import { db } from './db';
import { HttpError } from './http-error';
import { getPhotoRow, readPhoto } from './photos';

/** Same wording as the app's record list (src/web/cells/NodeDrawer.tsx); kept here so the server never imports web code. */
const LOG_LABELS: Record<LogType, string> = {
  observation: '관찰',
  medium_change: '배지 교체',
  passage: '계대',
  freeze: '동결',
  harvest: '수확',
  treatment: '처리',
  mycoplasma: '마이코플라스마',
  note: '메모',
};
const STATUS_LABELS: Record<CultureDto['status'], string> = {
  active: '활성',
  split: '계대 완료',
  frozen: '동결 완료',
  harvested: '수확',
  discarded: '폐기',
  contaminated: '오염',
};
const MYCOPLASMA_LABELS = { negative: '음성', positive: '양성', pending: '검사 중' } as const;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
/** Total bytes of photos embedded in one HTML notebook; later photos are listed as omitted. */
const EMBED_PHOTO_BUDGET = 40 * 1024 * 1024;

export interface NotebookQuery {
  format: 'md' | 'html';
  /** Inclusive local dates (YYYY-MM-DD). */
  from: string | null;
  to: string | null;
  cultureId: string | null;
}

const pad = (n: number) => String(n).padStart(2, '0');
function localDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function localTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localDateTime(d: Date): string {
  return `${localDate(d.toISOString())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Local midnight of a YYYY-MM-DD date, or 400 when it is malformed or not a real calendar day. */
function localDayStart(raw: string, label: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const date = new Date(y, mo - 1, d);
    if (date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d) return date;
  }
  throw new HttpError(400, `${label}을(를) YYYY-MM-DD 형식의 올바른 날짜로 입력하세요`);
}

export function parseNotebookQuery(get: (name: string) => string | undefined): NotebookQuery {
  const format = get('format') || 'html';
  if (format !== 'md' && format !== 'html') throw new HttpError(400, '형식은 md 또는 html이어야 합니다');
  const from = get('from') || null;
  const to = get('to') || null;
  const start = from ? localDayStart(from, '시작일') : null;
  const end = to ? localDayStart(to, '종료일') : null;
  if (start && end && start > end) throw new HttpError(400, '시작일이 종료일보다 늦습니다');
  return { format, from, to, cultureId: get('cultureId') || null };
}

/** Inline text from user data: one line, Markdown punctuation escaped. */
function inline(raw: string): string {
  return raw.replace(/\s*\n\s*/g, ' ').replace(/[\\`*_~<>[\]|]/g, '\\$&').trim();
}
/** Multi-line free text: keep line breaks, keep headings from splitting the notebook. */
function block(raw: string): string {
  return raw
    .trim()
    .replace(/^(\s{0,3})(#{1,6}\s)/gm, '$1\\$2')
    .replace(/([^\n\s])[ \t]*\n(?=[^\n])/g, '$1  \n');
}
const num = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 3 });

interface Entry {
  at: string;
  cultureId: string | null;
  heading: string;
  body: string[];
}

function logBullets(log: LogDto, photoLines: string[]): string[] {
  const out: string[] = [];
  const measures = [
    log.confluencyPct !== null && `Confluency ${num(log.confluencyPct)}%`,
    log.cellsPerMl !== null && `${formatCount(log.cellsPerMl)} cells/mL`,
    log.viabilityPct !== null && `생존율 ${num(log.viabilityPct)}%`,
    log.totalCells !== null && `총 ${formatCount(log.totalCells)}개`,
  ].filter(Boolean);
  if (measures.length) out.push(`- ${measures.join(' · ')}`);
  if (log.mycoplasma) out.push(`- 마이코플라스마: ${MYCOPLASMA_LABELS[log.mycoplasma]}`);
  if (log.feed) {
    const f = log.feed;
    const parts = [
      FEED_MODE_LABELS[f.mode],
      f.mediumLabel ? inline(f.mediumLabel) : '배지 미기록',
      `제거 ${f.removedMl === null ? '미기록' : `${num(f.removedMl)} mL`} / 추가 ${f.addedMl === null ? '미기록' : `${num(f.addedMl)} mL`}`,
      f.mediumDetail && inline(f.mediumDetail),
    ].filter(Boolean);
    out.push(`- 배지: ${parts.join(' · ')}`);
  }
  if (log.passage) {
    const p = log.passage;
    const parts = [
      p.dissociationReagent && `해리 시약 ${inline(p.dissociationReagent)}`,
      p.splitRatio && `분주비 ${inline(p.splitRatio)}`,
      p.recoveredLiveCells !== null && `회수 생세포 ${formatCount(p.recoveredLiveCells)}개`,
      p.seededCells !== null && `접종 ${formatCount(p.seededCells)}개`,
      p.childCount !== null && `자식 배양 ${p.childCount}개`,
    ].filter(Boolean);
    if (parts.length) out.push(`- 계대: ${parts.join(' · ')}`);
  }
  if (log.morphology) out.push(`- 형태: ${inline(log.morphology)}`);
  for (const [key, value] of Object.entries(log.extra))
    if (!RESERVED_EXTRA_KEYS.includes(key)) out.push(`- ${inline(key)}: ${inline(String(value))}`);
  if (out.length) out.push('');
  out.push(...photoLines);
  return out;
}

/** Embed (html) or count (md) a log's photos, within the shared byte budget. */
function photoLines(log: LogDto, embed: boolean, budget: { left: number }): string[] {
  if (!log.photos.length) return [];
  if (!embed) return [`사진 ${log.photos.length}장 (Markdown 내보내기에는 포함되지 않음)`, ''];
  const lines: string[] = [];
  let omitted = 0;
  log.photos.forEach((photo, i) => {
    if (photo.bytes > budget.left) {
      omitted += 1;
      return;
    }
    try {
      const data = readPhoto(getPhotoRow(photo.id));
      budget.left -= data.length;
      lines.push(`![관찰 사진 ${i + 1}](data:${photo.mime};base64,${data.toString('base64')})`, '');
    } catch {
      omitted += 1;
    }
  });
  if (omitted) lines.push(`사진 ${omitted}장은 파일이 없거나 용량 제한으로 포함하지 못했습니다.`, '');
  return lines;
}

function snapshotQuote(snapshot: string): string[] {
  const lines = snapshot
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => inline(l));
  return ['> **사용 조건**  ', ...lines.map((l, i) => `> ${l}${i < lines.length - 1 ? '  ' : ''}`), ''];
}

function lotEntry(lot: LotDto): Entry {
  const parts = [
    lot.passage !== null && `P${lot.passage}`,
    `바이알 ${lot.vialsInitial}개`,
    lot.location && `보관 ${inline(lot.location)}`,
    lot.cellsPerVial !== null && `${formatCount(lot.cellsPerVial)} cells/vial`,
    lot.freezingMedium && `동결 배지 ${inline(lot.freezingMedium)}`,
    lot.supplierLot && `공급처 Lot ${inline(lot.supplierLot)}`,
  ].filter(Boolean);
  const body = [`- ${parts.join(' · ')}`, ''];
  if (lot.notes.trim()) body.push(block(lot.notes), '');
  return {
    at: lot.eventAt,
    cultureId: lot.sourceCultureId,
    heading: `${lot.origin === 'received' ? 'Stock 입고' : '동결 stock'} · ${inline(lot.label)}`,
    body,
  };
}

function endEntry(culture: CultureDto): Entry {
  const body = [`- 상태: ${STATUS_LABELS[culture.status]}`, ''];
  if (culture.endNote?.trim()) body.push(block(culture.endNote), '');
  return {
    at: culture.endedAt as string,
    cultureId: culture.id,
    heading: `배양 종료 · ${inline(culture.label)} · P${culture.passage}`,
    body,
  };
}

/** The notebook as Markdown. `embedPhotos` inlines observation photos as data URIs (used by the HTML export). */
export function buildNotebookMarkdown(lineId: string, query: NotebookQuery, embedPhotos: boolean, exportedAt = new Date()): string {
  const line: CellLineDto = toLineDto(getLineRow(lineId));
  const cultureRows = db.prepare('SELECT * FROM cultures WHERE cell_line_id=?').all(lineId) as unknown as CultureRow[];
  const cultures = toCultureDtos(cultureRows);
  const byId = new Map(cultures.map((c) => [c.id, c]));
  const selected = query.cultureId ? byId.get(query.cultureId) : null;
  if (query.cultureId && !selected) throw new HttpError(404, '이 세포주에서 배양을 찾을 수 없습니다');

  const startMs = query.from ? localDayStart(query.from, '시작일').getTime() : -Infinity;
  const lastDay = query.to ? localDayStart(query.to, '종료일') : null;
  const endMs = lastDay ? new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate() + 1).getTime() : Infinity;
  const inRange = (iso: string) => {
    const t = Date.parse(iso);
    return Number.isFinite(t) && t >= startMs && t < endMs;
  };

  const logWhere = ['c.cell_line_id=?'];
  const logParams: string[] = [lineId];
  if (query.cultureId) {
    logWhere.push('l.culture_id=?');
    logParams.push(query.cultureId);
  }
  const logRows = (
    db
      .prepare(`SELECT l.* FROM culture_logs l JOIN cultures c ON c.id=l.culture_id WHERE ${logWhere.join(' AND ')} ORDER BY l.at,l.created_at,l.id`)
      .all(...logParams) as unknown as LogRow[]
  ).filter((r) => inRange(r.at));
  // A 수확·폐기·오염 record is printed once, as the culture's end entry below.
  const logs = toLogDtos(logRows).filter((log) => log.operation !== 'end');

  const lotRows = (db.prepare('SELECT * FROM cryo_lots WHERE cell_line_id=?').all(lineId) as unknown as LotRow[]).filter(
    (r) => inRange(r.event_at) && (!query.cultureId || r.source_culture_id === query.cultureId),
  );
  const entries: Entry[] = toLotDtos(lotRows).map(lotEntry);

  const budget = { left: EMBED_PHOTO_BUDGET };
  const lastSnapshot = new Map<string, string>();
  const logEntries: Entry[] = logs.map((log) => {
    const culture = byId.get(log.cultureId);
    const { text, snapshot } = splitConditionSnapshot(log.note);
    const body = logBullets(log, photoLines(log, embedPhotos, budget));
    if (text) body.push(block(text), '');
    // Printed once per culture until the condition set or work changes.
    if (snapshot && lastSnapshot.get(log.cultureId) !== snapshot) {
      lastSnapshot.set(log.cultureId, snapshot);
      body.push(...snapshotQuote(snapshot));
    }
    if (log.protocolRun) body.push(protocolRunMarkdown(log.protocolRun), '');
    return {
      at: log.at,
      cultureId: log.cultureId,
      heading: `${inline(culture?.label ?? '삭제된 배양')} · P${culture?.passage ?? '?'} · ${log.operation === 'thaw' ? '해동' : LOG_LABELS[log.type]}`,
      body,
    };
  });
  const endEntries = cultures
    .filter((c) => c.endedAt && inRange(c.endedAt) && (!query.cultureId || c.id === query.cultureId))
    .map(endEntry);

  // Lots first, then logs, then culture ends: at the same instant a record reads before the end it caused.
  const all = [...entries, ...logEntries, ...endEntries]
    .map((entry, order) => ({ entry, order }))
    .sort((a, b) => Date.parse(a.entry.at) - Date.parse(b.entry.at) || a.order - b.order)
    .map((x) => x.entry);

  const period = query.from || query.to ? `${query.from ?? '처음'} ~ ${query.to ?? '현재'}` : '전체 기간';
  const md: string[] = [`# 실험노트 — ${inline(line.name)}`, ''];
  const identity = [line.species, line.sourceBank, line.catalogNo && `Cat. ${line.catalogNo}`].filter(Boolean).map((s) => inline(String(s)));
  if (identity.length) md.push(`${identity.join(' · ')}  `);
  md.push(`내보낸 시각: ${localDateTime(exportedAt)}  `, `기간: ${period}  `, `배양: ${selected ? inline(selected.label) : '전체'}`, '');

  if (!all.length) {
    md.push('이 기간에 기록이 없습니다.', '');
    return md.join('\n');
  }
  let day = '';
  for (const entry of all) {
    const date = localDate(entry.at);
    if (date !== day) {
      day = date;
      md.push(`## ${date} (${WEEKDAYS[new Date(entry.at).getDay()]})`, '');
    }
    md.push(`### ${localTime(entry.at)} · ${entry.heading}`, '', ...entry.body);
  }
  return md.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Raw HTML inside user notes is shown as text, never run.
const marked = new Marked({ gfm: true, renderer: { html: ({ text }) => escapeHtml(text) } });

const PAGE_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; padding: 32px 20px 64px; background: #fff; color: #1b1f24; font: 14px/1.7 "Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR","Pretendard","Segoe UI",system-ui,sans-serif; }
main { max-width: 800px; margin: 0 auto; }
h1 { font-size: 24px; margin: 0 0 6px; }
h2 { font-size: 17px; margin: 32px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #1b1f24; break-after: avoid; }
h3 { font-size: 14.5px; margin: 20px 0 6px; break-after: avoid; }
p, ul, ol, blockquote, table { margin: 6px 0; }
ul, ol { padding-left: 22px; }
h3, h3 ~ * { break-inside: avoid-page; }
h1 + p { color: #4b5563; }
blockquote { margin: 8px 0; padding: 6px 12px; border-left: 3px solid #9ca3af; background: #f3f4f6; color: #374151; font-size: 12.5px; }
del { color: #b42318; text-decoration: line-through; text-decoration-thickness: 1.5px; }
strong { font-weight: 650; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { border: 1px solid #d1d5db; padding: 4px 8px; text-align: left; vertical-align: top; }
th { background: #f3f4f6; }
img { display: block; max-width: 100%; max-height: 90mm; margin: 8px 0; border: 1px solid #e5e7eb; }
code { font-family: ui-monospace,"SF Mono",Menlo,Consolas,monospace; font-size: 12.5px; background: #f3f4f6; padding: 0 3px; border-radius: 3px; }
@page { size: A4; margin: 16mm 14mm; }
@media print {
  body { padding: 0; font-size: 11pt; }
  main { max-width: none; }
  h2 { break-before: auto; }
  a { color: inherit; text-decoration: none; }
}`;

export function notebookHtml(markdown: string): string {
  const title = /^# (.+)$/m.exec(markdown)?.[1].replace(/\\([\\`*_~<>[\]|])/g, '$1') ?? '실험노트';
  const body = marked.parse(markdown, { async: false });
  return `<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>${escapeHtml(title)}</title>\n<style>${PAGE_CSS}</style>\n</head>\n<body>\n<main>\n${body}</main>\n</body>\n</html>\n`;
}

/** `TCMK-1_실험노트_2026-11-01_2026-11-16.md`; characters unsafe in file names become `_`. */
export function notebookFileName(lineName: string, query: NotebookQuery, exportedAt = new Date()): string {
  const period = query.from || query.to ? `${query.from ?? '처음'}_${query.to ?? '현재'}` : localDate(exportedAt.toISOString());
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are stripped on purpose
  const safe = lineName.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').trim() || 'cell-line';
  return `${safe}_실험노트_${period}.${query.format}`;
}
