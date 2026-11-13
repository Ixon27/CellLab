import JSZip from 'jszip';
import { parse } from 'node-html-parser';
import { posix } from 'node:path';
export const MAX_WORKBOOK_BYTES = 10 * 1024 * 1024;
export interface WorkbookGrid {
  id: string;
  sheet: string;
  origin: string;
  values: (number | null)[];
  wavelengthNm: number | null;
  warnings: string[];
}
/** Reads cached worksheet values only. VBA, formula execution and external links are never loaded. */
export async function parseBradfordWorkbook(buffer: Buffer): Promise<{ grids: WorkbookGrid[] }> {
  if (buffer.length > MAX_WORKBOOK_BYTES) throw new Error('엑셀 파일은 10 MB 이하여야 합니다');
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new Error('xlsx 또는 xlsm 엑셀 파일을 읽을 수 없습니다');
  }
  let expanded = 0;
  const xml = async (path: string) => {
    const entry = zip.file(path);
    if (!entry) throw new Error('엑셀 통합 문서 구성이 올바르지 않습니다');
    // Central-directory sizes bound expansion before decompression; check actual bytes as well.
    const internal = '_data' in entry ? entry._data : null;
    const size = internal && typeof internal === 'object' && 'uncompressedSize' in internal ? internal.uncompressedSize : undefined;
    if (typeof size !== 'number' || size > 20 * 1024 * 1024 || expanded + size > 40 * 1024 * 1024)
      throw new Error('압축 해제된 엑셀 데이터가 너무 큽니다');
    const text = await entry.async('string');
    expanded += Buffer.byteLength(text);
    if (expanded > 40 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('지원하지 않는 엑셀 XML 형식입니다');
    return parse(text, { lowerCaseTagName: false });
  };
  const workbook = await xml('xl/workbook.xml');
  const rels = await xml('xl/_rels/workbook.xml.rels');
  const shared = zip.file('xl/sharedStrings.xml')
    ? (await xml('xl/sharedStrings.xml')).querySelectorAll('si').map((si) =>
        si
          .querySelectorAll('t')
          .map((t) => t.textContent)
          .join(''),
      )
    : [];
  const grids: WorkbookGrid[] = [];
  for (const sheet of workbook.querySelectorAll('sheet')) {
    const relation = rels.querySelectorAll('relationship').find((r) => r.getAttribute('Id') === sheet.getAttribute('r:id'));
    const target = relation?.getAttribute('Target');
    if (!target || relation?.getAttribute('TargetMode') === 'External') continue;
    const path = target.startsWith('/') ? target.slice(1) : posix.normalize(posix.join('xl', target));
    if (!path.startsWith('xl/worksheets/')) continue;
    const cells = new Map<string, { text: string; numeric: number | null }>();
    const doc = await xml(path);
    for (const c of doc.querySelectorAll('c')) {
      const ref = c.getAttribute('r');
      if (!ref) continue;
      const type = c.getAttribute('t');
      const raw = c.querySelector('v')?.textContent ?? '';
      const text =
        type === 's'
          ? (shared[Number(raw)] ?? '')
          : type === 'inlineStr'
            ? c
                .querySelectorAll('t')
                .map((t) => t.textContent)
                .join('')
            : raw;
      const numeric = (type === undefined || type === 'n') && raw.trim() !== '' && Number.isFinite(Number(raw)) ? Number(raw) : null;
      cells.set(ref.toUpperCase(), { text: text.trim(), numeric });
    }
    const colName = (n: number): string => {
      let s = '';
      for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
      return s;
    };
    for (const [ref, cell] of cells) {
      if (cell.text !== '1') continue;
      const match = /^([A-Z]+)(\d+)$/.exec(ref);
      if (!match) continue;
      const col = [...match[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0),
        row = Number(match[2]);
      const at = (r: number, c: number) => cells.get(`${colName(c)}${r}`);
      if (!Array.from({ length: 12 }, (_, i) => at(row, col + i)?.text === String(i + 1)).every(Boolean)) continue;
      if (!Array.from({ length: 8 }, (_, i) => at(row + i + 1, col - 1)?.text.toUpperCase() === 'ABCDEFGH'[i]).every(Boolean)) continue;
      const warnings: string[] = [];
      const values = Array.from({ length: 96 }, (_, i) => {
        const c = at(row + 1 + Math.floor(i / 12), col + (i % 12));
        if (c?.numeric === null || !c)
          warnings.push(`${'ABCDEFGH'[Math.floor(i / 12)]}${(i % 12) + 1}: ${c?.text || '빈 칸'} — 측정값 없음`);
        return c?.numeric ?? null;
      });
      const wavelengths = Array.from({ length: 8 }, (_, i) => at(row + i + 1, col + 12)?.numeric);
      const wavelengthNm =
        wavelengths.every((v) => v === wavelengths[0]) && wavelengths[0] != null && wavelengths[0] >= 200 && wavelengths[0] <= 1000
          ? wavelengths[0]
          : null;
      grids.push({
        id: `${sheet.getAttribute('sheetId')}:${ref}`,
        sheet: sheet.getAttribute('name') ?? '',
        origin: ref,
        values,
        wavelengthNm,
        warnings,
      });
    }
  }
  if (!grids.length) throw new Error('A–H 행과 1–12 열 라벨이 있는 96-well 표를 찾지 못했습니다');
  return { grids };
}
