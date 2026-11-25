import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Config from '../src/server/config';
import type { CellLineLogDto, CultureDto, LogDto, LotDto } from '../src/shared/cell-line';
import type { LineageGraph } from '../src/shared/lineage';
import { freezeMix, splitFactor, splitRatio, splitShares } from '../src/shared/culture-operations';
vi.mock('../src/server/config', async (importOriginal) => {
  const actual = await importOriginal<typeof Config>();
  return { ...actual, PATHS: { ...actual.PATHS, db: ':memory:' } };
});
import { createApp } from '../src/server/app';
import { db, linkOperationRecords, now } from '../src/server/db';

const app = createApp();
const at = '2026-11-16T09:00:00.000Z';
const later = '2026-11-16T13:30:00.000Z';
const json = (method: string, body: unknown) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function call<T>(path: string, method = 'GET', body?: unknown): Promise<{ status: number; data: T }> {
  const res = await app.request(path, body === undefined ? { method } : json(method, body));
  return { status: res.status, data: (await res.json()) as T };
}
const lotRow = (id: string) => db.prepare('SELECT vials_remaining AS n FROM cryo_lots WHERE id=?').get(id) as { n: number } | undefined;
const cultureRow = (id: string) => db.prepare('SELECT status,started_at,ended_at FROM cultures WHERE id=?').get(id) as
  | { status: string; started_at: string; ended_at: string | null }
  | undefined;
const logsOf = async (cultureId: string) => (await call<LogDto[]>(`/api/cultures/${cultureId}/logs`)).data;
async function receive(vials: number): Promise<LotDto> {
  return (await call<LotDto>('/api/cell-lines/tcmk/lots', 'POST', { passage: 43, vials, receivedAt: at })).data;
}
async function thaw(lot: LotDto, cultures: { vessel: string }[], vials = 1) {
  return (await call<{ cultures: CultureDto[] }>(`/api/lots/${lot.id}/thaw`, 'POST', { vials, at, passage: 44, cultures })).data.cultures;
}

beforeAll(() => {
  db.prepare('INSERT INTO cell_lines(id,name,created_at,updated_at) VALUES(?,?,?,?)').run('tcmk', 'TCMK-1', now(), now());
});

describe('해동 기록 수정·취소', () => {
  it('해동 기록은 날짜별 기록에 해동으로 나타나고 계보 선이 그 기록을 가리킨다', async () => {
    const lot = await receive(2);
    const [culture] = await thaw(lot, [{ vessel: '100 mm dish' }]);
    const journal = (await call<CellLineLogDto[]>('/api/cell-lines/tcmk/logs')).data;
    const record = journal.find((l) => l.cultureId === culture.id)!;
    expect(record).toMatchObject({ operation: 'thaw', thaw: { lotId: lot.id, vials: 1 } });
    const graph = (await call<LineageGraph>('/api/cell-lines/tcmk/lineage')).data;
    expect(graph.edges.find((e) => e.target === culture.id)).toMatchObject({ kind: 'thaw', logId: record.id, protocolChanges: 0 });
  });

  it('해동 일시를 고치면 배양 시작이, 배양 시작을 고치면 해동 기록이 같이 움직인다', async () => {
    const lot = await receive(1);
    const [culture] = await thaw(lot, [{ vessel: 'T25' }]);
    const record = (await logsOf(culture.id)).find((l) => l.operation === 'thaw')!;
    expect((await call(`/api/logs/${record.id}`, 'PUT', { at: later, note: '실제로는 오후에 해동' })).status).toBe(200);
    expect(cultureRow(culture.id)?.started_at).toBe(later);
    expect((await call(`/api/cultures/${culture.id}`, 'PUT', { startedAt: at, passage: 45, label: '고친 이름' })).status).toBe(200);
    const moved = (await logsOf(culture.id)).find((l) => l.operation === 'thaw')!;
    expect(moved).toMatchObject({ at, note: '실제로는 오후에 해동', thaw: { lotId: lot.id, vials: 1 } });
    expect((await call(`/api/logs/${record.id}`, 'PUT', { type: 'observation' })).status).toBe(400);
  });

  it('바이알을 모두 쓴 뒤에도 해동 기록을 지우면 배양이 사라지고 바이알이 돌아온다', async () => {
    const lot = await receive(1);
    const [culture] = await thaw(lot, [{ vessel: 'T25' }]);
    expect(lotRow(lot.id)?.n).toBe(0);
    await call(`/api/cultures/${culture.id}/logs`, 'POST', { type: 'note', at: later, note: '관찰' });
    const record = (await logsOf(culture.id)).find((l) => l.operation === 'thaw')!;
    expect((await call(`/api/logs/${record.id}`, 'DELETE')).status).toBe(200);
    expect(cultureRow(culture.id)).toBeUndefined();
    expect(lotRow(lot.id)?.n).toBe(1);
  });

  it('한 번의 해동을 나눈 용기는 마지막 용기를 지울 때 바이알이 돌아온다', async () => {
    const lot = await receive(3);
    const [a, b] = await thaw(lot, [{ vessel: '60 mm dish' }, { vessel: '100 mm dish' }], 2);
    expect(lotRow(lot.id)?.n).toBe(1);
    expect((await call(`/api/cultures/${a.id}`, 'DELETE')).status).toBe(200);
    expect(lotRow(lot.id)?.n).toBe(1);
    expect((await call(`/api/cultures/${b.id}`, 'DELETE')).status).toBe(200);
    expect(lotRow(lot.id)?.n).toBe(3);
  });

  it('바이알 수를 모르는 해동은 되돌릴 바이알 수를 직접 정할 수 있고 사용량을 넘지 못한다', async () => {
    const lot = await receive(2);
    const [culture] = await thaw(lot, [{ vessel: 'T25' }]);
    expect((await call(`/api/cultures/${culture.id}?restoreVials=2`, 'DELETE')).status).toBe(400);
    expect((await call(`/api/cultures/${culture.id}?restoreVials=0`, 'DELETE')).status).toBe(200);
    expect(lotRow(lot.id)?.n).toBe(1);
  });
});

