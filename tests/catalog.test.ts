import { describe, expect, it, vi } from 'vitest';
import type * as Config from '../src/server/config';

// Each test file gets its own in-memory database (seeded from the repo's seed/ folder).
vi.mock('../src/server/config', async (importOriginal) => {
  const actual = await importOriginal<typeof Config>();
  return { ...actual, PATHS: { ...actual.PATHS, db: ':memory:' } };
});
import { createApp } from '../src/server/app';
import type { CatalogOption } from '../src/shared/catalog';

const app = createApp();
const json = (method: string, body: unknown) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const list = async (query: string) => (await (await app.request(`/api/catalog?${query}`)).json()) as CatalogOption[];

describe('catalog options', () => {
  it('lists seeded built-in options', async () => {
    const media = await list('category=base_medium');
    expect(media.map((o) => o.label)).toContain('RPMI 1640');
    expect(media.every((o) => o.builtin && o.category === 'base_medium')).toBe(true);
  });

  it('returns the existing option for a case-insensitive duplicate', async () => {
    const rpmi = (await list('category=base_medium')).find((o) => o.label === 'RPMI 1640')!;
    const res = await app.request('/api/catalog', json('POST', { category: 'base_medium', label: '  rpmi 1640 ' }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as CatalogOption).id).toBe(rpmi.id);
  });

  it('rejects an unknown category and built-in deletion or rename', async () => {
    expect((await app.request('/api/catalog', json('POST', { category: 'nope', label: 'x' }))).status).toBe(400);
    const fbs = (await list('category=serum')).find((o) => o.label === 'FBS')!;
    const del = await app.request(`/api/catalog/${fbs.id}`, { method: 'DELETE' });
    expect(del.status).toBe(400);
    expect(await del.json()).toEqual({ error: '기본 항목은 숨기기만 할 수 있습니다' });
    expect((await app.request(`/api/catalog/${fbs.id}`, json('PUT', { label: 'Fetal' }))).status).toBe(400);
  });

  it('hides an option from the default list but keeps it with all=1', async () => {
    const accutase = (await list('category=dissociation')).find((o) => o.label === 'Accutase')!;
    expect((await app.request(`/api/catalog/${accutase.id}`, json('PUT', { hidden: true }))).status).toBe(200);
    expect((await list('category=dissociation')).some((o) => o.id === accutase.id)).toBe(false);
    expect((await list('category=dissociation&all=1')).find((o) => o.id === accutase.id)?.hidden).toBe(true);
  });

  it('deletes a user option', async () => {
    const created = (await (await app.request('/api/catalog', json('POST', { category: 'coating', label: 'My coating' }))).json()) as CatalogOption;
    expect(created.builtin).toBe(false);
    expect((await app.request(`/api/catalog/${created.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await list('category=coating&all=1')).some((o) => o.id === created.id)).toBe(false);
  });
});
