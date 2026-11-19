import { describe, expect, it, vi } from 'vitest';
import type * as Config from '../src/server/config';

vi.mock('../src/server/config', async (importOriginal) => {
  const actual = await importOriginal<typeof Config>();
  return { ...actual, PATHS: { ...actual.PATHS, db: ':memory:' } };
});
import { createApp } from '../src/server/app';
import { getMediumProduct, getVesselProduct } from '../src/server/lab-products';
import { mediumRecipe, validateExecutionPlan, type CultureExecutionPlan } from '../src/shared/culture-plan';
import {
  formatVesselUse,
  REFERENCE_VESSEL_PRODUCTS,
  snapshotMediumProduct,
  validateMediumProductInput,
  validateVesselProductInput,
  validateVesselUse,
  vesselArea,
  type MediumProduct,
  type VesselProduct,
} from '../src/shared/lab-products';
import { calculateVesselChange } from '../src/shared/vessel-change';

const ref = (id: string) => REFERENCE_VESSEL_PRODUCTS.find((p) => p.id === id)!;
const vessel = (over: Partial<VesselProduct> = {}): VesselProduct => ({ ...ref('ref:12-well'), id: 'v1', ...over });

describe('vessel reference specs', () => {
  it('covers the common formats from the catalog area table, unverified and without medium volumes', () => {
    for (const id of ['ref:6-well', 'ref:12-well', 'ref:60 mm dish', 'ref:100 mm dish']) expect(ref(id)).toBeTruthy();
    expect(ref('ref:12-well')).toMatchObject({ wellsPerUnit: 12, areaCm2PerWell: 3.8, specStatus: 'reference', surfaceTreatment: 'unknown' });
    expect(ref('ref:60 mm dish')).toMatchObject({ wellsPerUnit: 1, areaCm2PerWell: 21 });
    for (const p of REFERENCE_VESSEL_PRODUCTS) {
      expect(p.mediumMinMlPerWell).toBeNull();
      expect(p.mediumMaxMlPerWell).toBeNull();
      expect(p.specStatus).toBe('reference');
    }
  });

  it('computes total area from used wells and rejects bad counts', () => {
    expect(vesselArea(ref('ref:12-well'), 3)).toBeCloseTo(11.4);
    expect(vesselArea({ areaCm2PerWell: null }, 2)).toBeNull();
    expect(() => vesselArea(ref('ref:12-well'), 0)).toThrow();
    expect(() => vesselArea(ref('ref:12-well'), 1.5)).toThrow();
    expect(vesselArea(ref('ref:60 mm dish'), 2)).toBe(42);
  });

  it('counts dishes as vessels and plates as wells across plates', () => {
    expect(formatVesselUse(ref('ref:60 mm dish'), 1)).toBe(ref('ref:60 mm dish').label);
    expect(formatVesselUse(ref('ref:60 mm dish'), 3)).toBe(`${ref('ref:60 mm dish').label} × 3`);
    expect(formatVesselUse(ref('ref:12-well'), 13)).toBe(`${ref('ref:12-well').label} · 13 well (plate 2개)`);
  });
});