describe('계대·동결 기록 수정·취소', () => {
  let parent: CultureDto;
  let children: CultureDto[];
  let passageLog: LogDto;
  it('계대 기록의 일시·시약·회수 세포 수를 고치면 새 배양 시작과 부모 종료가 같이 움직인다', async () => {
    const lot = await receive(1);
    [parent] = await thaw(lot, [{ vessel: 'T75' }]);
    children = (
      await call<{ children: CultureDto[] }>(`/api/cultures/${parent.id}/passage`, 'POST', {
        at,
        recoveredLiveCells: 1_000_000,
        children: [
          { vessel: 'T25', seededCells: 300_000 },
          { vessel: 'T25', seededCells: 300_000 },
        ],
      })
    ).data.children;
    passageLog = (await logsOf(parent.id)).find((l) => l.type === 'passage')!;
    expect(passageLog.operation).toBe('passage');
    expect((await call(`/api/logs/${passageLog.id}`, 'PUT', { totalCells: 500_000 })).status).toBe(400);
    const edited = await call<LogDto>(`/api/logs/${passageLog.id}`, 'PUT', { at: later, dissociationReagent: 'TrypLE 3분', totalCells: 900_000 });
    expect(edited.status).toBe(200);
    expect(edited.data.passage).toMatchObject({ dissociationReagent: 'TrypLE 3분', recoveredLiveCells: 900_000, seededCells: 600_000 });
    expect(children.map((c) => cultureRow(c.id)?.started_at)).toEqual([later, later]);
    expect(cultureRow(parent.id)).toMatchObject({ status: 'split', ended_at: later });
    expect((await logsOf(children[0].id))[0].at).toBe(later);
    const graph = (await call<LineageGraph>('/api/cell-lines/tcmk/lineage')).data;
    expect(graph.edges.filter((e) => e.kind === 'passage' && e.source === parent.id).map((e) => e.logId)).toEqual([passageLog.id, passageLog.id]);
  });

  it('새 배양에서 이어진 동결이 있으면 계대 취소를 막고, 동결을 먼저 취소하면 계대도 취소된다', async () => {
    const frozen = await call<{ lot: LotDto }>(`/api/cultures/${children[0].id}/freeze`, 'POST', { at: later, vials: 2, location: 'LN2', endCulture: true });
    expect((await call(`/api/logs/${passageLog.id}`, 'DELETE')).status).toBe(409);
    const freezeLog = (await logsOf(children[0].id)).find((l) => l.type === 'freeze')!;
    expect(freezeLog.operation).toBe('freeze');
    expect((await call(`/api/logs/${freezeLog.id}`, 'DELETE')).status).toBe(200);
    expect(lotRow(frozen.data.lot.id)).toBeUndefined();
    expect(cultureRow(children[0].id)).toMatchObject({ status: 'active', ended_at: null });
    expect((await call(`/api/logs/${passageLog.id}`, 'DELETE')).status).toBe(200);
    expect(children.map((c) => cultureRow(c.id))).toEqual([undefined, undefined]);
    expect(cultureRow(parent.id)).toMatchObject({ status: 'active', ended_at: null });
  });

  it('새 배양을 하나씩 지우면 마지막 배양과 함께 계대가 취소된다', async () => {
    const made = (
      await call<{ children: CultureDto[] }>(`/api/cultures/${parent.id}/passage`, 'POST', { at, children: [{ vessel: 'T25' }, { vessel: 'T25' }] })
    ).data.children;
    expect((await call(`/api/cultures/${made[0].id}`, 'DELETE')).status).toBe(200);
    expect((await logsOf(parent.id)).find((l) => l.type === 'passage')?.passage?.childCount).toBe(1);
    expect(cultureRow(parent.id)?.status).toBe('split');
    expect((await call(`/api/cultures/${made[1].id}`, 'DELETE')).status).toBe(200);
    expect((await logsOf(parent.id)).some((l) => l.type === 'passage')).toBe(false);
    expect(cultureRow(parent.id)?.status).toBe('active');
  });

  it('해동한 배양이 있는 동결 stock은 지울 수 없고, 동결 stock 삭제는 동결을 취소한다', async () => {
    const lot = (await call<{ lot: LotDto }>(`/api/cultures/${parent.id}/freeze`, 'POST', { at, vials: 2, location: 'LN2', endCulture: true })).data.lot;
    const [thawed] = await thaw(lot, [{ vessel: 'T25' }]);
    expect((await call(`/api/lots/${lot.id}`, 'DELETE')).status).toBe(409);
    expect((await call(`/api/cultures/${thawed.id}`, 'DELETE')).status).toBe(200);
    expect((await call(`/api/lots/${lot.id}`, 'PUT', { eventAt: later, vialsInitial: 3, vialsRemaining: 3 })).status).toBe(200);
    expect(cultureRow(parent.id)).toMatchObject({ status: 'frozen', ended_at: later });
    expect((await call(`/api/lots/${lot.id}`, 'DELETE')).status).toBe(200);
    expect(cultureRow(parent.id)?.status).toBe('active');
    expect((await logsOf(parent.id)).some((l) => l.type === 'freeze')).toBe(false);
  });

  it('수확·폐기·오염 종료는 기록으로 남고, 그 기록을 고치면 배양 종료가 바뀌고 취소하면 다시 활성이 된다', async () => {
    expect((await call(`/api/cultures/${parent.id}/end`, 'POST', { status: 'harvested', at: later, note: '단백질 추출용 수확' })).status).toBe(200);
    expect(cultureRow(parent.id)).toMatchObject({ status: 'harvested', ended_at: later });
    const journal = (await call<CellLineLogDto[]>('/api/cell-lines/tcmk/logs')).data;
    const record = journal.find((l) => l.cultureId === parent.id && l.operation === 'end')!;
    expect(record).toMatchObject({ type: 'harvest', at: later, note: '단백질 추출용 수확', extra: { endStatus: 'harvested' } });
    expect((await call(`/api/cultures/${parent.id}`, 'PUT', { status: 'active' })).status).toBe(400);

    expect((await call(`/api/logs/${record.id}`, 'PUT', { endStatus: 'contaminated', at, note: '오염 확인' })).status).toBe(200);
    expect(db.prepare('SELECT status,ended_at,end_note FROM cultures WHERE id=?').get(parent.id)).toMatchObject({
      status: 'contaminated',
      ended_at: at,
      end_note: '오염 확인',
    });
    expect((await logsOf(parent.id)).find((l) => l.id === record.id)).toMatchObject({ type: 'note', operation: 'end', extra: { endStatus: 'contaminated' } });
    expect((await call(`/api/logs/${record.id}`, 'PUT', { endStatus: 'split' })).status).toBe(400);

    expect((await call(`/api/logs/${record.id}`, 'DELETE')).status).toBe(200);
    expect(cultureRow(parent.id)).toMatchObject({ status: 'active', ended_at: null });
    expect((await logsOf(parent.id)).some((l) => l.id === record.id)).toBe(false);
  });
});

