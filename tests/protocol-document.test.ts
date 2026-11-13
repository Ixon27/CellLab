import { readFileSync } from 'node:fs';
import { getSchema, type JSONContent } from '@tiptap/core';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { prepareProtocolDocument, protocolDocumentExtensions, serializeProtocolDocument } from '../src/web/components/protocol-document-codec';
import { protocolStepTransaction } from '../src/web/components/protocol-document-steps';

const schema = getSchema(protocolDocumentExtensions());

function descendants(document: JSONContent, type: string): JSONContent[] {
  return [ ...(document.type === type ? [document] : []), ...(document.content ?? []).flatMap((child) => descendants(child, type)) ];
}

function visualDocument(source: string): JSONContent {
  const result = prepareProtocolDocument(source);
  expect(result.warning).toBeNull();
  expect(result.document).not.toBeNull();
  return result.document!;
}

function stateAtStep(document: JSONContent, text: string) {
  const doc = schema.nodeFromJSON(document);
  let position = -1;
  doc.descendants((node, at) => { if (node.isText && node.text === text) position = at; });
  expect(position).toBeGreaterThanOrEqual(0);
  return EditorState.create({ schema, doc, selection: TextSelection.create(doc, position) });
}

describe('프로토콜 문서 Markdown 왕복 변환', () => {
  it('빈 새 문서를 실제 입력 가능한 문단으로 연다', () => {
    const document = visualDocument('');
    expect(document.content).toEqual([{ type: 'paragraph' }]);
    expect(serializeProtocolDocument(document)).toBe('');
  });

  it('알 수 없는 키·공백을 포함한 변수 원문을 원자 노드로 보존한다', () => {
    const source = '# {{cell_line}}\n\n**{{ base_medium }}** / {{custom.key-v2}} / {{MY_value}}';
    const prepared = prepareProtocolDocument(source);
    const document = visualDocument(source);
    expect(prepared.source).toBe(source);
    expect(descendants(document, 'protocolVariable').map((node) => node.attrs)).toEqual([
      { raw: '{{cell_line}}', key: 'cell_line' },
      { raw: '{{ base_medium }}', key: 'base_medium' },
      { raw: '{{custom.key-v2}}', key: 'custom.key-v2' },
      { raw: '{{MY_value}}', key: 'MY_value' },
    ]);
    expect(descendants(document, 'protocolVariable')[1].marks).toContainEqual({ type: 'bold' });
    const serialized = serializeProtocolDocument(document);
    for (const raw of ['{{cell_line}}', '{{ base_medium }}', '{{custom.key-v2}}', '{{MY_value}}']) expect(serialized).toContain(raw);
    expect(serialized).not.toContain('연결 조건');
    expect(schema.nodeFromJSON(visualDocument(serialized)).toJSON()).toEqual(schema.nodeFromJSON(document).toJSON());
  });

  it('변수 앞뒤의 연속 서식과 변수 자체의 링크·기울임·취소선을 유지한다', () => {
    const source = '**앞 {{x}} 뒤** / *{{y}}* / ~~{{z}}~~ / [{{a}}](https://example.org)';
    const document = visualDocument(source);
    const serialized = serializeProtocolDocument(document);
    expect(serialized).toBe(source);
    expect(descendants(document, 'protocolVariable').map((node) => node.marks?.[0].type)).toEqual(['bold', 'italic', 'strike', 'link']);
    expect(schema.nodeFromJSON(visualDocument(serialized)).toJSON()).toEqual(schema.nodeFromJSON(document).toJSON());
  });

  it('변수 직렬화용 임시 식별자처럼 보이는 사용자 글도 변경하지 않는다', () => {
    const source = 'CELLLABVARIABLE0END / CELLLABVARIABLEX1END / {{custom_key}}';
    expect(serializeProtocolDocument(visualDocument(source))).toBe(source);
  });

  it('제목·주의·중첩 번호/글머리·강조·링크·정렬된 표와 파이프 문자를 유지한다', () => {
    const source = [
      '## 실험 순서', '', '> **주의:** 원문 조건을 확인하세요.', '',
      '3. 첫 단계', '   - 중첩 *메모* {{custom_value}}', '   - [근거](https://example.org/methods "원문")',
      '4. 다음 단계', '',
      '| 항목 | 조건 |', '| :--- | ---: |', '| A\\|B | {{base_medium}} |', '| **기록** | `x_y` |',
    ].join('\n');
    const document = visualDocument(source);
    expect(descendants(document, 'orderedList')[0].attrs?.start).toBe(3);
    expect(descendants(document, 'bulletList')).toHaveLength(1);
    expect(descendants(document, 'tableRow')).toHaveLength(3);
    expect(descendants(document, 'tableHeader').map((cell) => cell.attrs?.align)).toEqual(['left', 'right']);
    const serialized = serializeProtocolDocument(document);
    expect(serialized).toContain('A\\|B');
    expect(serialized).toContain('https://example.org/methods');
    expect(schema.nodeFromJSON(visualDocument(serialized)).toJSON()).toEqual(schema.nodeFromJSON(document).toJSON());
  });

  it('코드 안의 변수 모양은 실행 조건 칩으로 바꾸지 않는다', () => {
    const source = '`{{literal}}`\n\n```text\n{{code_example}}\n```';
    const document = visualDocument(source);
    expect(descendants(document, 'protocolVariable')).toHaveLength(0);
    expect(serializeProtocolDocument(document)).toContain('{{code_example}}');
  });

  for (const name of ['sop-adherent', 'sop-suspension', 'western-blot-v1-1', 'western-lab-notes']) {
    it(`실제 내장 문서 ${name}을 읽기/편집 가능한 구조로 왕복 변환한다`, () => {
      const source = readFileSync(new URL(`../seed/protocols/${name}.md`, import.meta.url), 'utf8');
      const document = visualDocument(source);
      const serialized = serializeProtocolDocument(document);
      expect(prepareProtocolDocument(source).source).toBe(source);
      expect(schema.nodeFromJSON(visualDocument(serialized)).textContent).toBe(schema.nodeFromJSON(document).textContent);
      expect(descendants(visualDocument(serialized), 'tableRow')).toHaveLength(descendants(document, 'tableRow').length);
    });
  }

  for (const source of [
    '---\ncustom: true\n---\n\n본문\n',
    '<custom-widget data-value="원문">보존</custom-widget>\n\n{{custom_key}}\n',
    '[참조][evidence]\n\n[evidence]: https://example.org "원문"\n',
    '![실험 원본](file.png "원본")\n',
    '- [x] 사용자가 완료한 단계\n- [ ] 다음 단계\n',
    '측정[^source]\n\n[^source]: 원문 각주\n',
    '$$\nx_1 + x_2\n$$\n',
    '::: custom\n원문\n:::\n',
  ]) {
    it(`지원하지 않는 입력은 원문을 한 글자도 바꾸지 않고 편집용 폴백으로 남긴다: ${source.slice(0, 24)}`, () => {
      const result = prepareProtocolDocument(source);
      expect(result.document).toBeNull();
      expect(result.warning).toContain('원문');
      expect(result.source).toBe(source);
      const edited = `${source}\n추가한 사용자 기록  \n`;
      expect(prepareProtocolDocument(edited).source).toBe(edited);
    });
  }
});

