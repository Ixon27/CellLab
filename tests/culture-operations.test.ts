import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, rmSync } from 'node:fs';
import type * as Config from '../src/server/config';
vi.mock('../src/server/config', async (original) => {
  const actual = await original<typeof Config>();
  // vi.mock factories run before static test imports; load filesystem dependencies inside this module-loading boundary.
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return { ...actual, PATHS: { ...actual.PATHS, db: ':memory:', files: await mkdtemp(join(tmpdir(), 'cell-operation-test-')) } };
});
import { PATHS } from '../src/server/config';
import { createApp } from '../src/server/app';
import { db } from '../src/server/db';
import { freezeAllocation, passageConservation, validateFeedInput, validateRecovery } from '../src/shared/culture-operations';
import type { CellLineDetailDto, CellLineDto, CultureDto, LogDto, LotDto } from '../src/shared/cell-line';
const app = createApp();
const at = '2026-01-01T09:00:00.000Z';
let line: CellLineDto;
let culture: CultureDto;
const json = (method: string, value: unknown) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
const post = (path: string, value: unknown) => app.request('/api' + path, json('POST', value));
const put = (path: string, value: unknown) => app.request('/api' + path, json('PUT', value));
const details = async () => (await (await app.request(`/api/cell-lines/${line.id}`)).json()) as CellLineDetailDto;
beforeEach(async () => {
  const r = await post('/cell-lines', { name: 'operation test', growthMode: 'adherent' });
  line = (await r.json()) as CellLineDto;
  const c = await post(`/cell-lines/${line.id}/cultures`, { vessel: 'T25', passage: 4, startedAt: at });
  culture = ((await c.json()) as { culture: CultureDto }).culture;
});
afterAll(() => {
  rmSync(PATHS.files, { recursive: true, force: true });
});

describe('작업 수치 경계', () => {
  it('배지만 추가한 작업을 전체 교환으로 위장하거나 불가능한 제거량을 허용하지 않는다', () => {
    expect(() => validateFeedInput({ mode: 'full', removedMl: 0, addedMl: 2, mediumLabel: 'A' })).toThrow();
    expect(() => validateFeedInput({ mode: 'addition', removedMl: 1, addedMl: 2, mediumLabel: 'A' })).toThrow();
    expect(() => validateFeedInput({ mode: 'partial', removedMl: 5, addedMl: 2, mediumLabel: 'A' }, 5)).toThrow();
    expect(() => validateFeedInput({ mode: 'partial', removedMl: 6, addedMl: 2, mediumLabel: 'A' }, 5)).toThrow();
    expect(validateFeedInput({ mode: 'addition', addedMl: 2, mediumLabel: 'A' }).removedMl).toBe(0);
  });
  it('동결 수량은 계속 배양할 세포를 제외하고 내림하며 부족분도 계산한다', () => {
    const input = {
      recoveredLiveCells: 3_000_000,
      retainedCells: 500_000,
      targetCellsPerVial: 1_000_000,
      volumePerVialMl: 0.5,
      desiredVials: 3,
    };
    expect(freezeAllocation(input)).toMatchObject({
      possibleVials: 2,
      vials: 2,
      usedCells: 2_000_000,
      leftoverCells: 500_000,
      shortfallCells: 500_000,
      resuspendVolumeMl: 1,
    });
    expect(freezeAllocation({ ...input, retainedCells: 4_000_000, desiredVials: 1 })).toMatchObject({
      possibleVials: 0,
      vials: 0,
      leftoverCells: 0,
      shortfallCells: 2_000_000,
    });
    expect(
      freezeAllocation({ ...input, recoveredLiveCells: 0.3, retainedCells: 0, targetCellsPerVial: 0.1, desiredVials: null }).possibleVials,
    ).toBe(3);
  });
  it('생세포 접종량은 회수량을 넘을 수 없으며 생존율을 다시 적용하지 않는다', () => {
    expect(passageConservation(100, [40, 50])).toEqual({ seededCells: 90, leftoverCells: 10 });
    expect(() => passageConservation(100, [60, 50])).toThrow();
    expect(() => passageConservation(100, [-1])).toThrow();
  });
  it('회복 확인은 관찰 시각과 내용을 요구하며 계획을 완료로 바꾸지 않는다', () => {
    expect(() => validateRecovery({ status: 'confirmed', observedAt: at, note: '' }, Date.parse(at))).toThrow();
    expect(() => validateRecovery({ status: 'poor', observedAt: '2030-01-01', note: '관찰' }, Date.parse(at))).toThrow();
    expect(validateRecovery({ status: 'unverified', note: '확인 예정' }, Date.parse(at))).toEqual({
      status: 'unverified',
      observedAt: null,
      note: '확인 예정',
    });
  });
});