describe('기록 뒤 프로토콜 변경', () => {
  it('저장한 해동의 단계 변경을 나중에 고치면 계보 선에 변경 단계 수가 보인다', async () => {
    const protocol = (await call<{ id: string }>('/api/cell-lines/tcmk/protocols', 'POST', { folder: 'thaw', title: '해동', bodyMd: '1. 녹인다\n2. 배지 9 mL\n3. 배양기\n' })).data;
    const updatedAt = (db.prepare('SELECT updated_at FROM protocols WHERE id=?').get(protocol.id) as { updated_at: string }).updated_at;
    const lot = await receive(1);
    const [culture] = (
      await call<{ cultures: CultureDto[] }>(`/api/lots/${lot.id}/thaw`, 'POST', {
        at,
        cultures: [{ vessel: 'T25' }],
        protocolRun: { protocolId: protocol.id, protocolUpdatedAt: updatedAt, deviations: [] },
      })
    ).data.cultures;
    const record = (await logsOf(culture.id)).find((l) => l.operation === 'thaw')!;
    const revised = await call<LogDto>(`/api/logs/${record.id}`, 'PUT', { protocolRun: { deviations: [{ index: 1, text: '배지 5 mL' }, { index: 2, text: '' }] } });
    expect(revised.status).toBe(200);
    expect(revised.data.protocolRun!.steps.map((s) => s.modified)).toEqual([null, '배지 5 mL', '']);
    const graph = (await call<LineageGraph>('/api/cell-lines/tcmk/lineage')).data;
    expect(graph.edges.find((e) => e.target === culture.id)?.protocolChanges).toBe(2);
    expect((await call(`/api/logs/${record.id}`, 'PUT', { protocolRun: { deviations: [{ index: 7, text: 'x' }] } })).status).toBe(400);
    expect((await call<LogDto>(`/api/logs/${record.id}`, 'PUT', { protocolRun: null })).data.protocolRun).toBeNull();
  });

  it('계대 프로토콜에는 그 계대의 분주 비율·접종 밀도·confluency가 들어가고, 기록에서 비율을 고치면 같이 바뀐다', async () => {
    const bodyMd = '1. Confluency {{subculture_confluency_pct}}% 도달 시 계대한다.\n2. {{split_ratio}} 또는 {{seeding_density}}로 분주한다.\n3. 90초 둔다.\n';
    const protocol = (await call<{ id: string }>('/api/cell-lines/tcmk/protocols', 'POST', { folder: 'passage', title: '계대', bodyMd })).data;
    const updatedAt = (db.prepare('SELECT updated_at FROM protocols WHERE id=?').get(protocol.id) as { updated_at: string }).updated_at;
    const dish = (
      await call<{ id: string }>('/api/lab-products/vessels', 'POST', { label: '100 mm dish', format: '100 mm dish', wellsPerUnit: 1, areaCm2PerWell: 55, sourceLabel: '테스트' })
    ).data;
    const [parent] = await thaw(await receive(1), [{ vessel: 'T75' }]);
    const passaged = await call<{ parent: CultureDto }>(`/api/cultures/${parent.id}/passage`, 'POST', {
      at,
      confluencyPct: 90,
      recoveredLiveCells: 5_000_000,
      splitRatio: '1:7',
      children: [{ vesselUse: { vesselProductId: dish.id, usedWells: 1, mediumMl: 10 }, seededCells: 1_100_000 }],
      protocolRun: { protocolId: protocol.id, protocolUpdatedAt: updatedAt, deviations: [] },
    });
    expect(passaged.status).toBe(201);
    const record = (await logsOf(parent.id)).find((l) => l.type === 'passage')!;
    expect(record.protocolRun!.steps.map((s) => [s.original, s.modified])).toEqual([
      ['Confluency 90% 도달 시 계대한다.', null],
      ['1:7 또는 2.00 × 10⁴ cells/cm²로 분주한다.', null],
      ['90초 둔다.', null],
    ]);

    const edited = await call<LogDto>(`/api/logs/${record.id}`, 'PUT', { splitRatio: '1:70', confluencyPct: 85, protocolRun: { deviations: [] } });
    expect(edited.status).toBe(200);
    expect(edited.data.protocolRun!.steps.map((s) => s.original)).toEqual([
      'Confluency 85% 도달 시 계대한다.',
      '1:70 또는 2.00 × 10⁴ cells/cm²로 분주한다.',
      '90초 둔다.',
    ]);
  });

  it('동결 프로토콜에는 그 동결의 바이알 수·바이알당 세포 수·부피·동결 배지가 들어간다', async () => {
    const bodyMd = '1. {{dissociation_reagent}}로 탈착한다.\n2. 회수한 {{recovered_cells}} 중 {{frozen_cells}}을 {{freezing_medium}}에 현탁한다.\n3. {{freeze_vials}}개 바이알에 {{cells_per_vial}}씩 {{volume_per_vial}} 분주한다(총 {{total_freeze_volume}}).\n';
    const protocol = (await call<{ id: string }>('/api/cell-lines/tcmk/protocols', 'POST', { folder: 'freeze', title: '동결', bodyMd })).data;
    const updatedAt = (db.prepare('SELECT updated_at FROM protocols WHERE id=?').get(protocol.id) as { updated_at: string }).updated_at;
    const [culture] = await thaw(await receive(1), [{ vessel: 'T75' }]);
    const plan = { recoveredLiveCells: 3_500_000, retainedCells: 0, targetCellsPerVial: 1_000_000, volumePerVialMl: 1, desiredVials: 3 };
    const res = await call(`/api/cultures/${culture.id}/freeze`, 'POST', {
      at,
      vials: 3,
      plan,
      location: 'LN2',
      freezingMedium: 'CryoStor CS10',
      dissociationReagent: 'TrypLE Express',
      protocolRun: { protocolId: protocol.id, protocolUpdatedAt: updatedAt, deviations: [] },
    });
    expect(res.status).toBe(201);
    const record = (await logsOf(culture.id)).find((l) => l.type === 'freeze')!;
    expect(record.protocolRun!.steps.map((s) => s.original)).toEqual([
      'TrypLE Express로 탈착한다.',
      '회수한 3.50 × 10⁶ cells 중 3.00 × 10⁶ cells을 CryoStor CS10에 현탁한다.',
      '3개 바이알에 1.00 × 10⁶ cells씩 1 mL 분주한다(총 3 mL).',
    ]);
    const edited = await call<LogDto>(`/api/logs/${record.id}`, 'PUT', { dissociationReagent: 'Accutase', protocolRun: { deviations: [] } });
    expect(edited.data.extra.dissociationReagent).toBe('Accutase');
    expect(edited.data.protocolRun!.steps[0].original).toBe('Accutase로 탈착한다.');
  });
});

