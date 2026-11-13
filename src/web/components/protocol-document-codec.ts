import { Node, decodeHtmlEntities, getSchema, nodeInputRule, type JSONContent, type MarkdownParseHelpers, type MarkdownToken } from '@tiptap/core';
import { Markdown, MarkdownManager } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import StarterKit from '@tiptap/starter-kit';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import Strike from '@tiptap/extension-strike';
import Link from '@tiptap/extension-link';
import { Marked, type marked, type Token, type Tokens } from 'marked';
import { sopFieldLabel } from '../../shared/sop';

/** Raw spelling is an attribute, never a resolved scientific value. */
export const ProtocolVariable = Node.create({
  name: 'protocolVariable',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      raw: { default: '', parseHTML: (element) => element.getAttribute('data-variable-raw') },
      key: { default: '', parseHTML: (element) => element.getAttribute('data-variable-key') },
    };
  },
  parseHTML() { return [{ tag: 'span[data-variable-raw]' }]; },
  renderHTML({ node }) {
    return ['span', {
      'data-variable-raw': node.attrs.raw,
      'data-variable-key': node.attrs.key,
      class: 'protocol-variable',
      contenteditable: 'false',
      role: 'button',
      tabindex: '0',
      'aria-label': `${sopFieldLabel(node.attrs.key)} · 연결 조건 열기`,
      title: `${sopFieldLabel(node.attrs.key)} · 세포주의 배양 조건에서 설정`,
    }, `${sopFieldLabel(node.attrs.key)} · 연결 조건`];
  },
  renderText({ node }) { return node.attrs.raw; },
  addInputRules() {
    return [nodeInputRule({
      find: /\{\{[^{}\r\n]+\}\}$/,
      type: this.type,
      getAttributes: (match) => ({ raw: match[0], key: match[0].slice(2, -2).trim() }),
    })];
  },
  markdownTokenizer: {
    name: 'protocolVariable',
    level: 'inline',
    start: (source) => source.indexOf('{{'),
    tokenize(source) {
      const match = /^\{\{([^{}\r\n]+)\}\}/.exec(source);
      if (match) return { type: 'protocolVariable', raw: match[0], key: match[1].trim() };
      return undefined;
    },
  },
  parseMarkdown(token) {
    return { type: 'protocolVariable', attrs: { raw: token.raw, key: token.key } };
  },
  renderMarkdown(node) { return node.attrs?.raw ?? ''; },
});

// The upstream Markdown mark helper marks text only, dropping marks on inline atoms.
// Apply Markdown marks to every inline node so variable chips retain their original formatting.
function protocolMarkedContent(token: MarkdownToken, helpers: MarkdownParseHelpers, type: string, attrs?: Record<string, unknown>) {
  return helpers.parseInline(token.tokens ?? []).map((node) => ({
    ...node,
    marks: [...(node.marks ?? []), attrs ? { type, attrs } : { type }],
  }));
}

export function protocolDocumentExtensions() {
  // Each editor owns a lexer: registering its variable tokenizer must not mutate another editor.
  const parser = new Marked() as unknown as typeof marked;
  return [
    StarterKit.configure({
      bold: false,
      italic: false,
      strike: false,
      link: false,
      // Underline has no lossless Markdown representation.
      underline: false,
      trailingNode: false,
    }),
    Bold.extend({ parseMarkdown: (token, helpers) => protocolMarkedContent(token, helpers, 'bold') }),
    Italic.extend({ parseMarkdown: (token, helpers) => protocolMarkedContent(token, helpers, 'italic') }),
    Strike.extend({ parseMarkdown: (token, helpers) => protocolMarkedContent(token, helpers, 'strike') }),
    Link.extend({
      parseMarkdown: (token, helpers) => protocolMarkedContent(token, helpers, 'link', { href: token.href, title: token.title || null }),
    }).configure({ openOnClick: false, autolink: false }),
    TableKit.configure({ table: { resizable: false } }),
    ProtocolVariable,
    Markdown.configure({ marked: parser, markedOptions: { gfm: true, breaks: false }, indentation: { style: 'space', size: 2 } }),
  ];
}

const codecExtensions = protocolDocumentExtensions();
const codecParser = new Marked() as unknown as typeof marked;
const manager = new MarkdownManager({ extensions: codecExtensions, marked: codecParser, markedOptions: { gfm: true, breaks: false } });
const schema = getSchema(codecExtensions);
const semanticParser = new Marked({ gfm: true, breaks: false });

export interface PreparedProtocolDocument {
  /** Kept byte-for-byte until the user actually edits the visual document. */
  source: string;
  document: JSONContent | null;
  warning: string | null;
}

class UnsupportedMarkdown extends Error {}