describe('프로토콜 단계 조작', () => {
  it('중첩 목록과 변수를 포함한 단계를 함께 이동하고 삭제한다', () => {
    const document = visualDocument('1. 첫 단계\n   - {{custom_value}}\n2. 둘째 단계\n3. 셋째 단계');
    let state = stateAtStep(document, '둘째 단계');
    state = state.apply(protocolStepTransaction(state, 'up')!);
    expect(state.doc.firstChild?.child(0).textContent).toBe('둘째 단계');
    expect(state.doc.firstChild?.child(1).childCount).toBe(2);
    state = state.apply(protocolStepTransaction(state, 'down')!);
    expect(state.doc.firstChild?.child(0).childCount).toBe(2);
    state = state.apply(protocolStepTransaction(state, 'remove')!);
    expect(state.doc.firstChild?.childCount).toBe(2);
    expect(serializeProtocolDocument(state.doc.toJSON())).toContain('{{custom_value}}');
    expect(serializeProtocolDocument(state.doc.toJSON())).not.toContain('둘째 단계');
  });

  it('단계 추가는 빈 문단만 만들며 과학적 기본값을 넣지 않는다', () => {
    let state = stateAtStep(visualDocument('1. 기존 단계'), '기존 단계');
    state = state.apply(protocolStepTransaction(state, 'add')!);
    expect(state.doc.firstChild?.childCount).toBe(2);
    expect(state.doc.firstChild?.child(1).textContent).toBe('');
    expect(state.selection.$from.parent.type.name).toBe('paragraph');
    state = state.apply(protocolStepTransaction(state, 'remove')!);
    state = stateAtStep(state.doc.toJSON(), '기존 단계');
    state = state.apply(protocolStepTransaction(state, 'remove')!);
    expect(state.doc.toJSON()).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });

  it('목록 밖·첫 단계 위·마지막 단계 아래 이동은 문서를 바꾸지 않는다', () => {
    const document = visualDocument('1. 첫 단계\n2. 마지막 단계');
    expect(protocolStepTransaction(stateAtStep(document, '첫 단계'), 'up')).toBeNull();
    expect(protocolStepTransaction(stateAtStep(document, '마지막 단계'), 'down')).toBeNull();
    expect(protocolStepTransaction(stateAtStep(visualDocument('일반 문단'), '일반 문단'), 'remove')).toBeNull();
  });
});