describe('링크가 없던 이전 기록', () => {
  it('지워진 해동 기록을 되살리고 이전 계대·동결 기록을 만든 배양·stock에 연결한다', async () => {
    const lot = await receive(1);
    const [culture] = await thaw(lot, [{ vessel: 'T25' }]);
    db.prepare('DELETE FROM culture_logs WHERE culture_id=?').run(culture.id);
    db.prepare('INSERT INTO cultures(id,cell_line_id,parent_culture_id,label,passage,vessel,status,started_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(
      'old-child',
      'tcmk',
      culture.id,
      '이전 자식',
      45,
      'T25',
      'active',
      later,
      now(),
    );
    db.prepare("INSERT INTO culture_logs(id,culture_id,at,type,extra,created_at) VALUES('old-passage',?,?,'passage','{}',?)").run(culture.id, later, now());
    linkOperationRecords(db);
    linkOperationRecords(db);
    const logs = await logsOf(culture.id);
    expect(logs.filter((l) => l.operation === 'thaw')).toEqual([expect.objectContaining({ at, thaw: { lotId: lot.id, vials: null } })]);
    expect(logs.find((l) => l.id === 'old-passage')?.extra.childCultureIds).toBe('old-child');
  });
});

describe('계수기 값과 남은 세포 처리', () => {
  it('계대 직전 계수 값과 confluency를 한 기록에 남기고 남은 세포를 같은 단계에서 동결한다', async () => {
    const lot = await receive(1);
    const [parent] = await thaw(lot, [{ vessel: 'T75' }]);
    const count = { countTotalPerMl: 4_000_000, countDeadPerMl: 1_000_000, countAverageSizeUm: 14.2, countLiveCounted: 90, countDilution: 2, countSuspensionMl: 2 };
    // 3.0e6 live/mL × 2 mL = 6.0e6 live cells; seed 2.0e6, freeze the remaining 4.0e6 as 4 × 1.0e6.
    const res = await call<{ children: CultureDto[]; lot: LotDto }>(`/api/cultures/${parent.id}/passage`, 'POST', {
      at,
      confluencyPct: 85,
      viabilityPct: 75,
      cellsPerMl: 3_000_000,
      recoveredLiveCells: 6_000_000,
      count,
      splitRatio: '1:3',
      children: [{ vessel: 'T75', seededCells: 2_000_000 }],
      freeze: {
        vials: 4,
        location: 'LN2 B-2',
        freezingMedium: 'Cell Freezing Medium-DMSO',
        plan: { recoveredLiveCells: 4_000_000, retainedCells: 0, targetCellsPerVial: 1_000_000, volumePerVialMl: 1, suspensionCellsPerMl: 3_000_000, freezingMediumX: 2, freezingMediumDmsoPct: 20 },
      },
    });
    expect(res.status).toBe(201);
    expect(res.data.lot).toMatchObject({ vialsInitial: 4, sourceCultureId: parent.id, location: 'LN2 B-2' });
    // 2X medium: 0.5 mL cell liquid + 0.5 mL medium per vial; 4 vials need 4/3 mL of the counted suspension topped up to 2 mL.
    expect(res.data.lot.freezePlan?.mix).toMatchObject({
      method: 'dilute',
      freezingMediumPerVialMl: 0.5,
      countedSuspensionMl: expect.closeTo(4 / 3, 6),
      growthMediumMl: expect.closeTo(2 / 3, 6),
      finalDmsoPct: 10,
    });
    const passage = (await logsOf(parent.id)).find((l) => l.type === 'passage')!;
    expect(passage).toMatchObject({ confluencyPct: 85, viabilityPct: 75, cellsPerMl: 3_000_000, count });
    expect(passage.passage).toMatchObject({ splitRatio: '1:3', leftoverHandling: 'frozen', leftoverCells: 4_000_000 });
    expect(cultureRow(parent.id)?.status).toBe('split');
    const edited = await call<LogDto>(`/api/logs/${passage.id}`, 'PUT', { count: { countAverageSizeUm: 15 } });
    expect(edited.data.count).toEqual({ countAverageSizeUm: 15 });
    expect((await call(`/api/logs/${passage.id}`, 'PUT', { count: { countLiveCounted: 1.5 } })).status).toBe(400);
  });

  it('남은 세포보다 많이 동결하거나 기존 용기 유지와 동결을 함께 고르면 아무것도 저장하지 않는다', async () => {
    const lot = await receive(1);
    const [parent] = await thaw(lot, [{ vessel: 'T75' }]);
    const plan = { recoveredLiveCells: 5_000_000, retainedCells: 0, targetCellsPerVial: 1_000_000, volumePerVialMl: 1 };
    const body = { at, recoveredLiveCells: 6_000_000, children: [{ vessel: 'T75', seededCells: 2_000_000 }], freeze: { vials: 1, location: 'LN2', plan } };
    expect((await call(`/api/cultures/${parent.id}/passage`, 'POST', body)).status).toBe(400);
    expect((await call(`/api/cultures/${parent.id}/passage`, 'POST', { ...body, keepParent: true, freeze: { ...body.freeze, plan: { ...plan, recoveredLiveCells: 1_000_000 } } })).status).toBe(400);
    expect(cultureRow(parent.id)?.status).toBe('active');
    expect(db.prepare('SELECT COUNT(*) AS n FROM cryo_lots WHERE source_culture_id=?').get(parent.id)).toEqual({ n: 0 });
  });

  it('동결 배지 농도(X)로 바이알당 동결 배지 양을 정하고 현탁액을 희석하거나 다시 원심한다', () => {
    const base = { suspensionCellsPerMl: 4_000_000, targetCellsPerVial: 1_000_000, volumePerVialMl: 1, vials: 3, freezingMediumDmsoPct: 20 };
    expect(freezeMix({ ...base, freezingMediumX: 2 })).toMatchObject({
      method: 'dilute',
      suspensionPerVialMl: 0.5,
      freezingMediumPerVialMl: 0.5,
      countedSuspensionMl: 0.75,
      growthMediumMl: 0.75,
      totalFreezingMediumMl: 1.5,
      finalDmsoPct: 10,
    });
    // 1X: the pellet goes straight into the medium.
    expect(freezeMix({ ...base, freezingMediumX: 1, freezingMediumDmsoPct: null })).toMatchObject({
      method: 'pellet',
      suspensionPerVialMl: 0,
      totalFreezingMediumMl: 3,
      countedSuspensionMl: 0.75,
      finalDmsoPct: null,
    });
    // Too dilute to fit 1.5 mL of cell liquid: spin 3 mL and resuspend in 1.5 mL.
    expect(freezeMix({ ...base, suspensionCellsPerMl: 1_000_000, freezingMediumX: 2 })).toMatchObject({ method: 'respin', countedSuspensionMl: 3, growthMediumMl: 1.5 });
    expect(() => freezeMix({ ...base, freezingMediumX: 0.5 })).toThrow('동결 배지 농도');
    expect(splitRatio(21, 63)).toBe('1:3');
    expect(splitRatio(2, 5)).toBe('1:2.5');
    // 1:5 by vessels: one dish into five equal dishes carries all cells; one dish into one dish carries a fifth.
    expect(['1:5', '1/5', '2:10', '5'].map(splitFactor)).toEqual([5, 5, 5, 5]);
    expect(splitFactor('abc')).toBeNull();
    expect(splitShares(1, [1, 1, 1, 1, 1], 5)).toEqual([0.2, 0.2, 0.2, 0.2, 0.2]);
    expect(splitShares(1, [1], 5)).toEqual([0.2]);
    expect(splitShares(55, [21], 5)[0]).toBeCloseTo(21 / 55 / 5);
  });

  it('세지 않은 계대는 분주 비율만 남긴다', async () => {
    const lot = await receive(1);
    const [parent] = await thaw(lot, [{ vessel: 'T75' }]);
    const res = await call<{ children: CultureDto[] }>(`/api/cultures/${parent.id}/passage`, 'POST', {
      at,
      splitRatio: '1:5',
      children: [{ vessel: '60 mm dish', seededCells: null }],
    });
    expect(res.status).toBe(201);
    expect((await logsOf(parent.id)).find((l) => l.type === 'passage')?.passage).toMatchObject({ splitRatio: '1:5', seededCells: null, recoveredLiveCells: null });
  });
});

