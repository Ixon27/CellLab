import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Config from '../src/server/config';
import type { CultureDto, LogDto, LotDto } from '../src/shared/cell-line';
import type { LineageGraph } from '../src/shared/lineage';
vi.mock('../src/server/config', async (importOriginal) => {
  const actual = await importOriginal<typeof Config>();
  return { ...actual, PATHS: { ...actual.PATHS, db: ':memory:' } };
});
import { createApp } from '../src/server/app';
import { db, now } from '../src/server/db';

const app = createApp();
const at = '2026-10-01T09:00:00.000Z';
const json = (method: string, body: unknown) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
type ThawResult = { culture: CultureDto; cultures: CultureDto[]; lot: LotDto; warnings: string[] };
let lot: LotDto;

beforeAll(async () => {
  db.prepare('INSERT INTO cell_lines(id,name,max_passage,created_at,updated_at) VALUES(?,?,?,?,?)').run('hela', 'HeLa', 50, now(), now());
  lot = (await (await app.request('/api/cell-lines/hela/lots', json('POST', { passage: 5, vials: 5, receivedAt: at }))).json()) as LotDto;
});

describe('하나의 해동을 여러 배양으로 나누기', () => {
  it('바이알 1개를 용기 3개로 나누면 A/B/C 배양 3개가 생기고 바이알은 1개만 차감된다', async () => {
    const res = await app.request(
      `/api/lots/${lot.id}/thaw`,
      json('POST', { vials: 1, at, cultures: [{ vessel: 'T75' }, { vessel: 'T25', label: '내가 붙인 이름' }, { vessel: '6-well' }] }),
    );
    expect(res.status).toBe(201);
    const result = (await res.json()) as ThawResult;
    expect(result.cultures).toHaveLength(3);
    expect(result.culture.id).toBe(result.cultures[0].id);
    expect(result.cultures.map((c) => c.label)).toEqual(['HeLa-P5-T1-A', '내가 붙인 이름', 'HeLa-P5-T1-C']);
    expect(result.cultures.map((c) => c.vessel)).toEqual(['T75', 'T25', '6-well']);
    expect(new Set(result.cultures.map((c) => c.parentLotId))).toEqual(new Set([lot.id]));
    expect(new Set(result.cultures.map((c) => c.passage))).toEqual(new Set([5]));
    expect(result.lot.vialsRemaining).toBe(4);
    const logs = (await (await app.request(`/api/cultures/${result.cultures[2].id}/logs`)).json()) as LogDto[];
    expect(logs.find((l) => l.type === 'note')?.note).toContain('용기 3/3');
    const graph = (await (await app.request('/api/cell-lines/hela/lineage')).json()) as LineageGraph;
    expect(graph.edges.filter((e) => e.kind === 'thaw')).toHaveLength(3);
  });
  it('이어지는 해동은 배양 개수가 아니라 해동 횟수로 번호를 매긴다', async () => {
    const res = await app.request(`/api/lots/${lot.id}/thaw`, json('POST', { vessel: 'T75', at }));
    expect(res.status).toBe(201);
    const single = (await res.json()) as ThawResult;
    expect(single.culture.label).toBe('HeLa-P5-T2');
    expect(single.cultures).toHaveLength(1);
    const next = (await (await app.request(`/api/lots/${lot.id}/thaw`, json('POST', { vials: 1, at, cultures: [{ vessel: 'T25' }, { vessel: 'T25' }] }))).json()) as ThawResult;
    expect(next.cultures.map((c) => c.label)).toEqual(['HeLa-P5-T3-A', 'HeLa-P5-T3-B']);
    expect(next.lot.vialsRemaining).toBe(2);
  });
  it('용기 수가 0개 또는 25개이면 400이고 바이알은 차감되지 않는다', async () => {
    expect((await app.request(`/api/lots/${lot.id}/thaw`, json('POST', { at, cultures: [] }))).status).toBe(400);
    const many = Array.from({ length: 25 }, () => ({ vessel: 'T25' }));
    expect((await app.request(`/api/lots/${lot.id}/thaw`, json('POST', { at, cultures: many }))).status).toBe(400);
    expect((await app.request(`/api/lots/${lot.id}/thaw`, json('POST', { at, cultures: [{ vessel: 'T25' }, { vessel: '' }] }))).status).toBe(400);
    expect(db.prepare('SELECT vials_remaining FROM cryo_lots WHERE id=?').get(lot.id)?.vials_remaining).toBe(2);
    expect(db.prepare('SELECT COUNT(*) AS n FROM cultures WHERE parent_lot_id=?').get(lot.id)?.n).toBe(6);
  });
  it('남은 바이알보다 많이 해동하면 409이다', async () => {
    const res = await app.request(`/api/lots/${lot.id}/thaw`, json('POST', { vials: 3, at, cultures: [{ vessel: 'T25' }] }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: '남은 바이알이 없습니다' });
  });
});