describe('실제 기록·재고 API', () => {
  it('추가만 기록해도 passage는 유지되고 마지막 교체일·관찰값 시각은 밀리지 않는다', async () => {
    const p = await post(`/cell-lines/${line.id}/profiles`, { name: 'active', origin: 'manual', fields: { medium_change_days: 2 } });
    expect(p.status).toBe(201);
    expect((await post(`/cultures/${culture.id}/logs`, { at, type: 'medium_change' })).status).toBe(400);
    const feed = await post(`/cultures/${culture.id}/logs`, {
      at,
      type: 'medium_change',
      feed: { mode: 'full', mediumLabel: '배지 A', removedMl: 5, addedMl: 5 },
      confluencyPct: 35,
    });
    expect(feed.status).toBe(201);
    const later = '2026-01-02T09:00:00.000Z';
    const addition = await post(`/cultures/${culture.id}/logs`, {
      at: later,
      type: 'medium_change',
      feed: { mode: 'addition', mediumLabel: '배지 A', addedMl: 1 },
    });
    expect(((await addition.json()) as LogDto).feed).toMatchObject({ mode: 'addition', replacesMedium: false, removedMl: 0 });
    const dashboard = (await (await app.request('/api/dashboard')).json()) as {
      activeCultures: { id: string; lastFeed: { at: string } | null; lastConfluency: { pct: number; at: string } | null }[];
    };
    const active = dashboard.activeCultures.find((c) => c.id === culture.id)!;
    expect(active.lastFeed?.at).toBe(at);
    expect(active.lastConfluency).toEqual({ pct: 35, at });
    expect((await details()).cultures[0].passage).toBe(4);
    const logs = (await (await app.request(`/api/cell-lines/${line.id}/logs?cultureId=${culture.id}`)).json()) as LogDto[];
    expect(logs.find((l) => l.confluencyPct !== null)?.at).toBe(at);
  });
  it('용기 제품 수정·삭제 후에도 기존 배양의 사양과 일반 정보 편집은 보존된다', async () => {
    const product = (await (
      await post('/lab-products/vessels', {
        label: '12-well',
        format: '12-well',
        wellsPerUnit: 12,
        areaCm2PerWell: 3.8,
        surfaceTreatment: 'treated',
        specStatus: 'product_confirmed',
        sourceLabel: '실제 제품 명세',
      })
    ).json()) as { id: string };
    const use = { vesselProductId: product.id, usedWells: 3, mediumMl: 6 };
    expect((await put(`/cultures/${culture.id}`, { vesselUse: { ...use, usedWells: 0 } })).status).toBe(400);
    const twoPlates = (await (await put(`/cultures/${culture.id}`, { vesselUse: { ...use, usedWells: 13 } })).json()) as CultureDto;
    expect(twoPlates.vessel).toBe('12-well · 13 well (plate 2개)');
    expect((await put(`/cultures/${culture.id}`, { vesselUse: use })).status).toBe(200);
    expect((await put(`/lab-products/vessels/${product.id}`, { areaCm2PerWell: 4 })).status).toBe(200);
    const first = (await (await put(`/cultures/${culture.id}`, { vesselUse: use, notes: '보존' })).json()) as CultureDto;
    expect(first.vesselUse?.product.areaCm2PerWell).toBe(3.8);
    await app.request(`/api/lab-products/vessels/${product.id}`, { method: 'DELETE' });
    const saved = await put(`/cultures/${culture.id}`, { vesselUse: use, notes: '제품 삭제 후에도 편집' });
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as CultureDto).vesselUse?.product.areaCm2PerWell).toBe(3.8);
  });
  it('배지 추가·부분 교환의 기록량을 누적하고 기록 수정·삭제도 반영한다', async () => {
    await put(`/cultures/${culture.id}`, { vesselUse: { vesselProductId: 'ref:T25', usedWells: 1, mediumMl: 5 } });
    const add = (await (
      await post(`/cultures/${culture.id}/logs`, { at, type: 'medium_change', feed: { mode: 'addition', mediumLabel: 'A', addedMl: 2 } })
    ).json()) as LogDto;
    expect((await details()).cultures[0].vesselUse?.mediumMl).toBe(7);
    const partial = await post(`/cultures/${culture.id}/logs`, {
      at: '2026-01-02',
      type: 'medium_change',
      feed: { mode: 'partial', mediumLabel: 'A', removedMl: 3, addedMl: 1 },
    });
    expect(partial.status).toBe(201);
    expect((await details()).cultures[0].vesselUse?.mediumMl).toBe(5);
    expect(
      (
        await post(`/cultures/${culture.id}/logs`, {
          at: '2026-01-03',
          type: 'medium_change',
          feed: { mode: 'full', mediumLabel: 'A', removedMl: 4, addedMl: 5 },
        })
      ).status,
    ).toBe(400);
    await put(`/logs/${add.id}`, { feed: { mode: 'addition', mediumLabel: 'A', addedMl: 3 } });
    expect((await details()).cultures[0].vesselUse?.mediumMl).toBe(6);
    await app.request(`/api/logs/${add.id}`, { method: 'DELETE' });
    expect((await details()).cultures[0].vesselUse?.mediumMl).toBe(3);
  });
  it('계대의 접종 합계 초과를 원자적으로 거부하고 실제 자식에만 P+1을 부여한다', async () => {
    const body = {
      at,
      dissociationReagent: '확인 시약',
      recoveredLiveCells: 100,
      viabilityPct: 50,
      children: [
        { vessel: 'T25', seededCells: 60 },
        { vessel: 'T25', seededCells: 50 },
      ],
    };
    expect((await post(`/cultures/${culture.id}/passage`, body)).status).toBe(400);
    expect((await details()).cultures.map((c) => c.status)).toEqual(['active']);
    const result = await post(`/cultures/${culture.id}/passage`, {
      ...body,
      children: [
        { vesselUse: { vesselProductId: 'ref:6-well', usedWells: 2, mediumMl: 4 }, seededCells: 60 },
        { vessel: 'T25', seededCells: 40 },
      ],
    });
    expect(result.status).toBe(201);
    const values = (await result.json()) as { parent: CultureDto; children: CultureDto[] };
    expect(values.parent.status).toBe('split');
    expect(values.parent.passage).toBe(4);
    expect(values.children.map((c) => c.passage)).toEqual([5, 5]);
    const logs = (await (await app.request(`/api/cultures/${culture.id}/logs`)).json()) as LogDto[];
    expect(logs.find((l) => l.type === 'passage')?.passage).toMatchObject({ recoveredLiveCells: 100, seededCells: 100, leftoverCells: 0 });
  });
  it('남겨 둔 세포를 종료하지 않고 동결 계획·대표 해동·실제 회복 결과를 독립 저장한다', async () => {
    const plan = {
      recoveredLiveCells: 3_000_000,
      retainedCells: 500_000,
      targetCellsPerVial: 1_000_000,
      volumePerVialMl: 0.5,
      desiredVials: 3,
      representativeThaw: { vials: 1, plannedAt: null, note: '형태·증식 확인 계획' },
    };
    expect((await post(`/cultures/${culture.id}/freeze`, { at, vials: 3, plan })).status).toBe(400);
    expect((await post(`/cultures/${culture.id}/freeze`, { at, vials: 2, plan, endCulture: true })).status).toBe(400);
    expect((await details()).lots).toEqual([]);
    const res = await post(`/cultures/${culture.id}/freeze`, { at, vials: 2, plan, location: 'A-1', endCulture: false });
    expect(res.status).toBe(201);
    const result = (await res.json()) as { lot: LotDto; culture: CultureDto };
    expect(result.culture.status).toBe('active');
    expect(result.culture.passage).toBe(4);
    expect(result.lot.freezePlan).toMatchObject({ vials: 2, leftoverCells: 500_000, resuspendVolumeMl: 1 });
    expect(result.lot.recovery?.status).toBe('unverified');
    expect(result.lot.representativeThaw?.vials).toBe(1);
    expect((await put(`/lots/${result.lot.id}`, { recovery: { status: 'confirmed', observedAt: at, note: '' } })).status).toBe(400);
    const updated = (await (
      await put(`/lots/${result.lot.id}`, { recovery: { status: 'confirmed', observedAt: at, note: '해동 후 부착·증식을 직접 관찰함' } })
    ).json()) as LotDto;
    expect(updated.recovery?.status).toBe('confirmed');
    expect(updated.vialsRemaining).toBe(2);
    expect(updated.freezePlan).toEqual(result.lot.freezePlan);
  });
  it('실제 사진만 관찰에 첨부하고 내용 위조·경로 이름을 격리하며 삭제 시 파일도 지운다', async () => {
    const obs = (await (
      await post(`/cultures/${culture.id}/logs`, { at, type: 'observation', morphology: '관찰 형태', confluencyPct: 42 })
    ).json()) as LogDto;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
    const upload = (bytes: Uint8Array<ArrayBuffer>, type = 'image/png') => {
      const form = new FormData();
      form.set('file', new File([bytes], '../../sample.png', { type }));
      return app.request(`/api/logs/${obs.id}/photos`, { method: 'POST', body: form });
    };
    expect((await upload(new TextEncoder().encode('<svg/>'))).status).toBe(400);
    const photo = await upload(png);
    expect(photo.status).toBe(201);
    const saved = (await photo.json()) as { id: string; url: string; originalName: string };
    expect(saved.originalName).toBe('sample.png');
    const file = await app.request(saved.url);
    expect(file.status).toBe(200);
    expect(Buffer.from(await file.arrayBuffer())).toEqual(png);
    const observed = (await (await app.request(`/api/cultures/${culture.id}/logs`)).json()) as LogDto[];
    expect(observed[0].morphology).toBe('관찰 형태');
    expect(observed[0].photos[0].id).toBe(saved.id);
    expect((await app.request(`/api/logs/${obs.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await app.request(saved.url)).status).toBe(404);
    expect(readdirSync(PATHS.files + '/culture-photos')).toEqual([]);
  });
});
