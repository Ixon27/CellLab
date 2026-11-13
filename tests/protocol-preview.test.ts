import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProtocolPreview } from '../src/web/components/ProtocolPreview';

describe('읽기 전용 프로토콜 미리보기', () => {
  it('변수를 읽기 쉬운 이름으로 렌더링하고 원본 템플릿을 수정하지 않는다', () => {
    const protocol = { id: 'sop-adherent', body_md: '# 배양\n\n{{base_medium}} / {{custom_value}}' };
    const html = renderToStaticMarkup(createElement(ProtocolPreview, { protocol }));
    expect(html).toContain('미설정: 기본 배지');
    expect(html).toContain('미설정: 사용자 항목 custom value');
    expect(html).not.toContain('{{');
    expect(html).toContain('AI 작성 일반 배양 초안');
    expect(html).toContain('외부 검증 출처가 없으며');
    expect(protocol.body_md).toBe('# 배양\n\n{{base_medium}} / {{custom_value}}');
  });

  it('일반 본문·표는 유지하고 실제 가져온 파일 출처를 표시한다', () => {
    const html = renderToStaticMarkup(createElement(ProtocolPreview, { protocol: {
      id: 'custom', source_file: '직접 가져온 문서.md', body_md: '| 항목 | 값 |\n| --- | --- |\n| 배지 | 실험실 설정 |',
    } }));
    expect(html).toContain('<table>');
    expect(html).toContain('실험실 설정');
    expect(html).toContain('직접 가져온 문서.md');
    expect(html).not.toContain('템플릿 미리보기입니다');
  });
});
