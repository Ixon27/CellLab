import { describe, expect, it } from 'vitest';
import { fillSop } from '../src/shared/sop';

describe('배양 SOP 채우기', () => {
  it('프로필 값을 채우고 미정 필드와 모르는 키를 구분한다', () => {
    const markdown = fillSop(
      '{{cell_line}}: {{base_medium}} / {{serum_pct}} / {{unknown_key}}',
      { name: 'HeLa', max_passage: null },
      { base_medium: 'DMEM', serum_pct: null },
    );
    expect(markdown).toBe('HeLa: DMEM / **(미정: 혈청 농도)** / {{unknown_key}}');
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
    ).toBe('**(미정: 완전 배지)** **(미정: 첨가물)** **(미정: 혈청)** **(미정: 최대 passage)**');
  });
});
