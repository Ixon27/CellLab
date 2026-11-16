import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Config from '../src/server/config';
import type { CultureDto, LogDto, LotDto } from '../src/shared/cell-line';
import type { CellProtocolDto } from '../src/shared/protocol-run';
import { protocolSteps } from '../src/shared/protocol-run';
vi.mock('../src/server/config', async (importOriginal) => {
  const actual = await importOriginal<typeof Config>();
  return { ...actual, PATHS: { ...actual.PATHS, db: ':memory:' } };
});
import { createApp } from '../src/server/app';
import { db, now } from '../src/server/db';

const app = createApp();
const json = (method: string, body: unknown) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const at = '2026-11-10T09:00:00.000Z';
const BODY = '## 해동\n\n1. 37 °C 수조에서 1–2분 녹인다\n2. 배지 9 mL에 옮긴다\n3. {{temp_c}} °C 배양기에 넣는다\n';
let culture: CultureDto;
let thaw: CellProtocolDto;

async function request<T>(path: string, method: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await app.request(path, body === undefined ? { method } : json(method, body));
  return { status: res.status, data: (await res.json()) as T };
}
const list = async () => (await request<CellProtocolDto[]>('/api/cell-lines/l929/protocols', 'GET')).data;

beforeAll(async () => {
  db.prepare('INSERT INTO cell_lines(id,name,created_at,updated_at) VALUES(?,?,?,?)').run('l929', 'L929', now(), now());
  db.prepare('INSERT INTO cell_lines(id,name,created_at,updated_at) VALUES(?,?,?,?)').run('other', 'Other', now(), now());
  db.prepare(
    "INSERT INTO culture_profiles(id,cell_line_id,name,origin,fields,is_active,created_at,updated_at) VALUES('p1','l929','기본','manual',?,1,?,?)",
  ).run(JSON.stringify({ temp_c: 37 }), now(), now());
  const lot = (await request<LotDto>('/api/cell-lines/l929/lots', 'POST', { passage: 3, vials: 2, receivedAt: at })).data;
  culture = (await request<{ culture: CultureDto }>(`/api/lots/${lot.id}/thaw`, 'POST', { vessel: 'T25', at })).data.culture;
});

describe('세포주 프로토콜 폴더', () => {
  it('빈 문서와 라이브러리 사본을 폴더에 만들고 라이브러리 목록과 분리한다', async () => {
    const blank = await request<{ id: string }>('/api/cell-lines/l929/protocols', 'POST', { folder: 'thaw', title: 'L929 해동', bodyMd: BODY });
    expect(blank.status).toBe(201);
    const copy = await request<{ id: string; provenance: { cellLineId: string } }>('/api/cell-lines/l929/protocols', 'POST', {
      folder: 'passage',
      sourceProtocolId: 'sop-adherent',
    });
    expect(copy.status).toBe(201);
    expect(copy.data.provenance.cellLineId).toBe('l929');
    const items = await list();
    thaw = items.find((p) => p.id === blank.data.id)!;
    expect(thaw.folder).toBe('thaw');
    expect(items.find((p) => p.id === copy.data.id)).toMatchObject({ folder: 'passage', title: '부착 세포 배양 SOP', copiedFrom: { id: 'sop-adherent' } });
    const library = (await request<{ id: string }[]>('/api/protocols', 'GET')).data.map((p) => p.id);
    expect(library).toContain('sop-adherent');
    expect(library).not.toContain(blank.data.id);
    const all = (await request<{ id: string; cell_line_name: string | null }[]>('/api/protocols?includeCell=1', 'GET')).data;
    expect(all.find((p) => p.id === blank.data.id)?.cell_line_name).toBe('L929');
  });

  it('폴더를 옮기고 다른 세포주나 잘못된 폴더는 거부한다', async () => {
    const moved = await request('/api/cell-lines/l929/protocols/' + thaw.id, 'PATCH', { folder: 'treatment' });
    expect(moved.status).toBe(200);
    expect((await list()).find((p) => p.id === thaw.id)?.folder).toBe('treatment');
    expect((await request('/api/cell-lines/other/protocols/' + thaw.id, 'PATCH', { folder: 'thaw' })).status).toBe(404);
    expect((await request('/api/cell-lines/l929/protocols/' + thaw.id, 'PATCH', { folder: 'misc' })).status).toBe(400);
    expect((await request('/api/cell-lines/l929/protocols', 'POST', { folder: 'thaw', title: '' })).status).toBe(400);
    await request('/api/cell-lines/l929/protocols/' + thaw.id, 'PATCH', { folder: 'thaw' });
    thaw = (await list()).find((p) => p.id === thaw.id)!;
  });
});