// Compare actual Markdown meaning on both sides of the official codec, not its source spelling.
// This additionally catches parser/serializer limitations in a future dependency update.
function inlineSignature(tokens: Token[] = []): unknown[] {
  const result: unknown[] = [];
  for (const token of tokens) {
    let value: unknown;
    switch (token.type) {
      case 'text':
      case 'escape': {
        if ('tokens' in token && token.tokens) {
          for (const child of inlineSignature(token.tokens as Token[])) append(child);
          continue;
        }
        value = decodeHtmlEntities(token.text ?? '').replace(/\r?\n/g, ' ');
        break;
      }
      case 'strong': case 'em': case 'del':
        value = [token.type, inlineSignature(token.tokens as Token[])];
        break;
      case 'codespan': value = ['code', token.text]; break;
      case 'br': value = ['break']; break;
      case 'link': value = ['link', token.href, token.title ?? null, inlineSignature(token.tokens as Token[])]; break;
      case 'html':
        if (!/^<br\s*\/?>$/i.test(token.raw)) throw new UnsupportedMarkdown('HTML 문법');
        value = ['break'];
        break;
      default: throw new UnsupportedMarkdown('이미지·HTML 또는 지원하지 않는 인라인 문법');
    }
    append(value);
  }
  return result;
  function append(value: unknown) {
    const last = result[result.length - 1];
    if (typeof last === 'string' && typeof value === 'string') result[result.length - 1] = last + value;
    else result.push(value);
  }
}

function blockSignature(tokens: Token[]): unknown[] {
  const result: unknown[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case 'space': break;
      case 'heading': result.push(['heading', token.depth, inlineSignature(token.tokens as Token[])]); break;
      case 'paragraph': case 'text': result.push(['paragraph', inlineSignature(token.tokens as Token[])]); break;
      case 'blockquote': result.push(['quote', blockSignature(token.tokens as Token[])]); break;
      case 'hr': result.push(['rule']); break;
      case 'code': result.push(['code', token.lang ?? '', token.text]); break;
      case 'list': {
        const list = token as Tokens.List;
        if (list.items.some((item) => item.task)) throw new UnsupportedMarkdown('체크박스 목록');
        result.push(['list', list.ordered, list.ordered ? list.start : null,
          list.items.map((item) => blockSignature(item.tokens))]);
        break;
      }
      case 'table': {
        const table = token as Tokens.Table;
        result.push(['table', table.align,
          table.header.map((cell) => inlineSignature(cell.tokens)),
          table.rows.map((row) => row.map((cell) => inlineSignature(cell.tokens)))]);
        break;
      }
      default: throw new UnsupportedMarkdown('HTML·참조 정의 또는 지원하지 않는 블록 문법');
    }
  }
  return result;
}

function signature(source: string): string {
  return JSON.stringify(blockSignature(semanticParser.lexer(source)));
}

export function serializeProtocolDocument(document: JSONContent): string {
  // The official serializer also groups marks on text nodes only. Encode atoms as collision-free
  // text while it writes mark boundaries, then restore their exact token spelling afterwards.
  const existingText: string[] = [];
  function collect(node: JSONContent) {
    if (node.text) existingText.push(node.text);
    if (node.type === 'protocolVariable') existingText.push(node.attrs?.raw ?? '');
    node.content?.forEach(collect);
  }
  collect(document);
  const occupied = existingText.join('');
  let prefix = 'CELLLABVARIABLE';
  while (occupied.includes(prefix)) prefix += 'X';
  const variables: string[] = [];
  function encode(node: JSONContent): JSONContent {
    if (node.type === 'protocolVariable') {
      const index = variables.push(node.attrs?.raw ?? '') - 1;
      return { type: 'text', text: `${prefix}${index}END`, marks: node.marks };
    }
    return node.content ? { ...node, content: node.content.map(encode) } : node;
  }
  const serialized = manager.serialize(encode(document));
  return serialized.replace(new RegExp(`${prefix}(\\d+)END`, 'g'), (match, index: string) => variables[Number(index)] ?? match);
}

/** Fail closed: the raw editor is the real editable fallback, never a read-only approximation. */
export function prepareProtocolDocument(source: string): PreparedProtocolDocument {
  try {
    if (/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/.test(source)
      || /^\s*(?:\[\^[^\]]+\]:|\${2}|:::{1,}|```\{)/m.test(source)
      || /(?:^|[^\\])\$[^\s$][^\n$]*\$/.test(source)) {
      throw new UnsupportedMarkdown('메타데이터·각주·수식 또는 확장 문법');
    }
    const before = signature(source);
    const document = manager.parse(source);
    if (!document.content?.length) document.content = [{ type: 'paragraph' }];
    // A parser result is not sufficient: it must also fit the actual editable schema.
    schema.nodeFromJSON(document).check();
    const converted = serializeProtocolDocument(document);
    if (before !== signature(converted)) throw new UnsupportedMarkdown('문서 구조 또는 내용이 달라지는 문법');
    return { source, document, warning: null };
  } catch (error) {
    const detail = error instanceof UnsupportedMarkdown ? error.message : '안전한 왕복 변환을 확인할 수 없는 문법';
    return {
      source,
      document: null,
      warning: `${detail}이 있어 원문 편집으로 열었습니다. 원문은 그대로 보존되며, 지원하지 않는 내용을 바꾸기 전에는 문서 편집으로 전환하지 않습니다.`,
    };
  }
}
