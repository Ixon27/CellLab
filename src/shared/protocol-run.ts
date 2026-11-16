import { Lexer } from 'marked';
import type { Tokens } from 'marked';
import type { PlanStage } from './culture-plan';

/** Folders of a cell line's own protocols. Order is the display order. */
export const PROTOCOL_FOLDERS = ['general', 'thaw', 'feed', 'passage', 'freeze', 'treatment'] as const;
export type ProtocolFolder = (typeof PROTOCOL_FOLDERS)[number];
export const PROTOCOL_FOLDER_LABELS: Record<ProtocolFolder, string> = {
  general: '전체 SOP',
  thaw: '해동',
  feed: '배지 교체',
  passage: '계대',
  freeze: '동결',
  treatment: '특별 처리',
};
export function isProtocolFolder(raw: unknown): raw is ProtocolFolder {
  return typeof raw === 'string' && (PROTOCOL_FOLDERS as readonly string[]).includes(raw);
}
/** The folder whose protocols an operation offers first. */
export function folderForStage(stage: PlanStage | 'treatment'): ProtocolFolder {
  return stage === 'stock' ? 'general' : stage;
}

/** `GET /api/cell-lines/:id/protocols` */
export interface CellProtocolDto {
  id: string;
  title: string;
  version: string;
  status: 'draft' | 'confirmed';
  folder: ProtocolFolder;
  sort: number;
  bodyMd: string;
  updatedAt: string;
  copiedFrom: { id: string; title: string; version: string } | null;
}

/** One performable unit of a protocol: a list item, paragraph, quote, table or code block. */
export interface ProtocolStep {
  index: number;
  /** Nearest preceding heading, plain text. */
  section: string | null;
  /** Markdown of the step as written. */
  text: string;
}

/** Split protocol markdown into ordered steps; headings become section names, not steps. */
export function protocolSteps(markdown: string): ProtocolStep[] {
  const steps: ProtocolStep[] = [];
  let section: string | null = null;
  const push = (text: string) => {
    const trimmed = text.trim();
    if (trimmed) steps.push({ index: steps.length, section, text: trimmed });
  };
  for (const token of new Lexer().lex(markdown)) {
    switch (token.type) {
      case 'heading':
        section = (token as Tokens.Heading).text.replace(/[*_`~]/g, '').trim();
        break;
      case 'list':
        for (const item of (token as Tokens.List).items) push(item.text);
        break;
      case 'paragraph':
      case 'blockquote':
      case 'table':
      case 'code':
      case 'text':
        push(token.raw);
        break;
      default:
        break;
    }
  }
  return steps;
}

/** One step as performed. `modified` null = as written, '' = skipped this time, otherwise the text actually followed. */
export interface ProtocolRunStep {
  index: number;
  section: string | null;
  original: string;
  modified: string | null;
}
/** Snapshot of a protocol as performed in one record. The source protocol is never changed by a run. */
export interface ProtocolRun {
  protocolId: string | null;
  title: string;
  version: string;
  protocolUpdatedAt: string;
  steps: ProtocolRunStep[];
}
/** What an operation form sends: the chosen protocol, the version it showed, and this run's deviations. */
export interface ProtocolRunInput {
  protocolId: string;
  protocolUpdatedAt: string;
  deviations: { index: number; text: string }[];
}

const MAX_STEP_TEXT = 5000;
const MAX_DEVIATIONS = 300;

/** Shape-check the request part; throws a Korean Error for the caller to turn into a 400. */
export function validateProtocolRunInput(raw: unknown): ProtocolRunInput | null {
  if (raw === undefined || raw === null) return null;
  const fail = (): never => {
    throw new Error('프로토콜 수행 기록 형식이 올바르지 않습니다');
  };
  if (typeof raw !== 'object' || Array.isArray(raw)) return fail();
  const r = raw as Record<string, unknown>;
  if (typeof r.protocolId !== 'string' || !r.protocolId || r.protocolId.length > 120) return fail();
  if (typeof r.protocolUpdatedAt !== 'string' || !r.protocolUpdatedAt) return fail();
  if (!Array.isArray(r.deviations) || r.deviations.length > MAX_DEVIATIONS) return fail();
  const seen = new Set<number>();
  const deviations = r.deviations.map((d) => {
    if (!d || typeof d !== 'object') return fail();
    const { index, text } = d as Record<string, unknown>;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || seen.has(index)) return fail();
    if (typeof text !== 'string' || text.length > MAX_STEP_TEXT) return fail();
    seen.add(index);
    return { index, text: text.trim() };
  });
  return { protocolId: r.protocolId, protocolUpdatedAt: r.protocolUpdatedAt, deviations };
}

/** Apply deviations to the steps of the protocol text shown to the user. */
export function buildProtocolRun(
  protocol: { id: string; title: string; version: string; updatedAt: string },
  steps: ProtocolStep[],
  deviations: ProtocolRunInput['deviations'],
): ProtocolRun {
  const byIndex = new Map(deviations.map((d) => [d.index, d.text]));
  for (const index of byIndex.keys()) if (index >= steps.length) throw new Error('수정한 단계가 프로토콜에 없습니다');
  return {
    protocolId: protocol.id,
    title: protocol.title,
    version: protocol.version,
    protocolUpdatedAt: protocol.updatedAt,
    steps: steps.map((s) => {
      const text = byIndex.get(s.index);
      return { index: s.index, section: s.section, original: s.text, modified: text === undefined || text === s.text ? null : text };
    }),
  };
}

export function changedSteps(run: ProtocolRun): ProtocolRunStep[] {
  return run.steps.filter((s) => s.modified !== null);
}

/** Markdown of a performed protocol: changed steps keep the original struck through, followed by what was done. */
export function protocolRunMarkdown(run: ProtocolRun): string {
  const lines = [`**프로토콜: ${run.title}**${run.version ? ` (${run.version})` : ''} · 변경 ${changedSteps(run).length}단계`, ''];
  let section: string | null | undefined;
  let n = 0;
  for (const step of run.steps) {
    if (step.section !== section) {
      section = step.section;
      n = 0;
      if (section) lines.push('', `*${section}*`, '');
    }
    n += 1;
    const original = step.original.replace(/\n+/g, ' ');
    if (step.modified === null) lines.push(`${n}. ${original}`);
    else if (step.modified === '') lines.push(`${n}. ~~${original}~~ → **이번에는 생략**`);
    else lines.push(`${n}. ~~${original}~~ → **${step.modified.replace(/\n+/g, ' ')}**`);
  }
  return lines.join('\n').trim();
}
