import { describe, expect, it, vi } from 'vitest';
import type * as Config from '../src/server/config';

vi.mock('../src/server/config', async (importOriginal) => {
  const actual = await importOriginal<typeof Config>();
  return { ...actual, PATHS: { ...actual.PATHS, db: ':memory:' } };
});
import { createApp } from '../src/server/app';
import { db, now } from '../src/server/db';

interface Protocol { id: string; title: string; body_md: string; version: string; status: string; source_file: string | null }
interface Revision { id: string; body_md: string; version: string }
const app = createApp();
const json = (method: string, body: unknown) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('프로토콜 라이브러리 API', () => {
  it('내장 프로토콜 네 개와 변환된 원본 표를 제공한다', async () => {
    const all = await (await app.request('/api/protocols')).json() as Protocol[];
    expect(all.map((p) => p.id)).toEqual(expect.arrayContaining(['western-blot-v1-1', 'western-lab-notes', 'sop-adherent', 'sop-suspension']));
    const western = await (await app.request('/api/protocols?category=western')).json() as Protocol[];
    expect(western.map((p) => p.id).sort()).toEqual(['western-blot-v1-1', 'western-lab-notes']);
    const doc = await (await app.request('/api/protocols/western-blot-v1-1')).json() as Protocol;
    expect(doc.body_md).toContain('| D.W | 2,839 | 2,425 | 2,009 | 1,675 | 1,175 |');
    expect(doc.body_md).toContain('| 검은판 / 음극 쪽 | 스펀지 |');
    expect((await app.request('/api/protocols/western-blot-v1-1', { method: 'DELETE' })).status).toBe(400);
    expect((await app.request('/api/protocols/western-lab-notes', { method: 'DELETE' })).status).toBe(400);
  });

  it('본문 변경 전 버전을 보관하고 복원 시 현재 본문도 보관한다', async () => {
    const response = await app.request('/api/protocols', json('POST', { title: '사용자 SOP', category: 'culture_sop', version: 'v1', bodyMd: '처음' }));
    expect(response.status).toBe(201);
    const doc = await response.json() as Protocol;
    expect((await app.request(`/api/protocols/${doc.id}`, json('PUT', { bodyMd: '두 번째', version: 'v2' }))).status).toBe(200);
    await app.request(`/api/protocols/${doc.id}`, json('PUT', { bodyMd: '세 번째', version: 'v3' }));
    const revisions = await (await app.request(`/api/protocols/${doc.id}/revisions`)).json() as Revision[];
    expect(revisions).toHaveLength(2);
    expect(revisions.map((r) => r.body_md)).toEqual(['두 번째', '처음']);
    const original = revisions.find((r) => r.version === 'v1')!;
    const restored = await (await app.request(`/api/protocols/${doc.id}/revisions/${original.id}/restore`, { method: 'POST' })).json() as Protocol;
    expect(restored.body_md).toBe('처음');
    expect(restored.version).toBe('v1');
    const after = await (await app.request(`/api/protocols/${doc.id}/revisions`)).json() as Revision[];
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
      const doc = await response.json() as Protocol;
      expect(doc).toMatchObject({ title: '실험', body_md: '# 한글 본문\n\n내용', status: 'draft', source_file: `실험.${extension}` });
    }
  });

  it('지원하지 않는 파일, 큰 파일, 잘못된 분류와 상태를 거부한다', async () => {
    for (const file of [new File(['본문'], '실험.pdf'), new File([new Uint8Array(10 * 1024 * 1024 + 1)], '실험.txt'), new File(['손상된 문서'], '실험.docx')]) {
      const form = new FormData(); form.set('category', 'other'); form.set('file', file);
      expect((await app.request('/api/protocols/import', { method: 'POST', body: form })).status).toBe(400);
    }
    expect((await app.request('/api/protocols?category=unknown')).status).toBe(400);
    expect((await app.request('/api/protocols', json('POST', { title: '제목', category: 'other', status: 'bad', bodyMd: '' }))).status).toBe(400);
    expect((await app.request('/api/protocols', json('POST', { title: '', category: 'other', bodyMd: '' }))).status).toBe(400);
  });

  it('활성 조건과 배양 방식에 맞는 SOP를 제공한다', async () => {
    const at = now();
    db.prepare('INSERT INTO cell_lines(id,name,growth_mode,created_at,updated_at) VALUES(?,?,?,?,?)').run('sop-test-line', 'HeLa', 'adherent', at, at);
    let sop = await (await app.request('/api/cell-lines/sop-test-line/sop')).json() as { protocolId: string; markdown: string };
    expect(sop.protocolId).toBe('sop-adherent');
    expect(sop.markdown).toContain('**(미정: 기본 배지)**');
    db.prepare("INSERT INTO culture_profiles(id,cell_line_id,name,origin,fields,is_active,created_at,updated_at) VALUES(?,?,?,'manual',?,1,?,?)")
      .run('sop-test-profile', 'sop-test-line', '기본', JSON.stringify({ base_medium: 'DMEM', serum: 'FBS', serum_pct: 10 }), at, at);
    sop = await (await app.request('/api/cell-lines/sop-test-line/sop')).json() as { protocolId: string; markdown: string };
    expect(sop.markdown).toContain('DMEM + 10% FBS');
    db.prepare("UPDATE cell_lines SET growth_mode='suspension' WHERE id='sop-test-line'").run();
    sop = await (await app.request('/api/cell-lines/sop-test-line/sop')).json() as { protocolId: string; markdown: string };
    expect(sop.protocolId).toBe('sop-suspension');
    const custom = await (await app.request('/api/protocols', json('POST', { title: '별도 템플릿', category: 'culture_sop', bodyMd: '{{cell_line}}: {{base_medium}}' }))).json() as Protocol;
    db.prepare("UPDATE cell_lines SET sop_protocol_id=? WHERE id='sop-test-line'").run(custom.id);
    sop = await (await app.request('/api/cell-lines/sop-test-line/sop')).json() as { protocolId: string; markdown: string };
    expect(sop).toMatchObject({ protocolId: custom.id, markdown: 'HeLa: DMEM' });
  });
});
