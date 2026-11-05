import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from '../src/server/protocol-import';

describe('문서 HTML 마크다운 변환', () => {
  it('표의 강조, 구분자와 줄바꿈을 보존한다', () => {
    expect(htmlToMarkdown('<table><tr><td><strong>구분</strong></td><td>항목</td></tr><tr><td>a|b</td><td>c<br/>d</td></tr></table>').trim())
      .toBe('| **구분** | 항목 |\n| --- | --- |\n| a\\|b | c d |');
  });

  it('중첩 목록을 두 칸 들여쓰고 순서 목록을 지원한다', () => {
    expect(htmlToMarkdown('<ul><li>첫째<ul><li>자식<ol><li>손자</li></ol></li></ul></li><li>둘째</li></ul>').trim())
      .toBe('- 첫째\n  - 자식\n    1. 손자\n- 둘째');
  });

  it('제목 다음 문단과 인라인 요소 및 엔티티를 보존한다', () => {
    expect(htmlToMarkdown('<h2>배양 조건</h2><p>배지 &amp; <b> 혈청 </b><i>항생제</i><br/><a href="https://example.com">원문</a></p>').trim())
      .toBe('## 배양 조건\n\n배지 &  **혈청** *항생제*  \n[원문](https://example.com)');
  });

  it('표의 빈 열을 채우고 빈 이미지를 생략한다', () => {
    expect(htmlToMarkdown('<table><tr><th>하나</th></tr><tr><td>둘</td><td><p>셋</p><p>넷</p></td></tr></table><img src=""/>').trim())
      .toBe('| 하나 |  |\n| --- | --- |\n| 둘 | 셋 넷 |');
  });
});