describe('여러 dish로 나뉜 배양의 plate별 계대·폐기', () => {
  it('고른 plate만 계대하고 나머지를 폐기하면 배양이 끝나며, 기록을 취소하면 plate가 돌아온다', async () => {
    const lot = await receive(1);
    const [parent] = await thaw(lot, [{ vessel: 'T75' }]);
    const product = (
      await call<{ id: string }>('/api/lab-products/vessels', 'POST', { label: '100 mm dish', format: '100 mm dish', wellsPerUnit: 1, areaCm2PerWell: 55, sourceLabel: '테스트' })
    ).data;
    expect((await call(`/api/cultures/${parent.id}`, 'PUT', { vesselUse: { vesselProductId: product.id, usedWells: 3, mediumMl: 30 } })).status).toBe(200);
    const passage = await call<{ children: CultureDto[]; parent: CultureDto }>(`/api/cultures/${parent.id}/passage`, 'POST', {
      at,
      sourcePlates: [2],
      children: [{ vessel: 'T25' }],
    });
    expect(passage.status).toBe(201);
    expect(passage.data.parent).toMatchObject({ status: 'active' });
    expect(passage.data.parent.plates.map((p) => p.status)).toEqual(['active', 'passaged', 'active']);
    const graph = (await call<LineageGraph>('/api/cell-lines/tcmk/lineage')).data;
    expect(graph.edges.find((e) => e.target === passage.data.children[0].id)?.sourcePlates).toEqual([2]);
    expect((await call(`/api/cultures/${parent.id}/passage`, 'POST', { at, sourcePlates: [2], children: [{ vessel: 'T25' }] })).status).toBe(400);

    const discard = await call<CultureDto>(`/api/cultures/${parent.id}/discard-plates`, 'POST', { at: later, plates: [1, 3], note: '오염 의심' });
    expect(discard.data).toMatchObject({ status: 'discarded', endedAt: later });
    const discardLog = (await logsOf(parent.id)).find((l) => l.operation === 'discard')!;
    expect((await call(`/api/logs/${discardLog.id}`, 'DELETE')).status).toBe(200);
    const reopened = (await call<{ cultures: CultureDto[] }>('/api/cell-lines/tcmk')).data.cultures.find((c) => c.id === parent.id)!;
    expect(reopened.status).toBe('active');
    expect(reopened.plates.map((p) => p.status)).toEqual(['active', 'passaged', 'active']);
    const passageLog = (await logsOf(parent.id)).find((l) => l.type === 'passage')!;
    expect((await call(`/api/logs/${passageLog.id}`, 'DELETE')).status).toBe(200);
    const restored = (await call<{ cultures: CultureDto[] }>('/api/cell-lines/tcmk')).data.cultures.find((c) => c.id === parent.id)!;
    expect(restored.plates.map((p) => p.status)).toEqual(['active', 'active', 'active']);
  });

  it('계대 후 남은 plate 중 일부로 stock을 만들고, 다른 plate를 나중에 계대할 수 있다', async () => {
    const [parent] = await thaw(await receive(1), [{ vessel: 'T75' }]);
    const product = (
      await call<{ id: string }>('/api/lab-products/vessels', 'POST', { label: '100 mm dish', format: '100 mm dish', wellsPerUnit: 1, areaCm2PerWell: 55, sourceLabel: '테스트' })
    ).data;
    const url = `/api/cultures/${parent.id}`;
    expect((await call(url, 'PUT', { vesselUse: { vesselProductId: product.id, usedWells: 3, mediumMl: 30 } })).status).toBe(200);
    const passage = { at, children: [{ vessel: 'T25' }] };
    expect((await call(`${url}/passage`, 'POST', { ...passage, sourcePlates: [1] })).status).toBe(201);
    const freeze = { at: later, vials: 2, location: 'LN2', endCulture: true };
    expect((await call(`${url}/freeze`, 'POST', { ...freeze, sourcePlates: [] })).status).toBe(400);
    expect((await call(`${url}/freeze`, 'POST', { ...freeze, sourcePlates: [1] })).status).toBe(400);

    const kept = await call<{ culture: CultureDto }>(`${url}/freeze`, 'POST', { ...freeze, sourcePlates: [2], endCulture: false });
    expect(kept.status).toBe(201);
    expect(kept.data.culture.plates.map((p) => p.status)).toEqual(['passaged', 'active', 'active']);
    const frozen = await call<{ culture: CultureDto; lot: LotDto }>(`${url}/freeze`, 'POST', { ...freeze, sourcePlates: [2] });
    expect(frozen.status).toBe(201);
    expect(frozen.data.culture.status).toBe('active');
    expect(frozen.data.culture.plates.map((p) => p.status)).toEqual(['passaged', 'frozen', 'active']);
    const record = (await logsOf(parent.id)).find((l) => l.extra.frozenLotId === frozen.data.lot.id)!;
    const graph = (await call<LineageGraph>('/api/cell-lines/tcmk/lineage')).data;
    expect(graph.edges.find((e) => e.target === frozen.data.lot.id)).toMatchObject({ kind: 'freeze', sourcePlates: [2], logId: record.id });
    expect((await call(`${url}/passage`, 'POST', { ...passage, sourcePlates: [2] })).status).toBe(400);
    const final = await call<{ parent: CultureDto }>(`${url}/passage`, 'POST', { ...passage, at: later, sourcePlates: [3] });
    expect(final.status).toBe(201);
    expect(final.data.parent).toMatchObject({ status: 'split', endedAt: later });

    expect((await call(`/api/logs/${record.id}`, 'DELETE')).status).toBe(200);
    const detail = (await call<{ cultures: CultureDto[]; lots: LotDto[] }>('/api/cell-lines/tcmk')).data;
    const restored = detail.cultures.find((c) => c.id === parent.id)!;
    expect(restored).toMatchObject({ status: 'active', endedAt: null });
    expect(restored.plates.map((p) => p.status)).toEqual(['passaged', 'active', 'passaged']);
    expect(detail.lots.find((l) => l.id === frozen.data.lot.id)).toBeUndefined();
    const lastStock = await call<{ culture: CultureDto }>(`${url}/freeze`, 'POST', { ...freeze, sourcePlates: [2] });
    expect(lastStock.data.culture).toMatchObject({ status: 'frozen', endedAt: later });
  });

  it('plate별 계대는 plate마다 기록·새 배양을 만들고, 한 묶음이라도 틀리면 아무것도 저장하지 않는다', async () => {
    const lot = await receive(1);
    const [parent] = await thaw(lot, [{ vessel: 'T75' }]);
    const product = (
      await call<{ id: string }>('/api/lab-products/vessels', 'POST', { label: '100 mm dish', format: '100 mm dish', wellsPerUnit: 1, areaCm2PerWell: 55, sourceLabel: '테스트' })
    ).data;
    expect((await call(`/api/cultures/${parent.id}`, 'PUT', { vesselUse: { vesselProductId: product.id, usedWells: 3, mediumMl: 30 } })).status).toBe(200);
    const url = `/api/cultures/${parent.id}/passage-groups`;
    // Plate 3 would seed more cells than it gave: the whole step is rejected, plate 1 included.
    const bad = await call<{ error: string }>(url, 'POST', {
      groups: [
        { at, sourcePlates: [1], splitRatio: '1:3', children: [{ vessel: 'T25' }] },
        { at, sourcePlates: [3], recoveredLiveCells: 100, children: [{ vessel: 'T25', seededCells: 500 }] },
      ],
    });
    expect(bad.status).toBe(400);
    expect(bad.data.error).toMatch(/^plate 3: /);
    expect((await logsOf(parent.id)).filter((l) => l.type === 'passage')).toHaveLength(0);
    expect((await call(url, 'POST', { groups: [{ at, sourcePlates: [1], children: [{ vessel: 'T25' }] }, { at, sourcePlates: [1, 2], children: [{ vessel: 'T25' }] }] })).status).toBe(400);

    const ok = await call<{ results: { children: CultureDto[]; parent: CultureDto }[] }>(url, 'POST', {
      groups: [1, 2, 3].map((no) => ({ at, sourcePlates: [no], splitRatio: no === 3 ? '1:5' : '1:3', children: [{ vessel: 'T25' }] })),
    });
    expect(ok.status).toBe(201);
    expect(ok.data.results.flatMap((r) => r.children.map((c) => c.label))).toEqual(['TCMK-1-P45-A', 'TCMK-1-P45-B', 'TCMK-1-P45-C']);
    expect(ok.data.results.at(-1)!.parent).toMatchObject({ status: 'split' });
    const graph = (await call<LineageGraph>('/api/cell-lines/tcmk/lineage')).data;
    expect(ok.data.results.map((r) => graph.edges.find((e) => e.target === r.children[0].id)?.sourcePlates)).toEqual([[1], [2], [3]]);
    const ratios = (await logsOf(parent.id)).filter((l) => l.type === 'passage').map((l) => l.passage?.splitRatio);
    expect(ratios.sort()).toEqual(['1:3', '1:3', '1:5']);
  });
});
