import { describe, expect, it, vi } from 'vitest';
import type * as Config from '../src/server/config';
import type { ProtocolProvenance } from '../src/shared/protocol';
import type { FilledSop } from '../src/shared/sop';

vi.mock('../src/server/config', async (importOriginal) => {
  const actual = await importOriginal<typeof Config>();
  return { ...actual, PATHS: { ...actual.PATHS, db: ':memory:' } };
});
import { createApp } from '../src/server/app';
import { db, now } from '../src/server/db';
import { seedBuiltins } from '../src/server/seed';

interface Protocol {
  id: string;
  title: string;
  body_md: string;
  version: string;
  status: string;
  source_file: string | null;
  provenance: ProtocolProvenance;
}
interface Revision {
  id: string;
  body_md: string;
  version: string;
}
const app = createApp();
const json = (method: string, body: unknown) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('프로토콜 라이브러리 API', () => {
  it('내장 프로토콜 네 개와 변환된 원본 표를 제공한다', async () => {
    const all = (await (await app.request('/api/protocols')).json()) as Protocol[];
    expect(all.map((p) => p.id)).toEqual(
      expect.arrayContaining(['western-blot-v1-1', 'western-lab-notes', 'sop-adherent', 'sop-suspension']),
    );
    const western = (await (await app.request('/api/protocols?category=western')).json()) as Protocol[];
    expect(western.map((p) => p.id).sort()).toEqual(['western-blot-v1-1', 'western-lab-notes']);
    const doc = (await (await app.request('/api/protocols/western-blot-v1-1')).json()) as Protocol;
    expect(doc.body_md).toContain('| D.W | 2,839 | 2,425 | 2,009 | 1,675 | 1,175 |');
    expect(doc.body_md).toContain('| 검은판 / 음극 쪽 | 스펀지 |');
    expect((await app.request('/api/protocols/western-blot-v1-1', { method: 'DELETE' })).status).toBe(400);
    expect((await app.request('/api/protocols/western-lab-notes', { method: 'DELETE' })).status).toBe(400);
  });

  it('본문 변경 전 버전을 보관하고 복원 시 현재 본문도 보관한다', async () => {
    const response = await app.request(
      '/api/protocols',
      json('POST', { title: '사용자 SOP', category: 'culture_sop', version: 'v1', bodyMd: '처음' }),
    );
    expect(response.status).toBe(201);
    const doc = (await response.json()) as Protocol;
    expect((await app.request(`/api/protocols/${doc.id}`, json('PUT', { bodyMd: '두 번째', version: 'v2' }))).status).toBe(200);
    await app.request(`/api/protocols/${doc.id}`, json('PUT', { bodyMd: '세 번째', version: 'v3' }));
    const revisions = (await (await app.request(`/api/protocols/${doc.id}/revisions`)).json()) as Revision[];
    expect(revisions).toHaveLength(2);
    expect(revisions.map((r) => r.body_md)).toEqual(['두 번째', '처음']);
    const original = revisions.find((r) => r.version === 'v1')!;
    const restored = (await (
      await app.request(`/api/protocols/${doc.id}/revisions/${original.id}/restore`, { method: 'POST' })
    ).json()) as Protocol;
    expect(restored.body_md).toBe('처음');
    expect(restored.version).toBe('v1');
    const after = (await (await app.request(`/api/protocols/${doc.id}/revisions`)).json()) as Revision[];
    expect(after).toHaveLength(3);
    expect(after[0].body_md).toBe('세 번째');
    await app.request(`/api/protocols/${doc.id}`, json('PUT', { title: '제목만 변경', status: 'confirmed' }));
    expect(await (await app.request(`/api/protocols/${doc.id}/revisions`)).json()).toHaveLength(3);
    expect((await app.request(`/api/protocols/${doc.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await app.request(`/api/protocols/${doc.id}`)).status).toBe(404);
  });

  it('UTF-8 문서를 가져오고 원래 파일명을 저장한다', async () => {
    for (const extension of ['md', 'txt']) {
      const form = new FormData();
      form.set('category', 'protein');
      form.set('file', new File(['# 한글 본문\n\n내용'], `실험.${extension}`));
      const response = await app.request('/api/protocols/import', { method: 'POST', body: form });
      expect(response.status).toBe(201);
      const doc = (await response.json()) as Protocol;
      expect(doc).toMatchObject({ title: '실험', body_md: '# 한글 본문\n\n내용', status: 'draft', source_file: `실험.${extension}` });
    }
  });

  it('지원하지 않는 파일, 큰 파일, 잘못된 분류와 상태를 거부한다', async () => {
    for (const file of [
      new File(['본문'], '실험.pdf'),
      new File([new Uint8Array(10 * 1024 * 1024 + 1)], '실험.txt'),
      new File(['손상된 문서'], '실험.docx'),
    ]) {
      const form = new FormData();
      form.set('category', 'other');
      form.set('file', file);
      expect((await app.request('/api/protocols/import', { method: 'POST', body: form })).status).toBe(400);
    }
    expect((await app.request('/api/protocols?category=unknown')).status).toBe(400);
    expect(
      (await app.request('/api/protocols', json('POST', { title: '제목', category: 'other', status: 'bad', bodyMd: '' }))).status,
    ).toBe(400);
    expect((await app.request('/api/protocols', json('POST', { title: '', category: 'other', bodyMd: '' }))).status).toBe(400);
  });

  it('활성 조건과 배양 방식에 맞는 SOP를 제공한다', async () => {
    const at = now();
    db.prepare('INSERT INTO cell_lines(id,name,growth_mode,created_at,updated_at) VALUES(?,?,?,?,?)').run(
      'sop-test-line',
      'HeLa',
      'adherent',
      at,
      at,
    );
    let sop = (await (await app.request('/api/cell-lines/sop-test-line/sop')).json()) as { protocolId: string; markdown: string };
    expect(sop.protocolId).toBe('sop-adherent');
    expect(sop.markdown).toContain('**(미설정: 기본 배지)**');
    db.prepare(
      "INSERT INTO culture_profiles(id,cell_line_id,name,origin,fields,is_active,created_at,updated_at) VALUES(?,?,?,'manual',?,1,?,?)",
    ).run('sop-test-profile', 'sop-test-line', '기본', JSON.stringify({ base_medium: 'DMEM', serum: 'FBS', serum_pct: 10 }), at, at);
    sop = (await (await app.request('/api/cell-lines/sop-test-line/sop')).json()) as { protocolId: string; markdown: string };
    expect(sop.markdown).toContain('DMEM + 10% FBS');
    db.prepare("UPDATE cell_lines SET growth_mode='suspension' WHERE id='sop-test-line'").run();
    sop = (await (await app.request('/api/cell-lines/sop-test-line/sop')).json()) as { protocolId: string; markdown: string };
    expect(sop.protocolId).toBe('sop-suspension');
    const custom = (await (
      await app.request(
        '/api/protocols',
        json('POST', { title: '별도 템플릿', category: 'culture_sop', bodyMd: '{{cell_line}}: {{base_medium}}' }),
      )
    ).json()) as Protocol;
    db.prepare("UPDATE cell_lines SET sop_protocol_id=? WHERE id='sop-test-line'").run(custom.id);
    sop = (await (await app.request('/api/cell-lines/sop-test-line/sop')).json()) as { protocolId: string; markdown: string };
    expect(sop).toMatchObject({ protocolId: custom.id, markdown: 'HeLa: DMEM' });
  });

  it('출처를 문서·사진·AI 일반 초안·직접 작성으로 구분한다', async () => {
    const get = async (id: string) => (await (await app.request(`/api/protocols/${id}`)).json()) as Protocol;
    expect((await get('western-blot-v1-1')).provenance).toMatchObject({ kind: 'user_document' });
    expect((await get('western-blot-v1-1')).provenance.detail).toContain('Downloads/Western_blot_프로토콜_재료_주의사항_포함_v1.1.docx');
    expect((await get('western-lab-notes')).provenance).toMatchObject({ kind: 'lab_photos' });
    expect((await get('sop-adherent')).provenance).toMatchObject({ kind: 'ai_draft' });
    const created = (await (await app.request('/api/protocols', json('POST', {
      title: '직접 작성 출처', category: 'other', bodyMd: '사용자 본문',
    }))).json()) as Protocol;
    expect(created.provenance.kind).toBe('manual');
    const list = (await (await app.request('/api/protocols')).json()) as Protocol[];
    expect(list.find((row) => row.id === 'sop-suspension')?.provenance.kind).toBe('ai_draft');
  });

  it('조건 없음과 혼합 배양을 준비 완료로 표시하거나 부착 배양으로 추정하지 않는다', async () => {
    const at = now();
    db.prepare('INSERT INTO cell_lines(id,name,growth_mode,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run('sop-empty-line', '조건 없음', 'adherent', at, at);
    const empty = (await (await app.request('/api/cell-lines/sop-empty-line/sop')).json()) as FilledSop;
    expect(empty).toMatchObject({ profile: null, readiness: 'no_profile', scope: 'general' });
    expect(empty.missingFields).toEqual(expect.arrayContaining([{ key: 'base_medium', label: '기본 배지' }]));
    expect(empty.warnings.length).toBeGreaterThan(0);
    db.prepare('INSERT INTO cell_lines(id,name,growth_mode,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run('sop-mixed-line', '혼합', 'mixed', at, at);
    const mixed = (await (await app.request('/api/cell-lines/sop-mixed-line/sop')).json()) as FilledSop;
    expect(mixed).toMatchObject({ protocolId: null, markdown: '', scope: 'unselected', readiness: 'template_required' });
    expect((await app.request('/api/cell-lines/sop-mixed-line/sop/copy', json('POST', {}))).status).toBe(400);
    const chosen = await app.request('/api/cell-lines/sop-mixed-line/sop/copy', json('POST', { protocolId: 'sop-suspension' }));
    expect(chosen.status).toBe(201);
    const chosenSop = (await (await app.request('/api/cell-lines/sop-mixed-line/sop')).json()) as FilledSop;
    expect(chosenSop.scope).toBe('cell_specific');
    expect(chosenSop.warnings.some((warning) => warning.includes('혼합 배양'))).toBe(true);
  });

  it('전용 사본은 원본과 버전을 보존하고 해당 세포주에만 연결한다', async () => {
    const at = now();
    for (const id of ['sop-copy-line', 'sop-other-line']) {
      db.prepare('INSERT INTO cell_lines(id,name,growth_mode,created_at,updated_at) VALUES(?,?,?,?,?)')
        .run(id, id, 'adherent', at, at);
    }
    const refs = [{ field: 'base_medium', sourceLabel: '실험실이 확인한 원문', url: 'https://example.org/experiment', quote: '사용자가 기록한 배지 근거' }];
    db.prepare('INSERT INTO culture_profiles(id,cell_line_id,name,origin,fields,source_refs,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)')
      .run('sop-copy-profile', 'sop-copy-line', '확인할 배양 조건', 'provider', JSON.stringify({ base_medium: '사용자 배지', temp_c: 37 }), JSON.stringify(refs), at, at);
    const original = (await (await app.request('/api/protocols/sop-adherent')).json()) as Protocol;
    const response = await app.request('/api/cell-lines/sop-copy-line/sop/copy', json('POST', {}));
    expect(response.status).toBe(201);
    const copy = (await response.json()) as Protocol;
    expect(copy.id).not.toBe(original.id);
    expect(copy.body_md).toBe(original.body_md);
    expect(copy.body_md).toContain('{{base_medium}}');
    expect(copy.version).toBe(original.version);
    expect(copy.status).toBe('draft');
    expect(copy.provenance).toMatchObject({ kind: 'cell_copy', cellLineId: 'sop-copy-line', copiedFrom: { id: original.id, version: original.version } });
    const linked = (await (await app.request('/api/cell-lines/sop-copy-line/sop')).json()) as FilledSop;
    expect(linked).toMatchObject({ protocolId: copy.id, scope: 'cell_specific', readiness: 'needs_review', profile: { name: '확인할 배양 조건', origin: 'provider', sourceRefs: refs } });
    expect(linked.markdown).toContain('사용자 배지');
    await app.request(`/api/protocols/${copy.id}`, json('PUT', { bodyMd: '{{cell_line}} / {{base_medium}}', status: 'confirmed' }));
    const changed = (await (await app.request('/api/cell-lines/sop-copy-line/sop')).json()) as FilledSop;
    expect(changed).toMatchObject({ markdown: 'sop-copy-line / 사용자 배지', readiness: 'confirmed', missingFields: [] });
    const unchanged = (await (await app.request('/api/protocols/sop-adherent')).json()) as Protocol;
    expect(unchanged.body_md).toBe(original.body_md);
    expect(unchanged.version).toBe(original.version);
    const other = (await (await app.request('/api/cell-lines/sop-other-line/sop')).json()) as FilledSop;
    expect(other).toMatchObject({ protocolId: 'sop-adherent', scope: 'general' });
    expect(other.markdown).not.toContain('사용자 배지');
  });

  it('재시드는 사용자가 수정한 내장 템플릿과 버전을 덮어쓰지 않는다', async () => {
    const original = (await (await app.request('/api/protocols/sop-suspension')).json()) as Protocol;
    try {
      db.prepare('UPDATE protocols SET body_md=?,version=? WHERE id=?').run('사용자가 보존할 본문 {{base_medium}}', '사용자 버전', original.id);
      seedBuiltins(db);
      const after = (await (await app.request(`/api/protocols/${original.id}`)).json()) as Protocol;
      expect(after).toMatchObject({ body_md: '사용자가 보존할 본문 {{base_medium}}', version: '사용자 버전' });
    } finally {
      db.prepare('UPDATE protocols SET body_md=?,version=? WHERE id=?').run(original.body_md, original.version, original.id);
    }
  });
});
