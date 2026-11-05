import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Config from '../src/server/config';
import type { CellLineDto, ProfileDto } from '../src/shared/cell-line';
import type { CatalogOption } from '../src/shared/catalog';
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
