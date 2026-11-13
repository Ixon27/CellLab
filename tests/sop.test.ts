import { describe, expect, it } from 'vitest';
import { fillSop, previewSop } from '../src/shared/sop';

describe('배양 SOP 채우기', () => {
  it('프로필 값을 채우고 미설정 필드와 모르는 키를 읽기 쉽게 표시한다', () => {
    const markdown = fillSop(
      '{{cell_line}}: {{base_medium}} / {{serum_pct}} / {{unknown_key}}',
      { name: 'HeLa', max_passage: null },
      { base_medium: 'DMEM', serum_pct: null },
    );
    expect(markdown).toBe('HeLa: DMEM / **(미설정: 혈청 농도)** / **(미설정: 사용자 항목 unknown key)**');
  });

  it('목록, 완전 배지, 최대 passage와 숫자 0을 채운다', () => {
    const markdown = fillSop(
      '{{complete_medium}}\n{{supplements}}\n{{co2_pct}}\n{{max_passage}}',
      { name: 'HeLa', max_passage: 20 },
      {
        base_medium: 'DMEM',
        serum: 'FBS',
        serum_pct: 10,
        supplements: ['GlutaMAX', 'NEAA'],
        co2_pct: 0,
      },
    );
    expect(markdown).toBe('DMEM + 10% FBS + GlutaMAX + NEAA\nGlutaMAX, NEAA\n0\n20');
  });

  it('빈 목록과 빈 문자열 및 없는 값을 미정으로 표시한다', () => {
    expect(
      fillSop(
        '{{complete_medium}} {{supplements}} {{serum}} {{max_passage}}',
        { name: '세포', max_passage: null },
        { supplements: [], serum: ' ' },
      ),
    ).toBe('**(미설정: 완전 배지)** **(미설정: 첨가물)** **(미설정: 혈청)** **(미설정: 최대 passage)**');
  });

  it('라이브러리 미리보기는 원본 변수를 보존하고 누락 항목을 중복 없이 반환한다', () => {
    const template = '{{base_medium}} / {{ base_medium }} / {{custom_field}} / {{cell_line}}';
    const preview = previewSop(template);
    expect(preview.markdown).toBe('**(미설정: 기본 배지)** / **(미설정: 기본 배지)** / **(미설정: 사용자 항목 custom field)** / **(미설정: 세포주)**');
    expect(preview.missingFields).toEqual([
      { key: 'base_medium', label: '기본 배지' },
      { key: 'custom_field', label: '사용자 항목 custom field' },
      { key: 'cell_line', label: '세포주' },
    ]);
    expect(template).toBe('{{base_medium}} / {{ base_medium }} / {{custom_field}} / {{cell_line}}');
  });

  it('변수가 아닌 마크다운은 바꾸지 않고 빈 프로필의 완전 배지를 미설정으로 표시한다', () => {
    const body = '# 프로토콜\\n\\n| 배지 | 값 |\\n| --- | --- |\\n| DMEM | 10% |\\n\\n`{보존}`';
    expect(previewSop(body)).toEqual({ markdown: body, missingFields: [] });
    expect(previewSop('{{complete_medium}}').missingFields).toEqual([{ key: 'complete_medium', label: '완전 배지' }]);
  });
});