describe('vessel product validation', () => {
  const base = { label: '내 12-well', format: '12-well', wellsPerUnit: 12, areaCm2PerWell: 3.5 };
  it('defaults to an unverified reference with unknown surface and no medium volume', () => {
    expect(validateVesselProductInput(base)).toMatchObject({
      surfaceTreatment: 'unknown',
      specStatus: 'reference',
      mediumMinMlPerWell: null,
      mediumMaxMlPerWell: null,
      url: null,
    });
  });
  it('requires a source for recommended medium volumes and for product-confirmed specs', () => {
    expect(() => validateVesselProductInput({ ...base, mediumMinMlPerWell: 1 })).toThrow('출처');
    expect(validateVesselProductInput({ ...base, mediumMinMlPerWell: 1, mediumMaxMlPerWell: 2, sourceLabel: '데이터시트' }).mediumMaxMlPerWell).toBe(2);
    expect(() => validateVesselProductInput({ ...base, specStatus: 'product_confirmed' })).toThrow();
    expect(() => validateVesselProductInput({ ...base, specStatus: 'product_confirmed', areaCm2PerWell: null, sourceLabel: 's' })).toThrow();
    expect(validateVesselProductInput({ ...base, specStatus: 'product_confirmed', sourceLabel: 's' }).specStatus).toBe('product_confirmed');
  });
  it('rejects malformed values', () => {
    const bad: Record<string, unknown>[] = [
      { label: '' },
      { format: '' },
      { wellsPerUnit: 0 },
      { wellsPerUnit: 2.5 },
      { areaCm2PerWell: -1 },
      { areaCm2PerWell: Number.NaN },
      { surfaceTreatment: 'maybe' },
      { url: 'javascript:alert(1)' },
      { mediumMinMlPerWell: 3, mediumMaxMlPerWell: 2, sourceLabel: 's' },
    ];
    for (const change of bad) expect(() => validateVesselProductInput({ ...base, ...change })).toThrow();
  });
  it('validates a culture vessel use', () => {
    expect(validateVesselUse({ vesselProductId: 'a', usedWells: 2, mediumMl: 1.5 })).toEqual({ vesselProductId: 'a', usedWells: 2, mediumMl: 1.5 });
    expect(validateVesselUse({ vesselProductId: 'a', usedWells: 1 }).mediumMl).toBeNull();
    for (const bad of [null, {}, { vesselProductId: 'a', usedWells: 0 }, { vesselProductId: 'a', usedWells: 1, mediumMl: 0 }, { vesselProductId: '', usedWells: 1 }])
      expect(() => validateVesselUse(bad)).toThrow();
  });
});

