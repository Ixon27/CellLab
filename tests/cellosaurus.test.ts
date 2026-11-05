import { describe, expect, it } from 'vitest';
import fixture from './fixtures/cellosaurus-hela.json';
import { normalizeCellosaurus } from '../src/server/services/cellosaurus';
describe('Cellosaurus 정규화', () => {
  it('실제 HeLa 응답에서 이름·조직·분양처를 추출한다', () => {
    const info = normalizeCellosaurus(fixture);
    expect(info.ac).toBe('CVCL_0030');
    expect(info.name).toBe('HeLa');
    expect(info.synonyms).toContain('Hela');
    expect(info.tissue).toBe('Uterus, cervix');
    expect(info.providers).toContainEqual({
      database: 'KCLB',
      accession: '10002',
      url: 'https://cellbank.snu.ac.kr/cellline/search?sc=y&q=10002',
    });
  });
});
