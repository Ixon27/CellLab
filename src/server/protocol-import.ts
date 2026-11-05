import mammoth from 'mammoth';
import { HTMLElement, NodeType, parse } from 'node-html-parser';
import type { Node } from 'node-html-parser';

/** Convert mammoth's semantic HTML, retaining lists and GFM tables. */
export function htmlToMarkdown(html: string): string {
  const root = parse(html);

  function children(node: Node, inCell = false): string {
    return node.childNodes.map((child) => render(child, inCell)).join('');
  }

  function list(node: HTMLElement, depth: number): string {
    return node.childNodes.filter((child): child is HTMLElement => child instanceof HTMLElement && child.tagName === 'LI').map((li) => {
      const nested = li.childNodes.filter((child): child is HTMLElement => child instanceof HTMLElement && /^(UL|OL)$/.test(child.tagName));
      const text = li.childNodes.filter((child) => !nested.includes(child as HTMLElement)).map((child) => render(child)).join('').trim();
      const indent = '  '.repeat(depth);
      const lines = text.split('\n').filter(Boolean);
      return `${indent}${node.tagName === 'OL' ? '1.' : '-'} ${lines.join(`\n${indent}  `)}\n${nested.map((child) => list(child, depth + 1)).join('')}`;
    }).join('');
  }

  function render(node: Node, inCell = false): string {
    if (node.nodeType === NodeType.TEXT_NODE) return node.text.replace(/\s+/g, ' ');
    if (!(node instanceof HTMLElement)) return '';
    const tag = node.tagName?.toLowerCase();
    if (['script', 'style'].includes(tag)) return '';
    if (tag === 'br') return inCell ? ' ' : '  \n';
    if (tag === 'img') {
      const src = node.getAttribute('src');
      return src ? `![${node.getAttribute('alt') ?? ''}](${src})` : '';
    }
    if (tag === 'table') {
      const rows = node.querySelectorAll('tr').map((tr) => tr.childNodes
        .filter((child): child is HTMLElement => child instanceof HTMLElement && /^(TD|TH)$/.test(child.tagName))
        .map((cell) => children(cell, true).trim().replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ')));
      if (!rows.length) return '';
      const width = Math.max(...rows.map((row) => row.length));
      const rowText = (row: string[]) => `| ${Array.from({ length: width }, (_, i) => row[i] ?? '').join(' | ')} |`;
      return `\n\n${[rowText(rows[0]), rowText(Array(width).fill('---')), ...rows.slice(1).map(rowText)].join('\n')}\n\n`;
    }
    if (tag === 'ul' || tag === 'ol') return inCell ? children(node, true) : `\n\n${list(node, 0)}\n`;
    const text = children(node, inCell);
    if (/^h[1-6]$/.test(tag)) return inCell ? text : `\n\n${'#'.repeat(Number(tag[1]))} ${text.trim()}\n\n`;
    if (tag === 'strong' || tag === 'b') return text.trim() ? text.replace(/^(\s*)([\s\S]*?)(\s*)$/, '$1**$2**$3') : text;
    if (tag === 'em' || tag === 'i') return text.trim() ? text.replace(/^(\s*)([\s\S]*?)(\s*)$/, '$1*$2*$3') : text;
    if (tag === 'a' && node.getAttribute('href')) return `[${text}](${node.getAttribute('href')})`;
    if (tag === 'p' || tag === 'div') return inCell ? `${text} ` : `\n\n${text.trim()}\n\n`;
    return text;
  }

  return children(root).replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export async function docxToMarkdown(buf: Buffer): Promise<string> {
  const result = await mammoth.convertToHtml({ buffer: buf }, {
    convertImage: mammoth.images.imgElement(async () => ({ src: '' })),
  });
  return htmlToMarkdown(result.value);
}