describe('이번 기록에만 적용하는 단계 변경', () => {
  it('변경한 단계는 원래 문장과 함께 기록되고 원본 프로토콜은 그대로다', async () => {
    const res = await request<LogDto>(`/api/cultures/${culture.id}/logs`, 'POST', {
      type: 'treatment',
      at,
      note: '',
      protocolRun: {
        protocolId: thaw.id,
        protocolUpdatedAt: thaw.updatedAt,
        deviations: [
          { index: 1, text: '배지 5 mL에 옮겼다' },
          { index: 0, text: '' },
        ],
      },
    });
    expect(res.status).toBe(201);
    const run = res.data.protocolRun!;
    expect(run.title).toBe('L929 해동');
    expect(run.steps.map((s) => [s.original, s.modified])).toEqual([
      ['37 °C 수조에서 1–2분 녹인다', ''],
      ['배지 9 mL에 옮긴다', '배지 5 mL에 옮겼다'],
      ['37 °C 배양기에 넣는다', null],
    ]);
    expect(run.steps[0].section).toBe('해동');
    const stored = db.prepare('SELECT body_md, updated_at FROM protocols WHERE id=?').get(thaw.id) as { body_md: string; updated_at: string };
    expect(stored).toEqual({ body_md: BODY, updated_at: thaw.updatedAt });
  });

  it('보는 사이 프로토콜이 바뀌었거나 없는 단계를 고치면 기록하지 않는다', async () => {
    const count = () => (db.prepare('SELECT COUNT(*) AS n FROM culture_logs WHERE culture_id=?').get(culture.id) as { n: number }).n;
    const before = count();
    const run = (deviations: unknown[], protocolUpdatedAt = thaw.updatedAt) => ({ protocolId: thaw.id, protocolUpdatedAt, deviations });
    expect((await request(`/api/cultures/${culture.id}/logs`, 'POST', { type: 'note', at, protocolRun: run([], '2000-01-01T00:00:00.000Z') })).status).toBe(409);
    expect((await request(`/api/cultures/${culture.id}/logs`, 'POST', { type: 'note', at, protocolRun: run([{ index: 9, text: 'x' }]) })).status).toBe(400);
    expect((await request(`/api/cultures/${culture.id}/logs`, 'POST', { type: 'note', at, protocolRun: run([{ index: 0, text: 'a' }, { index: 0, text: 'b' }]) })).status).toBe(400);
    expect(count()).toBe(before);
  });

  it('프로토콜을 지워도 기록에 남은 단계는 유지된다', async () => {
    await request(`/api/protocols/${thaw.id}`, 'DELETE');
    const logs = (await request<LogDto[]>(`/api/cultures/${culture.id}/logs`, 'GET')).data;
    const run = logs.find((l) => l.protocolRun)!.protocolRun!;
    expect(run.protocolId).toBeNull();
    expect(run.steps[1].modified).toBe('배지 5 mL에 옮겼다');
  });
});

describe('protocolSteps', () => {
  it('제목은 구역, 목록 항목·문단·표는 단계로 나눈다', () => {
    const steps = protocolSteps('> 주의\n\n# 계대\n\n1. 세척\n   - PBS 2회\n2. 탈착\n\n| a | b |\n|---|---|\n| 1 | 2 |\n');
    expect(steps.map((s) => [s.section, s.text.split('\n')[0]])).toEqual([
      [null, '> 주의'],
      ['계대', '세척'],
      ['계대', '탈착'],
      ['계대', '| a | b |'],
    ]);
  });
});
