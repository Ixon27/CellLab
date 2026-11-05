import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeEntities, htmlParagraphs, jatsParagraphs, selectEvidence, splitSentences } from '../src/shared/evidence';
import { buildMethodsQuery } from '../src/server/services/europepmc';
const xml = readFileSync(new URL('./fixtures/jats-min.xml', import.meta.url), 'utf8');
describe('원문 근거 추출', () => {
  it('본문의 제목과 문단을 연결하고 엔티티와 인용 태그를 처리한다', () => {
    const paragraphs = jatsParagraphs(xml);
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].heading).toBe('2.2. Cell Culture and Transfection');
    expect(paragraphs[0].text).toContain('10% FBS & 1% penicillin.');
    expect(paragraphs[0].text).not.toContain('[1]');
    expect(decodeEntities('&lt;&gt;&quot;&apos;&#65;&#x42;&amp;')).toBe('<>"\'AB&');
  });
  it('대상 세포주의 문장과 원문을 보존하고 안정적인 id를 붙인다', () => {
    const evidence = selectEvidence(jatsParagraphs(xml), ['HeLa'], 'S1', 12000);
    expect(evidence[0]).toEqual({
      id: 'S1-1',
      heading: '2.2. Cell Culture and Transfection',
      text: 'HeLa cells were obtained from the Korean Cell Line Bank (KCLB, Seoul, Republic of Korea; KCLB No. 10002).',
    });
    expect(evidence.map((e) => e.id)).toEqual(['S1-1', 'S1-2', 'S1-3']);
  });
  it('글자 수 제한 내에서 1순위 문장을 먼저 선택한다', () => {
    const paragraphs = [
      { heading: 'Methods', text: 'A549 cells were cultured in RPMI medium.' },
      { heading: '', text: 'HeLa cells were cultured in DMEM.' },
    ];
    const evidence = selectEvidence(paragraphs, ['HeLa'], 'S', 35);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].text).toContain('HeLa');
    expect(selectEvidence(jatsParagraphs(xml), ['HeLa'], 'S1', 5)).toEqual([]);
  });
  it('분양처 HTML의 잡음을 버리고 배양 문장을 고른다', () => {
    const paragraphs = htmlParagraphs(
      '<nav>Navigation that should not appear</nav><p>Medium: 90% MEM and 10% FBS serum.</p><script>script content that should not appear</script>',
    );
    expect(selectEvidence(paragraphs, [], 'S0', 8000)).toHaveLength(1);
    expect(splitSentences('Cells were cultured in DMEM. 5% CO2. More cells were frozen.')[0]).toContain('5% CO2.');
  });
  it('대소문자 중복을 제거한 Methods 검색식을 만든다', () => {
    expect(buildMethodsQuery(['HeLa', 'HELA', 'Hela'], ['KCLB', 'Korean Cell Line Bank'])).toBe(
      '(METHODS:"HeLa") AND (METHODS:"KCLB" OR METHODS:"Korean Cell Line Bank") AND OPEN_ACCESS:y AND HAS_FT:y',
    );
  });
});
