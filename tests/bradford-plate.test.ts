import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { parseBradfordWorkbook, MAX_WORKBOOK_BYTES } from '../src/server/bradford-workbook';
import { applyPlate, emptyPlate, removePlateRow, validateBradfordData, computeBradford, type BradfordData } from '../src/shared/bradford';
async function fixture(duplicate = false) {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Epoch2" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file('xl/sharedStrings.xml', '<sst><si><t>A</t></si></sst>');
  let cells = '';
  const add = (ref: string, value: string, type = '') => { cells += `<c r="${ref}"${type ? ` t="${type}"` : ''}><v>${value}</v></c>`; };
  function grid(row: number) {
    for (let c = 0; c < 12; c++) add(`${String.fromCharCode(67 + c)}${row}`, String(c + 1));
    for (let r = 0; r < 8; r++) {
      if (!r) add(`B${row + r + 1}`, '0', 's');
      else cells += `<c r="B${row + r + 1}" t="inlineStr"><is><t>${'ABCDEFGH'[r]}</t></is></c>`;
      for (let c = 0; c < 12; c++) {
        if (r === 0 && c === 0) continue;
        add(`${String.fromCharCode(67 + c)}${row + r + 1}`, r === 0 && c === 1 ? 'OVER' : r === 0 && c === 2 ? '#DIV/0!' : String((r * 12 + c) / 100), r === 0 && c === 1 ? 'str' : r === 0 && c === 2 ? 'e' : '');
      }
      add(`O${row + r + 1}`, '595');
    }
  }
  grid(24); if (duplicate) grid(50);
  zip.file('xl/worksheets/sheet1.xml', `<worksheet><sheetData>${cells}</sheetData></worksheet>`);
  zip.file('xl/vbaProject.bin', 'NOT EXECUTABLE');
  return zip.generateAsync({ type: 'nodebuffer' });
}
function data(): BradfordData { return { wavelengthNm: 595, fit: 'linear', subtractBlank: true, standards: [0, 125, 250].map(conc => ({ conc, reps: [{ abs: null, excluded: false }] })), samples: [{ name: '시료', dilution: 5, cultureId: null, reps: [{ abs: null, excluded: false }] }], notes: '', plate: emptyPlate() }; }
describe('엑셀 플레이트 가져오기', () => {
  it('finds a displaced grid and keeps blank, OVER and error cells null, excluding wavelength metadata', async () => {
    const { grids } = await parseBradfordWorkbook(await fixture());
    expect(grids).toHaveLength(1); expect(grids[0].origin).toBe('C24'); expect(grids[0].sheet).toBe('Epoch2');
    expect(grids[0].values).toHaveLength(96); expect(grids[0].values.slice(0, 4)).toEqual([null, null, null, 0.03]);
    expect(grids[0].wavelengthNm).toBe(595); expect(grids[0].values).not.toContain(595); expect(grids[0].warnings).toHaveLength(3);
  });
  it('returns every labeled grid for explicit selection', async () => { expect((await parseBradfordWorkbook(await fixture(true))).grids).toHaveLength(2); });
  it('rejects corrupt and oversized input', async () => { await expect(parseBradfordWorkbook(Buffer.from('bad'))).rejects.toThrow(); await expect(parseBradfordWorkbook(Buffer.alloc(MAX_WORKBOOK_BYTES + 1))).rejects.toThrow('10 MB'); });
});
describe('플레이트 계산', () => {
  it('uses mapped values and exclusions as source of truth with missing-well warnings', () => {
    const d = data(); d.plate!.mappings[0] = { kind: 'standard', index: 0 }; d.plate!.values[0] = 0.05;
    d.plate!.mappings[1] = { kind: 'sample', index: 0 }; d.plate!.mappings[2] = { kind: 'sample', index: 0 }; d.plate!.values[1] = 0.5; d.plate!.excluded[1] = true;
    const applied = validateBradfordData(d); expect(applied.samples[0].reps).toEqual([{ abs: 0.5, excluded: true }, { abs: null, excluded: false }]);
    expect(computeBradford(d).warnings.join()).toContain('A3'); expect(computeBradford(d).samples[0].mean).toBeNull();
  });
  it('rejects stale references and seven replicates without truncating', () => {
    const d = data(); d.plate!.mappings[0] = { kind: 'sample', index: 8 }; expect(() => validateBradfordData(d)).toThrow('배정');
    d.plate!.mappings.fill(null); for (let i = 0; i < 7; i++) d.plate!.mappings[i] = { kind: 'sample', index: 0 };
    expect(() => applyPlate(d)).toThrow('6개');
  });
  it('deleting a standard clears its wells and remaps later indexes only', () => {
    const d = data(); d.plate!.mappings[0] = { kind: 'standard', index: 1 }; d.plate!.mappings[1] = { kind: 'standard', index: 2 };
    const next = removePlateRow(d, 'standard', 1); expect(next.plate!.mappings.slice(0, 2)).toEqual([null, { kind: 'standard', index: 1 }]); expect(next.standards[1].conc).toBe(250);
  });
});

  it('feeds plate replicates into the existing regression and dilution calculation', () => {
    const d = data();
    d.standards.forEach((s, index) => { d.plate!.mappings[index] = { kind: 'standard', index }; d.plate!.values[index] = 0.05 + 0.001 * s.conc; });
    d.plate!.mappings[12] = { kind: 'sample', index: 0 }; d.plate!.values[12] = 0.25;
    const result = computeBradford(d);
    expect(result.fit!.r2).toBeCloseTo(1, 12); expect(result.samples[0].stockUgPerUl).toBeCloseTo(1, 12);
  });