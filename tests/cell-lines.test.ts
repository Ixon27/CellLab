import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Config from '../src/server/config';
import type { CellLineDto, ProfileDto } from '../src/shared/cell-line';
import type { CatalogOption } from '../src/shared/catalog';
import { DatabaseSync } from 'node:sqlite';
import { migrateCultureProfiles } from '../src/server/db';
vi.mock('../src/server/config', async (importOriginal) => {
  const actual = await importOriginal<typeof Config>();
  return { ...actual, PATHS: { ...actual.PATHS, db: ':memory:' } };
});
import { createApp } from '../src/server/app';
import { db } from '../src/server/db';
const app = createApp();
let lineId: string;
beforeEach(async () => {
  db.prepare('DELETE FROM cell_lines').run();
  const response = await app.request('/api/cell-lines', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'HeLa', growthMode: 'adherent' }),
  });
  lineId = ((await response.json()) as CellLineDto).id;
});
describe('세포주 배양 조건', () => {
  it('기존 DB에 실행 계획 열을 추가해도 원래 데이터는 유지한다', () => {
    const legacy = new DatabaseSync(':memory:');
    try {
      legacy.exec("CREATE TABLE culture_profiles(id TEXT, fields TEXT, source_refs TEXT); INSERT INTO culture_profiles VALUES('legacy','{}','[]')");
      migrateCultureProfiles(legacy);
      migrateCultureProfiles(legacy);
      expect(legacy.prepare('SELECT * FROM culture_profiles').get()).toEqual({ id: 'legacy', fields: '{}', source_refs: '[]', execution_plan: null });
    } finally { legacy.close(); }
  });
  it('실행 계획과 항목 근거는 독립 저장하며 생략 보존·명시 null 제거·복제를 지원한다', async () => {
    const executionPlan = {
      version: 1, summary: '일반 실행 지침', conditions: [],
      steps: Object.fromEntries(['stock', 'thaw', 'feed', 'passage', 'freeze'].map((s) => [s, { instructions: '', recordLabels: [] }])),
      mediumRecipe: null,
    };
    const sourceRefs = [{ field: 'base_medium', sourceLabel: '실험실 보고', url: '', quote: '원자료 미확인' }];
    const request = (path: string, method: string, body: unknown) => app.request(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const created = await request(`/api/cell-lines/${lineId}/profiles`, 'POST', { name: '실행 조건', origin: 'manual', fields: {}, sourceRefs, executionPlan });
    expect(created.status).toBe(201);
    const p = await created.json() as ProfileDto;
    expect(p.executionPlan).toEqual(executionPlan);
    const updated = await request(`/api/profiles/${p.id}`, 'PUT', { fields: { base_medium: '시험용 배지' } });
    const saved = await updated.json() as ProfileDto;
    expect(saved.executionPlan).toEqual(executionPlan);
    expect(saved.sourceRefs).toEqual(sourceRefs);
    const read = await app.request(`/api/profiles/${p.id}`);
    expect((await read.json() as ProfileDto).executionPlan).toEqual(executionPlan);
    const copy = await request(`/api/cell-lines/${lineId}/profiles`, 'POST', { name: '복제', origin: saved.origin, fields: saved.fields, sourceRefs: saved.sourceRefs, executionPlan: saved.executionPlan });
    const copied = await copy.json() as ProfileDto;
    expect(copied.executionPlan).toEqual(executionPlan);
    expect(copied.sourceRefs).toEqual(sourceRefs);
    const cleared = await request(`/api/profiles/${p.id}`, 'PUT', { executionPlan: null });
    expect((await cleared.json() as ProfileDto).executionPlan).toBeNull();
    expect((await request(`/api/profiles/${p.id}`, 'PUT', { executionPlan: { version: 2 } })).status).toBe(400);
    const manual = await request(`/api/profiles/${p.id}`, 'PUT', { sourceRefs: [] });
    expect((await manual.json() as ProfileDto).sourceRefs).toEqual([]);
  });
  it('첫 프로필을 자동 활성화한다', async () => {
    const res = await app.request(`/api/cell-lines/${lineId}/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '첫 조건', origin: 'manual', fields: {} }),
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as ProfileDto).isActive).toBe(true);
  });
  it('두 번째 프로필을 활성화하면 첫 번째를 비활성화한다', async () => {
    for (const [name, activate] of [
      ['첫 조건', false],
      ['둘째 조건', true],
    ])
      await app.request(`/api/cell-lines/${lineId}/profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, activate, origin: 'manual', fields: {} }),
      });
    const res = await app.request(`/api/cell-lines/${lineId}`);
    const detail = (await res.json()) as { profiles: ProfileDto[] };
    expect(detail.profiles.map((p) => p.isActive)).toEqual([false, true]);
  });
  it('활성 프로필 삭제를 거부한다', async () => {
    const created = await app.request(`/api/cell-lines/${lineId}/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '첫 조건', origin: 'manual', fields: {} }),
    });
    const p = (await created.json()) as ProfileDto;
    expect((await app.request(`/api/profiles/${p.id}`, { method: 'DELETE' })).status).toBe(400);
  });
  it('새 배지를 선택 목록에 추가한다', async () => {
    await app.request(`/api/cell-lines/${lineId}/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '직접 입력', origin: 'manual', fields: { base_medium: 'My custom medium' } }),
    });
    const res = await app.request('/api/catalog?category=base_medium');
    expect(((await res.json()) as CatalogOption[]).some((o) => o.label === 'My custom medium')).toBe(true);
  });
  it('범위 밖 혈청 농도를 거부한다', async () => {
    const res = await app.request(`/api/cell-lines/${lineId}/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '잘못된 조건', origin: 'manual', fields: { serum_pct: 150 } }),
    });
    expect(res.status).toBe(400);
  });
});
