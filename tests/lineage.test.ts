import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Config from '../src/server/config';
import type { CellLineLogDto, CultureDto, LogDto, LotDto } from '../src/shared/cell-line';
import type { LineageGraph } from '../src/shared/lineage';
vi.mock('../src/server/config', async (importOriginal) => {
  const actual = await importOriginal<typeof Config>();
  return { ...actual, PATHS: { ...actual.PATHS, db: ':memory:' } };
});
import { createApp } from '../src/server/app';
import { db, now } from '../src/server/db';

const app = createApp();
const at = '2026-10-01T09:00:00.000Z';
let lot: LotDto;
let culture: CultureDto;
let children: CultureDto[];
const json = (method: string, body: unknown) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
beforeAll(() => {
  db.prepare('INSERT INTO cell_lines(id,name,max_passage,created_at,updated_at) VALUES(?,?,?,?,?)').run('hela', 'HeLa', 5, now(), now());
});
describe('재고와 배양 계보', () => {
  it('1. 바이알 3개 P5 stock을 받는다', async () => {
    const res = await app.request('/api/cell-lines/hela/lots', json('POST', { passage: 5, vials: 3, receivedAt: at }));
    expect(res.status).toBe(201);
    lot = (await res.json()) as LotDto;
    expect(lot.vialsInitial).toBe(3);
    expect(lot.origin).toBe('received');
  });
  it('2. 해동은 바이알을 차감하고 passage를 유지한다', async () => {
    const res = await app.request(`/api/lots/${lot.id}/thaw`, json('POST', { vessel: 'T75', at }));
    expect(res.status).toBe(201);
    const result = (await res.json()) as { culture: CultureDto; lot: LotDto };
    culture = result.culture;
    expect(result.lot.vialsRemaining).toBe(2);
    expect(culture.passage).toBe(5);
    expect(culture.label).toBe('HeLa-P5-T1');
  });
  it('3. 계대는 P6 자식 A/B를 만들고 부모를 종료한다', async () => {
    const res = await app.request(
      `/api/cultures/${culture.id}/passage`,
      json('POST', { at, children: [{ vessel: 'T75' }, { vessel: 'T25' }], splitRatio: '1:2', confluencyPct: 80 }),
    );
    const result = (await res.json()) as { parent: CultureDto; children: CultureDto[]; warnings: string[] };
    expect(res.status).toBe(201);
    children = result.children;
    expect(children.map((c) => c.passage)).toEqual([6, 6]);
    expect(children.map((c) => c.label)).toEqual(['HeLa-P6-A', 'HeLa-P6-B']);
    expect(result.parent.status).toBe('split');
  });
  it('4. 자식 A를 바이알 4개로 동결한다', async () => {
    const res = await app.request(
      `/api/cultures/${children[0].id}/freeze`,
      json('POST', { at, vials: 4, location: 'LN2 A-1', endCulture: true }),
    );
    const result = (await res.json()) as { lot: LotDto; culture: CultureDto };
    expect(res.status).toBe(201);
    expect(result.lot).toMatchObject({ passage: 6, origin: 'frozen', vialsRemaining: 4, label: 'HeLa-P6-F261001' });
    expect(result.culture.status).toBe('frozen');
  });
  it('5. 남은 바이알 2개를 소진하면 다음 해동은 409이다', async () => {
    expect((await app.request(`/api/lots/${lot.id}/thaw`, json('POST', { vials: 2, vessel: 'T75', at }))).status).toBe(201);
    const res = await app.request(`/api/lots/${lot.id}/thaw`, json('POST', { vessel: 'T75', at }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: '남은 바이알이 없습니다' });
  });
  it('6. 종료된 부모는 다시 계대할 수 없다', async () => {
    const res = await app.request(`/api/cultures/${culture.id}/passage`, json('POST', { at, children: [{ vessel: 'T75' }] }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: '활성 상태의 배양만 계대할 수 있습니다' });
  });
  it('7. 해동 2개, 계대 2개, 동결 1개 edge를 반환한다', async () => {
    const graph = (await (await app.request('/api/cell-lines/hela/lineage')).json()) as LineageGraph;
    expect(graph.edges.filter((e) => e.kind === 'thaw')).toHaveLength(2);
    expect(graph.edges.filter((e) => e.kind === 'passage')).toHaveLength(2);
    expect(graph.edges.filter((e) => e.kind === 'freeze')).toHaveLength(1);
  });
  it('8. 최대 passage를 넘으면 차단하지 않고 경고한다', async () => {
    const res = await app.request(`/api/cultures/${children[1].id}/passage`, json('POST', { at, children: [{ vessel: 'T75' }] }));
    const result = (await res.json()) as { warnings: string[] };
    expect(res.status).toBe(201);
    expect(result.warnings).toEqual(['최대 passage(5)를 넘었습니다']);
  });
  it('검증 실패 시 바이알 차감과 자식 생성을 롤백한다', async () => {
    const created = (await (await app.request('/api/cell-lines/hela/lots', json('POST', { vials: 1, receivedAt: at }))).json()) as LotDto;
    expect((await app.request(`/api/lots/${created.id}/thaw`, json('POST', { vessel: '', at }))).status).toBe(400);
    const row = db.prepare('SELECT vials_remaining FROM cryo_lots WHERE id=?').get(created.id);
    expect(row?.vials_remaining).toBe(1);
    expect(
      (
        await app.request(
          '/api/cell-lines/hela/cultures',
          json('POST', { passage: 0, vessel: 'T75', startedAt: at, profileId: '없는조건' }),
        )
      ).status,
    ).toBe(400);
  });
  it('일반 기록의 수치를 검증하고 계대·동결 기록의 직접 수정과 삭제를 막는다', async () => {
    expect(
      (await app.request(`/api/cultures/${culture.id}/logs`, json('POST', { at, type: 'observation', viabilityPct: 101 }))).status,
    ).toBe(400);
    expect((await app.request(`/api/cultures/${culture.id}/logs`, json('POST', { at, type: 'passage' }))).status).toBe(400);
    const logs = (await (await app.request(`/api/cultures/${culture.id}/logs`)).json()) as LogDto[];
    const passage = logs.find((l) => l.type === 'passage')!;
    expect((await app.request(`/api/logs/${passage.id}`, { method: 'DELETE' })).status).toBe(400);
    expect((await app.request(`/api/logs/${passage.id}`, json('PUT', { note: '변경' }))).status).toBe(400);
    const log = (await (
      await app.request(
        `/api/cultures/${culture.id}/logs`,
        json('POST', { at, type: 'observation', extra: { pH: '7.2' }, confluencyPct: 40 }),
      )
    ).json()) as LogDto;
    const updated = (await (await app.request(`/api/logs/${log.id}`, json('PUT', { confluencyPct: 50 }))).json()) as LogDto;
    expect(updated.confluencyPct).toBe(50);
    expect(updated.extra).toEqual({ pH: '7.2' });
    expect((await app.request(`/api/logs/${log.id}`, { method: 'DELETE' })).status).toBe(200);
  });
  it('대시보드에 배지 교체 지연, passage 경고와 최근 실험을 표시한다', async () => {
    db.prepare(
      'INSERT INTO culture_profiles(id,cell_line_id,name,origin,fields,is_active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)',
    ).run('profile', 'hela', '활성', 'manual', JSON.stringify({ medium_change_days: 2 }), now(), now());
    db.prepare('INSERT INTO bradford_assays(id,title,performed_at,data,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(
      'assay',
      '정량',
      at,
      '{}',
      now(),
      now(),
    );
    db.prepare('INSERT INTO western_runs(id,title,performed_at,status,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(
      'western',
      '실험',
      at,
      'planned',
      '{}',
      now(),
      now(),
    );
    const dashboard = (await (await app.request('/api/dashboard')).json()) as {
      activeCultures: { feedOverdue: boolean; overPassage: boolean }[];
      lowStock: { vialsRemaining: number }[];
      recentBradford: { id: string }[];
      recentWestern: { id: string }[];
    };
    expect(dashboard.activeCultures.some((c) => c.feedOverdue && c.overPassage)).toBe(true);
    expect(dashboard.lowStock.every((l) => l.vialsRemaining <= 2)).toBe(true);
    expect(dashboard.recentBradford[0].id).toBe('assay');
    expect(dashboard.recentWestern[0].id).toBe('western');
  });
  it('세포주 전체 기록을 날짜·생성일·id 내림차순으로 격리해 반환한다', async () => {
    for (const id of ['journal', 'other-journal', 'empty-journal']) {
      db.prepare('INSERT INTO cell_lines(id,name,created_at,updated_at) VALUES(?,?,?,?)').run(id, id, now(), now());
    }
    const createCulture = async (line: string, label: string, passage: number) => {
      const response = await app.request(
        `/api/cell-lines/${line}/cultures`,
        json('POST', { label, passage, vessel: 'T25', startedAt: at }),
      );
      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data).toHaveProperty('culture.id');
      return data.culture as CultureDto;
    };
    const first = await createCulture('journal', '첫 배양', 3);
    const second = await createCulture('journal', '둘째 배양', 4);
    const other = await createCulture('other-journal', '다른 세포주', 8);
    for (const [id, cultureId, date, created] of [
      ['journal-old', first.id, '2026-10-01T09:00:00.000Z', '2026-10-05T09:00:00.000Z'],
      ['journal-new-a', first.id, '2026-10-03T09:00:00.000Z', '2026-10-04T09:00:00.000Z'],
      ['journal-new-b', second.id, '2026-10-03T09:00:00.000Z', '2026-10-04T09:00:00.000Z'],
      ['journal-new-c', second.id, '2026-10-03T09:00:00.000Z', '2026-10-03T09:00:00.000Z'],
      ['journal-other', other.id, '2026-10-06T09:00:00.000Z', '2026-10-06T09:00:00.000Z'],
    ]) {
      db.prepare('INSERT INTO culture_logs(id,culture_id,at,type,created_at) VALUES(?,?,?,?,?)').run(id, cultureId, date, 'note', created);
    }
    const read = async () => (await (await app.request('/api/cell-lines/journal/logs')).json()) as CellLineLogDto[];
    const logs = await read();
    expect(logs.map((l) => l.id)).toEqual(['journal-new-b', 'journal-new-a', 'journal-new-c', 'journal-old']);
    expect(logs[0]).toMatchObject({ cultureId: second.id, cultureLabel: '둘째 배양', culturePassage: 4, extra: {} });
    expect(logs[1]).toMatchObject({ cultureId: first.id, cultureLabel: '첫 배양', culturePassage: 3 });
    expect(await (await app.request('/api/cell-lines/empty-journal/logs')).json()).toEqual([]);
    expect((await app.request('/api/cell-lines/missing-journal/logs')).status).toBe(404);
    expect(
      (
        await app.request(
          '/api/logs/journal-old',
          json('PUT', {
            at: '2026-10-07T09:00:00.000Z',
            type: 'observation',
            confluencyPct: 67,
            extra: { 수행자: '연구자', pH: '7.2' },
            note: '관찰 수정',
          }),
        )
      ).status,
    ).toBe(200);
    expect((await read())[0]).toMatchObject({
      id: 'journal-old',
      confluencyPct: 67,
      note: '관찰 수정',
      extra: { 수행자: '연구자', pH: '7.2' },
    });
    expect((await app.request(`/api/cultures/${first.id}`, json('PUT', { label: '변경한 배양' }))).status).toBe(200);
    expect((await read())[0].cultureLabel).toBe('변경한 배양');
    expect((await app.request('/api/logs/journal-old', { method: 'DELETE' })).status).toBe(200);
    expect((await read()).some((l) => l.id === 'journal-old')).toBe(false);
    expect(((await (await app.request('/api/cell-lines/other-journal/logs')).json()) as CellLineLogDto[]).map((l) => l.id)).toEqual([
      'journal-other',
    ]);
  });
});