describe('vessel change calculator', () => {
  it('seeds by density: cells and resulting density follow total used area', () => {
    const r = calculateVesselChange({ source: null, target: { product: ref('ref:12-well'), usedWells: 3 }, seed: { kind: 'density', densityPerCm2: 2e4 } });
    expect(r.targetAreaCm2).toBeCloseTo(11.4);
    expect(r.targetCells).toBeCloseTo(228000);
    expect(r.resultingDensityPerCm2).toBeCloseTo(2e4);
    expect(r.mediumMl).toBeNull();
    expect(r.surface.check).toBe('not_compared');
    expect(r.warnings.some((w) => w.includes('권장 배지 부피'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('참고 사양'))).toBe(true);
  });

  it('seeds by actual cell count and reports the resulting density', () => {
    const r = calculateVesselChange({ source: null, target: { product: ref('ref:6-well'), usedWells: 2 }, seed: { kind: 'cells', cells: 190000 } });
    expect(r.targetAreaCm2).toBeCloseTo(19);
    expect(r.resultingDensityPerCm2).toBeCloseTo(1e4);
  });

  it('keeps the source density across different vessels and gives the area ratio', () => {
    const r = calculateVesselChange({
      source: { product: ref('ref:6-well'), usedWells: 2, cells: 1.9e6 },
      target: { product: ref('ref:12-well'), usedWells: 3 },
      seed: { kind: 'same_density' },
    });
    expect(r.sourceAreaCm2).toBeCloseTo(19);
    expect(r.sourceDensityPerCm2).toBeCloseTo(1e5);
    expect(r.targetCells).toBeCloseTo(1.14e6);
    expect(r.areaRatio).toBeCloseTo(0.6);
  });

  it('gives a medium range only from entered per-well volumes, scaled by used wells', () => {
    const known = vessel({ mediumMinMlPerWell: 0.5, mediumMaxMlPerWell: 1, sourceLabel: '데이터시트', specStatus: 'product_confirmed' });
    const r = calculateVesselChange({ source: null, target: { product: known, usedWells: 3 }, seed: { kind: 'density', densityPerCm2: 1e4 } });
    expect(r.mediumMl).toEqual({ min: 1.5, max: 3 });
    expect(r.warnings.some((w) => w.includes('권장 배지 부피'))).toBe(false);
    expect(r.warnings.some((w) => w.includes('참고 사양'))).toBe(false);
  });

  it('never calls surfaces compatible unless both are stated and equal, and warns on mismatch or unknown', () => {
    const run = (a: VesselProduct['surfaceTreatment'], b: VesselProduct['surfaceTreatment']) =>
      calculateVesselChange({
        source: { product: vessel({ surfaceTreatment: a }), usedWells: 1, cells: 1e5 },
        target: { product: vessel({ id: 'v2', surfaceTreatment: b }), usedWells: 1 },
        seed: { kind: 'density', densityPerCm2: 1e4 },
      });
    expect(run('treated', 'treated').surface.check).toBe('match_stated');
    expect(run('untreated', 'untreated').surface.check).toBe('match_stated');
    const mismatch = run('treated', 'untreated');
    expect(mismatch.surface.check).toBe('mismatch');
    expect(mismatch.warnings.some((w) => w.includes('표면 처리 표기가 다릅니다'))).toBe(true);
    expect(run('unknown', 'treated').surface.check).toBe('unverified');
    expect(run('unknown', 'unknown').surface.check).toBe('unverified');
    expect(run('unknown', 'unknown').warnings.some((w) => w.includes('표면 처리가 확인되지 않은'))).toBe(true);
  });

  it('does not treat different formats as equivalent: same area only if the specs say so', () => {
    // 60 mm dish (21 cm²) vs T25 (25 cm²): different areas, no equivalence assumed.
    const r = calculateVesselChange({
      source: { product: ref('ref:60 mm dish'), usedWells: 1, cells: 21e5 },
      target: { product: ref('ref:T25'), usedWells: 1 },
      seed: { kind: 'same_density' },
    });
    expect(r.areaRatio).toBeCloseTo(25 / 21);
    expect(r.surface.check).toBe('unverified');
  });

  it('warns when seeding more cells than the source holds', () => {
    const r = calculateVesselChange({
      source: { product: ref('ref:6-well'), usedWells: 1, cells: 1000 },
      target: { product: ref('ref:100 mm dish'), usedWells: 1 },
      seed: { kind: 'density', densityPerCm2: 1e4 },
    });
    expect(r.warnings.some((w) => w.includes('현재 용기의 세포 수보다 많습니다'))).toBe(true);
  });

  it('throws on unusable input', () => {
    const t = { product: ref('ref:12-well'), usedWells: 1 };
    expect(() => calculateVesselChange({ source: null, target: { ...t, usedWells: 0 }, seed: { kind: 'density', densityPerCm2: 1 } })).toThrow();
    expect(() => calculateVesselChange({ source: null, target: { product: vessel({ areaCm2PerWell: null }), usedWells: 1 }, seed: { kind: 'density', densityPerCm2: 1 } })).toThrow('면적');
    expect(() => calculateVesselChange({ source: null, target: t, seed: { kind: 'density', densityPerCm2: 0 } })).toThrow();
    expect(() => calculateVesselChange({ source: null, target: t, seed: { kind: 'cells', cells: Number.NaN } })).toThrow();
    expect(() => calculateVesselChange({ source: null, target: t, seed: { kind: 'same_density' } })).toThrow('현재 밀도');
    expect(() => calculateVesselChange({ source: { product: vessel({ areaCm2PerWell: null }), usedWells: 1, cells: 5 }, target: t, seed: { kind: 'same_density' } })).toThrow();
  });
});

describe('medium product validation', () => {
  const fbs = { kind: 'serum', label: '시험용 혈청', ingredients: [{ label: '성분 A', value: 100, unit: 'U/mL' }], ingredientsConfirmed: true };
  it('accepts confirmed ingredients only when ingredients exist', () => {
    expect(validateMediumProductInput(fbs)).toMatchObject({ ingredientsConfirmed: true, manufacturer: '', lotNo: '', url: null });
    expect(() => validateMediumProductInput({ ...fbs, ingredients: [] })).toThrow();
    expect(validateMediumProductInput({ kind: 'other', label: 'x' }).ingredientsConfirmed).toBe(false);
  });
  it('keeps a strength (X) only on freezing media and within 1–20X', () => {
    const medium = { kind: 'freezing_medium', label: '2X 동결 배지', strengthX: 2 };
    expect(validateMediumProductInput(medium).strengthX).toBe(2);
    expect(validateMediumProductInput({ ...medium, kind: 'serum' }).strengthX).toBeNull();
    expect(() => validateMediumProductInput({ ...medium, strengthX: 0.5 })).toThrow('1–20X');
  });
  it('rejects bad kinds, concentrations and urls', () => {
    for (const bad of [{ kind: 'wine' }, { label: ' ' }, { ingredients: [{ label: 'a', value: 0, unit: 'U/mL' }] }, { ingredients: [{ label: 'a', value: 1, unit: '' }] }, { url: 'ftp://x' }])
      expect(() => validateMediumProductInput({ ...fbs, ...bad })).toThrow();
  });
});

function product(over: Partial<MediumProduct> = {}): MediumProduct {
  return {
    id: 'p1',
    kind: 'antibiotic',
    label: '시험용 항생제',
    manufacturer: '제조사',
    catalogNo: 'C-1',
    lotNo: 'L-9',
    ingredients: [{ label: '성분 A', value: 10000, unit: 'U/mL' }],
    ingredientsConfirmed: true,
    strengthX: null,
    sourceLabel: '라벨',
    url: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}
function planWith(component: NonNullable<CultureExecutionPlan['mediumRecipe']>['components'][number], base?: object): CultureExecutionPlan {
  const step = { instructions: '', recordLabels: [] };
  return {
    version: 1,
    summary: '',
    conditions: [],
    steps: { stock: step, thaw: step, feed: step, passage: step, freeze: step },
    mediumRecipe: { baseLabel: '기본 배지', ...base, components: [component] },
  };
}

describe('recipe product links', () => {
  const at = '2026-02-02T00:00:00.000Z';
  const linked = (p: MediumProduct, over = {}) => ({
    id: 'c1',
    label: p.label,
    percent: 1,
    stockConfirmed: p.ingredientsConfirmed,
    stockIngredients: p.ingredients.map((i) => ({ ...i })),
    productId: p.id,
    product: snapshotMediumProduct(p, at),
    ...over,
  });

  it('round-trips a linked product and legacy components without extra keys', () => {
    const p = product();
    const plan = planWith(linked(p), { baseProductId: 'b1', baseProduct: snapshotMediumProduct(product({ id: 'b1', kind: 'base_medium', ingredients: [], ingredientsConfirmed: false }), at) });
    expect(validateExecutionPlan(plan)).toEqual(plan);
    const legacy = planWith({ id: 'a', label: '첨가물', percent: 5, stockConfirmed: false, stockIngredients: [] });
    const out = validateExecutionPlan(legacy)!;
    expect(out).toEqual(legacy);
    expect(Object.keys(out.mediumRecipe!)).toEqual(['baseLabel', 'components']);
    expect('productId' in out.mediumRecipe!.components[0]).toBe(false);
  });

  it('shows final concentration only when the product was confirmed', () => {
    const confirmed = linked(product());
    expect(mediumRecipe(planWith(confirmed), 100)!.components[0].finalIngredients).toEqual([{ label: '성분 A', value: 100, unit: 'U/mL' }]);
    const unconfirmedProduct = product({ ingredientsConfirmed: false });
    const unconfirmed = planWith(linked(unconfirmedProduct));
    expect(mediumRecipe(unconfirmed, 100)!.components[0].finalIngredients).toBeNull();
    // Even a tampered plan claiming confirmation cannot show a concentration; validation also refuses it.
    const tampered = planWith(linked(unconfirmedProduct, { stockConfirmed: true }));
    expect(mediumRecipe(tampered, 100)!.components[0].finalIngredients).toBeNull();
    expect(() => validateExecutionPlan(tampered)).toThrow();
  });

  it('rejects mismatched links, diverging stock and half links', () => {
    const p = product();
    expect(() => validateExecutionPlan(planWith(linked(p, { productId: 'other' })))).toThrow();
    expect(() => validateExecutionPlan(planWith(linked(p, { stockIngredients: [{ label: '성분 A', value: 5, unit: 'U/mL' }] })))).toThrow();
    expect(() => validateExecutionPlan(planWith(linked(p, { product: undefined })))).toThrow();
    const { productId: _id, ...noId } = linked(p);
    expect(() => validateExecutionPlan(planWith(noId))).toThrow();
  });

  it('freezes the product at selection time: later product edits never change the recipe', () => {
    const p = product();
    const plan = planWith(linked(p));
    const edited = { ...p, ingredients: [{ label: '성분 A', value: 1, unit: 'U/mL' }], lotNo: 'L-10', updatedAt: '2026-03-03T00:00:00.000Z' };
    const stored = validateExecutionPlan(JSON.parse(JSON.stringify(plan)))!;
    expect(stored.mediumRecipe!.components[0].product!.lotNo).toBe('L-9');
    expect(mediumRecipe(stored, 100)!.components[0].finalIngredients![0].value).toBe(100);
    expect(edited.ingredients[0].value).toBe(1);
    // The snapshot is a deep copy of the product at that time.
    const snap = snapshotMediumProduct(p, at);
    p.ingredients[0].value = 7;
    expect(snap.ingredients[0].value).toBe(10000);
  });
});

describe('lab product routes', () => {
  const app = createApp();
  const send = (method: string, path: string, body?: unknown) =>
    app.request(`/api/lab-products${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

  it('lists built-in reference vessels first and keeps them immutable', async () => {
    const list = (await (await send('GET', '/vessels')).json()) as VesselProduct[];
    const twelve = list.find((p) => p.id === 'ref:12-well')!;
    expect(twelve).toMatchObject({ specStatus: 'reference', mediumMinMlPerWell: null, surfaceTreatment: 'unknown' });
    expect(getVesselProduct('ref:6-well')?.areaCm2PerWell).toBe(9.5);
    expect((await send('PUT', '/vessels/ref:12-well', { label: 'x' })).status).toBe(400);
    expect((await send('DELETE', '/vessels/ref:12-well')).status).toBe(400);
    expect((await send('GET', '/vessels/ref:nope')).status).toBe(404);
  });

  it('creates, partially updates and deletes a vessel product', async () => {
    const created = await send('POST', '/vessels', {
      label: '시험용 24-well',
      format: '24-well',
      manufacturer: '제조사',
      catalogNo: 'W24',
      wellsPerUnit: 24,
      areaCm2PerWell: 1.9,
      surfaceTreatment: 'treated',
    });
    expect(created.status).toBe(201);
    const product = (await created.json()) as VesselProduct;
    expect(product).toMatchObject({ specStatus: 'reference', surfaceTreatment: 'treated', mediumMinMlPerWell: null });
    expect(getVesselProduct(product.id)).toEqual(product);
    expect(((await (await send('GET', '/vessels?reference=0')).json()) as VesselProduct[]).map((p) => p.id)).toEqual([product.id]);

    expect((await send('PUT', `/vessels/${product.id}`, { mediumMinMlPerWell: 0.5 })).status).toBe(400);
    const updated = (await (await send('PUT', `/vessels/${product.id}`, { mediumMinMlPerWell: 0.5, mediumMaxMlPerWell: 1, sourceLabel: '데이터시트', specStatus: 'product_confirmed' })).json()) as VesselProduct;
    expect(updated).toMatchObject({ label: '시험용 24-well', mediumMinMlPerWell: 0.5, mediumMaxMlPerWell: 1, specStatus: 'product_confirmed' });

    expect((await send('POST', '/vessels', { label: 'x' })).status).toBe(400);
    expect((await send('DELETE', `/vessels/${product.id}`)).status).toBe(200);
    expect(getVesselProduct(product.id)).toBeNull();
    expect((await send('DELETE', `/vessels/${product.id}`)).status).toBe(404);
  });

  it('creates, filters, updates and deletes medium products with confirmed ingredients', async () => {
    const body = { kind: 'antibiotic', label: '시험용 PS', manufacturer: '제조사', catalogNo: 'A1', lotNo: 'L1', ingredients: [{ label: '성분 A', value: 10000, unit: 'U/mL' }, { label: '성분 B', value: 10, unit: 'mg/mL' }], ingredientsConfirmed: true, sourceLabel: '라벨' };
    const created = await send('POST', '/media', body);
    expect(created.status).toBe(201);
    const product = (await created.json()) as MediumProduct;
    expect(product).toMatchObject({ kind: 'antibiotic', ingredientsConfirmed: true, lotNo: 'L1' });
    expect(product.ingredients).toHaveLength(2);
    expect(getMediumProduct(product.id)).toEqual(product);

    await send('POST', '/media', { kind: 'serum', label: '시험용 혈청' });
    const serums = (await (await send('GET', '/media?kind=serum')).json()) as MediumProduct[];
    expect(serums.map((p) => p.label)).toEqual(['시험용 혈청']);
    expect(serums[0].ingredientsConfirmed).toBe(false);
    expect((await send('GET', '/media?kind=wine')).status).toBe(400);

    // Editing ingredients so none remain must also drop "confirmed".
    expect((await send('PUT', `/media/${product.id}`, { ingredients: [] })).status).toBe(400);
    const edited = (await (await send('PUT', `/media/${product.id}`, { ingredients: [], ingredientsConfirmed: false, lotNo: 'L2' })).json()) as MediumProduct;
    expect(edited).toMatchObject({ lotNo: 'L2', ingredients: [], ingredientsConfirmed: false, label: '시험용 PS' });
    expect(edited.updatedAt >= product.updatedAt).toBe(true);

    expect((await send('POST', '/media', { kind: 'other', label: 'x', ingredients: [{ label: 'a', value: -1, unit: 'u' }] })).status).toBe(400);
    expect((await send('DELETE', `/media/${product.id}`)).status).toBe(200);
    expect((await send('GET', `/media/${product.id}`)).status).toBe(404);
  });
});

describe('product edits never rewrite a saved recipe', () => {
  const app = createApp();
  const call = (method: string, path: string, body?: unknown) =>
    app.request(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

  it('keeps the frozen snapshot and stock in a stored profile after the product changes', async () => {
    const productRes = await call('POST', '/api/lab-products/media', {
      kind: 'serum',
      label: '시험용 혈청',
      lotNo: 'L1',
      ingredients: [{ label: '성분 A', value: 200, unit: 'U/mL' }],
      ingredientsConfirmed: true,
    });
    const p = (await productRes.json()) as MediumProduct;
    const step = { instructions: '', recordLabels: [] };
    const plan = {
      version: 1,
      summary: '',
      conditions: [],
      steps: { stock: step, thaw: step, feed: step, passage: step, freeze: step },
      mediumRecipe: {
        baseLabel: '기본 배지',
        components: [
          {
            id: 'c1',
            label: p.label,
            percent: 10,
            stockConfirmed: true,
            stockIngredients: p.ingredients,
            productId: p.id,
            product: snapshotMediumProduct(p, '2026-02-02T00:00:00.000Z'),
          },
        ],
      },
    };
    const line = (await (await call('POST', '/api/cell-lines', { name: '시험 세포주', growthMode: 'adherent' })).json()) as { id: string };
    const created = await call('POST', `/api/cell-lines/${line.id}/profiles`, { name: '조성', origin: 'manual', fields: {}, executionPlan: plan });
    expect(created.status).toBe(201);

    await call('PUT', `/api/lab-products/media/${p.id}`, { lotNo: 'L2', ingredients: [{ label: '성분 A', value: 1, unit: 'U/mL' }] });
    await call('DELETE', `/api/lab-products/media/${p.id}`);

    const detail = (await (await call('GET', `/api/cell-lines/${line.id}`)).json()) as { profiles: { executionPlan: typeof plan }[] };
    const component = detail.profiles[0].executionPlan.mediumRecipe.components[0];
    expect(component.product.lotNo).toBe('L1');
    expect(component.stockIngredients).toEqual([{ label: '성분 A', value: 200, unit: 'U/mL' }]);
    expect(component.productId).toBe(p.id);
  });
});
